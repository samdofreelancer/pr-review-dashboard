/**
 * Team membership REST adapter (T040, FR-009/018, SC-015).
 *
 * Reads the viewer's membership in a requested org team. GitHub answers
 * 404 both when the viewer is not a member and when the viewer may not see
 * the membership — indistinguishable — so a 404 is cached as `null`
 * (indeterminate): the UI displays the team request with a warning, but it
 * never counts as "needs my review". Any other lookup failure is also
 * surfaced as `null` so one unreadable team cannot fail a whole sync.
 */
import type { Database } from '../db/connection.js';
import { upsertTeamMembership } from '../db/repositoryStore.js';
import { mapGitHubError, type GitHubOctokit } from './client.js';

export type TeamMembershipLookup = boolean | null;

export interface RequestedTeam {
  readonly githubId: string;
  readonly org: string;
  readonly slug: string;
}

export async function refreshTeamMembership(
  octokit: GitHubOctokit,
  team: RequestedTeam,
  memberLogin: string,
): Promise<TeamMembershipLookup> {
  try {
    const response = await octokit.rest.teams.getMembershipForUserInOrg({
      org: team.org,
      team_slug: team.slug,
      username: memberLogin,
    });
    // `active` members are members; invitations (`pending`) are not yet.
    return response.data.state === 'active';
  } catch (error) {
    const mapped = mapGitHubError(error);
    if (mapped.code === 'NOT_FOUND') return null;
    return null; // Renamed/unreadable teams stay indeterminate, never fatal.
  }
}

/** Fetch-and-cache helper used by the sync orchestrator; never throws. */
export async function upsertTeamMembershipFromGitHub(
  db: Database,
  octokit: GitHubOctokit,
  team: RequestedTeam,
  memberLogin: string,
  checkedAt: string,
): Promise<TeamMembershipLookup> {
  const isMember = await refreshTeamMembership(octokit, team, memberLogin);
  upsertTeamMembership(db, {
    githubTeamId: team.githubId,
    orgLogin: team.org,
    teamSlug: team.slug,
    isMember,
    checkedAt,
  });
  return isMember;
}
