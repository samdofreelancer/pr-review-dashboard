/**
 * Board actions (T044; FR-014, FR-025, FR-070).
 *
 * Board-initiated write paths always follow the same shape: verify the live
 * GitHub head first, act on GitHub, then re-fetch the full snapshot and
 * recompute — the lane never flips optimistically (FR-025/029). Stale heads
 * and closed pull requests are contract problems (409), not exceptions to
 * recover from.
 */
import {
  ReviewDraftSchema,
  type ChecksState,
  type PullRequestDetail,
  type ReviewDraft,
} from '@pr-review-dashboard/shared';
import { AppError } from '../api/errors.js';
import type { Database } from '../db/connection.js';
import type { AppConfig } from '../config/index.js';
import {
  createDraft,
  computeDraftCounts,
  computePublishability,
  getDraft,
} from '../db/draftStore.js';
import { buildPullRequestDetail, requirePullRequest, requireRepository } from './boardService.js';
import { fetchChecksForHead } from './checks.js';
import { mapGitHubError, type GitHubOctokit } from './client.js';
import { fetchPullRequestSnapshot } from './queries.js';
import { persistPullRequestSnapshot } from './sync.js';
import { resolveGitHubClient } from './auth.js';
import { verifyHead } from './verifyHead.js';
import type { ActivitySink } from '../observability/activity.js';

export interface ActionDeps {
  readonly db: Database;
  readonly config: AppConfig;
  readonly viewerLogin: string | null;
  /** Activity/SSE sink (T046); null keeps flows runnable without a stream. */
  readonly events: ActivitySink | null;
}

const MARK_READY_MUTATION = `
mutation MarkPullRequestReadyForReview($input: MarkPullRequestReadyForReviewInput!) {
  markPullRequestReadyForReview(input: $input) {
    pullRequest { id isDraft }
  }
}`;

interface MarkReadyMutationPayload {
  markPullRequestReadyForReview?: {
    pullRequest?: { id: string; isDraft: boolean } | null;
  } | null;
}

function verificationProblem(
  reason: 'STALE_HEAD' | 'PR_CLOSED' | 'NOT_FOUND',
  headSha: string | null,
  expectedHeadSha: string | null,
): AppError {
  if (reason === 'STALE_HEAD') {
    return new AppError(
      'STALE_HEAD',
      'The pull request head changed on GitHub; refresh the board and retry.',
      {
        details: { expectedHeadSha: expectedHeadSha ?? '', headSha: headSha ?? '' },
      },
    );
  }
  if (reason === 'PR_CLOSED') {
    return new AppError('PR_CLOSED', 'The pull request is no longer open on GitHub.');
  }
  return new AppError('NOT_FOUND', 'The pull request no longer exists on GitHub.');
}

/**
 * Mark a draft PR ready for review on GitHub, then re-derive from the
 * refreshed snapshot before answering.
 */
export async function markReadyForReview(
  deps: ActionDeps,
  prId: string,
  request: { readonly expectedHeadSha: string },
): Promise<PullRequestDetail> {
  const row = requirePullRequest(deps.db, prId);
  const repo = requireRepository(deps.db, row.repoId);
  const { client, plainOctokit } = await resolveGitHubClient(deps.config.credential);
  const octokit: GitHubOctokit = client.octokit;

  const verification = await verifyHead(octokit, {
    owner: repo.owner,
    name: repo.name,
    number: row.number,
    expectedHeadSha: request.expectedHeadSha,
  });
  if (!verification.ok) {
    throw verificationProblem(
      verification.reason,
      verification.headSha,
      verification.expectedHeadSha,
    );
  }

  try {
    await octokit.graphql<MarkReadyMutationPayload>(MARK_READY_MUTATION, {
      input: { pullRequestId: row.githubId, headRefOid: verification.headSha },
    });
  } catch (error) {
    throw mapGitHubError(error);
  }

  const snapshot = await fetchPullRequestSnapshot(octokit, {
    owner: repo.owner,
    name: repo.name,
    number: row.number,
  });
  if (snapshot === null) {
    throw new AppError('NOT_FOUND', 'The pull request no longer exists on GitHub.');
  }

  let checksState: ChecksState = row.checksState;
  try {
    checksState = (
      await fetchChecksForHead(plainOctokit, {
        owner: repo.owner,
        repo: repo.name,
        sha: snapshot.headSha,
      })
    ).state;
  } catch {
    // The board keeps the previous checks state when GitHub will not confirm.
  }
  persistPullRequestSnapshot(deps.db, row.repoId, snapshot, checksState, { runId: null });

  // T046: mark-ready is a user-visible milestone both persisted and streamed.
  deps.events?.recordActivity('mark_ready', {
    repoId: row.repoId,
    prId: row.id,
    data: { number: row.number },
  });
  deps.events?.boardUpdated({ reason: 'mark_ready', repoId: row.repoId, prId: row.id });

  return buildPullRequestDetail(
    { db: deps.db, config: deps.config, viewerLogin: deps.viewerLogin },
    requirePullRequest(deps.db, prId),
  );
}

/** Create a manual review draft bound to the verified head (FR-070). */
export async function createManualDraft(
  deps: ActionDeps,
  prId: string,
  request: {
    readonly event: 'comment' | 'request_changes' | 'approve';
    readonly summary?: string | undefined;
  },
): Promise<ReviewDraft> {
  const row = requirePullRequest(deps.db, prId);
  const repo = requireRepository(deps.db, row.repoId);
  const { client } = await resolveGitHubClient(deps.config.credential);

  const verification = await verifyHead(client.octokit, {
    owner: repo.owner,
    name: repo.name,
    number: row.number,
    expectedHeadSha: row.headSha,
  });
  if (!verification.ok) {
    throw verificationProblem(
      verification.reason,
      verification.headSha,
      verification.expectedHeadSha,
    );
  }

  const draftId = createDraft(deps.db, {
    prId,
    runId: null,
    origin: 'manual',
    summary: request.summary ?? '',
    event: request.event,
    targetHeadSha: verification.headSha,
  });
  const draft = getDraft(deps.db, draftId);
  if (draft === null) {
    throw new AppError('INTERNAL', 'Manual draft disappeared during creation.');
  }

  const counts = computeDraftCounts(deps.db, draftId);
  const isOwnPr =
    deps.viewerLogin !== null && deps.viewerLogin.toLowerCase() === row.authorLogin.toLowerCase();
  const publishability = computePublishability(draft, {
    prState: row.state,
    prIsDraft: row.isDraft,
    prIsOwnPr: isOwnPr,
    prOpenChecks: null,
    prLane: row.lane,
    prMergeability: null,
    prReviewDecision: row.reviewDecision,
    online: true,
    verifiedHeadSha: verification.headSha,
    runStatus: null,
    runStale: false,
    publishInFlight: false,
  });

  return ReviewDraftSchema.parse({
    id: draft.id,
    prId: draft.prId,
    origin: draft.origin,
    runId: draft.runId,
    summary: draft.summary,
    event: draft.event,
    status: draft.status,
    targetHeadSha: draft.targetHeadSha,
    findings: [],
    counts: {
      inline: counts.inline,
      summaryOnly: counts.summaryOnly,
      demoted: counts.demoted,
      stale: counts.stale,
    },
    publishability: {
      publishable: publishability.publishable,
      reasons: [...publishability.reasons],
    },
    updatedAt: draft.updatedAt,
  });
}
