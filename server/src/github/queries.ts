/**
 * GitHub GraphQL queries and snapshot mapping (T039).
 *
 * Synchronizes open pull requests plus the 30-day closed/merged window in
 * one aliased document. The normalized snapshots are the only type the sync
 * orchestrator (T041) consumes, so root GraphQL field changes in GitHub can
 * never leak into store code.
 */
import { mapGitHubError, type GitHubOctokit } from './client.js';
import type {
  ChecksState,
  Mergeability,
  PullRequestState,
  ReviewDecision,
  ReviewState,
} from '@pr-review-dashboard/shared';

export interface GitHubRepositorySnapshot {
  readonly id: string;
  readonly databaseId: number;
  readonly visibility: 'public' | 'private' | 'internal';
  readonly defaultBranch: string;
}

export interface GitHubReviewSnapshot {
  readonly githubReviewId: string;
  readonly reviewerLogin: string;
  readonly state: ReviewState;
  readonly submittedAt: string | null;
  readonly headSha: string;
}

export interface GitHubPullRequestSnapshot {
  readonly number: number;
  readonly githubId: string;
  readonly title: string;
  readonly body: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly authorLogin: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly baseRef: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: ReadonlyArray<{ name: string; color?: string }>;
  readonly requestedUsers: readonly string[];
  readonly requestedTeams: ReadonlyArray<{ org: string; slug: string; githubId: string }>;
  readonly reviewDecision: ReviewDecision | null;
  readonly mergeable: Mergeability;
  readonly checksStatePlaceholder: ChecksState;
  readonly reviews: ReadonlyArray<GitHubReviewSnapshot>;
}

const PULL_REQUEST_NODE_FIELDS = `
      id
      number
      title
      body
      state
      isDraft
      author { login }
      createdAt
      updatedAt
      mergedAt
      closedAt
      baseRef { name }
      headRef { name target { oid } }
      mergeable
      additions
      deletions
      changedFiles
      labels(first: 20) { nodes { name color } }
      reviewDecision
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } } } }
      requestedTeams: reviewRequests(first: 20) { nodes { team { id org { login } slug } } }
      reviews(first: 100, after: null) { nodes { id author { login } state submittedAt headRefOid } }`;

const REPOSITORY_CONNECTION_ALIASES = `
    pullRequests(first: 100, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
${PULL_REQUEST_NODE_FIELDS}
      }
    }
    closedWindow: pullRequests(first: 100, states: [MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
${PULL_REQUEST_NODE_FIELDS}
      }
    }`;

const SYNC_LIST_QUERY = `
query SyncRepositoryPullRequests($owner: String!, $name: String!, $afterOpen: String, $afterClosed: String) {
  repository(owner: $owner, name: $name) {
    id
    databaseId
    visibility
    viewerPermission
    defaultBranchRef { name }
${REPOSITORY_CONNECTION_ALIASES}
  }
}`;

const PULL_REQUEST_QUERY = `
query PullRequestNode($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    id
    databaseId
    visibility
    viewerPermission
    defaultBranchRef { name }
    pullRequest(number: $number) { ... on PullRequest {
${PULL_REQUEST_NODE_FIELDS}
    } }
  }
}`;

interface PagePayload {
  readonly totalCount: number;
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
  readonly nodes: readonly unknown[];
}

interface PullRequestNodePayload {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  isDraft: boolean;
  author: { login: string } | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRef: { name: string } | null;
  headRef: { name: string; target: { oid: string } | null } | null;
  mergeable: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: { nodes: ReadonlyArray<{ name?: string; color?: string } | null> } | null;
  reviewDecision: string | null;
  reviewRequests: {
    nodes: ReadonlyArray<{
      requestedReviewer?: { __typename?: string; login?: string } | null;
    } | null> | null;
  } | null;
  requestedTeams: {
    nodes: ReadonlyArray<{
      team?: { id: string; org?: { login: string } | null; slug: string } | null;
    } | null> | null;
  } | null;
  reviews: {
    nodes: ReadonlyArray<{
      id?: string;
      author?: { login?: string } | null;
      state?: string;
      submittedAt?: string | null;
      headRefOid?: string;
    } | null> | null;
  } | null;
}

function mapState(state: string): PullRequestState {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  if (state === 'OPEN') return 'open';
  return 'open';
}

function mergeabilityOf(guess: string): Mergeability {
  if (guess === 'CONFLICTING') return 'conflicting';
  if (guess === 'UNKNOWN') return 'unknown';
  return 'mergeable';
}

function decisionOf(value: string | null | undefined): ReviewDecision | null {
  if (value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'REVIEW_REQUIRED') {
    return value;
  }
  return null;
}

