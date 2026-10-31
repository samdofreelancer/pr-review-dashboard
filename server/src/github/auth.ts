/**
 * GitHub credential resolution and viewer validation (T025, research R2).
 *
 * Resolution order: GH_TOKEN → GITHUB_TOKEN → `gh auth token`. The resolved
 * token is validated with a `viewer { login }` query before it counts as a
 * working credential. Only the source name and login are ever reported —
 * the token itself stays in memory and is never logged, persisted, or sent
 * to the client (FR-003/090).
 *
 * Resolution always happens at call time and re-reads the gh CLI token: the
 * app "re-resolves on 401 and on restart" by simply calling the same
 * function again — no cached identity survives a rejected credential.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CredentialConfig, CredentialSource } from '../config/index.js';
import { GitHubError, mapGitHubError } from './client.js';

const execFileP = promisify(execFile);

export interface ResolvedAuth {
  readonly source: CredentialSource;
  /** Token value; never logged or persisted. */
  readonly token: string;
  readonly login: string;
}

/** Read the token from an authenticated `gh` CLI session; null when unavailable. */
export async function readGhCliToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('gh', ['auth', 'token'], {
      timeout: 10_000,
      windowsHide: true,
    });
    const token = stdout.trim();
    return token === '' ? null : token;
  } catch {
    // gh missing, unauthenticated, or timed out — reported as no credential.
    return null;
  }
}

const VIEWER_QUERY = 'query ViewerLogin { viewer { login } }';
const TOKEN_TIMEOUT_MS = 20_000;

/** Validate a token against the GraphQL viewer query and return the login. */
export async function validateViewer(token: string): Promise<string> {
  if (token.trim() === '') {
    throw new GitHubError('AUTH_INVALID', 'Empty GitHub credential');
  }
  let response: Response;
  try {
    response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'pr-review-dashboard',
      },
      body: JSON.stringify({ query: VIEWER_QUERY }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubError('OFFLINE', 'GitHub is unreachable while validating the credential');
  }
  if (response.status === 401) {
    throw new GitHubError('AUTH_INVALID', 'GitHub rejected the credential');
  }
  if (response.status === 403) {
    throw new GitHubError('RATE_LIMITED', 'GitHub rate limit reached during viewer validation');
  }
  if (!response.ok) {
    throw mapGitHubError(
      new Error(`GitHub viewer validation failed with status ${response.status}`),
    );
  }
  const payload = (await response.json()) as {
    data?: { viewer?: { login?: string } };
    errors?: Array<{ message?: string } | Record<string, unknown>>;
    message?: string;
  };
  const login = payload.data?.viewer?.login;
  if (typeof login !== 'string' || login === '') {
    throw new GitHubError('AUTH_INVALID', 'GitHub credential accepted but viewer identity missing');
  }
  return login;
}

export type GhCliTokenReader = () => Promise<string | null>;

/**
 * Resolve the current credential and validate it. Returns null when no
 * credential is available at all (caller decides: the session route reports
 * `configured` capabilities without leaking why).
 */
export async function resolveViewerAuth(
  credential: CredentialConfig,
  readCliToken: GhCliTokenReader = readGhCliToken,
): Promise<ResolvedAuth | null> {
  // 1-2. Env tokens in explicit precedence order (validated by the config).
  if (credential.token !== null) {
    return {
      source: credential.source,
      token: credential.token,
      login: await validateViewer(credential.token),
    };
  }
  // 3. Pending gh CLI resolution (source=gh_cli with no executable token).
  if (!credential.pendingCliResolution) {
    return null;
  }
  const cliToken = await readCliToken();
  if (cliToken === null) {
    return null;
  }
  return { source: 'gh_cli', token: cliToken, login: await validateViewer(cliToken) };
}
