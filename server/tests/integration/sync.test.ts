/**
 * Integration tests for the sync pipeline (T034 ↔ T039–T046).
 *
 * The flows drive the real queue + sync orchestrator through the sync HTTP
 * route, backed by MSW fixtures in `fixtures/github-sync.ts` (self-contained
 * standalone server; per-test fixture states swap in as runtime handlers).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { ErrorSchema, SyncRunSchema, type LaneName } from '@pr-review-dashboard/shared';
import type { LightMyRequestResponse } from 'fastify';
import {
  createSyncRuntimeHandlers,
  createSyncFixtureServer,
  type SyncFixturePullRequest,
  type SyncFixtureRepository,
} from '../fixtures/github-sync.js';
import { createHarness, type TestHarness } from '../fixtures/harness.js';
import { listPullRequestsByRepo } from '../../src/db/pullRequestStore.js';
import { getLatestSyncRun } from '../../src/db/repositoryStore.js';

const iso = (value: string) => new Date(value).toISOString();

const GITHUB_ORIGIN = 'https://api.github.com';

function fixturePullRequest(
  spec: Partial<SyncFixturePullRequest> & { number: number },
): SyncFixturePullRequest {
  return {
    title: `Fixture PR #${spec.number}`,
    isDraft: false,
    state: 'OPEN',
    githubId: `github-${spec.number}`,
    authorLogin: 'octo-author',
    createdAt: iso('2026-02-01T00:00:00Z'),
    updatedAt: iso('2026-02-20T00:00:00Z'),
    ...spec,
  };
}

const REPO_BASE: SyncFixtureRepository = {
  owner: 'octo-org',
  name: 'demo-repo',
  databaseId: 42,
  visibility: 'PUBLIC',
  pullRequests: [],
};

let currentFixture: SyncFixtureRepository;

/** Swap the GitHub fixture state for the next sync. */
function swapSyncFixture(fixture: Partial<SyncFixtureRepository>): SyncFixtureRepository {
  currentFixture = { ...REPO_BASE, ...fixture };
  github.server.resetHandlers();
  github.server.use(...createSyncRuntimeHandlers(currentFixture));
  return currentFixture;
}

const github = createSyncFixtureServer(REPO_BASE);

let context: SyncContext;

interface SyncContext {
  readonly harness: TestHarness;
  readonly repoId: string;
}

/** Seed the repository row directly (production store) and return a context. */
async function startSync(): Promise<SyncContext> {
  const harness = await createHarness();
  const repoId = harness.connectRepository({
    owner: currentFixture.owner,
    name: currentFixture.name,
    githubRepoId: currentFixture.databaseId,
  });
  context = { harness, repoId };
  return context;
}

beforeAll(() => {
  github.start();
});

afterEach(async () => {
  await context.harness.close();
});

afterAll(() => {
  github.close();
});

/** Drive one sync through the HTTP surface (CSRF token attached). */
async function runSync(ctx: SyncContext): Promise<LightMyRequestResponse> {
  return ctx.harness.injectWithCsrf({
    method: 'POST',
    url: `/api/repos/${ctx.repoId}/sync`,
  });
}

function waitForTerminalRun(ctx: SyncContext) {
  return vi.waitFor(
    () => {
      const run = getLatestSyncRun(ctx.harness.db, ctx.repoId);
      expect(run).not.toBeNull();
      expect(run?.status).not.toBe('running');
      return run!;
    },
    { timeout: 5_000, interval: 25 },
  );
}

function boardOfTitles(board: {
  lanes: ReadonlyArray<{ cards: ReadonlyArray<{ number: number }> }>;
}): number[] {
  return board.lanes.flatMap((lane) => lane.cards.map((card) => card.number));
}

async function boardOf(ctx: SyncContext) {
  const response = await ctx.harness.inject({ method: 'GET', url: '/api/board' });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body) as {
    lanes: ReadonlyArray<{
      name: LaneName;
      count: number;
      cards: ReadonlyArray<{ number: number }>;
    }>;
  };
}

function laneCounts(board: {
  lanes: ReadonlyArray<{ name: LaneName; count: number }>;
}): Record<LaneName, number> {
  return Object.fromEntries(board.lanes.map((lane) => [lane.name, lane.count])) as Record<
    LaneName,
    number
  >;
}