export function mapPullRequestNode(node: PullRequestNodePayload): GitHubPullRequestSnapshot {
  const reviews: GitHubReviewSnapshot[] = [];
  for (const raw of node.reviews?.nodes ?? []) {
    if (raw === null) continue;
    reviews.push({
      githubReviewId: raw.id ?? `review-${raw.author?.login ?? 'unknown'}-${raw.submittedAt ?? ''}`,
      reviewerLogin: raw.author?.login ?? 'unknown',
      state: (raw.state ?? 'PENDING') as ReviewState,
      submittedAt: raw.submittedAt ?? null,
      headSha: raw.headRefOid ?? node.headRef?.target?.oid ?? '',
    });
  }
  return {
    number: node.number,
    githubId: node.id,
    title: node.title,
    body: node.body ?? '',
    state: mapState(node.state),
    isDraft: node.isDraft,
    authorLogin: node.author?.login ?? 'ghost',
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    mergedAt: node.mergedAt,
    closedAt: node.closedAt,
    baseRef: node.baseRef?.name ?? 'main',
    headRef: node.headRef?.name ?? '',
    headSha: node.headRef?.target?.oid ?? '',
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    labels: (node.labels?.nodes ?? [])
      .filter(
        (label): label is { name: string; color?: string } =>
          label !== null && typeof label.name === 'string',
      )
      .map((label) =>
        label.color === undefined ? { name: label.name } : { name: label.name, color: label.color },
      ),
    requestedUsers: (node.reviewRequests?.nodes ?? [])
      .map((entry) => entry?.requestedReviewer)
      .filter(
        (reviewer): reviewer is { __typename: string; login: string } =>
          reviewer !== null && reviewer !== undefined && reviewer.login !== undefined,
      )
      .map((reviewer) => reviewer.login),
    requestedTeams: (node.requestedTeams?.nodes ?? [])
      .map((entry) => entry?.team)
      .filter(
        (team): team is { id: string; org: { login: string } | null; slug: string } =>
          team !== null && team !== undefined && typeof team.slug === 'string',
      )
      .map((team) => ({
        org: team.org?.login ?? '',
        slug: team.slug,
        githubId: team.id,
      })),
    reviewDecision: decisionOf(node.reviewDecision),
    mergeable: mergeabilityOf(node.mergeable),
    checksStatePlaceholder: 'none',
    reviews,
  };
}

interface RepositoryListPayload {
  repository?: {
    id?: string;
    databaseId?: number;
    visibility?: string;
    viewerPermission?: string;
    defaultBranchRef?: { name?: string } | null;
    pullRequests?: PagePayload;
    closedWindow?: PagePayload;
  } | null;
}

function mapRepository(payload: NonNullable<RepositoryListPayload['repository']>): {
  repository: GitHubRepositorySnapshot;
  open: GitHubPullRequestSnapshot[];
  closed: GitHubPullRequestSnapshot[];
} {
  const visibility =
    payload.visibility === 'PUBLIC'
      ? 'public'
      : payload.visibility === 'INTERNAL'
        ? 'internal'
        : 'private';
  return {
    repository: {
      id: payload.id ?? '',
      databaseId: payload.databaseId ?? 0,
      visibility,
      defaultBranch: payload.defaultBranchRef?.name ?? 'main',
    },
    open: (payload.pullRequests?.nodes ?? [])
      .filter((node): node is PullRequestNodePayload => node !== null && node !== undefined)
      .map((node) => mapPullRequestNode(node)),
    closed: (payload.closedWindow?.nodes ?? [])
      .filter((node): node is PullRequestNodePayload => node !== null && node !== undefined)
      .map((node) => mapPullRequestNode(node)),
  };
}

export interface FetchRepositoryPullRequestsResult {
  readonly repository: GitHubRepositorySnapshot;
  readonly open: readonly GitHubPullRequestSnapshot[];
  readonly closed: readonly GitHubPullRequestSnapshot[];
}

/**
 * List open pull requests and the closed/merged confirmation window for a
 * connected repository. Pagination follows both cursors until exhausted.
 */
export async function fetchRepositoryPullRequests(
  octokit: GitHubOctokit,
  input: { readonly owner: string; readonly name: string },
): Promise<FetchRepositoryPullRequestsResult> {
  const openNodes: GitHubPullRequestSnapshot[] = [];
  const closedNodes: GitHubPullRequestSnapshot[] = [];
  let afterOpen: string | null = null;
  let afterClosed: string | null = null;
  let repository: GitHubRepositorySnapshot | null = null;

  do {
    let payload: RepositoryListPayload;
    try {
      payload = await octokit.graphql<RepositoryListPayload>(SYNC_LIST_QUERY, {
        owner: input.owner,
        name: input.name,
        ...(afterOpen !== null ? { afterOpen } : {}),
        ...(afterClosed !== null ? { afterClosed } : {}),
      });
    } catch (error) {
      throw mapGitHubError(error);
    }
    const repo = payload.repository;
    if (repo === undefined || repo === null) {
      throw mapGitHubError(Object.assign(new Error('Could not resolve to a Repository'), {}));
    }
    if (repository === null) {
      repository = mapRepository(repo).repository;
    }
    const mapped = mapRepository(repo);
    openNodes.push(...mapped.open);
    closedNodes.push(...mapped.closed);
    afterOpen =
      repo.pullRequests?.pageInfo.hasNextPage === true
        ? (repo.pullRequests.pageInfo.endCursor ?? null)
        : null;
    afterClosed =
      repo.closedWindow?.pageInfo.hasNextPage === true
        ? (repo.closedWindow.pageInfo.endCursor ?? null)
        : null;
  } while (afterOpen !== null || afterClosed !== null);

  return { repository: repository, open: openNodes, closed: closedNodes };
}

interface SinglePullRequestPayload {
  repository?: {
    pullRequest?: PullRequestNodePayload;
  } | null;
}

/**
 * Re-fetch one pull request's full snapshot (used before returning refreshed
 * board data after a GitHub action — FR-025).
 */
export async function fetchPullRequestSnapshot(
  octokit: GitHubOctokit,
  input: { readonly owner: string; readonly name: string; readonly number: number },
): Promise<GitHubPullRequestSnapshot | null> {
  let payload: SinglePullRequestPayload;
  try {
    payload = await octokit.graphql<SinglePullRequestPayload>(PULL_REQUEST_QUERY, {
      owner: input.owner,
      name: input.name,
      number: input.number,
    });
  } catch (error) {
    throw mapGitHubError(error);
  }
  const node = payload.repository?.pullRequest;
  if (node === undefined || node === null) return null;
  return mapPullRequestNode(node);
}
