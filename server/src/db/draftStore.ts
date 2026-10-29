/**
 * Review draft and draft-finding data access (T020).
 *
 * Invariants carried here:
 * - AI findings stay immutable; triage edits live as overrides in
 *   `draft_findings` (US3-10, FR-070) and the base row is returned untouched.
 * - A draft's unique hidden marker is derived from its id never changes
 *   (FR-081/083).
 * - `run_id` is nullable; `origin` `ai` ⇔ non-null run, `manual` ⇔ null run.
 */
import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { Database } from './connection.js';
import type {
  ChecksState,
  DraftEvent,
  DraftOrigin,
  DraftStatus,
  FindingCategory,
  FindingSeverity,
  FindingSide,
  FindingSource,
  FindingValidationStatus,
  LaneName,
  Mergeability,
  PullRequestState,
  ReviewDecision,
  RunStatus,
  TriageDecision,
} from '@pr-review-dashboard/shared';

// ---------------------------------------------------------------------------
// Findings (both AI rows and manual rows share this table)
// ---------------------------------------------------------------------------

export interface FindingRow {
  readonly id: string;
  readonly runId: string | null;
  readonly source: FindingSource;
  readonly path: string;
  readonly side: FindingSide;
  readonly line: number;
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly title: string;
  readonly explanation: string;
  readonly confidence: number;
  readonly quotedCode: string | null;
  readonly suggestion: string | null;
  readonly validationStatus: FindingValidationStatus;
  readonly resolvedPath: string | null;
  readonly resolvedSide: FindingSide | null;
  readonly resolvedLine: number | null;
  readonly dedupeKey: string;
  readonly createdAt: string;
}

interface FindingRecord {
  id: string;
  run_id: string | null;
  source: string;
  path: string;
  side: string;
  line: number;
  severity: string;
  category: string;
  title: string;
  explanation: string;
  confidence: number;
  quoted_code: string | null;
  suggestion: string | null;
  validation_status: string;
  resolved_path: string | null;
  resolved_side: string | null;
  resolved_line: number | null;
  dedupe_key: string;
  created_at: string;
}

export interface FindingInsert {
  readonly id?: string;
  readonly runId: string | null;
  readonly source: FindingSource;
  readonly path: string;
  readonly side: FindingSide;
  readonly line: number;
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly title: string;
  readonly explanation: string;
  readonly confidence: number;
  readonly quotedCode: string | null;
  readonly suggestion: string | null;
  readonly validationStatus: FindingValidationStatus;
  readonly resolvedPath: string | null;
  readonly resolvedSide: FindingSide | null;
  readonly resolvedLine: number | null;
  /** Normalized path/side/line/explanation hash; uniqueness guarded for AI rows. */
  readonly dedupeKey: string;
}

function mapFinding(row: FindingRecord): FindingRow {
  return {
    id: row.id,
    runId: row.run_id,
    source: row.source as FindingSource,
    path: row.path,
    side: row.side as FindingSide,
    line: row.line,
    severity: row.severity as FindingSeverity,
    category: row.category as FindingCategory,
    title: row.title,
    explanation: row.explanation,
    confidence: row.confidence,
    quotedCode: row.quoted_code,
    suggestion: row.suggestion,
    validationStatus: row.validation_status as FindingValidationStatus,
    resolvedPath: row.resolved_path,
    resolvedSide: row.resolved_side as FindingSide | null,
    resolvedLine: row.resolved_line,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
  };
}

export function insertFinding(db: Database, input: FindingInsert): string {
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO findings
       (id, run_id, source, path, side, line, severity, category, title, explanation, confidence,
        quoted_code, suggestion, validation_status, resolved_path, resolved_side, resolved_line, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
  ).run(
    id,
    input.runId,
    input.source,
    input.path,
    input.side,
    input.line,
    input.severity,
    input.category,
    input.title,
    input.explanation,
    input.confidence,
    input.quotedCode,
    input.suggestion,
    input.validationStatus,
    input.resolvedPath,
    input.resolvedSide,
    input.resolvedLine,
    input.dedupeKey,
    new Date().toISOString(),
  );
  return id;
}