describe('connect → sync → five lanes', () => {
  it('maps every canonical GitHub state to its documented lane', async () => {
    const partial = {
      pullRequests: [
        fixturePullRequest({ number: 1, isDraft: true, updatedAt: iso('2026-02-01T00:00:00Z') }),
        fixturePullRequest({
          number: 2,
          reviewDecision: 'REVIEW_REQUIRED',
          updatedAt: iso('2026-02-02T00:00:00Z'),
        }),
        fixturePullRequest({
          number: 3,
          reviewDecision: 'APPROVED',
          updatedAt: iso('2026-02-03T00:00:00Z'),
        }),
        fixturePullRequest({
          number: 4,
          reviewDecision: 'CHANGES_REQUESTED',
          updatedAt: iso('2026-02-04T00:00:00Z'),
        }),
        fixturePullRequest({ number: 5, state: 'MERGED', updatedAt: iso('2026-02-05T00:00:00Z') }),
      ],
      closedWindow: [
        fixturePullRequest({ number: 6, state: 'CLOSED', updatedAt: iso('2026-02-06T00:00:00Z') }),
      ],
    };
    setupInitialFixture(partial);
    const ctx = await startSync();

    const response = await runSync(ctx);
    expect(response.statusCode).toBe(202);
    expect(SyncRunSchema.parse(JSON.parse(response.body)).status).toBe('running');

    const run = await waitForTerminalRun(ctx);
    expect(run.status).toBe('succeeded');

    const board = await boardOf(ctx);
    expect(laneCounts(board)).toEqual({
      Draft: 1,
      'In review': 1,
      'Request changes': 1,
      Approved: 1,
      Done: 2,
    });
  });
});

/** Install the GitHub fixture state for the NEXT sync (also re-seats handlers). */
function setupInitialFixture(partial: Partial<SyncFixtureRepository>): void {
  swapSyncFixture(partial);
}

describe('COMMENTED does not clear an approval (FR-013/014)', () => {
  it('keeps the approval from the decision-bearing review', async () => {
    setupInitialFixture({
      pullRequests: [
        fixturePullRequest({
          number: 10,
          reviewDecision: null,
          reviews: [
            { author: 'alice-dev', state: 'APPROVED', submittedAt: iso('2026-02-02T00:00:00Z') },
            { author: 'alice-dev', state: 'COMMENTED', submittedAt: iso('2026-02-10T00:00:00Z') },
            { author: 'bob-qa', state: 'COMMENTED', submittedAt: iso('2026-02-11T00:00:00Z') },
          ],
        }),
      ],
    });
    const ctx = await startSync();

    const response = await runSync(ctx);
    expect(response.statusCode).toBe(202);
    await waitForTerminalRun(ctx);

    const board = await boardOf(ctx);
    expect(laneCounts(board)['Approved']).toBe(1);
  });
});

describe('dismissed approval lane transition', () => {
  it('drops the PR to In review (latest decision-bearing review wins)', async () => {
    setupInitialFixture({
      pullRequests: [
        fixturePullRequest({
          number: 11,
          reviewDecision: null,
          reviews: [
            { author: 'alice-dev', state: 'APPROVED', submittedAt: iso('2026-02-02T00:00:00Z') },
            { author: 'alice-dev', state: 'DISMISSED', submittedAt: iso('2026-02-12T00:00:00Z') },
          ],
        }),
      ],
    });
    const ctx = await startSync();

    const response = await runSync(ctx);
    expect(response.statusCode).toBe(202);
    await waitForTerminalRun(ctx);

    const board = await boardOf(ctx);
    expect(laneCounts(board)).toEqual({
      Draft: 0,
      'In review': 1,
      'Request changes': 0,
      Approved: 0,
      Done: 0,
    });
  });
});

describe('sync idempotency', () => {
  it('stores no duplicate rows and keeps lanes stable across repeated syncs', async () => {
    setupInitialFixture({
      pullRequests: [
        fixturePullRequest({
          number: 20,
          reviewDecision: 'APPROVED',
          updatedAt: iso('2026-02-03T00:00:00Z'),
        }),
        fixturePullRequest({ number: 21, updatedAt: iso('2026-02-04T00:00:00Z') }),
      ],
    });
    const ctx = await startSync();

    const first = await runSync(ctx);
    expect(first.statusCode).toBe(202);
    await waitForTerminalRun(ctx);
    const rowsAfterFirst = listPullRequestsByRepo(ctx.harness.db, ctx.repoId);
    const firstSeenAtByNumber = new Map(rowsAfterFirst.map((row) => [row.number, row.firstSeenAt]));
    expect(rowsAfterFirst).toHaveLength(2);
    const boardBefore = await boardOf(ctx);

    const second = await runSync(ctx);
    expect(second.statusCode).toBe(202);
    await waitForTerminalRun(ctx);

    const rowsAfterSecond = listPullRequestsByRepo(ctx.harness.db, ctx.repoId);
    expect(rowsAfterSecond).toHaveLength(2);
    for (const row of rowsAfterSecond) {
      expect(row.firstSeenAt).toBe(firstSeenAtByNumber.get(row.number));
    }
    expect(boardOfTitles(await boardOf(ctx))).toEqual(boardOfTitles(boardBefore));
  });
});

