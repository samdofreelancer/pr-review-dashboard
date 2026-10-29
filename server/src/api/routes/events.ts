/**
 * `GET /api/events` (T023).
 *
 * GET is CSRF-exempt by contract: the stream carries only progress and IDs,
 * never credentials or code. Host/Origin checks still apply through the
 * global security hook.
 */
import type { FastifyInstance } from 'fastify';
import { SECURITY_HEADERS } from '../../security/local.js';
import type { SseHub } from '../sse.js';

export function registerEventRoutes(app: FastifyInstance, hub: SseHub): void {
  app.get('/api/events', (request, reply) => {
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const detach = hub.attach(raw);
    request.raw.once('close', detach);
  });
}
