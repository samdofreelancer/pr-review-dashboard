/**
 * Sync-scoped GitHub fixtures (T034).
 *
 * The base `github.ts` fixture covers the requests the implemented modules
 * already make. This module grows it for the sync pipeline: one catch-all
 * GraphQL answer (provisional shape, finalized when T039 lands queries.ts)
 * plus the REST endpoints sync reads (check runs, commit statuses, team
 * memberships). Register them with `server.use(...)` on the base fixture
 * server for the duration of a test.
 */
import { graphql, http, HttpResponse, type HttpHandler } from 'msw';
import { GITHUB_ORIGIN } from './github.js';

export type SyncFixtureReviewState =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'DISMISSED'
  | 'COMMENTED'
  | 'PENDING';

export interface SyncFixtureReview {
  readonly author: string;
  readonly state: SyncFixtureReviewState;
  readonly submittedAt: string;
  /** Head the review was submitted on; defaults to the PR head. */
  readonly headRefOid?: string;
}

export interface SyncFixtureCheck {
  readonly name: string;
  readonly status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  readonly conclusion: 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'SKIP' | null;
}

export interface SyncFixtureStatus {
  readonly context: string;
  readonly state: 'SUCCESS' | 'FAILURE' | 'PENDING';
}

export interface SyncFixturePullRequest {
  readonly number: number;
  readonly title: string;
  readonly body?: string;
  readonly isDraft: boolean;
  readonly state: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly githubId: string;
  readonly authorLogin: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly headSha?: string;
  readonly baseRefName?: string;
  readonly headRefName?: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly changedFiles?: number;
  readonly labels?: ReadonlyArray<{ readonly name: string; readonly color?: string }>;
  readonly reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  readonly requestedReviewers?: readonly string[];
  readonly requestedTeams?: ReadonlyArray<{
    readonly org: string;
    readonly slug: string;
    readonly githubId: string;
  }>;
  readonly reviews?: ReadonlyArray<SyncFixtureReview>;
  readonly checks?: ReadonlyArray<SyncFixtureCheck>;
  readonly statuses?: ReadonlyArray<SyncFixtureStatus>;
  /** Force the check-runs REST endpoint to fail for this head (partial sync). */
  readonly checksUnavailable?: boolean;
}

export interface SyncFixtureRepository {
  readonly owner: string;
  readonly name: string;
  readonly databaseId: number;
  readonly visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  readonly defaultBranch?: string;
  readonly viewerPermission?: 'READ' | 'WRITE' | 'ADMIN';
  /** Open pull requests (paged window). */
  readonly pullRequests: ReadonlyArray<SyncFixturePullRequest>;
  /** Closed/merged pull requests inside the 30-day confirmation window. */
  readonly closedWindow?: ReadonlyArray<SyncFixturePullRequest>;
  /** Default head SHA for pull requests without an explicit headSha. */
  readonly defaultHeadSha?: string;
  /** Teams whose membership endpoint answers 404 (indeterminate membership). */
  readonly indeterminateTeams?: ReadonlyArray<string>;
  /** When true the repository GraphQL query answers Not Found (revoked access). */
  readonly inaccessible?: boolean;
}

/** Deterministic 40-char head SHA per pull request number. */
function headShaFor(pr: SyncFixturePullRequest): string {
  if (pr.headSha !== undefined) return pr.headSha;
  return `a${String(pr.number).padStart(39, '0')}`;
}

function pullRequestNode(pr: SyncFixturePullRequest) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? 'Fixture body.',
    state: pr.state,
    isDraft: pr.isDraft,
    author: { login: pr.authorLogin },
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.state === 'MERGED' ? pr.updatedAt : null,
    closedAt: pr.state === 'CLOSED' ? pr.updatedAt : null,
    baseRef: { name: pr.baseRefName ?? 'main' },
    headRef: { name: pr.headRefName ?? 'feature/fixture', target: { oid: headShaFor(pr) } },
    additions: pr.additions ?? 5,
    deletions: pr.deletions ?? 2,
    changedFiles: pr.changedFiles ?? 1,
    labels: { nodes: (pr.labels ?? []).map((label) => ({ name: label.name, color: label.color ?? 'd4c5f9' })) },
    reviewDecision: pr.reviewDecision ?? null,
    reviewRequests: {
      nodes: (pr.requestedReviewers ?? []).map((login) => ({
        requestedReviewer: { __typename: 'User', login },
      })),
    },
    requestedTeams: {
      nodes: (pr.requestedTeams ?? []).map((team) => ({
        team: { id: team.githubId, org: { login: team.org }, slug: team.slug },
      })),
    },
    reviews: {
      nodes: (pr.reviews ?? []).map((review) => ({
        author: { login: review.author },
        state: review.state,
        submittedAt: review.submittedAt,
        headRefOid: review.headRefOid ?? headShaFor(pr),
      })),
    },
  };
}

