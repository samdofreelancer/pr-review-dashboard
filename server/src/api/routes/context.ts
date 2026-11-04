/**
 * Shared route context (T045): feature modules receive the app's live
 * collaborators; all transport-facing helpers (error mapping, DB liveness)
 * live with the API layer.
 */
import type { FastifyInstance } from 'fastify';
import type { JobQueue } from '../../jobs/queue.js';
import type { Database } from '../../db/connection.js';
import type { AppConfig } from '../../config/index.js';
import type { SseHub } from '../sse.js';
import { AppError } from '../errors.js';

export interface RouteDeps {
  readonly config: AppConfig;
  /** Null while migrations have not run; affected routes go 503 OFFLINE. */
  readonly db: Database | null;
  readonly queue: JobQueue;
  readonly sse: SseHub;
  /** Session viewer login for needs-my-review; null when signed out. */
  readonly viewerLogin: string | null;
}

/** Unwrap the optional database; routes are read-mostly but never migrate. */
export function requireDb(db: Database | null): Database {
  if (db === null) {
    throw new AppError('OFFLINE', 'The local database is not ready; reload after startup.');
  }
  return db;
}

export type RouteRegistrar = (app: FastifyInstance, deps: RouteDeps) => void;
