import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';

const webDist = fileURLToPath(new URL('../../../web/dist/', import.meta.url));

export async function registerStaticAssets(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
  });

  app.get('/*', async (request, reply) => {
    // Unknown API paths must stay JSON 404s instead of the SPA shell.
    if (request.url === '/api' || request.url.startsWith('/api/')) {
      return reply.callNotFound();
    }
    return reply.sendFile('index.html');
  });
}
