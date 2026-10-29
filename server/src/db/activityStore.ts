/**
 * Activity event data access (T020).
 *
 * Writes store redacted summary data only — callers filter credentials and
 * denylisted content before this layer sees them (FR-085/095).
 */
import type { ActivityType } from '@pr-review-dashboard/shared';
import type { Database } from './connection.js';

export interface ActivityEventRow {
  readonly id: string;
  readonly repoId: string;
  readonly prId: string | null;
  readonly type: ActivityType;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

interface ActivityRecord {
  id: string;
  repo_id: string;
  pr_id: string | null;
  type: string;
  occurred_at: string;
  data_json: string;
}

function mapActivity(row: ActivityRecord): ActivityEventRow {
  return {
    id: row.id,
    repoId: row.repo_id,
    prId: row.pr_id,
    type: row.type as ActivityType,
    occurredAt: row.occurred_at,
    data: JSON.parse(row.data_json) as Record<string, unknown>,
  };
}

export function insertActivityEvent(
  db: Database,
  input: {
    readonly id: string;
    readonly repoId: string;
    readonly prId?: string | null;
    readonly type: ActivityType;
    readonly occurredAt: string;
    readonly data?: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO activity_events (id, repo_id, pr_id, type, occurred_at, data_json) VALUES (?, ?, ?, ?, ?, ?);`,
  ).run(
    input.id,
    input.repoId,
    input.prId ?? null,
    input.type,
    input.occurredAt,
    JSON.stringify(input.data ?? {}),
  );
}

export function listActivityForPullRequest(
  db: Database,
  prId: string,
  limit = 50,
): ActivityEventRow[] {
  const rows = db
    .prepare('SELECT * FROM activity_events WHERE pr_id = ? ORDER BY occurred_at DESC LIMIT ?;')
    .all(prId, limit) as unknown as ActivityRecord[];
  return rows.map(mapActivity);
}

export function listActivityForRepository(
  db: Database,
  repoId: string,
  limit = 50,
): ActivityEventRow[] {
  const rows = db
    .prepare('SELECT * FROM activity_events WHERE repo_id = ? ORDER BY occurred_at DESC LIMIT ?;')
    .all(repoId, limit) as unknown as ActivityRecord[];
  return rows.map(mapActivity);
}
