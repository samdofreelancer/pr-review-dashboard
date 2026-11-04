import { describe, expect, it } from 'vitest';
import { deriveLane, needsMyReview } from '@pr-review-dashboard/shared';

const base = {
  isDraft: false,
  reviewDecision: null,
  latestDecisionBearingStates: [] as Array<'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED'>,
  lastKnownLane: null as string | null,
};

describe('deriveLane (data-model "Lane")', () => {
  it('maps merged and closed to Done regardless of inputs', () => {
    for (const state of ['merged', 'closed'] as const) {
      expect(
        deriveLane({
          ...base,
          state,
          reviewDecision: 'CHANGES_REQUESTED',
          latestDecisionBearingStates: ['CHANGES_REQUESTED'],
          isDraft: true,
        }),
      ).toEqual({ lane: 'Done', inaccessible: false });
    }
  });

  it('keeps the last known lane for inaccessible PRs and never promotes to Done', () => {
    expect(deriveLane({ ...base, state: 'inaccessible', lastKnownLane: 'Approved' })).toEqual({
      lane: 'Approved',
      inaccessible: true,
    });
    expect(
      deriveLane({ ...base, state: 'inaccessible', lastKnownLane: 'Draft', isDraft: true }),
    ).toEqual({
      lane: 'Draft',
      inaccessible: true,
    });
    // FR-020: inaccessible is not terminal → default to "In review", never Done.
    expect(deriveLane({ ...base, state: 'inaccessible' })).toEqual({
      lane: 'In review',
      inaccessible: true,
    });
    // Last known lane is kept verbatim; no fresh derivation from other inputs.
    expect(deriveLane({ ...base, state: 'inaccessible', lastKnownLane: 'Done' })).toEqual({
      lane: 'Done',
      inaccessible: true,
    });
  });

  it('maps open drafts to Draft before any review signal', () => {
    expect(
      deriveLane({ ...base, state: 'open', isDraft: true, reviewDecision: 'APPROVED' }),
    ).toEqual({ lane: 'Draft', inaccessible: false });
  });

  it('maps each GraphQL reviewDecision lane', () => {
    expect(deriveLane({ ...base, state: 'open', reviewDecision: 'CHANGES_REQUESTED' })).toEqual({
      lane: 'Request changes',
      inaccessible: false,
    });
    expect(deriveLane({ ...base, state: 'open', reviewDecision: 'APPROVED' })).toEqual({
      lane: 'Approved',
      inaccessible: false,
    });
    expect(deriveLane({ ...base, state: 'open', reviewDecision: 'REVIEW_REQUIRED' })).toEqual({
      lane: 'In review',
      inaccessible: false,
    });
  });

  it('falls back to the latest decision-bearing review: CHANGES_REQUESTED outranks APPROVED', () => {
    expect(
      deriveLane({
        ...base,
        state: 'open',
        latestDecisionBearingStates: ['APPROVED', 'CHANGES_REQUESTED'],
      }),
    ).toEqual({ lane: 'Request changes', inaccessible: false });
    expect(
      deriveLane({ ...base, state: 'open', latestDecisionBearingStates: ['APPROVED'] }),
    ).toEqual({
      lane: 'Approved',
      inaccessible: false,
    });
  });

  it('DISMISSED rows never carry a lane decision (FR-013)', () => {
    expect(
      deriveLane({ ...base, state: 'open', latestDecisionBearingStates: ['DISMISSED'] }),
    ).toEqual({
      lane: 'In review',
      inaccessible: false,
    });
  });

  it('open PR with no decision-bearing signal lands in In review', () => {
    expect(deriveLane({ ...base, state: 'open', reviewDecision: null })).toEqual({
      lane: 'In review',
      inaccessible: false,
    });
  });
});

describe('needsMyReview (data-model "Needs my review")', () => {
  it('true when the viewer login is requested (case-insensitive)', () => {
    expect(
      needsMyReview({ viewerLogin: 'Reviewer-One', requestedUsers: ['reviewer-one', 'other'] }),
    ).toEqual({
      needs: true,
      hasIndeterminate: false,
    });
    expect(needsMyReview({ viewerLogin: 'viewer', requestedUsers: ['someone'] })).toEqual({
      needs: false,
      hasIndeterminate: false,
    });
  });

  it('true when a requested team membership is cached true', () => {
    expect(
      needsMyReview({
        viewerLogin: 'viewer',
        requestedUsers: [],
        requestedTeamMemberships: [{ isMember: false }, { isMember: true }],
      }),
    ).toEqual({ needs: true, hasIndeterminate: false });
  });

  it('indeterminate team membership is displayed but never counted (FR-018/SC-015)', () => {
    expect(
      needsMyReview({
        viewerLogin: 'viewer',
        requestedUsers: [],
        requestedTeamMemberships: [{ isMember: null }],
      }),
    ).toEqual({ needs: false, hasIndeterminate: true });
  });

  it('no request at all is false with no warning', () => {
    expect(needsMyReview({ viewerLogin: 'viewer' })).toEqual({
      needs: false,
      hasIndeterminate: false,
    });
  });
});