/**
 * Catch-all GraphQL handler for the sync document (T039 will name the exact
 * operation; the provisional shape follows `contracts/openapi.yaml` inputs).
 */
export function createSyncGraphQLHandler(fixture: SyncFixtureRepository): HttpHandler {
  return graphql.operation(async ({ variables }) => {
    const owner = String(variables.owner ?? fixture.owner);
    const name = String(variables.name ?? fixture.name);
    if (owner !== fixture.owner || name !== fixture.name) {
      return HttpResponse.json({ data: { repository: null } });
    }
    if (fixture.inaccessible === true) {
      return HttpResponse.json({ data: { repository: null }, errors: [{ type: 'FORBIDDEN', message: 'Not authorized' }] });
    }
    return HttpResponse.json({
      data: {
        repository: {
          id: `R_${fixture.databaseId}`,
          databaseId: fixture.databaseId,
          visibility: fixture.visibility,
          viewerPermission: fixture.viewerPermission ?? 'WRITE',
          defaultBranchRef: { name: fixture.defaultBranch ?? 'main' },
          pullRequests: {
            totalCount: fixture.pullRequests.length,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: fixture.pullRequests.map((pr) => pullRequestNode(pr)),
          },
          closedWindow: {
            totalCount: (fixture.closedWindow ?? []).length,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: (fixture.closedWindow ?? []).map((pr) => pullRequestNode(pr)),
          },
        },
      },
    });
  });
}

/** REST endpoints the sync pipeline reads (checks, statuses, team membership). */
export function createSyncRestHandlers(fixture: SyncFixtureRepository): HttpHandler[] {
  const repoBase = `${GITHUB_ORIGIN}/repos/${fixture.owner}/${fixture.name}`;

  const checkRuns = http.get(`${repoBase}/commits/:sha/check-runs`, ({ params }) => {
    const sha = String(params.sha);
    const pr = fixture.pullRequests.find((candidate) => headShaFor(candidate) === sha);
    if (pr?.checksUnavailable === true) {
      return HttpResponse.json({ message: 'check runs unavailable' }, { status: 500 });
    }
    return HttpResponse.json({
      total_count: (pr?.checks ?? []).length,
      check_runs: (pr?.checks ?? []).map((check) => ({
        id: check.name.length,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        started_at: CHECKS_FIXTURE_EPOCH,
        completed_at: check.status === 'COMPLETED' ? CHECKS_FIXTURE_EPOCH : null,
      })),
    });
  });

  const statuses = http.get(`${repoBase}/commits/:sha/status`, ({ params }) => {
    const sha = String(params.sha);
    const pr = fixture.pullRequests.find((candidate) => headShaFor(candidate) === sha);
    const statuses = pr?.statuses ?? [];
    const state =
      statuses.length === 0
        ? 'SUCCESS'
        : statuses.some((status) => status.state === 'FAILURE')
          ? 'FAILURE'
          : statuses.some((status) => status.state === 'PENDING')
            ? 'PENDING'
            : 'SUCCESS';
    return HttpResponse.json({
      state,
      statuses: statuses.map((status) => ({ context: status.context, state: status.state })),
    });
  });

  const teamMembership = http.get(`${GITHUB_ORIGIN}/orgs/:org/teams/:slug/memberships/:login`, ({ params }) => {
    const slug = String(params.slug);
    if ((fixture.indeterminateTeams ?? []).includes(slug)) {
      return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    }
    return HttpResponse.json({
      state: 'active',
      role: 'member',
      organization: { login: String(params.org) },
      member: { login: String(params.login) },
    });
  });

  return [checkRuns, statuses, teamMembership];
}

/** Convenience: register both GraphQL and REST sync handlers at once. */
export function createSyncHandlers(fixture: SyncFixtureRepository): HttpHandler[] {
  return [createSyncGraphQLHandler(fixture), ...createSyncRestHandlers(fixture)];
}
