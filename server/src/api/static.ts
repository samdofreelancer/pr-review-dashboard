import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';

const webDist = fileURLToPath(new URL('../../../web/dist/', import.meta.url));

export async function registerStaticAssets(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
  });

  app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
}
