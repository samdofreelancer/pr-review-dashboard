/**
 * Shared domain enums and union types (T010).
 *
 * Every string union here mirrors an enum in `contracts/openapi.yaml`,
 * `contracts/events.md`, or `data-model.md`. Server and web code must not
 * redefine these locally; contract guards keep them in sync with the specs.
 */

// ---------------------------------------------------------------------------
// Pull request / lane domain
// ---------------------------------------------------------------------------

/** The five board lanes. Values match the wire strings exactly. */
export const LANES = ['Draft', 'In review', 'Request changes', 'Approved', 'Done'] as const;
export type LaneName = (typeof LANES)[number];

/** Pull request state as derived from GitHub (FR-020 keeps inaccessible non-terminal). */
export const PR_STATES = ['open', 'merged', 'closed', 'inaccessible'] as const;
export type PullRequestState = (typeof PR_STATES)[number];

/** GitHub's current review decision (GraphQL `reviewDecision`). */
export const REVIEW_DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Per-review state persisted in `pull_request_reviews`. */
export const REVIEW_STATES = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'DISMISSED',
  'COMMENTED',
  'PENDING',
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** Only these states carry lane decisions (FR-013); COMMENTED/PENDING never override. */
export const DECISION_BEARING_REVIEW_STATES = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'DISMISSED',
] as const;
export type DecisionBearingReviewState = (typeof DECISION_BEARING_REVIEW_STATES)[number];

/** Aggregate checks precedence order (data-model.md): failing → pending → passing → neutral → none. */
export const CHECKS_STATES = ['failing', 'pending', 'passing', 'neutral', 'none'] as const;
export type ChecksState = (typeof CHECKS_STATES)[number];
/** Checks aggregate aligned with its precedence order for deterministic sorting. */
export const CHECKS_STATE_PRECEDENCE: readonly ChecksState[] = CHECKS_STATES;

export const MERGEABILITY_STATES = ['mergeable', 'conflicting', 'unknown'] as const;
export type Mergeability = (typeof MERGEABILITY_STATES)[number];

/** Pull request diff scoreboard on the PR detail payload (distinct from DiffStatus). */
export const PR_DIFF_STATES = ['none', 'preparing', 'ready', 'stale', 'invalid'] as const;
export type PullRequestDiffState = (typeof PR_DIFF_STATES)[number];

