/**
 * Session bootstrap and readiness routes (T022).
 *
 * `/api/session` hands the SPA its CSRF token, AI disclosure, and the shared
 * limit constants. `/api/health` reports Git availability, database
 * reachability, and online state without leaking paths or credentials.
 */
import {
  HealthSchema,
  LIMITS,
  SessionSchema,
  type DatabaseStatus,
  type Health,
  type Session,
  type SessionViewer,
} from '@pr-review-dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import type { LocalSecurity } from '../security/local.js';

const execFileAsync = promisify(execFile);

const GIT_CACHE_MS = 5_000;
const GIT_TIMEOUT_MS = 2_000;

export interface GitProbe {
  readonly available: boolean;
  readonly version: string | null;
}

async function probeGitVersion(): Promise<GitProbe> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    const match = /git version (\S+)/.exec(stdout);
    const version = match?.[1] ?? stdout.trim();
    return { available: true, version: version.length > 0 ? version : null };
  } catch {
    return { available: false, version: null };
  }
}

export interface HealthProbeOverrides {
  readonly git?: () => Promise<GitProbe>;
  readonly database?: () => DatabaseStatus;
  readonly online?: () => boolean;
}

export interface HealthProbeOptions {
  readonly db?: Database | null;
  readonly overrides?: HealthProbeOverrides;
}

export interface HealthProbe {
  report(): Promise<Health>;
}

/**
 * Git and database probes with a short Git cache: readiness may be polled by
 * the SPA, and spawning `git --version` on every poll is wasteful.
 */
export function createHealthProbe(options: HealthProbeOptions = {}): HealthProbe {
  const db = options.db ?? null;
  const overrides = options.overrides;
  let cachedGit: { readonly at: number; readonly value: GitProbe } | null = null;
  let inflightGit: Promise<GitProbe> | null = null;

  async function git(): Promise<GitProbe> {
    if (overrides?.git !== undefined) return overrides.git();
    if (cachedGit !== null && Date.now() - cachedGit.at < GIT_CACHE_MS) return cachedGit.value;
    if (inflightGit !== null) return inflightGit;
    inflightGit = probeGitVersion()
      .then((value) => {
        cachedGit = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflightGit = null;
      });
    return inflightGit;
  }

  function database(): DatabaseStatus {
    if (overrides?.database !== undefined) return overrides.database();
    if (db === null) return 'migrating';
    try {
      db.prepare('SELECT 1 AS ok;').get();
      return 'ok';
    } catch {
      return 'error';
    }
  }

  return {
    async report(): Promise<Health> {
      const gitProbe = await git();
      const databaseStatus = database();
      const online = overrides?.online?.() ?? true;
      const status = gitProbe.available && databaseStatus === 'ok' && online ? 'ready' : 'degraded';
      return HealthSchema.parse({
        status,
        git: { available: gitProbe.available, version: gitProbe.version },
        database: databaseStatus,
        online,
      });
    },
  };
}

export function buildSession(
  config: AppConfig,
  csrfToken: string,
  viewer: SessionViewer | null = null,
): Session {
  const { ai } = config;
  return SessionSchema.parse({
    csrfToken,
    appVersion: config.appVersion,
    credentialSource: config.credential.source,
    viewer,
    ai: {
      configured: ai.baseUrl !== null && ai.model !== null,
      destinationKnown: ai.destinationKnown,
      destinationLabel: ai.destinationLabel,
      model: ai.model ?? '',
      mayLeaveMachine: ai.mayLeaveMachine,
    },
    limits: {
      maxInlineFindings: LIMITS.maxInlineFindings,
      maxSummaryChars: LIMITS.maxSummaryChars,
      maxInlineCommentChars: LIMITS.maxInlineCommentChars,
      maxDiffFiles: LIMITS.maxDiffFiles,
      maxDiffLines: LIMITS.maxDiffLines,
    },
  });
}

export interface SessionRouteOptions {
  readonly config: AppConfig;
  readonly security: LocalSecurity;
  readonly healthProbe: HealthProbe;
  /** Resolved after T025 validates the credential; null until then. */
  readonly viewer?: SessionViewer | null;
}

export function registerSessionRoutes(app: FastifyInstance, options: SessionRouteOptions): void {
  app.get('/api/session', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.send(
      buildSession(options.config, options.security.csrfToken, options.viewer ?? null),
    );
  });

  app.get('/api/health', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const health = await options.healthProbe.report();
    return reply.send(health);
  });
}
