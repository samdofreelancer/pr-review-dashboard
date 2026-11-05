/**
 * Integration tests for app-recorded activity and SSE fan-out (T046).
 *
 * The flows drive the HTTP surface through the same harness as the sync
 * tests, with a recording SseHub override so the exact frames reaching an
 * attached browser can be asserted against `contracts/events.md`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SyncRunSchema } from '@pr-review-dashboard/shared';
import {
  createMarkReadyFixtureServer,
  createSyncFixtureServer,
  createSyncRuntimeHandlers,
  type SyncFixtureRepository,
} from '../fixtures/github-sync.js';
import { createHarness, type TestHarness } from '../fixtures/harness.js';
import { SseHub, type SseName } from '../../src/api/sse.js';
import { getLatestSyncRun } from '../../src/db/repositoryStore.js';
import {
  listActivityForPullRequest,
  listActivityForRepository,
} from '../../src/db/activityStore.js';

const iso = (value: string) => new Date(value).toISOString();

const REPO_BASE: SyncFixtureRepository = {
  owner: 'octo-org',
  name: 'demo-repo',
  databaseId: 42,
  visibility: 'PUBLIC',
  pullRequests: [],
};

interface RecordedFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** Hub spy: records every frame instead of writing to (nonexistent) clients. */
class RecordingSseHub extends SseHub {
  readonly frames: RecordedFrame[] = [];

  broadcast(event: SseName, data: Record<string, unknown>): void {
    this.frames.push({ event, data });
  }
}

const github = createSyncFixtureServer(REPO_BASE);

function openPrFixture(): SyncFixtureRepository {
  return {
    ...REPO_BASE,
    pullRequests: [
      {
        number: 1,
        title: 'Fixture PR #1',
        isDraft: false,
        state: 'OPEN',
        githubId: 'github-1',
        authorLogin: 'octo-author',
        createdAt: iso('2026-02-01T00:00:00Z'),
        updatedAt: iso('2026-02-20T00:00:00Z'),
        reviewDecision: null,
        mergeable: 'MERGEABLE',
      },
    ],
  };
}

function waitForTerminalRun(harness: TestHarness, repoId: string) {
  return expect
    .poll(
      () => getLatestSyncRun(harness.db, repoId)?.status,
      { timeout: 10_000, interval: 25 },
    )
    .not.toBe('running');
}

