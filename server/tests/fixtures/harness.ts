/**
 * Server test harness (T033/T034).
 *
 * Boots the real Fastify app (buildApp) against a migrated temporary SQLite
 * database, seeds repositories and pull requests through the production
 * stores, and exposes inject() helpers that always carry the session CSRF
 * token. Contract and integration slices reuse this so the HTTP surface
 * under test is exactly what serves the SPA.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import {
  deriveLane,
  type ChecksState,
  type Mergeability,
  type PullRequestState,
  type ReviewDecision,
  type RepositoryVisibility,
  type SessionViewer,
} from '@pr-review-dashboard/shared';
import { buildApp } from '../../src/api/app.js';
import type { SseHub } from '../../src/api/sse.js';
import type { AppConfig } from '../../src/config/index.js';
import { openDatabase, closeDatabase, type Database } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { insertRepository } from '../../src/db/repositoryStore.js';
import { upsertPullRequest } from '../../src/db/pullRequestStore.js';

const APP_VERSION = '0.0.0-test';
export const VIEWER_LOGIN = 'fixture-viewer';

export interface SeedPullRequestSpec {
  readonly number: number;
  readonly title?: string;
  readonly state?: PullRequestState;
  readonly isDraft?: boolean;
  /** GraphQL review decision; drives the lane through deriveLane (T036). */
  readonly reviewDecision?: ReviewDecision | null;
  /** Login names explicitly requested for review (viewer counts personally). */
  readonly requestedReviewers?: readonly string[];
  readonly checksState?: ChecksState;
  readonly mergeableState?: Mergeability;
  readonly headSha?: string;
  /** Updated-at ordering input; later iso strings sort first on the board. */
  readonly updatedAt?: string;
}

export interface TestHarness {
  readonly app: FastifyInstance;
  readonly db: Database;
  readonly config: AppConfig;
  readonly viewerLogin: string;
  /** Insert a repository through the production store; returns the row id. */
  connectRepository(spec?: Partial<Parameters<typeof insertRepository>[1]>): string;
  /** Insert one pull request through the production store; returns the row id. */
  seedPullRequest(repoId: string, spec: SeedPullRequestSpec): string;
  /** inject() with the session CSRF token already attached. */
  injectWithCsrf(options: InjectOptions): Promise<LightMyRequestResponse>;
  /** Plain inject() for unauthenticated guard probes (no CSRF header). */
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

function buildConfig(dataRoot: string): AppConfig {
  const dataDir = path.join(dataRoot, 'data');
  return {
    credential: { source: 'GH_TOKEN', token: 'gho_test', pendingCliResolution: false },
    ai: {
      baseUrl: null,
      model: null,
      hasApiKey: false,
      timeoutMs: 120_000,
      maxContextChars: 300_000,
      priceInputPerMTok: null,
      priceOutputPerMTok: null,
      destinationKnown: false,
      destinationLabel: null,
      mayLeaveMachine: false,
    },
    port: 0,
    dataRoot,
    paths: {
      dataRoot,
      dataDir,
      reposDir: path.join(dataRoot, 'repos'),
      artifactsDir: path.join(dataRoot, 'artifacts'),
      logsDir: path.join(dataRoot, 'logs'),
      databasePath: path.join(dataDir, 'app.db'),
    },
    appVersion: APP_VERSION,
  };
}

export async function createHarness(
  options: {
    viewer?: SessionViewer | null;
    /** Custom SSE hub (recording spy) for activity/SSE assertions (T046). */
    sse?: SseHub;
  } = {},
): Promise<TestHarness> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'prdbh-'));
  await mkdir(path.join(tempRoot, 'data'), { recursive: true });
  const db = openDatabase(path.join(tempRoot, 'data', 'app.db'));
  runMigrations(db, path.resolve('server/migrations'));
  const config = buildConfig(tempRoot);
  const app = await buildApp({
    config,
    db,
    viewer: options.viewer ?? { login: VIEWER_LOGIN },
    ...(options.sse !== undefined ? { sse: options.sse } : {}),
  });

  let csrfToken: string | null = null;

  async function ensureCsrfToken(): Promise<string> {
    if (csrfToken !== null) return csrfToken;
    const response = await app.inject({ method: 'GET', url: '/api/session' });
    if (response.statusCode !== 200) {
      throw new Error(`/api/session returned ${response.statusCode}; cannot obtain CSRF token.`);
    }
    const body = JSON.parse(response.body) as { csrfToken: string };
    return (csrfToken = body.csrfToken);
  }

  return {
    app,
    db,
    config,
    viewerLogin: VIEWER_LOGIN,
    connectRepository(spec = {}) {
      return insertRepository(db, {
        owner: 'octo-org',
        name: 'demo-repo',
        githubRepoId: 42,
        visibility: 'public' as RepositoryVisibility,
        defaultBranch: 'main',
        isArchived: false,
        capabilities: {},
        connectedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
        ...spec,
      });
    },
    seedPullRequest(repoId, spec) {
      const iso = (input: string) => new Date(input).toISOString();
      const updatedAt = iso(spec.updatedAt ?? '2026-02-01T00:00:00Z');
      const state = spec.state ?? 'open';
      const isDraft = spec.isDraft ?? false;
      const reviewDecision = spec.reviewDecision ?? null;
      const lane = deriveLane({ state, isDraft, reviewDecision }).lane;
      const headSha = spec.headSha ?? `a${String(spec.number).padStart(39, '0')}`;
      const prId = `pr-${spec.number}`;
      upsertPullRequest(db, {
        id: prId,
        repoId,
        number: spec.number,
        githubId: `github-${spec.number}`,
        title: spec.title ?? `PR #${spec.number}`,
        body: 'Seeded body.',
        authorLogin: 'octo-author',
        state,
        isDraft,
        baseRef: 'main',
        headRef: 'feature/branch',
        headSha,
        additions: 12,
        deletions: 4,
        changedFiles: 2,
        labels: [{ name: 'ui', color: '0e8a16' }],
        requestedUsers: [...(spec.requestedReviewers ?? [])],
        requestedTeams: [],
        reviewDecision,
        lane,
        checksState: spec.checksState ?? 'none',
        mergeableState: spec.mergeableState ?? 'mergeable',
        mergedAt: state === 'merged' ? updatedAt : null,
        closedAt: state === 'closed' ? updatedAt : null,
        githubCreatedAt: iso('2026-01-15T00:00:00Z'),
        githubUpdatedAt: updatedAt,
        firstSeenAt: iso('2026-01-16T00:00:00Z'),
        lastSyncedAt: updatedAt,
        lastSeenOpenSyncId: null,
      });
      return prId;
    },
    async injectWithCsrf(request) {
      const token = await ensureCsrfToken();
      return app.inject({ ...request, headers: { ...request.headers, 'x-csrf-token': token } });
    },
    inject(request) {
      return app.inject(request);
    },
    async close() {
      await app.close();
      closeDatabase(db);
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}
