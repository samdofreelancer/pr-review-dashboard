/**
 * MSW GitHub fixtures (T029).
 *
 * GraphQL/REST handlers against the real origins (`https://api.github.com`)
 * so every later consumer (auth, sync, verifyHead, reviews) runs without a
 * live GitHub. Handlers start from the requests the implemented modules
 * already make (viewer validation, rate-limit probe) and grow per slice;
 * lifecycle helpers follow the setupServer pattern documented by MSW.
 */
import { graphql, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const GITHUB_ORIGIN = 'https://api.github.com';

export interface GithubFixtureOptions {
  /** Login answered by the viewer validation query (auth.ts smoke). */
  readonly viewerLogin?: string;
  readonly rateLimit?: {
    readonly remaining: number;
    readonly limit: number;
    /** Epoch seconds; fixtures use a fixed future instant by default. */
    readonly resetEpochSeconds?: number;
  };
  /** Returns null to answer the generic Not Found repository payload. */
  readonly pullRequest?: {
    readonly owner: string;
    readonly name: string;
    readonly number: number;
    readonly headRefOid: string;
    readonly state: 'OPEN' | 'MERGED' | 'CLOSED';
    readonly isDraft: boolean;
    readonly viewerPermission: string;
  };
}

const RATE_LIMIT_EPOCH = 2_000_000_000;

interface ViewerPayload {
  viewer: { login: string };
}

interface PullRequestPayload {
  repository: {
    pullRequest: {
      headRefOid: string;
      state: string;
      isDraft: boolean;
      viewerPermission: string;
    } | null;
  } | null;
}

/**
 * Build the MSW interception server. Callers must call the standard MSW
 * lifecycle (listen/resetHandlers/close) inside the test they use it in.
 */
export function createGithubFixtureServer(options: GithubFixtureOptions = {}) {
  const viewerLogin = options.viewerLogin ?? 'fixture-viewer';
  const pullRequest = options.pullRequest;

  const handlers = [
    graphql.query<ViewerPayload>('ViewerLogin', () =>
      HttpResponse.json({ data: { viewer: { login: viewerLogin } } }),
    ),
    http.get(`${GITHUB_ORIGIN}/rate_limit`, () =>
      HttpResponse.json({
        resources: {
          core: {
            limit: options.rateLimit?.limit ?? 5000,
            remaining: options.rateLimit?.remaining ?? 4999,
            reset: options.rateLimit?.resetEpochSeconds ?? RATE_LIMIT_EPOCH,
          },
        },
      }),
    ),
    graphql.query<PullRequestPayload>('HeadVerification', ({ variables }) => {
      const matches =
        pullRequest !== undefined &&
        pullRequest.owner === variables.owner &&
        pullRequest.name === variables.name &&
        pullRequest.number === variables.number;
      return HttpResponse.json({
        data: {
          repository: matches
            ? {
                pullRequest: {
                  headRefOid: pullRequest.headRefOid,
                  state: pullRequest.state,
                  isDraft: pullRequest.isDraft,
                  viewerPermission: pullRequest.viewerPermission,
                },
              }
            : null,
        },
      });
    }),
  ];

  const server = setupServer(...handlers);
  return {
    server,
    /** standard `beforeAll` call */
    start: () => server.listen({ onUnhandledRequest: 'error' }),
    /** standard `afterEach` call */
    reset: () => server.resetHandlers(),
    /** standard `afterAll` call */
    close: () => server.close(),
  };
}
