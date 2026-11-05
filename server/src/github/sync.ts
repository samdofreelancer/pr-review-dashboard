/**
 * Sync orchestrator (T041, research R16; FR-010/013/015/019/020/026).
 *
 * One run per invocation: fetch the open window plus the 30-day closed /
 * merged window (always from GitHub's live lists), refresh requested-team
 * memberships, then per pull request: fetch its checks, persist the review
 * snapshots, recompute the lane through `deriveLane`, and upsert by
 * `(repo_id, number)`.
 *
 * Retention rules encoded here:
 * - A detail-fetch failure for one pull request keeps that pull request's
 *   previous row untouched and turns the run into `partial` (never replaces
 *   the last good data with an error).
 * - A pull request absent from both windows is simply not refreshed — it is
 *   never marked closed and never dropped into Done (FR-019/020). Its
 *   stored row, state, and lane stay as they are.
 * - Whole-run failures (list fetch, credential) finish the run as `failed`
 *   and timestamp only the repository's last-sync stamp.
 */
import { randomUUID } from 'node:crypto';
import {
  DECISION_BEARING_REVIEW_STATES,
  deriveLane,
  type ChecksState,
  type DecisionBearingReviewState,
  type SyncRunStatus,
} from '@pr-review-dashboard/shared';
import type { Database } from '../db/connection.js';
import type { AppConfig } from '../config/index.js';
import {
  finishSyncRun,
  getRepositoryById,
  updateRepositorySyncStamp,
} from '../db/repositoryStore.js';
import {
  getPullRequestByNumber,
  upsertPullRequest,
  upsertPullRequestReview,
} from '../db/pullRequestStore.js';
import { resolveGitHubClient } from './auth.js';
import { fetchChecksForHead } from './checks.js';
import { fetchRepositoryPullRequests, type GitHubPullRequestSnapshot } from './queries.js';
import { upsertTeamMembershipFromGitHub, type RequestedTeam } from './teams.js';
import type { GitHubOctokit } from './client.js';
import type { ActivitySink } from '../observability/activity.js';

export interface SyncDeps {
  readonly db: Database;
  readonly config: AppConfig;
  /** Viewer login; empty disables team-membership lookups. */
  readonly viewerLogin: string;
  /** Activity/SSE sink (T046); null keeps flows runnable without a stream. */
  readonly events: ActivitySink | null;
}

export interface SyncInvocation {
  readonly repoId: string;
  /** Sync-run row created beforehand; the orchestrator only finishes it. */
  readonly runId: string;
}

/**
 * Execute one complete sync for a repository. Never throws: every failure
 * lands in the sync-run row (status `failed`) and the repository stamp, so
 * the board keeps serving the last known data (FR-026).
 */
