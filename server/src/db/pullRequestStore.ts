/**
 * Pull request and review data access (T020).
 *
 * Upserts are idempotent by `(repo_id, number)`; lane/checks/mergeability are
 * always recomputed and passed in by the sync orchestrator — never assigned
 * by users (FR-015). Review snapshots persist their decision-bearing status
 * so the FR-013 fallback lane rule can read the latest row per reviewer.
 */
import type {
  ChecksState,
  LaneName,
  Mergeability,
  PullRequestState,
  ReviewDecision,
  ReviewState,
} from '@pr-review-dashboard/shared';
import { randomUUID } from 'node:crypto';
import type { Database } from './connection.js';

export interface PullRequestRow {
  readonly id: string;
  readonly repoId: string;
  readonly number: number;
  readonly githubId: string;
  readonly title: string;
  readonly body: string;
  readonly authorLogin: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly baseRef: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: ReadonlyArray<{ readonly name: string; readonly color?: string }>;
  readonly requestedUsers: readonly string[];
  readonly requestedTeams: ReadonlyArray<{
    readonly org: string;
    readonly slug: string;
    readonly githubId: string;
  }>;
  readonly reviewDecision: ReviewDecision | null;
  readonly lane: LaneName;
  readonly checksState: ChecksState;
  readonly mergeableState: Mergeability;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly githubCreatedAt: string;
  readonly githubUpdatedAt: string;
  readonly firstSeenAt: string;
  readonly lastSyncedAt: string;
  readonly lastSeenOpenSyncId: string | null;
}

interface PullRequestRecord {
  id: string;
  repo_id: string;
  number: number;
  github_id: string;
  title: string;
  body: string;
  author_login: string;
  state: string;
  is_draft: number;
  base_ref: string;
  head_ref: string;
  head_sha: string;
  additions: number;
  deletions: number;
  changed_files: number;
  labels_json: string;
  requested_users_json: string;
  requested_teams_json: string;
  review_decision: string | null;
  lane: string;
  checks_state: string;
  mergeable_state: string;
  merged_at: string | null;
  closed_at: string | null;
  github_created_at: string;
  github_updated_at: string;
  first_seen_at: string;
  last_synced_at: string;
  last_seen_open_sync_id: string | null;
}

interface LabelJson {
  name: string;
  color?: string;
}

interface RequestedTeamJson {
  org: string;
  slug: string;
  githubId: string;
}

function mapPullRequest(row: PullRequestRecord): PullRequestRow {
  return {
    id: row.id,
    repoId: row.repo_id,
    number: row.number,
    githubId: row.github_id,
    title: row.title,
    body: row.body,
    authorLogin: row.author_login,
    state: row.state as PullRequestState,
    isDraft: row.is_draft === 1,
    baseRef: row.base_ref,
    headRef: row.head_ref,
    headSha: row.head_sha,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changed_files,
    labels: JSON.parse(row.labels_json) as LabelJson[],
    requestedUsers: JSON.parse(row.requested_users_json) as string[],
    requestedTeams: JSON.parse(row.requested_teams_json) as RequestedTeamJson[],
    reviewDecision: row.review_decision as ReviewDecision | null,
    lane: row.lane as LaneName,
    checksState: row.checks_state as ChecksState,
    mergeableState: row.mergeable_state as Mergeability,
    mergedAt: row.merged_at,
    closedAt: row.closed_at,
    githubCreatedAt: row.github_created_at,
    githubUpdatedAt: row.github_updated_at,
    firstSeenAt: row.first_seen_at,
    lastSyncedAt: row.last_synced_at,
    lastSeenOpenSyncId: row.last_seen_open_sync_id,
  };
}

export interface PullRequestUpsert {
  readonly id: string;
  readonly repoId: string;
  readonly number: number;
  readonly githubId: string;
  readonly title: string;
  readonly body: string;
  readonly authorLogin: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly baseRef: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: readonly LabelJson[];
  readonly requestedUsers: readonly string[];
  readonly requestedTeams: readonly RequestedTeamJson[];
  readonly reviewDecision: ReviewDecision | null;
  readonly lane: LaneName;
  readonly checksState: ChecksState;
  readonly mergeableState: Mergeability;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly githubCreatedAt: string;
  readonly githubUpdatedAt: string;
  readonly firstSeenAt: string;
  readonly lastSyncedAt: string;
  readonly lastSeenOpenSyncId: string | null;
}

/** Insert or update by `(repo_id, number)`; `first_seen_at` survives updates. */
export function upsertPullRequest(db: Database, input: PullRequestUpsert): void {
  db.prepare(
    `INSERT INTO pull_requests (
       id, repo_id, number, github_id, title, body, author_login, state, is_draft,
       base_ref, head_ref, head_sha, additions, deletions, changed_files,
       labels_json, requested_users_json, requested_teams_json, review_decision,
       lane, checks_state, mergeable_state, merged_at, closed_at,
       github_created_at, github_updated_at, first_seen_at, last_synced_at, last_seen_open_sync_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (repo_id, number) DO UPDATE SET
       github_id = excluded.github_id,
       title = excluded.title,
       body = excluded.body,
       author_login = excluded.author_login,
       state = excluded.state,
       is_draft = excluded.is_draft,
       base_ref = excluded.base_ref,
       head_ref = excluded.head_ref,
       head_sha = excluded.head_sha,
       additions = excluded.additions,
       deletions = excluded.deletions,
       changed_files = excluded.changed_files,
       labels_json = excluded.labels_json,
       requested_users_json = excluded.requested_users_json,
       requested_teams_json = excluded.requested_teams_json,
       review_decision = excluded.review_decision,
       lane = excluded.lane,
       checks_state = excluded.checks_state,
       mergeable_state = excluded.mergeable_state,
       merged_at = excluded.merged_at,
       closed_at = excluded.closed_at,
       github_created_at = excluded.github_created_at,
       github_updated_at = excluded.github_updated_at,
       last_synced_at = excluded.last_synced_at,
       last_seen_open_sync_id = excluded.last_seen_open_sync_id;`,
  ).run(
    input.id,
    input.repoId,
    input.number,
    input.githubId,
    input.title,
    input.body,
    input.authorLogin,
    input.state,
    input.isDraft ? 1 : 0,
    input.baseRef,
    input.headRef,
    input.headSha,
    input.additions,
    input.deletions,
    input.changedFiles,
    JSON.stringify(input.labels),
    JSON.stringify(input.requestedUsers),
    JSON.stringify(input.requestedTeams),
    input.reviewDecision,
    input.lane,
    input.checksState,
    input.mergeableState,
    input.mergedAt,
    input.closedAt,
    input.githubCreatedAt,
    input.githubUpdatedAt,
    input.firstSeenAt,
    input.lastSyncedAt,
    input.lastSeenOpenSyncId,
  );
}

