/**
 * GitHub head and PR-state verification (T027, data-model "verification").
 *
 * Runs before diff preparation, review start, review completion, and every
 * publish: the on-disk/board notion of a PR (head sha + open state) is only
 * acted on when the live GitHub instance still agrees. A stale head is never
 * an error condition — it is a normal result that callers translate into
 * `STALE_HEAD`/`PR_CLOSED` problems or "not now" UI states.
 *
 * The comparison uses the exact 40-char head SHA; short SHAs never match.
 */
import type { PullRequestState } from '@pr-review-dashboard/shared';
import { mapGitHubError } from './client.js';
import type { GitHubOctokit } from './client.js';

/** GitHub viewer permission levels on a pull request (GraphQL scalar). */
export const VIEWER_PERMISSIONS = [
  'ADMIN',
  'MAINTAIN',
  'WRITE',
  'TRIAGE',
  'READ',
  'OUTSIDER',
  'NONE',
] as const;
export type ViewerPermission = (typeof VIEWER_PERMISSIONS)[number];

const HEAD_QUERY = `
query HeadVerification($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      state
      isDraft
      viewerPermission
    }
  }
}`;

interface HeadQueryPayload {
  repository?: {
    pullRequest?: {
      headRefOid: string;
      state: string;
      isDraft: boolean;
      viewerPermission: string;
    } | null;
  } | null;
}

export type HeadVerification =
  | {
      readonly ok: true;
      readonly headSha: string;
      readonly state: Extract<PullRequestState, 'open'>;
      readonly isDraft: boolean;
      readonly viewerPermission: ViewerPermission;
    }
  /**
   * `STALE_HEAD`: GitHub moved the head; `headSha` carries the new one for
   * the UI to display while board data stays untouched (FR-014/069).
   * `PR_CLOSED`: terminal state — never promoted to Done locally (FR-020).
   */
  | {
      readonly ok: false;
      readonly reason: 'STALE_HEAD' | 'PR_CLOSED' | 'NOT_FOUND';
      readonly headSha: string | null;
      readonly state: PullRequestState | null;
      readonly expectedHeadSha: string | null;
    };

export interface VerifyHeadInput {
  readonly owner: string;
  readonly name: string;
  readonly number: number;
  /** Board's known head SHA; pass null to skip the head comparison. */
  readonly expectedHeadSha: string;
}

function normalizePermission(value: string): ViewerPermission {
  return (VIEWER_PERMISSIONS as readonly string[]).includes(value)
    ? (value as ViewerPermission)
    : 'NONE';
}

export async function verifyHead(
  octokit: GitHubOctokit,
  input: VerifyHeadInput,
): Promise<HeadVerification> {
  let payload: HeadQueryPayload | null;
  try {
    payload = await octokit.graphql<HeadQueryPayload>(HEAD_QUERY, {
      owner: input.owner,
      name: input.name,
      number: input.number,
    });
  } catch (error) {
    const candidate = error as { message?: string | null } | null;
    if (
      typeof candidate?.message === 'string' &&
      candidate.message.includes('Could not resolve to a PullRequest')
    ) {
      return {
        ok: false,
        reason: 'NOT_FOUND',
        headSha: null,
        state: null,
        expectedHeadSha: input.expectedHeadSha,
      };
    }
    throw mapGitHubError(error);
  }
  const pr = payload?.repository?.pullRequest;
  if (pr === undefined || pr === null) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      headSha: null,
      state: null,
      expectedHeadSha: input.expectedHeadSha,
    };
  }

  const state: PullRequestState =
    pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : 'closed';
  if (state !== 'open') {
    return {
      ok: false,
      reason: 'PR_CLOSED',
      headSha: pr.headRefOid,
      state,
      expectedHeadSha: input.expectedHeadSha,
    };
  }
  if (pr.headRefOid !== input.expectedHeadSha) {
    return {
      ok: false,
      reason: 'STALE_HEAD',
      headSha: pr.headRefOid,
      state,
      expectedHeadSha: input.expectedHeadSha,
    };
  }
  return {
    ok: true,
    headSha: pr.headRefOid,
    state: 'open',
    isDraft: pr.isDraft,
    viewerPermission: normalizePermission(pr.viewerPermission),
  };
}

/** True when the credential may leave GitHub review comments (publish paths). */
export function canLeaveComments(permission: ViewerPermission): boolean {
  return permission !== 'OUTSIDER' && permission !== 'NONE';
}
