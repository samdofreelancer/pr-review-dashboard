/**
 * Sync-scoped GitHub fixtures (T034 → T039–T041).
 *
 * Two standalone MSW servers, each self-sufficient (handler order inside one
 * `setupServer` call is deterministic in MSW, runtime handlers outrank setup
 * handlers, so nothing depends on cross-server registration order):
 *
 * - `createSyncFixtureServer` — the repository list document the sync
 *   orchestrator queries, the REST endpoints it reads (check runs, commit
 *   statuses, team memberships), plus viewer/rate-limit answers.
 * - `createMarkReadyFixtureServer` — verify-head, the
 *   `markPullRequestReadyForReview` mutation (it flips the stored draft
 *   state), and the full single-pull-request re-fetch document.
 *
 * The GraphQL node shape is provisional for tests-first T033/T034; only
 * `createSyncHandlers` documents the shape `queries.ts` codes against.
 */
import { graphql, http, HttpResponse, type HttpHandler } from 'msw';
import type { SetupServer } from 'msw/node';
import { setupServer } from 'msw/node';
import { GITHUB_ORIGIN } from './github.js';

export const SYNC_VIEWER_LOGIN = 'fixture-viewer';

export type SyncFixtureReviewState =
  'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';

export interface SyncFixtureReview {
  readonly author: string;
  readonly state: SyncFixtureReviewState;
  readonly submittedAt: string;
  /** Head the review was submitted on; defaults to the pull request head. */
  readonly headRefOid?: string;
  /** GitHub review id; defaults to a deterministic per-list value. */
  readonly id?: string;
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
  readonly mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
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
  /** Teams whose membership endpoint answers 404 (indeterminate membership). */
  readonly indeterminateTeams?: ReadonlyArray<string>;
  /** When true the repository GraphQL query answers Not Found (revoked access). */
  readonly inaccessible?: boolean;
}

interface GithubFixtureServer {
  readonly server: SetupServer;
  /** standard `beforeAll` call */
  start: () => void;
  /** standard `afterEach` call */
  reset: () => void;
  /** standard `afterAll` call */
  close: () => void;
}

function setupFixtureServer(handlers: HttpHandler[]): GithubFixtureServer {
  const server = setupServer(...handlers);
  return {
    server,
    start: () => server.listen({ onUnhandledRequest: 'error' }),
    reset: () => server.resetHandlers(),
    close: () => server.close(),
  };
}

/** Deterministic 40-char head SHA per pull request number. */
function headShaFor(pr: SyncFixturePullRequest): string {
  if (pr.headSha !== undefined) return pr.headSha;
  return `a${String(pr.number).padStart(39, '0')}`;
}

function fullPullRequestNode(pr: SyncFixturePullRequest) {
  return {
    id: pr.githubId,
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
    mergeable: pr.mergeable ?? 'MERGEABLE',
    additions: pr.additions ?? 5,
    deletions: pr.deletions ?? 2,
    changedFiles: pr.changedFiles ?? 1,
    labels: {
      nodes: (pr.labels ?? []).map((label) => ({
        name: label.name,
        color: label.color ?? 'd4c5f9',
      })),
    },
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
      nodes: (pr.reviews ?? []).map((review, index) => ({
        id: review.id ?? `review-${pr.number}-${index}`,
        author: { login: review.author },
        state: review.state,
        submittedAt: review.submittedAt,
        headRefOid: review.headRefOid ?? headShaFor(pr),
      })),
    },
  };
}

const repositoryFields = (fixture: SyncFixtureRepository) => ({
  id: `R_${fixture.databaseId}`,
  databaseId: fixture.databaseId,
  visibility: fixture.visibility,
  viewerPermission: fixture.viewerPermission ?? 'WRITE',
  defaultBranchRef: { name: fixture.defaultBranch ?? 'main' },
  owner: { login: fixture.owner },
  name: fixture.name,
});

function listDocumentResponse(fixture: SyncFixtureRepository): unknown {
  if (fixture.inaccessible === true) {
    return {
      data: {
        repository: null,
      },
      errors: [{ type: 'FORBIDDEN', message: 'Not authorized to view this repository' }],
    };
  }
  return {
    data: {
      repository: {
        ...repositoryFields(fixture),
        pullRequests: {
          totalCount: fixture.pullRequests.length,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: fixture.pullRequests.map((pr) => fullPullRequestNode(pr)),
        },
        closedWindow: {
          totalCount: (fixture.closedWindow ?? []).length,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: (fixture.closedWindow ?? []).map((pr) => fullPullRequestNode(pr)),
        },
      },
    },
  };
}