export async function runRepositorySync(deps: SyncDeps, invocation: SyncInvocation): Promise<void> {
  const { db, config, viewerLogin } = deps;
  const repo = getRepositoryById(db, invocation.repoId);
  if (repo === null) {
    finishSyncRun(db, invocation.runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      openSeen: 0,
      closedSeen: 0,
      errorCode: 'NOT_FOUND',
      errorMessage: 'Repository was disconnected while the sync was queued',
    });
    return;
  }

  let openSeen = 0;
  let closedSeen = 0;
  let partial = false;
  let partialReason: string | null = null;
  const events = deps.events;

  try {
    events?.syncStarted({
      repoId: repo.id,
      syncRunId: invocation.runId,
      startedAt: new Date().toISOString(),
    });
    const { client, plainOctokit } = await resolveGitHubClient(config.credential);
    const list = await fetchRepositoryPullRequests(client.octokit, {
      owner: repo.owner,
      name: repo.name,
    });

    const listSeen = list.open.length + list.closed.length;
    events?.syncProgress({
      repoId: repo.id,
      syncRunId: invocation.runId,
      phase: 'pull_requests',
      fetched: listSeen,
      total: listSeen,
    });

    await refreshRequestedTeams(db, plainOctokit, [...list.open, ...list.closed], viewerLogin);

    let checksDone = 0;
    for (const snapshot of list.open) {
      if (await persistWithChecks(db, plainOctokit, repo, snapshot, invocation.runId)) {
        openSeen += 1;
      } else {
        partial = true;
        partialReason = 'checks_unavailable';
      }
      checksDone += 1;
      events?.syncProgress({
        repoId: repo.id,
        syncRunId: invocation.runId,
        phase: 'checks',
        fetched: checksDone,
        total: listSeen,
      });
    }
    for (const snapshot of list.closed) {
      if (await persistWithChecks(db, plainOctokit, repo, snapshot, invocation.runId)) {
        closedSeen += 1;
      } else {
        partial = true;
        partialReason = 'checks_unavailable';
      }
      checksDone += 1;
      events?.syncProgress({
        repoId: repo.id,
        syncRunId: invocation.runId,
        phase: 'checks',
        fetched: checksDone,
        total: listSeen,
      });
    }

    const finishedAt = new Date().toISOString();
    const status: SyncRunStatus = partial ? 'partial' : 'succeeded';
    finishSyncRun(db, invocation.runId, {
      status,
      finishedAt,
      openSeen,
      closedSeen,
      partialReason,
    });
    updateRepositorySyncStamp(db, repo.id, partial ? 'partial' : 'succeeded', finishedAt);
    events?.syncCompleted(
      {
        repoId: repo.id,
        syncRunId: invocation.runId,
        status,
        finishedAt,
        openSeen,
        closedSeen,
        error: null,
        rateLimitResetAt: null,
      },
      { record: true },
    );
  } catch (error) {
    const candidate = error as { code?: unknown; resetAt?: unknown } | null;
    const code = typeof candidate?.code === 'string' ? candidate.code : 'INTERNAL';
    const message = error instanceof Error ? error.message : 'Unexpected sync failure';
    const resetAt = candidate?.resetAt instanceof Date ? candidate.resetAt : null;
    const now = new Date().toISOString();
    finishSyncRun(db, invocation.runId, {
      status: 'failed',
      finishedAt: now,
      openSeen,
      closedSeen,
      partialReason,
      errorCode: code,
      errorMessage: message,
      rateLimitResetAt: resetAt === null ? null : resetAt.toISOString(),
    });
    updateRepositorySyncStamp(db, repo.id, 'failed', null);
    events?.syncCompleted(
      {
        repoId: repo.id,
        syncRunId: invocation.runId,
        status: 'failed',
        finishedAt: now,
        openSeen,
        closedSeen,
        error: { code, message },
        rateLimitResetAt: resetAt === null ? null : resetAt.toISOString(),
      },
      { record: true },
    );
  }
}

/** Fetch checks for one snapshot and persist it; `false` marks a partial run. */
async function persistWithChecks(
  db: Database,
  octokit: GitHubOctokit,
  repo: { readonly owner: string; readonly name: string; readonly id: string },
  snapshot: GitHubPullRequestSnapshot,
  runId: string,
): Promise<boolean> {
  let checksState: ChecksState;
  try {
    const checks = await fetchChecksForHead(octokit, {
      owner: repo.owner,
      repo: repo.name,
      sha: snapshot.headSha,
    });
    checksState = checks.state;
  } catch {
    // Keep the last good row instead of pushing unknown data onto the board.
    return false;
  }
  persistPullRequestSnapshot(db, repo.id, snapshot, checksState, { runId });
  return true;
}

async function refreshRequestedTeams(
  db: Database,
  octokit: GitHubOctokit,
  snapshots: ReadonlyArray<GitHubPullRequestSnapshot>,
  viewerLogin: string,
): Promise<void> {
  if (viewerLogin === '') return;
  const requested = new Map<string, RequestedTeam>();
  for (const snapshot of snapshots) {
    for (const team of snapshot.requestedTeams) {
      requested.set(`${team.org}/${team.slug}`, team);
    }
  }
  for (const team of requested.values()) {
    await upsertTeamMembershipFromGitHub(db, octokit, team, viewerLogin, new Date().toISOString());
  }
}

