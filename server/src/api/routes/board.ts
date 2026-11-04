/**
 * Board route (T045): `getBoard` — five lanes, always present, with the
 * repository/search/needs-my-review filters from the OpenAPI contract.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Board } from '@pr-review-dashboard/shared';
import { buildBoard } from '../../github/boardService.js';
import { requireDb, type RouteDeps } from './context.js';

const BoardQuerySchema = z
  .object({
    repoId: z.string().min(1).optional(),
    q: z.string().max(200).optional(),
    needsMyReview: z.enum(['true', 'false']).optional(),
  })
  .strict();

export function registerBoardRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/board', (request): Board => {
    const db = requireDb(deps.db);
    const query = BoardQuerySchema.parse(request.query ?? {});
    return buildBoard(
      { db, config: deps.config, viewerLogin: deps.viewerLogin },
      {
        repoId: query.repoId === undefined ? null : query.repoId,
        q: query.q === undefined ? null : query.q,
        needsMyReview: query.needsMyReview === 'true',
      },
    );
  });
}
