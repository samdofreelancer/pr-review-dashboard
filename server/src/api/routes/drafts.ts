/**
 * Draft routes (T045): `createManualDraft` — verifies the head against
 * GitHub, then creates a draft with `origin=manual`, a null run id, and the
 * stable draft marker (FR-070/081). AI flows extend this file in US3.
 */
import { z } from 'zod';
import { ManualDraftCreateSchema, type ReviewDraft } from '@pr-review-dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { createManualDraft } from '../../github/actions.js';
import { createActivitySink } from '../../observability/activity.js';
import { requireDb, type RouteDeps } from './context.js';

const PrParamsSchema = z.object({ prId: z.string().min(1) }).strict();

export function registerDraftRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/prs/:prId/draft', async (request, reply): Promise<ReviewDraft> => {
    const db = requireDb(deps.db);
    const body = ManualDraftCreateSchema.parse(request.body);
    const draft = await createManualDraft(
      {
        db,
        config: deps.config,
        viewerLogin: deps.viewerLogin,
        events: createActivitySink(db, deps.sse),
      },
      PrParamsSchema.parse(request.params).prId,
      body,
    );
    void reply.code(201);
    return draft;
  });
}