export const REPOSITORY_VISIBILITIES = ['public', 'private', 'internal'] as const;
export type RepositoryVisibility = (typeof REPOSITORY_VISIBILITIES)[number];

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export const SYNC_RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export const SYNC_TRIGGERS = ['startup', 'manual', 'after_action'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

/** Repository's last sync outcome stamp. */
export const LAST_SYNC_STATUSES = ['never', 'succeeded', 'partial', 'failed'] as const;
export type LastSyncStatus = (typeof LAST_SYNC_STATUSES)[number];

/** Phases reported by `sync.progress` SSE events (contracts/events.md). */
export const SYNC_SSE_PHASES = [
  'pull_requests',
  'reviews',
  'checks',
  'teams',
  'persisting',
] as const;
export type SyncSsePhase = (typeof SYNC_SSE_PHASES)[number];

// ---------------------------------------------------------------------------
// Local copies / diff
// ---------------------------------------------------------------------------

/** `local_copies.status` state machine per data-model.md. */
export const COPY_STATUSES = ['preparing', 'ready', 'stale', 'invalid', 'deleted'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

/** Statuses on the diff status payload (`GET`/`POST /api/prs/{prId}/diff`). */
export const DIFF_STATUSES = ['queued', 'preparing', 'ready', 'stale', 'invalid'] as const;
export type DiffStatus = (typeof DIFF_STATUSES)[number];

/** `diff.progress` SSE phases; `done` only on the REST status payload. */
export const DIFF_PHASES = ['fetch', 'merge_base', 'diff', 'files', 'done'] as const;
export type DiffPhase = (typeof DIFF_PHASES)[number];
/** Job-level phases emitted before completion. */
export const DIFF_JOB_PHASES = ['fetch', 'merge_base', 'diff', 'files'] as const;
export type DiffJobPhase = (typeof DIFF_JOB_PHASES)[number];

export const CHANGE_TYPES = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'mode_changed',
  'unmerged',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/** One parsed diff line inside a hunk. */
export const DIFF_LINE_KINDS = ['context', 'added', 'deleted'] as const;
export type DiffLineKind = (typeof DIFF_LINE_KINDS)[number];

// ---------------------------------------------------------------------------
// Review runs and findings
// ---------------------------------------------------------------------------

export const RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_PHASES = [
  'waiting',
  'preparing',
  'building_context',
  'calling_model',
  'validating',
  'finalizing',
  'done',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/** Advisory run verdict; never selects a publish event (FR-064/073). */
export const RUN_VERDICTS = ['approve', 'comment', 'request_changes'] as const;
export type RunVerdict = (typeof RUN_VERDICTS)[number];

export const FINDING_SOURCES = ['ai', 'manual'] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export const FINDING_SIDES = ['LEFT', 'RIGHT'] as const;
export type FindingSide = (typeof FINDING_SIDES)[number];

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'nit'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CATEGORIES = [
  'bug',
  'security',
  'performance',
  'concurrency',
  'error_handling',
  'api_contract',
  'tests',
  'maintainability',
  'style',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_VALIDATION_STATUSES = [
  'pending',
  'valid',
  'reanchored',
  'demoted',
  'invalid',
] as const;
export type FindingValidationStatus = (typeof FINDING_VALIDATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Drafts and publishing
// ---------------------------------------------------------------------------

export const DRAFT_EVENTS = ['comment', 'request_changes', 'approve'] as const;
export type DraftEvent = (typeof DRAFT_EVENTS)[number];

export const DRAFT_ORIGINS = ['ai', 'manual'] as const;
export type DraftOrigin = (typeof DRAFT_ORIGINS)[number];

export const DRAFT_STATUSES = [
  'building',
  'previewed',
  'publishing',
  'published',
  'failed',
  'uncertain',
  'blocked',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const TRIAGE_DECISIONS = ['accepted', 'dismissed'] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

export const POST_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'uncertain',
  'duplicate_detected',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPES = [
  'repo_connected',
  'sync_completed',
  'mark_ready',
  'review_started',
  'review_completed',
  'review_failed',
  'review_cancelled',
  'finding_triaged',
  'draft_previewed',
  'publish_attempted',
  'publish_succeeded',
  'publish_failed',
  'publish_uncertain',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/** Every event name on `GET /api/events` (contracts/events.md). */
export const SSE_NAMES = [
  'ready',
  'board.updated',
  'repo.updated',
  'sync.started',
  'sync.progress',
  'sync.completed',
  'diff.started',
  'diff.progress',
  'diff.completed',
  'review.started',
  'review.progress',
  'review.completed',
  'publish.started',
  'publish.progress',
  'publish.completed',
  'retention.cleanup',
] as const;
export type SseName = (typeof SSE_NAMES)[number];

/** Reasons carried by `board.updated` (contracts/events.md). */
export const BOARD_UPDATE_REASONS = [
  'sync_completed',
  'mark_ready',
  'publish_completed',
  'repo_connected',
  'repo_disconnected',
  'retention_cleanup',
] as const;
export type BoardUpdateReason = (typeof BOARD_UPDATE_REASONS)[number];

/** Phases reported by `publish.progress` SSE events. */
export const PUBLISH_SSE_PHASES = [
  'verifying_head',
  'verifying_marker',
  'submitting',
  'verifying_outcome',
] as const;
export type PublishSsePhase = (typeof PUBLISH_SSE_PHASES)[number];

/** Fallback markers surfaced by `publish.completed` (contracts/events.md). */
export const PUBLISH_FALLBACK_REASONS = ['anchors_demoted', 'comment_event_fallback'] as const;
export type PublishFallbackReason = (typeof PUBLISH_FALLBACK_REASONS)[number];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Stable error codes mapped by the API layer (T022 owns the mapping; codes live here). */
export const ERROR_CODES = [
  'AUTH_MISSING',
  'AUTH_INVALID',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'OFFLINE',
  'NOT_FOUND',
  'CONFLICT',
  'STALE_HEAD',
  'PR_CLOSED',
  'PREVIEW_EXPIRED',
  'PREVIEW_MISMATCH',
  'PUBLISH_IN_FLIGHT',
  'AI_FAILED',
  'AI_INVALID_OUTPUT',
  'GIT_MISSING',
  'GIT_PREP_FAILED',
  'SECRET_EXCLUDED',
  'VALIDATION_FAILED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HEALTH_STATUSES = ['ready', 'degraded'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const DATABASE_STATUSES = ['ok', 'migrating', 'error'] as const;
export type DatabaseStatus = (typeof DATABASE_STATUSES)[number];
