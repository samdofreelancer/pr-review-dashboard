/**
 * Needs-my-review logic (T038, data-model "Needs my review"; FR-018/SC-015).
 *
 * True when the viewer login is in `requested_users` or a requested team's
 * cached membership is true. Team membership can be indeterminate (API cached
 * as null / request failed): reviewers see the team request with a warning,
 * but it never counts as "needs my review".
 */
export interface TeamMembershipSnapshot {
  /**
   * Cached membership for the viewer in the requested team: `true`/`false`
   * from the REST teams lookup, or `null` when the lookup did not resolve.
   */
  readonly isMember: boolean | null;
}

export interface NeedsMyReviewInput {
  readonly viewerLogin: string;
  readonly requestedUsers?: ReadonlyArray<string>;
  readonly requestedTeamMemberships?: ReadonlyArray<TeamMembershipSnapshot>;
}

export interface NeedsMyReviewResult {
  /** Whether the board must count this PR as needing the viewer's review. */
  readonly needs: boolean;
  /** At least one team request resolved as indeterminate (FR-018 warning). */
  readonly hasIndeterminate: boolean;
}

/** GitHub logins are case-insensitive; compare lowercase. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function needsMyReview(input: NeedsMyReviewInput): NeedsMyReviewResult {
  let needs = (input.requestedUsers ?? []).some((login) => sameLogin(login, input.viewerLogin));
  let hasIndeterminate = false;
  for (const team of input.requestedTeamMemberships ?? []) {
    if (team.isMember === true) {
      needs = true;
    } else if (team.isMember === null) {
      hasIndeterminate = true;
    }
  }
  return { needs, hasIndeterminate };
}
