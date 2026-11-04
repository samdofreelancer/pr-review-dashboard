/**
 * Repository connect/disconnect services (T042; FR-005/006/007/009).
 *
 * Connect resolves `owner/repo` against GitHub first (canonical casing,
 * visibility, default branch), derives the capability map from the per-user
 * permission (FR-009 — an explicit map, never silent partial data), and
 * queues the first sync. Disconnect stops the repository's active sync,
 * deletes all local rows in one cascading transaction, then removes the
 * bare cache directory best-effort — nothing on GitHub is touched.
 */
import path from 'node:path';
import { rm } from 'node:fs/promises';
import type { Repository, RepositoryVisibility } from '@pr-review-dashboard/shared';
import { RepositorySchema } from '@pr-review-dashboard/shared';
import { AppError } from '../api/errors.js';
import { withTransaction, type Database } from '../db/connection.js';
import type { AppConfig } from '../config/index.js';
import {
  createSyncRun,
  getActiveAcknowledgement,
  getRepositoryByFullName,
  getRepositoryById,
  hasRepositoryWithGithubId,
  insertRepository,
  listRepositories,
} from '../db/repositoryStore.js';
import { GitHubError, mapGitHubError, type GitHubOctokit } from './client.js';
import { resolveGitHubClient } from './auth.js';
import { VIEWER_PERMISSIONS, type ViewerPermission } from './verifyHead.js';
import { normalizeRepositoryVisibility } from './visibility.js';

export interface RepositoryDeps {
  readonly db: Database;
  readonly config: AppConfig;
  readonly viewerLogin: string;
  /** Queue side: enqueue the sync whose run row is already created. */
  readonly startSyncJob: (repoId: string, runId: string) => void;
  /** Queue side: cancel any active sync for the repository (disconnect). */
  readonly stopSyncJob: (repoId: string) => void;
}

const CONNECT_QUERY = `
query ConnectRepositoryLookup($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    databaseId
    owner { login }
    name
    visibility
    isArchived
    defaultBranchRef { name }
    viewerPermission
  }
}`;

interface ConnectLookupPayload {
  repository?: {
    id?: string;
    databaseId?: number;
    owner?: { login?: string } | null;
    name?: string;
    visibility?: string;
    isArchived?: boolean | null;
    defaultBranchRef?: { name?: string } | null;
    viewerPermission?: string | null;
  } | null;
}

export interface ResolvedRepository {
  readonly githubId: string;
  readonly databaseId: number;
  readonly owner: string;
  readonly name: string;
  readonly visibility: RepositoryVisibility;
  readonly defaultBranch: string;
  readonly isArchived: boolean;
  readonly viewerPermission: ViewerPermission;
}

function normalizePermission(value: string | null | undefined): ViewerPermission {
  return (VIEWER_PERMISSIONS as readonly string[]).includes(value ?? '')
    ? (value as ViewerPermission)
    : 'NONE';
}

/** FR-009: capabilities state exactly what this credential may see. */
function capabilitiesFor(permission: ViewerPermission): Record<string, boolean> {
  const level =
    permission === 'ADMIN'
      ? 'admin'
      : permission === 'MAINTAIN' || permission === 'WRITE'
        ? 'write'
        : permission === 'TRIAGE' || permission === 'READ'
          ? 'read'
          : 'none';
  return {
    metadata: true,
    pull_requests: level !== 'none',
    checks: level !== 'none',
    contents: level !== 'none',
    requested_teams: level === 'admin' || level === 'write',
  };
}

/** Resolve `owner/name` on GitHub; NOT_FOUND when the app cannot see it. */
export async function resolveRepository(
  octokit: GitHubOctokit,
  input: { readonly owner: string; readonly name: string },
): Promise<ResolvedRepository> {
  let payload: ConnectLookupPayload;
  try {
    payload = await octokit.graphql<ConnectLookupPayload>(CONNECT_QUERY, {
      owner: input.owner,
      name: input.name,
    });
  } catch (error) {
    const message = (error as { message?: string } | null)?.message ?? '';
    if (message.includes('Could not resolve to a Repository')) {
      throw new GitHubError('NOT_FOUND', 'Repository not found on GitHub');
    }
    throw mapGitHubError(error);
  }
  const repo = payload.repository;
  if (repo === null || repo === undefined || repo.databaseId === undefined) {
    throw new GitHubError('NOT_FOUND', 'Repository not found on GitHub');
  }
  return {
    githubId: repo.id ?? '',
    databaseId: repo.databaseId,
    owner: repo.owner?.login ?? input.owner,
    name: repo.name ?? input.name,
    visibility: normalizeRepositoryVisibility(repo.visibility),
    defaultBranch: repo.defaultBranchRef?.name ?? 'main',
    isArchived: repo.isArchived === true,
    viewerPermission: normalizePermission(repo.viewerPermission),
  };
}

