/**
 * Contract tests for the User Story 1 API surface (T033).
 *
 * Every status, body shape, and operation ID comes from
 * `contracts/openapi.yaml`; the shared Zod schemas (T012) are the drift
 * guard, so each 2xx body is parsed with them and each error body with
 * `ErrorSchema`. Mutations must carry the CSRF token from GET /api/session.
 *
 * These tests are written first (see tasks.md Notes) and fail while the US1
 * routes (T042/T043/T045) are not implemented; the session and CSRF guard
 * probes pass against the T022 factory.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  BoardSchema,
  ErrorSchema,
  ManualDraftCreateSchema,
  PullRequestDetailSchema,
  RepositorySchema,
  ReviewDraftSchema,
  SessionSchema,
} from '@pr-review-dashboard/shared';
import { createHarness, VIEWER_LOGIN, type TestHarness } from '../fixtures/harness.js';

const LANES_IN_ORDER = ['Draft', 'In review', 'Request changes', 'Approved', 'Done'] as const;

let harness: TestHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

describe('GET /api/session (getSession)', () => {
  it('returns the contract session shape for the resolved credential and viewer', async () => {
    const response = await harness.inject({ method: 'GET', url: '/api/session' });
    expect(response.statusCode).toBe(200);
    const session = SessionSchema.parse(JSON.parse(response.body));
    expect(session.csrfToken.length).toBeGreaterThan(0);
    expect(session.appVersion).toBe(harness.config.appVersion);
    expect(session.credentialSource).toBe('GH_TOKEN');
    expect(session.viewer).toEqual({ login: VIEWER_LOGIN });
    expect(session.limits).toEqual({
      maxInlineFindings: 15,
      maxSummaryChars: 60000,
      maxInlineCommentChars: 10000,
      maxDiffFiles: 400,
      maxDiffLines: 20000,
    });
  });
});

describe('Mutation security guard (CsrfToken securityScheme)', () => {
  it('rejects mutations without the session CSRF token', async () => {
    const response = await harness.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { owner: 'octo-org', name: 'demo-repo' },
    });
    expect(response.statusCode).toBe(403);
    const error = ErrorSchema.parse(JSON.parse(response.body));
    expect(error.code).toBe('PERMISSION_DENIED');
  });
});

describe('GET /api/repos (listRepositories)', () => {
  it('returns connected repositories with the contract shape', async () => {
    harness.connectRepository();
    const response = await harness.inject({ method: 'GET', url: '/api/repos' });
    expect(response.statusCode).toBe(200);
    const body = RepositorySchema.array().parse(JSON.parse(response.body));
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      owner: 'octo-org',
      name: 'demo-repo',
      visibility: 'public',
      defaultBranch: 'main',
      lastSyncStatus: 'never',
      aiAcknowledged: false,
    });
  });
});

describe('POST /api/repos (connectRepository)', () => {
  it('connects a repository by owner/name with CSRF and queues the first sync', async () => {
    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: '/api/repos',
      payload: { owner: 'octo-org', name: 'demo-repo' },
    });
    expect(response.statusCode).toBe(201);
    const repository = RepositorySchema.parse(JSON.parse(response.body));
    expect(repository.owner).toBe('octo-org');
    expect(repository.lastSyncStatus).toBe('never');
    expect(repository.connectedAt.length).toBeGreaterThan(0);
  });

  it('validates the request body with VALIDATION_FAILED', async () => {
    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: '/api/repos',
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    const error = ErrorSchema.parse(JSON.parse(response.body));
    expect(error.code).toBe('VALIDATION_FAILED');
  });
});

describe('DELETE /api/repos/{repoId} (disconnectRepository)', () => {
  it('removes repository data only with an explicit confirm query', async () => {
    const repoId = harness.connectRepository();

    const withoutConfirm = await harness.injectWithCsrf({
      method: 'DELETE',
      url: `/api/repos/${repoId}`,
    });
    expect(withoutConfirm.statusCode).toBe(422);

    const confirmed = await harness.injectWithCsrf({
      method: 'DELETE',
      url: `/api/repos/${repoId}?confirm=true`,
    });
    expect(confirmed.statusCode).toBe(204);

    const again = await harness.injectWithCsrf({
      method: 'DELETE',
      url: `/api/repos/${repoId}?confirm=true`,
    });
    expect(again.statusCode).toBe(404);
    expect(ErrorSchema.parse(JSON.parse(again.body)).code).toBe('NOT_FOUND');
  });
});

describe('GET /api/board (getBoard)', () => {
  it('always returns the five lanes in contract order with visible counts', async () => {
    const repoId = harness.connectRepository();
    harness.seedPullRequest(repoId, { number: 10, isDraft: true });
    harness.seedPullRequest(repoId, { number: 12, reviewDecision: 'REVIEW_REQUIRED' });
    harness.seedPullRequest(repoId, { number: 14, reviewDecision: 'APPROVED' });
    harness.seedPullRequest(repoId, { number: 16, reviewDecision: 'CHANGES_REQUESTED' });
    harness.seedPullRequest(repoId, { number: 18, state: 'merged' });

    const response = await harness.inject({ method: 'GET', url: '/api/board' });
    expect(response.statusCode).toBe(200);
    const board = BoardSchema.parse(JSON.parse(response.body));
    expect(board.offline).toBe(false);
    expect(board.lanes.map((lane) => lane.name)).toEqual([...LANES_IN_ORDER]);
    const byName = new Map(board.lanes.map((lane) => [lane.name, lane]));
    expect(byName.get('Draft')?.count).toBe(1);
    expect(byName.get('In review')?.count).toBe(1);
    expect(byName.get('Approved')?.count).toBe(1);
    expect(byName.get('Request changes')?.count).toBe(1);
    expect(byName.get('Done')?.count).toBe(1);
  });

  it('sorts cards newest-first by updatedAt inside each lane', async () => {
    const repoId = harness.connectRepository();
    harness.seedPullRequest(repoId, { number: 20, reviewDecision: 'APPROVED', updatedAt: '2026-03-01T00:00:00Z' });
    harness.seedPullRequest(repoId, { number: 21, reviewDecision: 'APPROVED', updatedAt: '2026-03-03T00:00:00Z' });
    harness.seedPullRequest(repoId, { number: 22, reviewDecision: 'APPROVED', updatedAt: '2026-03-02T00:00:00Z' });

    const response = await harness.inject({ method: 'GET', url: '/api/board' });
    expect(response.statusCode).toBe(200);
    const board = BoardSchema.parse(JSON.parse(response.body));
    const approved = board.lanes.find((lane) => lane.name === 'Approved');
    expect(approved).toBeDefined();
    expect(approved?.cards.map((c) => c.number)).toEqual([21, 22, 20]);
  });

  it('constrains search (q) to title/author/label/number and supports needsMyReview', async () => {
    const repoId = harness.connectRepository();
    harness.seedPullRequest(repoId, { number: 30, title: 'Add cart page' });
    harness.seedPullRequest(repoId, {
      number: 31,
      title: 'Refactor billing',
      requestedReviewers: [VIEWER_LOGIN],
    });

    const search = await harness.inject({ method: 'GET', url: '/api/board?q=cart' });
    expect(search.statusCode).toBe(200);
    const searchBoard = BoardSchema.parse(JSON.parse(search.body));
    const visible = searchBoard.lanes.flatMap((lane) => lane.cards.map((c) => c.number));
    expect(visible).toEqual([30]);

    const needsReview = await harness.inject({
      method: 'GET',
      url: '/api/board?needsMyReview=true',
    });
    expect(needsReview.statusCode).toBe(200);
    const reviewBoard = BoardSchema.parse(JSON.parse(needsReview.body));
    const needs = reviewBoard.lanes.flatMap((lane) => lane.cards.map((c) => c.number));
    expect(needs).toEqual([31]);
    for (const card of reviewBoard.lanes.flatMap((lane) => lane.cards)) {
      expect(card.needsMyReview).toBe(true);
    }
  });
});

describe('GET /api/prs/{prId} (getPullRequest)', () => {
  it('returns the detail payload matching the contract', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, {
      number: 40,
      title: 'Fix retry window',
      reviewDecision: 'APPROVED',
      headSha: 'a000000000000000000000000000000000000040',
      updatedAt: '2026-04-01T00:00:00Z',
    });

    const response = await harness.inject({ method: 'GET', url: `/api/prs/${prId}` });
    expect(response.statusCode).toBe(200);
    const pr = PullRequestDetailSchema.parse(JSON.parse(response.body));
    expect(pr.id).toBe(prId);
    expect(pr.number).toBe(40);
    expect(pr.title).toBe('Fix retry window');
    expect(pr.repository.owner).toBe('octo-org');
    expect(pr.lane).toBe('Approved');
    expect(pr.headSha).toBe('a000000000000000000000000000000000000040');
    expect(pr.lastSyncedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(pr.diffStatus).toBe('none');
    expect(pr.activeRunId).toBeNull();
    expect(pr.draftId).toBeNull();
  });

  it('answers NOT_FOUND for an unknown pull request', async () => {
    const response = await harness.inject({ method: 'GET', url: '/api/prs/pr-999' });
    expect(response.statusCode).toBe(404);
    expect(ErrorSchema.parse(JSON.parse(response.body)).code).toBe('NOT_FOUND');
  });
});

describe('POST /api/prs/{prId}/mark-ready (markReadyForReview)', () => {
  it('clears the draft flag on GitHub and returns the refreshed detail', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, {
      number: 50,
      isDraft: true,
      headSha: 'a000000000000000000000000000000000000050',
    });

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/mark-ready`,
      payload: { expectedHeadSha: 'a000000000000000000000000000000000000050', confirmed: true },
    });
    expect(response.statusCode).toBe(200);
    const pr = PullRequestDetailSchema.parse(JSON.parse(response.body));
    expect(pr.isDraft).toBe(false);
    expect(pr.headSha).toBe('a000000000000000000000000000000000000050');
  });

  it('conflicts with STALE_HEAD when the head moved', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, { number: 51, isDraft: true, headSha: 'a000000000000000000000000000000000000051' });

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/mark-ready`,
      payload: { expectedHeadSha: '0'.repeat(40), confirmed: true },
    });
    expect(response.statusCode).toBe(409);
    expect(ErrorSchema.parse(JSON.parse(response.body)).code).toBe('STALE_HEAD');
  });

  it('requires the documented request body', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, { number: 52, isDraft: true });
    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/mark-ready`,
      payload: { expectedHeadSha: 'a000000000000000000000000000000000000052' },
    });
    expect(response.statusCode).toBe(422);
    expect(ErrorSchema.parse(JSON.parse(response.body)).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/prs/{prId}/draft (createManualDraft)', () => {
  it('creates a manual draft bound to the verified head with no run', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, {
      number: 60,
      headSha: 'a000000000000000000000000000000000000060',
    });

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/draft`,
      payload: { event: 'approve' },
    });
    expect(response.statusCode).toBe(201);
    const draft = ReviewDraftSchema.parse(JSON.parse(response.body));
    expect(draft.prId).toBe(prId);
    expect(draft.origin).toBe('manual');
    expect(draft.runId).toBeNull();
    expect(draft.event).toBe('approve');
    expect(draft.status).toBe('building');
    expect(draft.targetHeadSha).toBe('a000000000000000000000000000000000000060');
    expect(draft.findings).toEqual([]);
    expect(draft.counts).toEqual({ inline: 0, summaryOnly: 0, demoted: 0, stale: 0 });
    expect(draft.publishability.publishable).toBe(true);
    expect(draft.publishability.reasons).toEqual([]);
  });

  it('keeps the optional summary within the contract limits', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, { number: 61 });
    ManualDraftCreateSchema.parse({ event: 'comment', summary: 'Looks good to me.' });

    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/draft`,
      payload: { event: 'comment', summary: 'Looks good to me.' },
    });
    expect(response.statusCode).toBe(201);
    const draft = ReviewDraftSchema.parse(JSON.parse(response.body));
    expect(draft.event).toBe('comment');
    expect(draft.summary).toBe('Looks good to me.');
  });

  it('rejects unknown events with VALIDATION_FAILED', async () => {
    const repoId = harness.connectRepository();
    const prId = harness.seedPullRequest(repoId, { number: 62 });
    const response = await harness.injectWithCsrf({
      method: 'POST',
      url: `/api/prs/${prId}/draft`,
      payload: { event: 'merge' },
    });
    expect(response.statusCode).toBe(422);
    expect(ErrorSchema.parse(JSON.parse(response.body)).code).toBe('VALIDATION_FAILED');
  });
});
