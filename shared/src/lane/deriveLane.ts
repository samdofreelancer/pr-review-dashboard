/**
 * Lane derivation (T036, data-model "Lane"; FR-013/014/015/020).
 *
 * Pure function over GitHub-derived inputs — lanes are never assigned by
 * users (FR-015). Precedence follows data-model.md exactly:
 *   merged/closed → Done; inaccessible → last known lane + warning;
 *   draft → Draft; then Github's reviewDecision; then the fallback rule
 *   over the latest decision-bearing review at the current head per
 *   reviewer, where CHANGES_REQUESTED outranks APPROVED and
 *   DISMISSED/COMMENTED/PENDING rows never participate.
 */
import type {
  DecisionBearingReviewState,
  LaneName,
  PullRequestState,
  ReviewDecision,
} from '../types/domain.js';

export interface LaneDerivationInput {
  /** Lifecycle state as persisted in `pull_requests.state`. */
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  /** GraphQL `reviewDecision`; null when GitHub has not computed one. */
  readonly reviewDecision: ReviewDecision | null;
  /**
   * Latest decision-bearing review state per reviewer, filtered to the
   * current head SHA by the caller (T020 store returns these directly).
   */
  readonly latestDecisionBearingStates?: ReadonlyArray<DecisionBearingReviewState>;
  /** Persisted lane from the previous sync; used only for inaccessible PRs. */
  readonly lastKnownLane?: LaneName | null;
}

export interface LaneDerivationResult {
  readonly lane: LaneName;
  /** True when GitHub state could not be verified (FR-020 warning surface). */
  readonly inaccessible: boolean;
}

export function deriveLane(input: LaneDerivationInput): LaneDerivationResult {
  if (input.state === 'merged' || input.state === 'closed') {
    return { lane: 'Done', inaccessible: false };
  }
  if (input.state === 'inaccessible') {
    // Never promoted to Done — the app cannot verify any current state.
    return { lane: input.lastKnownLane ?? 'In review', inaccessible: true };
  }
  if (input.isDraft) {
    return { lane: 'Draft', inaccessible: false };
  }
  if (input.reviewDecision === 'CHANGES_REQUESTED') {
    return { lane: 'Request changes', inaccessible: false };
  }
  if (input.reviewDecision === 'APPROVED') {
    return { lane: 'Approved', inaccessible: false };
  }
  if (input.reviewDecision === 'REVIEW_REQUIRED') {
    return { lane: 'In review', inaccessible: false };
  }
  const latest = input.latestDecisionBearingStates ?? [];
  if (latest.includes('CHANGES_REQUESTED')) {
    return { lane: 'Request changes', inaccessible: false };
  }
  if (latest.includes('APPROVED')) {
    return { lane: 'Approved', inaccessible: false };
  }
  return { lane: 'In review', inaccessible: false };
}