const CHECKS_FIXTURE_EPOCH = '2026-03-01T00:00:00Z';

function syncRestHandlers(fixture: SyncFixtureRepository): HttpHandler[] {
  const repoBase = `${GITHUB_ORIGIN}/repos/${fixture.owner}/${fixture.name}`;

  const checkRuns = http.get(`${repoBase}/commits/:sha/check-runs`, ({ params }) => {
    const sha = String(params.sha);
    const pr =
      fixture.pullRequests.find((candidate) => headShaFor(candidate) === sha) ??
      (fixture.closedWindow ?? []).find((candidate) => headShaFor(candidate) === sha);
    if (pr === undefined || pr.checksUnavailable === true) {
      return HttpResponse.json({ message: 'check runs unavailable' }, { status: 500 });
    }
    return HttpResponse.json({
      total_count: (pr.checks ?? []).length,
      check_runs: (pr.checks ?? []).map((check) => ({
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
    const pr =
      fixture.pullRequests.find((candidate) => headShaFor(candidate) === sha) ??
      (fixture.closedWindow ?? []).find((candidate) => headShaFor(candidate) === sha);
    if (pr === undefined) {
      return HttpResponse.json({ message: 'status unavailable' }, { status: 500 });
    }
    const combined = pr.statuses ?? [];
    const state =
      combined.length === 0
        ? 'SUCCESS'
        : combined.some((status) => status.state === 'FAILURE')
          ? 'FAILURE'
          : combined.some((status) => status.state === 'PENDING')
            ? 'PENDING'
            : 'SUCCESS';
    return HttpResponse.json({
      state,
      statuses: combined.map((status) => ({ context: status.context, state: status.state })),
    });
  });

  const teamMembership = http.get(
    `${GITHUB_ORIGIN}/orgs/:org/teams/:slug/memberships/:login`,
    ({ params }) => {
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
    },
  );

  return [checkRuns, statuses, teamMembership];
}

/**
 * Runtime sync handlers for one fixture state: the REST endpoints the sync
 * pipeline reads plus the dispatching catch-all GraphQL handler (list
 * documents, head-verification documents, viewer documents). Register them
 * with `server.use(...)` to swap fixture states between sync calls.
 */
export function createSyncRuntimeHandlers(fixture: SyncFixtureRepository): HttpHandler[] {
  return [
    ...syncRestHandlers(fixture),
    graphql.operation(({ query }) => {
      // Order matters: the list document's fingerprint precedes the head
      // probe (which lacks `pullRequests(`), and the single-node re-fetch is
      // not served by the sync server at all.
      if (query.includes('pullRequests(')) {
        return HttpResponse.json(listDocumentResponse(fixture));
      }
      if (query.includes('pullRequest(number')) {
        return HttpResponse.json({
          data: {
            repository: {
              pullRequest: {
                headRefOid: null,
                state: 'OPEN',
                isDraft: false,
                viewerPermission: fixture.viewerPermission ?? 'WRITE',
              },
            },
          },
        });
      }
      if (query.includes('viewerPermission')) {
        // Connection lookup: repository metadata only (no pullRequest field).
        return HttpResponse.json({ data: { repository: repositoryFields(fixture) } });
      }
      if (query.includes('viewer {')) {
        return HttpResponse.json({ data: { viewer: { login: SYNC_VIEWER_LOGIN } } });
      }
      return HttpResponse.json({ data: { repository: null } });
    }),
  ];
}

/**
 * Standalone server for sync-driven tests; per-test fixture states swap via
 * `server.resetHandlers(); server.use(...createSyncRuntimeHandlers(next))`.
 */
export function createSyncFixtureServer(fixture: SyncFixtureRepository): GithubFixtureServer {
  return setupFixtureServer([
    http.get(`${GITHUB_ORIGIN}/rate_limit`, () =>
      HttpResponse.json({
        resources: { core: { limit: 5000, remaining: 4999, reset: 2_000_000_000 } },
      }),
    ),
    graphql.query('ViewerLogin', () =>
      HttpResponse.json({ data: { viewer: { login: SYNC_VIEWER_LOGIN } } }),
    ),
    ...createSyncRuntimeHandlers(fixture),
  ]);
}

export interface MarkReadyFixtureSpec {
  readonly owner: string;
  readonly name: string;
  readonly number: number;
  readonly headSha: string;
  /** Mutable: the mark-ready mutation flips this, and the re-fetch reads it. */
  isDraft: boolean;
}

/**
 * Standalone server for mark-ready / manual-draft contract flows:
 * head verification, the ready mutation (flipping the stored draft state),
 * and the full single-pull-request re-fetch document.
 */
export function createMarkReadyFixtureServer(options: {
  readonly viewerLogin?: string;
  readonly pullRequests: ReadonlyArray<MarkReadyFixtureSpec>;
}): GithubFixtureServer {
  return setupFixtureServer([
    http.get(`${GITHUB_ORIGIN}/rate_limit`, () =>
      HttpResponse.json({
        resources: { core: { limit: 5000, remaining: 4999, reset: 2_000_000_000 } },
      }),
    ),
    // Persistence refreshes the checks snapshot for the head; deterministic
    // empty answers keep the mark-ready flow quiet and fast.
    http.get(`${GITHUB_ORIGIN}/repos/:owner/:repo/commits/:sha/check-runs`, () =>
      HttpResponse.json({ total_count: 0, check_runs: [] }),
    ),
    http.get(`${GITHUB_ORIGIN}/repos/:owner/:repo/commits/:sha/status`, () =>
      HttpResponse.json({ state: 'SUCCESS', statuses: [] }),
    ),
    graphql.query('ViewerLogin', () =>
      HttpResponse.json({
        data: { viewer: { login: options.viewerLogin ?? SYNC_VIEWER_LOGIN } },
      }),
    ),
    graphql.query('HeadVerification', ({ variables }) => {
      const match = options.pullRequests.find(
        (candidate) =>
          candidate.owner === variables.owner &&
          candidate.name === variables.name &&
          candidate.number === variables.number,
      );
      return HttpResponse.json({
        data: {
          repository: {
            pullRequest:
              match === undefined
                ? null
                : {
                    headRefOid: match.headSha,
                    state: 'OPEN',
                    isDraft: match.isDraft,
                    viewerPermission: 'WRITE',
                  },
          },
        },
      });
    }),
    graphql.mutation('MarkPullRequestReadyForReview', ({ variables }) => {
      // Production sends the node id from the stored row; the fixture maps it
      // onto its deterministic per-number id (`github-${number}`).
      const input = variables.input as { pullRequestId?: string } | null | undefined;
      const match = options.pullRequests.find(
        (candidate) => input?.pullRequestId === `github-${candidate.number}`,
      );
      if (match === undefined) {
        return HttpResponse.json({
          data: { markPullRequestReadyForReview: null },
          errors: [{ type: 'NOT_FOUND', message: 'not a pull request' }],
        });
      }
      match.isDraft = false;
      return HttpResponse.json({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { id: `fixture-${match.number}`, isDraft: false },
          },
        },
      });
    }),
    graphql.operation(({ query, variables }) => {
      if (!query.includes('pullRequest(number')) {
        return HttpResponse.json({ data: { repository: null } });
      }
      const match = options.pullRequests.find(
        (candidate) =>
          candidate.owner === variables.owner &&
          candidate.name === variables.name &&
          candidate.number === variables.number,
      );
      if (match === undefined) {
        return HttpResponse.json({ data: { repository: { pullRequest: null } } });
      }
      const pr: SyncFixturePullRequest = {
        number: match.number,
        title: `Fixture PR #${match.number}`,
        isDraft: match.isDraft,
        state: 'OPEN',
        githubId: `github-${match.number}`,
        authorLogin: 'octo-author',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z',
        headSha: match.headSha,
      };
      return HttpResponse.json({
        data: {
          repository: {
            ...repositoryFields({
              owner: match.owner,
              name: match.name,
              databaseId: Number(match.headSha.slice(-2).replace(/\D/g, '') || 42),
              visibility: 'PUBLIC',
            }),
            pullRequest: fullPullRequestNode(pr),
          },
        },
      });
    }),
  ]);
}