/** Map a stored repository row onto the wire contract (drift-guarded). */
export function toRepositoryPayload(
  db: Database,
  config: AppConfig,
  row: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly visibility: RepositoryVisibility;
    readonly defaultBranch: string;
    readonly connectedAt: string;
    readonly lastSuccessfulSyncAt: string | null;
    readonly lastSyncStatus: string;
    readonly capabilities: Record<string, boolean>;
  },
): Repository {
  const acknowledgement = getActiveAcknowledgement(db, row.id, config.ai.destinationLabel);
  return RepositorySchema.parse({
    id: row.id,
    owner: row.owner,
    name: row.name,
    visibility: row.visibility,
    defaultBranch: row.defaultBranch,
    connectedAt: row.connectedAt,
    ...(row.lastSuccessfulSyncAt !== null
      ? { lastSuccessfulSyncAt: row.lastSuccessfulSyncAt }
      : {}),
    lastSyncStatus: row.lastSyncStatus,
    aiAcknowledged: acknowledgement?.acknowledged ?? false,
    capabilities: row.capabilities,
  });
}

export function listConnectedRepositories(deps: {
  readonly db: Database;
  readonly config: AppConfig;
}): Repository[] {
  return listRepositories(deps.db).map((row) =>
    toRepositoryPayload(deps.db, deps.config, {
      ...row,
      lastSyncStatus: String(row.lastSyncStatus),
    }),
  );
}

export interface ConnectOutcome {
  readonly repository: Repository;
  readonly initialSyncRunId: string;
}

/**
 * Connect by `owner/name`: resolve, persist, and queue the first sync. The
 * duplicate checks deliberately run before any network call so double
 * connects stay offline-cheap, and the resolved identity (canonical casing)
 * is what gets stored.
 */
export async function connectRepository(
  deps: RepositoryDeps,
  request: { readonly owner: string; readonly name: string },
): Promise<ConnectOutcome> {
  const owner = request.owner.trim();
  const name = request.name.trim();
  if (owner === '' || name === '') {
    throw new AppError('VALIDATION_FAILED', 'Owner and repository name are required.');
  }

  if (getRepositoryByFullName(deps.db, owner, name) !== null) {
    throw new AppError('CONFLICT', 'This repository is already connected.');
  }

  const { client } = await resolveGitHubClient(deps.config.credential);
  const resolved = await resolveRepository(client.octokit, { owner, name });
  if (hasRepositoryWithGithubId(deps.db, resolved.databaseId)) {
    throw new AppError('CONFLICT', 'This repository is already connected.');
  }

  const connectedAt = new Date().toISOString();
  const repoId = insertRepository(deps.db, {
    owner: resolved.owner,
    name: resolved.name,
    githubRepoId: resolved.databaseId,
    visibility: resolved.visibility,
    defaultBranch: resolved.defaultBranch,
    isArchived: resolved.isArchived,
    capabilities: capabilitiesFor(resolved.viewerPermission),
    connectedAt,
  });
  const runId = createSyncRun(deps.db, repoId, 'manual', connectedAt);
  const row = getRepositoryById(deps.db, repoId);
  if (row === null) {
    throw new AppError('INTERNAL', 'Repository was inserted but could not be read back.');
  }
  deps.startSyncJob(repoId, runId);
  return { repository: toRepositoryPayload(deps.db, deps.config, row), initialSyncRunId: runId };
}

export async function disconnectRepository(deps: RepositoryDeps, repoId: string): Promise<void> {
  const row = getRepositoryById(deps.db, repoId);
  if (row === null) {
    throw new AppError('NOT_FOUND', 'Repository is not connected.');
  }

  // Stop any queued/running sync for this repository before data removal.
  deps.stopSyncJob(repoId);

  // FR-007/092: one transaction removes every local row for the repository;
  // the schema cascades pull requests, reviews, runs, drafts, posts, and
  // activity. GitHub is never touched.
  withTransaction(deps.db, () => {
    deps.db.prepare('DELETE FROM repositories WHERE id = ?;').run(repoId);
  });

  // Best-effort cleanup of the bare cache; board data is already gone.
  const cachePath = path.join(deps.config.paths.reposDir, `${row.id}.git`);
  try {
    await rm(cachePath, { recursive: true, force: true });
  } catch {
    // A stuck directory is swept by the retention job later.
  }
}
