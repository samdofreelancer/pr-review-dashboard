/**
 * Pull request routes (T045): `getPullRequest` and `markReadyForReview`.
 * Diff, review-run, and publishing endpoints arrive with US2/US3.
 */
import { z } from 'zod';
import { MarkReadyRequestSchema, type PullRequestDetail } from '@pr-review-dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { buildPullRequestDetail, requirePullRequest } from '../../github/boardService.js';
import { markReadyForReview } from '../../github/actions.js';
import { createActivitySink } from '../../observability/activity.js';
import { requireDb, type RouteDeps } from './context.js';

const PrParamsSchema = z.object({ prId: z.string().min(1) }).strict();

export function registerPullRequestRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/prs/:prId', (request): PullRequestDetail => {
    const db = requireDb(deps.db);
    const row = requirePullRequest(db, PrParamsSchema.parse(request.params).prId);
    return buildPullRequestDetail({ db, config: deps.config, viewerLogin: deps.viewerLogin }, row);
  });

  app.post('/api/prs/:prId/mark-ready', async (request): Promise<PullRequestDetail> => {
    const db = requireDb(deps.db);
    const body = MarkReadyRequestSchema.parse(request.body);
    return markReadyForReview(
      {
        db,
        config: deps.config,
        viewerLogin: deps.viewerLogin,
        events: createActivitySink(db, deps.sse),
      },
      PrParamsSchema.parse(request.params).prId,
      body,
    );
  });
}
