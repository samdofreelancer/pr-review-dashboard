import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, type Database } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { insertRepository, createSyncRun } from '../../src/db/repositoryStore.js';
import { upsertPullRequest } from '../../src/db/pullRequestStore.js';
import { createDraft, insertFinding } from '../../src/db/draftStore.js';
import { markInterruptedWork } from '../../src/startup.js';

const tempRoots: string[] = [];

async function preparedDatabase(): Promise<{
  db: Database;
  repoId: string;
  prId: string;
  syncRunId: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prrev-startup-test-'));
  tempRoots.push(root);
  const db = openDatabase(path.join(root, 'app.db'));
  runMigrations(db, fileURLToPath(new URL('../../migrations/', import.meta.url)));

  const now = new Date().toISOString();
  const repoId = insertRepository(db, {
    owner: 'fixture',
    name: 'repo',
    githubRepoId: 42,
    visibility: 'public',
    defaultBranch: 'main',
    isArchived: false,
    capabilities: {},
    connectedAt: now,
  });
  const syncRunId = createSyncRun(db, repoId, 'startup', now);
  const prId = '22222222-2222-4222-8222-222222222222';
  upsertPullRequest(db, {
    id: prId,
    repoId,
    number: 7,
    githubId: 'gid',
    title: 't',
    body: '',
    authorLogin: 'a',
    state: 'open',
    isDraft: false,
    baseRef: 'main',
    headRef: 'f',
    headSha: 'a'.repeat(40),
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    labels: [],
    requestedUsers: [],
    requestedTeams: [],
    reviewDecision: null,
    lane: 'In review',
    checksState: 'none',
    mergeableState: 'mergeable',
    mergedAt: null,
    closedAt: null,
    githubCreatedAt: now,
    githubUpdatedAt: now,
    firstSeenAt: now,
    lastSyncedAt: now,
    lastSeenOpenSyncId: syncRunId,
  });
  return { db, repoId, prId, syncRunId };
}

afterAll(async () => {
  const fs = await import('node:fs/promises');
  for (const root of tempRoots) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

describe('markInterruptedWork', () => {
  it('interrupts queued and running runs and demotes pending posts to uncertain', async () => {
    const { db, repoId, prId } = await preparedDatabase();
    const secondPrId = '22222222-2222-4222-8222-222222222299';
    const nowIso = new Date().toISOString();
    upsertPullRequest(db, {
      id: secondPrId,
      repoId,
      number: 8,
      githubId: 'gid8',
      title: 't8',
      body: '',
      authorLogin: 'a',
      state: 'open',
      isDraft: false,
      baseRef: 'main',
      headRef: 'f',
      headSha: 'b'.repeat(40),
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      labels: [],
      requestedUsers: [],
      requestedTeams: [],
      reviewDecision: null,
      lane: 'In review',
      checksState: 'none',
      mergeableState: 'mergeable',
      mergedAt: null,
      closedAt: null,
      githubCreatedAt: nowIso,
      githubUpdatedAt: nowIso,
      firstSeenAt: nowIso,
      lastSyncedAt: nowIso,
      lastSeenOpenSyncId: null,
    });
    const queuedId = '88888888-8888-4888-8888-888888888881';
    const runningId = '88888888-8888-4888-8888-888888888882';
    db.prepare(
      `INSERT INTO review_runs (id, pr_id, head_sha, provider, model, status, started_at)
       VALUES (?, ?, ?, 'local', 'fixture-model', 'queued', ?)`,
    ).run(queuedId, prId, 'a'.repeat(40), new Date().toISOString());
    db.prepare(
      `INSERT INTO review_runs (id, pr_id, head_sha, provider, model, status, phase, started_at)
       VALUES (?, ?, ?, 'local', 'fixture-model', 'running', 'calling_model', ?)`,
    ).run(runningId, secondPrId, 'b'.repeat(40), new Date().toISOString());

    const draftId = createDraft(db, {
      prId,
      runId: null,
      origin: 'manual',
      summary: '',
      event: 'comment',
      targetHeadSha: 'a'.repeat(40),
    });
    insertFinding(db, {
      runId: null,
      source: 'manual',
      path: 'src/b.ts',
      side: 'RIGHT',
      line: 4,
      severity: 'low',
      category: 'style',
      title: 'naming',
      explanation: 'rename me',
      confidence: 0.4,
      quotedCode: null,
      suggestion: null,
      validationStatus: 'valid',
      resolvedPath: null,
      resolvedSide: null,
      resolvedLine: null,
      dedupeKey: 'src/b.ts/RIGHT/4/man',
    });
    const postId = '77777777-7777-4777-8777-777777777777';
    db.prepare(
      `INSERT INTO review_posts
         (id, draft_id, attempt_no, marker, event, target_head_sha, status, payload_summary_json, started_at)
       VALUES (?, ?, 1, ?, 'comment', ?, 'pending', '{}', ?)`,
    ).run(
      postId,
      draftId,
      `<!-- pr-review-dashboard:draft=${draftId} -->`,
      'a'.repeat(40),
      new Date().toISOString(),
    );

    const markings = markInterruptedWork(db);

    expect(markings).toEqual({ interruptedRuns: 2, uncertainPosts: 1 });
    const queued = db
      .prepare(`SELECT status, interrupted_at, completed_at FROM review_runs WHERE id = ?;`)
      .get(queuedId) as {
      status: string;
      interrupted_at: string;
      completed_at: string;
    };
    const running = db.prepare(`SELECT status FROM review_runs WHERE id = ?;`).get(runningId) as {
      status: string;
    };
    const post = db.prepare(`SELECT status FROM review_posts WHERE id = ?;`).get(postId) as {
      status: string;
    };
    expect(queued.status).toBe('interrupted');
    expect(queued.interrupted_at).not.toBeNull();
    expect(queued.completed_at).not.toBeNull();
    expect(running.status).toBe('interrupted');
    expect(post.status).toBe('uncertain');
    closeDatabase(db);
  });

  it('is idempotent: a second boot changes nothing', async () => {
    const { db } = await preparedDatabase();
    expect(markInterruptedWork(db)).toEqual({ interruptedRuns: 0, uncertainPosts: 0 });
    expect(markInterruptedWork(db)).toEqual({ interruptedRuns: 0, uncertainPosts: 0 });
    closeDatabase(db);
  });
});
