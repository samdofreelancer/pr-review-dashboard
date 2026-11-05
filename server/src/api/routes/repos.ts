/**
 * Repository routes (T045): listRepositories, connectRepository,
 * disconnectRepository, startSync, and the AI acknowledgement surface
 * (FR-008/025) exactly as operation IDs in `contracts/openapi.yaml`.
 *
 * Bodies are Zod-validated at the boundary (contract drift guard); every
 * 2xx payload is parsed with the shared schema before being sent, and a
 * running sync is returned as-is (duplicate submissions are idempotent —
 * FR-056).
 */
import { z } from 'zod';
import {
  AiAcknowledgementSchema,
  ConnectRepositoryRequestSchema,
  SyncRunSchema,
  type ErrorCode,
  type Repository,
  type SyncRun,
} from '@pr-review-dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import type { Database } from '../../db/connection.js';
import {
  createSyncRun,
  getActiveAcknowledgement,
  getRunningSyncRun,
  getSyncRun,
  recordAcknowledgement,
  revokeAcknowledgement,
} from '../../db/repositoryStore.js';
import { requireRepository } from '../../github/boardService.js';
import { resolveGitHubClient } from '../../github/auth.js';
import {
  connectRepository,
  disconnectRepository,
  listConnectedRepositories,
  type RepositoryDeps,
} from '../../github/repositoryService.js';
import { runRepositorySync } from '../../github/sync.js';
import { createActivitySink, type ActivitySink } from '../../observability/activity.js';
import { requireDb, type RouteDeps } from './context.js';

const RepoParamsSchema = z.object({ repoId: z.string().min(1) }).strict();
const DisconnectQuerySchema = z.object({ confirm: z.literal('true') }).strict();

/** One sink per request scope; the hub itself is process-wide. */
function activityEvents(deps: RouteDeps, db: Database): ActivitySink {
  return createActivitySink(db, deps.sse);
}

/** Build the sync-run wire payload from its row (drift-guarded). */
export function toSyncRunPayload(db: Database, runId: string): SyncRun {
  const row = getSyncRun(db, runId);
  if (row === null) {
    throw new AppError('NOT_FOUND', 'Sync run not found.');
  }
  const payload: Record<string, unknown> = {
    id: row.id,
    repoId: row.repoId,
    status: row.status,
    startedAt: row.startedAt,
    openSeen: row.openSeen,
    closedSeen: row.closedSeen,
  };
  if (row.finishedAt !== null) payload.finishedAt = row.finishedAt;
  if (row.rateLimitResetAt !== null) payload.rateLimitResetAt = row.rateLimitResetAt;
  if (row.errorCode !== null) {
    payload.error = {
      code: row.errorCode as ErrorCode,
      message: row.errorMessage ?? 'Sync failed',
    };
  }
  return SyncRunSchema.parse(payload);
}

function repositoryRouteDeps(deps: RouteDeps): RepositoryDeps {
  const db = requireDb(deps.db);
  const events = activityEvents(deps, db);
  return {
    db,
    config: deps.config,
    viewerLogin: deps.viewerLogin ?? '',
    events,
    startSyncJob(repoId, runId) {
      deps.queue.enqueueSync(repoId, async () => {
        await runRepositorySync(
          { db, config: deps.config, viewerLogin: deps.viewerLogin ?? '', events },
          { repoId, runId },
        );
      });
    },
    stopSyncJob(repoId) {
      deps.queue.findActive('sync', repoId)?.cancel();
    },
  };
}

export function registerRepositoryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/repos', (): Repository[] => {
    const db = requireDb(deps.db);
    return listConnectedRepositories({ db, config: deps.config });
  });

  app.post('/api/repos', async (request, reply) => {
    const body = ConnectRepositoryRequestSchema.parse(request.body);
    const outcome = await connectRepository(repositoryRouteDeps(deps), body);
    void reply.code(201);
    return outcome.repository;
  });

  app.delete('/api/repos/:repoId', async (request, reply) => {
    const { repoId } = RepoParamsSchema.parse(request.params);
    DisconnectQuerySchema.parse(request.query);
    await disconnectRepository(repositoryRouteDeps(deps), repoId);
    void reply.code(204);
    return undefined;
  });

  app.post('/api/repos/:repoId/sync', async (request, reply) => {
    const db = requireDb(deps.db);
    const repo = requireRepository(db, RepoParamsSchema.parse(request.params).repoId);

    // Cheap, uncounted probe so exhausted credentials fail fast with the
    // documented Retry-After window instead of a doomed run (FR-056, SC-005).
    const { client } = await resolveGitHubClient(deps.config.credential);
    const rateLimit = await client.getRateLimitStatus();
    if (rateLimit.remaining <= 0) {
      throw new AppError(
        'RATE_LIMITED',
        'GitHub rate limit is exhausted; sync when the window resets.',
        {
          ...(rateLimit.resetAt !== null ? { retryAfter: rateLimit.resetAt.toISOString() } : {}),
        },
      );
    }

    const running = getRunningSyncRun(db, repo.id);
    if (running !== null) {
      // Idempotent repeat while a sync is queued or running (FR-056).
      void reply.code(202);
      return toSyncRunPayload(db, running.id);
    }

    const runId = createSyncRun(db, repo.id, 'manual', new Date().toISOString());
    const payload = toSyncRunPayload(db, runId);
    repositoryRouteDeps(deps).startSyncJob(repo.id, runId);
    void reply.code(202);
    return payload;
  });

  app.get('/api/repos/:repoId/ai-ack', (request) => {
    const db = requireDb(deps.db);
    const repo = requireRepository(db, RepoParamsSchema.parse(request.params).repoId);
    const acknowledgement = getActiveAcknowledgement(db, repo.id, deps.config.ai.destinationLabel);
    return AiAcknowledgementSchema.parse(acknowledgement);
  });

  app.put('/api/repos/:repoId/ai-ack', async (request, reply) => {
    const db = requireDb(deps.db);
    const repo = requireRepository(db, RepoParamsSchema.parse(request.params).repoId);
    if (!deps.config.ai.destinationKnown || deps.config.ai.destinationLabel === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The AI processing destination is not configured; there is nothing to acknowledge yet.',
      );
    }
    const acknowledgedAt = new Date().toISOString();
    recordAcknowledgement(db, repo.id, deps.config.ai.destinationLabel, acknowledgedAt);
    const acknowledgement = getActiveAcknowledgement(db, repo.id, deps.config.ai.destinationLabel);
    void reply.code(200);
    return AiAcknowledgementSchema.parse(acknowledgement);
  });

  app.delete('/api/repos/:repoId/ai-ack', async (request, reply) => {
    const db = requireDb(deps.db);
    const repo = requireRepository(db, RepoParamsSchema.parse(request.params).repoId);
    revokeAcknowledgement(db, repo.id, new Date().toISOString());
    void reply.code(204);
    return undefined;
  });
}