describe('partial and failed syncs', () => {
  it('keeps the last good lanes and reports partial when one PR fails to sync', async () => {
    const good = [
      fixturePullRequest({
        number: 30,
        reviewDecision: 'APPROVED',
        updatedAt: iso('2026-02-05T00:00:00Z'),
      }),
      fixturePullRequest({ number: 31, updatedAt: iso('2026-02-06T00:00:00Z') }),
    ];
    setupInitialFixture({ pullRequests: good });
    const ctx = await startSync();
    const first = await runSync(ctx);
    expect(first.statusCode).toBe(202);
    await waitForTerminalRun(ctx);
    const boardBefore = await boardOf(ctx);

    // Second sync: GitHub answers the check-runs endpoint for PR 31 with 500.
    swapSyncFixture({
      pullRequests: good.map((pr) => (pr.number === 31 ? { ...pr, checksUnavailable: true } : pr)),
    });
    const second = await runSync(ctx);
    expect(second.statusCode).toBe(202);
    const run = await waitForTerminalRun(ctx);
    expect(run.status).toBe('partial');

    const boardAfter = await boardOf(ctx);
    expect(boardOfTitles(boardAfter)).toEqual(boardOfTitles(boardBefore));

    const rows = listPullRequestsByRepo(ctx.harness.db, ctx.repoId);
    const degradedRow = rows.find((row) => row.number === 31);
    expect(degradedRow?.state).toBe('open');
    expect(degradedRow?.lane).toBe('In review');
  });
});

describe('rate limiting', () => {
  it('answers RATE_LIMITED with a Retry-After window when exhausted', async () => {
    setupInitialFixture();
    const ctx = await startSync();

    github.server.use(
      http.get(`${GITHUB_ORIGIN}/rate_limit`, () =>
        HttpResponse.json({
          resources: {
            core: {
              limit: 5000,
              remaining: 0,
              reset: Math.floor(Date.now() / 1000) + 180,
            },
          },
        }),
      ),
    );

    const response = await runSync(ctx);
    expect(response.statusCode).toBe(429);
    expect(ErrorSchema.parse(JSON.parse(response.body)).code).toBe('RATE_LIMITED');
    const retryAfter = Number(response.headers['retry-after']);
    expect(Number.isFinite(retryAfter) && retryAfter > 0).toBe(true);
  });
});

describe('closed confirmations', () => {
  it('confirms closed PRs into Done and never falsely closes PRs missing from GitHub', async () => {
    setupInitialFixture();
    const ctx = await startSync();
    ctx.harness.seedPullRequest(ctx.repoId, {
      number: 40,
      reviewDecision: 'APPROVED',
      updatedAt: iso('2026-02-07T00:00:00Z'),
    });
    ctx.harness.seedPullRequest(ctx.repoId, {
      number: 41,
      reviewDecision: 'APPROVED',
      updatedAt: iso('2026-02-08T00:00:00Z'),
    });

    swapSyncFixture({
      pullRequests: [],
      closedWindow: [
        fixturePullRequest({ number: 40, state: 'CLOSED', updatedAt: iso('2026-03-01T00:00:00Z') }),
      ],
    });
    const response = await runSync(ctx);
    expect(response.statusCode).toBe(202);
    await waitForTerminalRun(ctx);

    const rows = listPullRequestsByRepo(ctx.harness.db, ctx.repoId);
    expect(rows.find((row) => row.number === 40)?.state).toBe('closed');
    expect(rows.find((row) => row.number === 40)?.lane).toBe('Done');
    expect(rows.find((row) => row.number === 41)?.state).toBe('open');
    expect(rows.find((row) => row.number === 41)?.lane).toBe('Approved');
  });
});