export function getPullRequest(db: Database, prId: string): PullRequestRow | null {
  const row = db.prepare('SELECT * FROM pull_requests WHERE id = ?;').get(prId) as
    PullRequestRecord | undefined;
  return row === undefined ? null : mapPullRequest(row);
}

export function getPullRequestByNumber(
  db: Database,
  repoId: string,
  number: number,
): PullRequestRow | null {
  const row = db
    .prepare('SELECT * FROM pull_requests WHERE repo_id = ? AND number = ?;')
    .get(repoId, number) as PullRequestRecord | undefined;
  return row === undefined ? null : mapPullRequest(row);
}

export function listPullRequestsByRepo(db: Database, repoId: string): PullRequestRow[] {
  const rows = db
    .prepare('SELECT * FROM pull_requests WHERE repo_id = ? ORDER BY github_updated_at DESC;')
    .all(repoId) as unknown as PullRequestRecord[];
  return rows.map(mapPullRequest);
}

/** Numbers of PRs whose last synced state is open (for disappearance detection in T041). */
export function listOpenPullRequestNumbers(db: Database, repoId: string): number[] {
  const rows = db
    .prepare(`SELECT number FROM pull_requests WHERE repo_id = ? AND state = 'open';`)
    .all(repoId) as Array<{ number: number }>;
  return rows.map((row) => row.number);
}

// ---------------------------------------------------------------------------
// Review snapshots (FR-013/014)
// ---------------------------------------------------------------------------

export interface PullRequestReviewRow {
  readonly id: string;
  readonly prId: string;
  readonly githubReviewId: string;
  readonly reviewerLogin: string;
  readonly state: ReviewState;
  readonly submittedAt: string | null;
  readonly commitSha: string;
  readonly isDecisionBearing: boolean;
}

interface ReviewRecord {
  id: string;
  pr_id: string;
  github_review_id: string;
  reviewer_login: string;
  state: string;
  submitted_at: string | null;
  commit_sha: string;
  is_decision_bearing: number;
}

function mapReview(row: ReviewRecord): PullRequestReviewRow {
  return {
    id: row.id,
    prId: row.pr_id,
    githubReviewId: row.github_review_id,
    reviewerLogin: row.reviewer_login,
    state: row.state as ReviewState,
    submittedAt: row.submitted_at,
    commitSha: row.commit_sha,
    isDecisionBearing: row.is_decision_bearing === 1,
  };
}

export function upsertPullRequestReview(
  db: Database,
  input: {
    readonly prId: string;
    readonly githubReviewId: string;
    readonly reviewerLogin: string;
    readonly state: ReviewState;
    readonly submittedAt: string | null;
    readonly commitSha: string;
    readonly isDecisionBearing: boolean;
  },
): void {
  db.prepare(
    `INSERT INTO pull_request_reviews
       (id, pr_id, github_review_id, reviewer_login, state, submitted_at, commit_sha, is_decision_bearing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (pr_id, github_review_id) DO UPDATE SET
       reviewer_login = excluded.reviewer_login,
       state = excluded.state,
       submitted_at = excluded.submitted_at,
       commit_sha = excluded.commit_sha,
       is_decision_bearing = excluded.is_decision_bearing;`,
  ).run(
    randomUUID(),
    input.prId,
    input.githubReviewId,
    input.reviewerLogin,
    input.state,
    input.submittedAt,
    input.commitSha,
    input.isDecisionBearing ? 1 : 0,
  );
}

/** Latest decision-bearing review per reviewer at the current head (FR-013 fallback). */
export function listLatestDecisionBearingReviews(
  db: Database,
  prId: string,
  headSha: string,
): PullRequestReviewRow[] {
  const rows = db
    .prepare(
      `SELECT prr.id, prr.pr_id, prr.github_review_id, prr.reviewer_login, prr.state, prr.submitted_at, prr.commit_sha, prr.is_decision_bearing
         FROM pull_request_reviews prr
         JOIN (
           SELECT reviewer_login, MAX(submitted_at) AS latest_at
             FROM pull_request_reviews
            WHERE pr_id = ? AND is_decision_bearing = 1 AND commit_sha = ? AND submitted_at IS NOT NULL
            GROUP BY reviewer_login
         ) latest ON prr.reviewer_login = latest.reviewer_login AND prr.submitted_at = latest.latest_at
        WHERE prr.pr_id = ? AND prr.is_decision_bearing = 1 AND prr.commit_sha = ?;`,
    )
    .all(prId, headSha, prId, headSha) as unknown as ReviewRecord[];
  return rows.map(mapReview);
}
