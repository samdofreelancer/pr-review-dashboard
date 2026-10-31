/**
 * GitHub client factory (T026, research R2).
 *
 * One adapter wraps both REST and GraphQL through two official plugins:
 * - throttling: waits out primary and secondary rate limits instead of
 *   failing mid-sync; every wait is surfaced through `onRateLimitWait` so
 *   callers can report reset times (SC-005 excludes waits from timing).
 * - retry: a few attempts for transient failures, but never for auth
 *   failures — 401 must re-resolve the credential (T025) rather than
 *   retry a dead token.
 *
 * Every thrown error is normalized to `GitHubError` with a stable
 * `ErrorCode` (openapi `Error.code`), so route layers only ever map from
 * `ErrorCode` to HTTP status.
 */
import { Octokit } from '@octokit/rest';
import { throttling, type ThrottlingOptions } from '@octokit/plugin-throttling';
import { retry, type RetryOptions } from '@octokit/plugin-retry';
import type { ErrorCode } from '@pr-review-dashboard/shared';

export type GitHubOctokit = Octokit & {
  /** GraphQL-with-throttling entry point added by the plugins above. */
  graphql: <Result>(query: string, options?: Record<string, unknown>) => Promise<Result>;
};

const PrebuiltOctokit = Octokit.plugin(throttling, retry);

export class GitHubError extends Error {
  readonly code: ErrorCode;
  /** Set only for RATE_LIMITED; the reset instant reported by GitHub. */
  readonly resetAt: Date | null;

  constructor(code: ErrorCode, message: string, resetAt: Date | null = null) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.resetAt = resetAt;
  }
}

export type AuthErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'OFFLINE'
  | 'INTERNAL';

/** Errors the caller treats as "re-resolve the credential and retry once". */
export function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof GitHubError && (error.code === 'AUTH_MISSING' || error.code === 'AUTH_INVALID')
  );
}

export interface GitHubRateLimitStatus {
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: Date | null;
}

export interface CreateGitHubClientOptions {
  readonly token: string;
  /** Called for every wait the throttling plugin produces (seconds). */
  readonly onRateLimitWait?: (seconds: number, secondary: boolean) => void;
}

export interface GitHubClient {
  readonly octokit: GitHubOctokit;
  /**
   * Cheap, uncounted rate-limit probe (`GET /rate_limit`). Returns remaining
   * core quota and its reset instant so the UI can surface retry times.
   */
  getRateLimitStatus(): Promise<GitHubRateLimitStatus>;
}

const USER_AGENT = 'pr-review-dashboard';

/** Normalize any thrown value into a stable `GitHubError` (maps T026). */
export function mapGitHubError(input: unknown): GitHubError {
  if (input instanceof GitHubError) {
    return input;
  }
  const candidate = input as {
    status?: number;
    name?: string;
    message?: string;
    response?: { headers?: Record<string, string>; data?: unknown } | null;
  } | null;
  if (candidate === null || candidate.message === undefined || candidate.name === undefined) {
    return new GitHubError('INTERNAL', 'Unexpected GitHub failure');
  }
  const headers = candidate.response?.headers ?? {};
  const remaining = headers['x-ratelimit-remaining'];
  const resetHeader = headers['x-ratelimit-reset'];
  const resetAt = resetHeader === undefined ? null : new Date(Number(resetHeader) * 1000);
  const status = candidate.status;
  const message = candidate.message.toLowerCase();

  if (status === 401) {
    return new GitHubError('AUTH_INVALID', 'GitHub rejected the credential');
  }
  if (
    status === 403 &&
    (remaining === '0' || message.includes('rate limit') || message.includes('secondary'))
  ) {
    return new GitHubError('RATE_LIMITED', 'GitHub rate limit reached', resetAt);
  }
  if (status === 403 && message.includes('resource not accessible')) {
    return new GitHubError('PERMISSION_DENIED', 'GitHub denied this request for the current token');
  }
  if (status === 403) {
    return new GitHubError('PERMISSION_DENIED', `GitHub request not authorized`);
  }
  if (status === 404) {
    return new GitHubError('NOT_FOUND', 'GitHub resource not found');
  }
  if (status === 422) {
    return new GitHubError('VALIDATION_FAILED', 'GitHub rejected the request payload');
  }
  if (status !== undefined && status >= 500) {
    return new GitHubError('OFFLINE', 'GitHub is temporarily unavailable');
  }
  if (
    candidate.name === 'FetchError' ||
    candidate.message.includes('fetch failed') ||
    candidate.message.includes('network')
  ) {
    return new GitHubError('OFFLINE', 'GitHub is unreachable from this machine');
  }
  return new GitHubError('INTERNAL', 'Unexpected GitHub failure');
}

export function createGitHubClient(options: CreateGitHubClientOptions): GitHubClient {
  const octokit = new PrebuiltOctokit({
    auth: options.token,
    userAgent: USER_AGENT,
    throttle: {
      onRateLimit: (retryAfter: number) => {
        options.onRateLimitWait?.(retryAfter, false);
        return true;
      },
      onSecondaryRateLimit: (retryAfter: number) => {
        options.onRateLimitWait?.(retryAfter, true);
        return true;
      },
    } satisfies ThrottlingOptions,
    retry: {
      retries: 2,
      doNotRetry: [401],
    } satisfies RetryOptions,
  }) as GitHubOctokit;

  async function getRateLimitStatus(): Promise<GitHubRateLimitStatus> {
    try {
      const { data } = await octokit.rest.rateLimit.get();
      const core = data.resources.core;
      return {
        remaining: core.remaining,
        limit: core.limit,
        resetAt: new Date(core.reset * 1000),
      };
    } catch (error) {
      throw mapGitHubError(error);
    }
  }

  return { octokit, getRateLimitStatus };
}
