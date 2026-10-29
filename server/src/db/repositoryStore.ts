/**
 * Repository, sync-run, acknowledgement, and team-membership data access (T019).
 *
 * Synchronous, short, transactional access through `node:sqlite`. JSON
 * columns are written as validated strings by callers; reads parse with the
 * shared Zod schemas at the service boundary (the stores return plain rows).
 */
import { randomUUID } from 'node:crypto';
import type {
  LastSyncStatus,
  RepositoryVisibility,
  SyncRunStatus,
  SyncTrigger,
} from '@pr-review-dashboard/shared';
import { withTransaction, type Database } from './connection.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface RepositoryRow {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly githubRepoId: number;
  readonly visibility: RepositoryVisibility;
  readonly defaultBranch: string;
  readonly isArchived: boolean;
  readonly capabilities: Record<string, boolean>;
  readonly connectedAt: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly lastSyncStatus: LastSyncStatus;
}

interface RepositoryRecord {
  id: string;
  owner: string;
  name: string;
  github_repo_id: number;
  visibility: string;
  default_branch: string;
  is_archived: number;
  capabilities_json: string;
  connected_at: string;
  last_successful_sync_at: string | null;
  last_sync_status: string;
}

function mapRepository(row: RepositoryRecord): RepositoryRow {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    githubRepoId: row.github_repo_id,
    visibility: row.visibility as RepositoryVisibility,
    defaultBranch: row.default_branch,
    isArchived: row.is_archived === 1,
    capabilities: JSON.parse(row.capabilities_json) as Record<string, boolean>,
    connectedAt: row.connected_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastSyncStatus: row.last_sync_status as LastSyncStatus,
  };
}

export interface NewRepository {
  readonly owner: string;
  readonly name: string;
  readonly githubRepoId: number;
  readonly visibility: RepositoryVisibility;
  readonly defaultBranch: string;
  readonly isArchived: boolean;
  readonly capabilities: Record<string, boolean>;
  readonly connectedAt: string;
}

export function insertRepository(db: Database, input: NewRepository): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO repositories
       (id, owner, name, github_repo_id, visibility, default_branch, is_archived,
        capabilities_json, connected_at, last_successful_sync_at, last_sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'never')`,
  ).run(
    id,
    input.owner,
    input.name,
    input.githubRepoId,
    input.visibility,
    input.defaultBranch,
    input.isArchived ? 1 : 0,
    JSON.stringify(input.capabilities),
    input.connectedAt,
  );
  return id;
}

export function getRepositoryById(db: Database, repoId: string): RepositoryRow | null {
  const row = db.prepare('SELECT * FROM repositories WHERE id = ?;').get(repoId) as
    RepositoryRecord | undefined;
  return row === undefined ? null : mapRepository(row);
}

export function getRepositoryByFullName(
  db: Database,
  owner: string,
  name: string,
): RepositoryRow | null {
  const row = db
    .prepare('SELECT * FROM repositories WHERE lower(owner) = lower(?) AND lower(name) = lower(?);')
    .get(owner, name) as RepositoryRecord | undefined;
  return row === undefined ? null : mapRepository(row);
}

export function listRepositories(db: Database): RepositoryRow[] {
  const rows = db
    .prepare('SELECT * FROM repositories ORDER BY connected_at DESC;')
    .all() as unknown as RepositoryRecord[];
  return rows.map(mapRepository);
}

export function hasRepositoryWithGithubId(db: Database, githubRepoId: number): boolean {
  const row = db
    .prepare('SELECT id FROM repositories WHERE github_repo_id = ?;')
    .get(githubRepoId) as { id: string } | undefined;
  return row !== undefined;
}

export function updateRepositorySyncStamp(
  db: Database,
  repoId: string,
  status: LastSyncStatus,
  successfulAt: string | null,
): void {
  withTransaction(db, () => {
    db.prepare(`UPDATE repositories SET last_sync_status = ? WHERE id = ?;`).run(status, repoId);
    if (successfulAt !== null) {
      db.prepare(`UPDATE repositories SET last_successful_sync_at = ? WHERE id = ?;`).run(
        successfulAt,
        repoId,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Sync runs
// ---------------------------------------------------------------------------

export interface SyncRunRow {
  readonly id: string;
  readonly repoId: string;
  readonly trigger: SyncTrigger;
  readonly status: SyncRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly openSeen: number;
  readonly closedSeen: number;
  readonly partialReason: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly rateLimitResetAt: string | null;
}

interface SyncRunRecord {
  id: string;
  repo_id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  open_seen: number;
  closed_seen: number;
  partial_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  rate_limit_reset_at: string | null;
}

const SYNC_COLUMNS = `id, repo_id, trigger, status, started_at, finished_at, open_seen, closed_seen, partial_reason, error_code, error_message, rate_limit_reset_at`;

function mapSyncRun(row: SyncRunRecord): SyncRunRow {
  return {
    id: row.id,
    repoId: row.repo_id,
    trigger: row.trigger as SyncTrigger,
    status: row.status as SyncRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    openSeen: row.open_seen,
    closedSeen: row.closed_seen,
    partialReason: row.partial_reason,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    rateLimitResetAt: row.rate_limit_reset_at,
  };
}

export function createSyncRun(
  db: Database,
  repoId: string,
  trigger: SyncTrigger,
  startedAt: string,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sync_runs (id, repo_id, trigger, status, started_at) VALUES (?, ?, ?, 'running', ?);`,
  ).run(id, repoId, trigger, startedAt);
  return id;
}