export function getFinding(db: Database, findingId: string): FindingRow | null {
  const row = db.prepare('SELECT * FROM findings WHERE id = ?;').get(findingId) as
    FindingRecord | undefined;
  return row === undefined ? null : mapFinding(row);
}

/** AI rows are never updated; run results arrive once per completed run. */
export function listFindingsForRun(db: Database, runId: string): FindingRow[] {
  const rows = db
    .prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY created_at;')
    .all(runId) as unknown as FindingRecord[];
  return rows.map(mapFinding);
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface ReviewDraftRow {
  readonly id: string;
  readonly prId: string;
  readonly origin: DraftOrigin;
  readonly runId: string | null;
  readonly summary: string;
  readonly event: DraftEvent;
  readonly marker: string;
  readonly targetHeadSha: string;
  readonly status: DraftStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DraftRecord {
  id: string;
  pr_id: string;
  origin: string;
  run_id: string | null;
  summary: string;
  event: string;
  marker: string;
  target_head_sha: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapDraft(row: DraftRecord): ReviewDraftRow {
  return {
    id: row.id,
    prId: row.pr_id,
    origin: row.origin as DraftOrigin,
    runId: row.run_id,
    summary: row.summary,
    event: row.event as DraftEvent,
    marker: row.marker,
    targetHeadSha: row.target_head_sha,
    status: row.status as DraftStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Hidden GitHub marker for a draft; constant for the draft's lifetime (FR-081). */
export function draftMarker(draftId: string): string {
  return `<!-- pr-review-dashboard:draft=${draftId} -->`;
}

export interface CreateDraftInput {
  readonly prId: string;
  /** Required for origin=ai, null for origin=manual. */
  readonly runId: string | null;
  readonly origin: DraftOrigin;
  readonly summary: string;
  readonly event: DraftEvent;
  readonly targetHeadSha: string;
}

export function createDraft(db: Database, input: CreateDraftInput): string {
  if (input.origin === 'ai' && input.runId === null) {
    throw new Error('AI-origin draft requires a completed run id (FR-070)');
  }
  if (input.origin === 'manual' && input.runId !== null) {
    throw new Error('Manual draft must not carry a run id (FR-070)');
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO review_drafts
       (id, pr_id, run_id, origin, summary, event, marker, target_head_sha, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'building', ?, ?);`,
  ).run(
    id,
    input.prId,
    input.runId,
    input.origin,
    input.summary,
    input.event,
    draftMarker(id),
    input.targetHeadSha,
    now,
    now,
  );
  return id;
}

export function getDraft(db: Database, draftId: string): ReviewDraftRow | null {
  const row = db.prepare('SELECT * FROM review_drafts WHERE id = ?;').get(draftId) as
    DraftRecord | undefined;
  return row === undefined ? null : mapDraft(row);
}

export function listDraftsForPullRequest(db: Database, prId: string): ReviewDraftRow[] {
  const rows = db
    .prepare('SELECT * FROM review_drafts WHERE pr_id = ? ORDER BY created_at;')
    .all(prId) as unknown as DraftRecord[];
  return rows.map(mapDraft);
}

export function updateDraft(
  db: Database,
  draftId: string,
  patch: { readonly summary?: string; readonly event?: DraftEvent },
): void {
  const assignments: string[] = [];
  const values: SQLInputValue[] = [];
  if (patch.summary !== undefined) {
    assignments.push('summary = ?');
    values.push(patch.summary);
  }
  if (patch.event !== undefined) {
    assignments.push('event = ?');
    values.push(patch.event);
  }
  if (assignments.length === 0) return;
  assignments.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(draftId);
  db.prepare(`UPDATE review_drafts SET ${assignments.join(', ')} WHERE id = ?;`).run(...values);
}

export function setDraftStatus(db: Database, draftId: string, status: DraftStatus): void {
  db.prepare('UPDATE review_drafts SET status = ?, updated_at = ? WHERE id = ?;').run(
    status,
    new Date().toISOString(),
    draftId,
  );
}

// ---------------------------------------------------------------------------
// Draft finding links and edits (overrides)
// ---------------------------------------------------------------------------

export interface DraftFindingRow {
  readonly findingId: string;
  readonly decision: TriageDecision;
  readonly inlineSelected: boolean;
  readonly finding: FindingRow;
  readonly edits: {
    readonly title: string | null;
    readonly explanation: string | null;
    readonly suggestion: string | null;
    readonly path: string | null;
    readonly side: FindingSide | null;
    readonly line: number | null;
  } | null;
}

interface DraftFindingRecord {
  draft_id: string;
  finding_id: string;
  decision: string;
  inline_selected: number;
  edited_title: string | null;
  edited_explanation: string | null;
  edited_suggestion: string | null;
  edited_path: string | null;
  edited_side: string | null;
  edited_line: number | null;
  updated_at: string;
}

function mapDraftFinding(link: DraftFindingRecord, finding: FindingRow): DraftFindingRow {
  const hasEdits =
    link.edited_title !== null ||
    link.edited_explanation !== null ||
    link.edited_suggestion !== null ||
    link.edited_path !== null ||
    link.edited_side !== null ||
    link.edited_line !== null;
  return {
    findingId: link.finding_id,
    decision: link.decision as TriageDecision,
    inlineSelected: link.inline_selected === 1,
    finding,
    edits: hasEdits
      ? {
          title: link.edited_title,
          explanation: link.edited_explanation,
          suggestion: link.edited_suggestion,
          path: link.edited_path,
          side: link.edited_side as FindingSide | null,
          line: link.edited_line,
        }
      : null,
  };
}

export function upsertDraftFinding(
  db: Database,
  input: {
    readonly draftId: string;
    readonly findingId: string;
    readonly decision: TriageDecision;
    readonly inlineSelected: boolean;
    readonly edits?: {
      readonly title?: string | null;
      readonly explanation?: string | null;
      readonly suggestion?: string | null;
      readonly path?: string | null;
      readonly side?: FindingSide | null;
      readonly line?: number | null;
    };
  },
): void {
  const edits = input.edits ?? {};
  db.prepare(
    `INSERT INTO draft_findings
       (draft_id, finding_id, decision, inline_selected,
        edited_title, edited_explanation, edited_suggestion, edited_path, edited_side, edited_line, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (draft_id, finding_id) DO UPDATE SET
       decision = excluded.decision,
       inline_selected = excluded.inline_selected,
       edited_title = excluded.edited_title,
       edited_explanation = excluded.edited_explanation,
       edited_suggestion = excluded.edited_suggestion,
       edited_path = excluded.edited_path,
       edited_side = excluded.edited_side,
       edited_line = excluded.edited_line,
       updated_at = excluded.updated_at;`,
  ).run(
    input.draftId,
    input.findingId,
    input.decision,
    input.inlineSelected ? 1 : 0,
    edits.title ?? null,
    edits.explanation ?? null,
    edits.suggestion ?? null,
    edits.path ?? null,
    edits.side ?? null,
    edits.line ?? null,
    new Date().toISOString(),
  );
}

export function listDraftFindings(db: Database, draftId: string): DraftFindingRow[] {
  const rows = db
    .prepare(
      `SELECT df.draft_id, df.finding_id, df.decision, df.inline_selected,
              df.edited_title, df.edited_explanation, df.edited_suggestion, df.edited_path, df.edited_side, df.edited_line, df.updated_at,
              f.id AS fid
         FROM draft_findings df
         JOIN findings f ON f.id = df.finding_id
        WHERE df.draft_id = ?
        ORDER BY f.severity, f.confidence DESC, f.path, f.line;`,
    )
    .all(draftId) as unknown as Array<DraftFindingRecord & { fid: string }>;
  return rows.map((row) => {
    const finding = getFinding(db, row.finding_id);
    if (finding === null) {
      throw new Error(`Draft finding references missing finding: ${row.finding_id}`);
    }
    return mapDraftFinding(row, finding);
  });
}

// ---------------------------------------------------------------------------
// Counts (FR-072)
// ---------------------------------------------------------------------------

export interface DraftCounts {
  readonly inline: number;
  readonly summaryOnly: number;
  readonly demoted: number;
  readonly stale: number;
}

const VALID_FOR_INLINE = "('valid', 'reanchored')";

export function computeDraftCounts(db: Database, draftId: string): DraftCounts {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN df.decision = 'accepted' AND df.inline_selected = 1 AND f.validation_status IN ${VALID_FOR_INLINE} THEN 1 ELSE 0 END) AS inline,
         SUM(CASE WHEN df.decision = 'accepted' AND (df.inline_selected = 0 OR f.validation_status = 'demoted') THEN 1 ELSE 0 END) AS summary_only,
         SUM(CASE WHEN df.decision = 'accepted' AND f.validation_status = 'demoted' THEN 1 ELSE 0 END) AS demoted,
         SUM(CASE WHEN df.decision = 'accepted' AND f.validation_status = 'invalid' THEN 1 ELSE 0 END) AS stale
         FROM draft_findings df
         JOIN findings f ON f.id = df.finding_id
        WHERE df.draft_id = ?;`,
    )
    .get(draftId) as {
    inline: number | null;
    summary_only: number | null;
    demoted: number | null;
    stale: number | null;
  };
  return {
    inline: row.inline ?? 0,
    summaryOnly: row.summary_only ?? 0,
    demoted: row.demoted ?? 0,
    stale: row.stale ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Publishability (data-model.md derived values; FR-030/070/076/078/079/080)
// ---------------------------------------------------------------------------

export interface PublishState {
  readonly prState: PullRequestState;
  readonly prIsDraft: boolean;
  readonly prIsOwnPr: boolean;
  readonly prOpenChecks: ChecksState | null;
  readonly prLane: LaneName | null;
  readonly prMergeability: Mergeability | null;
  readonly prReviewDecision: ReviewDecision | null;
  readonly online: boolean;
  readonly verifiedHeadSha: string | null;
  readonly runStatus: RunStatus | null;
  readonly runStale: boolean;
  readonly publishInFlight: boolean;
}

export interface PublishabilityResult {
  readonly publishable: boolean;
  readonly reasons: readonly string[];
  readonly blockedFor: readonly (
    | 'offline'
    | 'head_change'
    | 'pr_state'
    | 'draft_state'
    | 'ai_run'
    | 'in_flight'
    | 'event_conflict'
  )[];
}

/**
 * Publishability is derived, not stored: any head/state/online change flips
 * it without a write. `building`/`previewed` drafts may publish; anything
 * already in flight or done must not.
 */
export function computePublishability(
  draft: ReviewDraftRow,
  state: PublishState,
): PublishabilityResult {
  const reasons: string[] = [];
  const blockedFor: PublishabilityResult['blockedFor'][number][] = [];

  const activeDraftStatus = draft.status === 'building' || draft.status === 'previewed';
  if (!activeDraftStatus) {
    reasons.push('draft_state_not_active');
    blockedFor.push('draft_state');
  }
  if (state.publishInFlight) {
    reasons.push('publish_in_flight');
    blockedFor.push('in_flight');
  }
  if (!state.online) {
    reasons.push('offline');
    blockedFor.push('offline');
  }
  if (state.prState !== 'open') {
    reasons.push(`pr_state_${state.prState}`);
    blockedFor.push('pr_state');
  }
  if (state.verifiedHeadSha === null || state.verifiedHeadSha !== draft.targetHeadSha) {
    reasons.push('head_mismatch');
    blockedFor.push('head_change');
  }
  if (state.prIsOwnPr) {
    reasons.push('own_pr');
    blockedFor.push('event_conflict');
  }
  if (state.prIsDraft && draft.event === 'approve') {
    reasons.push('draft_pr_approve');
    blockedFor.push('event_conflict');
  }
  if (draft.origin === 'ai') {
    if (state.runStatus !== 'completed' || state.runStale) {
      reasons.push('ai_run_not_publishable');
      blockedFor.push('ai_run');
    }
  }

  return { publishable: reasons.length === 0, reasons, blockedFor };
}
