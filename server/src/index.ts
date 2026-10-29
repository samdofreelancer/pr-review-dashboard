import { buildApp } from './api/app.js';
import { loadConfig, type AppConfig } from './config/index.js';
import { redactString } from './observability/logger.js';

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactString(message));
    process.exitCode = 1;
    return;
  }

  const app = await buildApp({
    config,
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    serveStatic: true,
  });

  const address = await app.listen({ host: '127.0.0.1', port: config.port });
  app.log.info({ address }, 'PR Review Dashboard listening on loopback');
}

await main();