/**
 * Persist one GitHub snapshot: the pull-request row first (the FK on
 * reviews demands it), then the review rows. The lane is recomputed in
 * memory from the snapshot — per reviewer, the latest decision-bearing
 * review at the CURRENT head (FR-013 fallback) — exactly what
 * `listLatestDecisionBearingReviews` reads back from the store after the
 * review rows land. The row id stays stable across syncs so drafts, runs,
 * and findings keep their links.
 */
export function persistPullRequestSnapshot(
  db: Database,
  repoId: string,
  snapshot: GitHubPullRequestSnapshot,
  checksState: ChecksState,
  context: { readonly runId: string | null },
): void {
  const existing = getPullRequestByNumber(db, repoId, snapshot.number);
  const prId = existing?.id ?? randomUUID();

  const latestByReviewer = new Map<string, DecisionBearingReviewState>();
  const submittedAtOf = (review: GitHubPullRequestSnapshot['reviews'][number]): string =>
    review.submittedAt ?? '';
  for (const review of [...snapshot.reviews].sort((left, right) =>
    submittedAtOf(left).localeCompare(submittedAtOf(right)),
  )) {
    if (!DECISION_BEARING_REVIEW_STATES.includes(review.state as DecisionBearingReviewState)) {
      continue; // COMMENTED/PENDING never participate (FR-013).
    }
    if (review.headSha !== snapshot.headSha || review.submittedAt === null) {
      continue; // Only rows at the current head count (data-model "Lane").
    }
    latestByReviewer.set(review.reviewerLogin, review.state as DecisionBearingReviewState);
  }
  const latestStates = [...latestByReviewer.values()];

  upsertPullRequest(db, {
    id: prId,
    repoId,
    number: snapshot.number,
    githubId: snapshot.githubId,
    title: snapshot.title,
    body: snapshot.body,
    authorLogin: snapshot.authorLogin,
    state: snapshot.state,
    isDraft: snapshot.isDraft,
    baseRef: snapshot.baseRef,
    headRef: snapshot.headRef,
    headSha: snapshot.headSha,
    additions: snapshot.additions,
    deletions: snapshot.deletions,
    changedFiles: snapshot.changedFiles,
    labels: snapshot.labels,
    requestedUsers: snapshot.requestedUsers,
    requestedTeams: snapshot.requestedTeams,
    reviewDecision: snapshot.reviewDecision,
    lane: deriveLane({
      state: snapshot.state,
      isDraft: snapshot.isDraft,
      reviewDecision: snapshot.reviewDecision,
      latestDecisionBearingStates: latestStates,
    }).lane,
    checksState,
    mergeableState: snapshot.mergeable,
    mergedAt: snapshot.mergedAt,
    closedAt: snapshot.closedAt,
    githubCreatedAt: snapshot.createdAt,
    githubUpdatedAt: snapshot.updatedAt,
    firstSeenAt: existing?.firstSeenAt ?? snapshot.createdAt,
    lastSyncedAt: new Date().toISOString(),
    lastSeenOpenSyncId:
      snapshot.state === 'open' ? context.runId : (existing?.lastSeenOpenSyncId ?? null),
  });

  for (const review of snapshot.reviews) {
    upsertPullRequestReview(db, {
      prId,
      githubReviewId: review.githubReviewId,
      reviewerLogin: review.reviewerLogin,
      state: review.state,
      submittedAt: review.submittedAt,
      commitSha: review.headSha,
      isDecisionBearing: DECISION_BEARING_REVIEW_STATES.includes(
        review.state as DecisionBearingReviewState,
      ),
    });
  }
}