export function finishSyncRun(
  db: Database,
  syncRunId: string,
  input: {
    readonly status: SyncRunStatus;
    readonly finishedAt: string;
    readonly openSeen: number;
    readonly closedSeen: number;
    readonly partialReason?: string | null;
    readonly errorCode?: string | null;
    readonly errorMessage?: string | null;
    readonly rateLimitResetAt?: string | null;
  },
): void {
  db.prepare(
    `UPDATE sync_runs
       SET status = ?, finished_at = ?, open_seen = ?, closed_seen = ?,
           partial_reason = ?, error_code = ?, error_message = ?, rate_limit_reset_at = ?
     WHERE id = ?;`,
  ).run(
    input.status,
    input.finishedAt,
    input.openSeen,
    input.closedSeen,
    input.partialReason ?? null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.rateLimitResetAt ?? null,
    syncRunId,
  );
}

export function getSyncRun(db: Database, syncRunId: string): SyncRunRow | null {
  const row = db.prepare(`SELECT ${SYNC_COLUMNS} FROM sync_runs WHERE id = ?;`).get(syncRunId) as
    SyncRunRecord | undefined;
  return row === undefined ? null : mapSyncRun(row);
}

export function getRunningSyncRun(db: Database, repoId: string): SyncRunRow | null {
  const row = db
    .prepare(
      `SELECT ${SYNC_COLUMNS} FROM sync_runs WHERE repo_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1;`,
    )
    .get(repoId) as SyncRunRecord | undefined;
  return row === undefined ? null : mapSyncRun(row);
}

export function getLatestSyncRun(db: Database, repoId: string): SyncRunRow | null {
  const row = db
    .prepare(
      `SELECT ${SYNC_COLUMNS} FROM sync_runs WHERE repo_id = ? ORDER BY started_at DESC LIMIT 1;`,
    )
    .get(repoId) as SyncRunRecord | undefined;
  return row === undefined ? null : mapSyncRun(row);
}

// ---------------------------------------------------------------------------
// AI acknowledgements (FR-008/025)
// ---------------------------------------------------------------------------

export interface AcknowledgementRow {
  readonly acknowledged: boolean;
  readonly destinationKnown: boolean;
  readonly destinationLabel: string;
  readonly acknowledgedAt: string | null;
}

export function recordAcknowledgement(
  db: Database,
  repoId: string,
  destinationLabel: string,
  acknowledgedAt: string,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO repo_acknowledgements (id, repo_id, destination, acknowledged_at) VALUES (?, ?, ?, ?);`,
  ).run(id, repoId, destinationLabel, acknowledgedAt);
  return id;
}

export function revokeAcknowledgement(db: Database, repoId: string, revokedAt: string): void {
  db.prepare(
    `UPDATE repo_acknowledgements SET revoked_at = ? WHERE repo_id = ? AND revoked_at IS NULL;`,
  ).run(revokedAt, repoId);
}

/**
 * A destination change invalidates the previous acknowledgement (FR-008/025):
 * active means the latest non-revoked row for the *same* destination.
 */
export function getActiveAcknowledgement(
  db: Database,
  repoId: string,
  destinationLabel: string | null,
): AcknowledgementRow | null {
  if (destinationLabel === null) {
    return {
      acknowledged: false,
      destinationKnown: false,
      destinationLabel: '',
      acknowledgedAt: null,
    };
  }
  const row = db
    .prepare(
      `SELECT destination, acknowledged_at
         FROM repo_acknowledgements
        WHERE repo_id = ? AND revoked_at IS NULL AND destination = ?
        ORDER BY acknowledged_at DESC
        LIMIT 1;`,
    )
    .get(repoId, destinationLabel) as { destination: string; acknowledged_at: string } | undefined;
  if (row === undefined) {
    return { acknowledged: false, destinationKnown: true, destinationLabel, acknowledgedAt: null };
  }
  return {
    acknowledged: true,
    destinationKnown: true,
    destinationLabel,
    acknowledgedAt: row.acknowledged_at,
  };
}

// ---------------------------------------------------------------------------
// Team membership cache (FR-018, SC-015)
// ---------------------------------------------------------------------------

export interface TeamMembershipRow {
  readonly githubTeamId: string;
  readonly orgLogin: string;
  readonly teamSlug: string;
  /** null = indeterminate — displayed with a warning, never counted. */
  readonly isMember: boolean | null;
  readonly checkedAt: string;
}

export function upsertTeamMembership(
  db: Database,
  input: {
    readonly githubTeamId: string;
    readonly orgLogin: string;
    readonly teamSlug: string;
    readonly isMember: boolean | null;
    readonly checkedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO team_membership_cache (github_team_id, org_login, team_slug, is_member, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (github_team_id, org_login) DO UPDATE SET
       team_slug = excluded.team_slug,
       is_member = excluded.is_member,
       checked_at = excluded.checked_at;`,
  ).run(
    input.githubTeamId,
    input.orgLogin,
    input.teamSlug,
    input.isMember === null ? null : input.isMember ? 1 : 0,
    input.checkedAt,
  );
}

export function getTeamMembership(
  db: Database,
  orgLogin: string,
  teamSlug: string,
): TeamMembershipRow | null {
  const row = db
    .prepare(
      `SELECT github_team_id, org_login, team_slug, is_member, checked_at FROM team_membership_cache WHERE org_login = ? AND team_slug = ?;`,
    )
    .get(orgLogin, teamSlug) as
    | {
        github_team_id: string;
        org_login: string;
        team_slug: string;
        is_member: number | null;
        checked_at: string;
      }
    | undefined;
  if (row === undefined) return null;
  return {
    githubTeamId: row.github_team_id,
    orgLogin: row.org_login,
    teamSlug: row.team_slug,
    isMember: row.is_member === null ? null : row.is_member === 1,
    checkedAt: row.checked_at,
  };
}
