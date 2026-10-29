/**
 * Fastify application factory (T022).
 *
 * Keeps transport wiring out of startup (T028): the factory builds a
 * loopback-secured instance with `/api/health`, `/api/session`, and
 * `/api/events`, then optionally serves the built SPA. Tests can inject a
 * database, CSRF token, SSE hub, and health probes.
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { SessionViewer } from '@pr-review-dashboard/shared';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import {
  createLocalSecurity,
  registerLocalSecurity,
  type LocalSecurity,
} from '../security/local.js';
import { registerErrorHandling } from './errors.js';
import { registerEventRoutes } from './routes/events.js';
import { createHealthProbe, registerSessionRoutes, type HealthProbeOverrides } from './session.js';
import { createSseHub, type SseHub } from './sse.js';
import { registerStaticAssets } from './static.js';

export interface BuildAppOptions {
  readonly config: AppConfig;
  /** Null or omitted before migrations run; health reports `migrating` then. */
  readonly db?: Database | null;
  readonly security?: LocalSecurity;
  readonly sse?: SseHub;
  readonly health?: HealthProbeOverrides;
  readonly viewer?: SessionViewer | null;
  readonly serveStatic?: boolean;
  readonly logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: false,
  });

  const security = options.security ?? createLocalSecurity();
  const sse =
    options.sse ??
    createSseHub({
      appVersion: options.config.appVersion,
    });
  const healthProbe = createHealthProbe({
    db: options.db ?? null,
    ...(options.health !== undefined ? { overrides: options.health } : {}),
  });

  registerLocalSecurity(app, security);
  registerErrorHandling(app);
  registerSessionRoutes(app, {
    config: options.config,
    security,
    healthProbe,
    viewer: options.viewer ?? null,
  });
  registerEventRoutes(app, sse);

  app.addHook('onClose', (_instance, done) => {
    sse.close();
    done();
  });

  if (options.serveStatic === true) {
    await registerStaticAssets(app);
  }

  return app;
}