describe('sync activity + SSE fan-out (T046)', () => {
  let hub: RecordingSseHub;
  let harness: TestHarness | null = null;

  beforeAll(() => {
    github.start();
  });

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  afterAll(() => {
    github.close();
  });

  it('a successful sync emits started/progress/completed frames, board.updated, and banks a sync_completed row', async () => {
    hub = new RecordingSseHub({ appVersion: 'test', heartbeatMs: 60_000 });
    harness = await createHarness({ sse: hub });
    const fixture = openPrFixture();
    github.server.resetHandlers();
    github.server.use(...createSyncRuntimeHandlers(fixture));

    const repoId = harness.connectRepository({
      owner: fixture.owner,
      name: fixture.name,
      githubRepoId: fixture.databaseId,
    });

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/repos/${repoId}/sync`,
    });
    expect(response.statusCode).toBe(202);
    const { id: runId } = SyncRunSchema.parse(JSON.parse(response.body));
    await waitForTerminalRun(harness, repoId);
    expect(getLatestSyncRun(harness.db, repoId)?.status).toBe('succeeded');

    const events = hub.frames.map((frame) => frame.event);
    expect(events[0]).toBe('sync.started');
    expect(hub.frames.filter((frame) => frame.event === 'sync.started')).toHaveLength(1);

    const started = hub.frames.find((frame) => frame.event === 'sync.started');
    expect(started?.data).toMatchObject({
      repoId,
      syncRunId: runId,
      startedAt: expect.any(String),
    });

    const listProgress = hub.frames.find(
      (frame) => frame.event === 'sync.progress' && frame.data.phase === 'pull_requests',
    );
    expect(listProgress?.data).toMatchObject({ repoId, syncRunId: runId, fetched: 1, total: 1 });

    const checksProgress = hub.frames.find(
      (frame) => frame.event === 'sync.progress' && frame.data.phase === 'checks',
    );
    expect(checksProgress?.data).toMatchObject({ phase: 'checks', fetched: 1, total: 1 });

    const completed = hub.frames.find((frame) => frame.event === 'sync.completed');
    expect(completed?.data).toMatchObject({
      repoId,
      syncRunId: runId,
      status: 'succeeded',
      openSeen: 1,
      closedSeen: 0,
      error: null,
    });
    // Fractions of the events contract: repo.updated and board.updated follow.
    const repoUpdated = hub.frames.find((frame) => frame.event === 'repo.updated');
    expect(repoUpdated?.data).toMatchObject({ repoId, lastSyncStatus: 'succeeded' });
    const boardUpdated = hub.frames.find((frame) => frame.event === 'board.updated');
    expect(boardUpdated?.data).toMatchObject({ reason: 'sync_completed', repoId, prId: null });

    const activity = listActivityForRepository(harness.db, repoId);
    expect(activity).toHaveLength(1);
    expect(activity[0]?.type).toBe('sync_completed');
    expect(activity[0]?.data).toMatchObject({ status: 'succeeded', openSeen: 1 });
    expect(JSON.stringify(activity[0]?.data)).not.toContain('token');
  });
});

describe('connect/disconnect activity + SSE (T046)', () => {
  let hub: RecordingSseHub;
  let harness: TestHarness | null = null;

  beforeAll(() => {
    github.start();
  });

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  afterAll(() => {
    github.close();
  });

  it('the connect route records repo_connected, streams board.updated, and disconnect streams repo_disconnected', async () => {
    hub = new RecordingSseHub({ appVersion: 'test', heartbeatMs: 60_000 });
    harness = await createHarness({ sse: hub });
    github.server.resetHandlers();
    github.server.use(
      ...createSyncRuntimeHandlers({ ...REPO_BASE, pullRequests: [] }),
    );

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: '/api/repos',
      payload: { owner: REPO_BASE.owner, name: REPO_BASE.name },
    });
    expect(response.statusCode).toBe(201);
    const repoId = (JSON.parse(response.body) as { id: string }).id;

    // The connect handler runs synchronously before the queued initial sync,
    // so the first board frame is the connection event itself.
    const firstBoardFrame = hub.frames.find((frame) => frame.event === 'board.updated');
    expect(firstBoardFrame?.data).toMatchObject({
      reason: 'repo_connected',
      repoId,
      prId: null,
    });

    const connected = listActivityForRepository(harness.db, repoId);
    expect(connected.some((row) => row.type === 'repo_connected')).toBe(true);

    // Let the queued initial sync settle before hitting disconnect guards.
    await waitForTerminalRun(harness, repoId);

    const disconnect = await harness.injectWithCsrf({
      method: 'DELETE',
      url: `/api/repos/${repoId}?confirm=true`,
    });
    expect(disconnect.statusCode).toBe(204);

    const lastBoardFrame = [...hub.frames]
      .reverse()
      .find((frame) => frame.event === 'board.updated');
    expect(lastBoardFrame?.data).toMatchObject({
      reason: 'repo_disconnected',
      repoId,
      prId: null,
    });
  });
});

describe('mark-ready activity + SSE (T046)', () => {
  const headSha = (spec: { number: number }) => `a${String(spec.number).padStart(39, '0')}`;
  const MARK_READY_FIXTURE = createMarkReadyFixtureServer({
    pullRequests: [
      {
        owner: REPO_BASE.owner,
        name: REPO_BASE.name,
        number: 55,
        headSha: headSha({ number: 55 }),
        isDraft: true,
      },
    ],
  });
  let hub: RecordingSseHub;
  let harness: TestHarness | null = null;

  beforeEach(() => {
    MARK_READY_FIXTURE.start();
  });

  afterEach(async () => {
    await harness?.close();
    harness = null;
    MARK_READY_FIXTURE.close();
  });

  it('markReadyForReview streams board.updated with prId and banks a mark_ready row', async () => {
    hub = new RecordingSseHub({ appVersion: 'test', heartbeatMs: 60_000 });
    harness = await createHarness({ sse: hub });
    const repoId = harness.connectRepository({
      owner: REPO_BASE.owner,
      name: REPO_BASE.name,
      githubRepoId: REPO_BASE.databaseId,
    });
    const prId = harness.seedPullRequest(repoId, {
      number: 55,
      isDraft: true,
      headSha: headSha({ number: 55 }),
    });

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/mark-ready`,
      payload: { expectedHeadSha: headSha({ number: 55 }), confirmed: true },
    });
    expect(response.statusCode).toBe(200);

    const boardUpdated = hub.frames.find((frame) => frame.event === 'board.updated');
    expect(boardUpdated?.data).toMatchObject({ reason: 'mark_ready', repoId, prId });

    const perPullRequest = listActivityForPullRequest(harness.db, prId);
    expect(perPullRequest.some((row) => row.type === 'mark_ready')).toBe(true);
    const perRepository = listActivityForRepository(harness.db, repoId);
    expect(perRepository.some((row) => row.type === 'mark_ready')).toBe(true);
  });
});
