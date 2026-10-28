import Fastify from 'fastify';

import { registerStaticAssets } from './api/static.js';

const port = Number.parseInt(process.env.PORT ?? '4317', 10);
const app = Fastify({ logger: true });

app.get('/api/health', () => ({ status: 'setup' }));
await registerStaticAssets(app);

await app.listen({ host: '127.0.0.1', port });
