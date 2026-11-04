/**
 * Startup and graceful shutdown (T028).
 *
 * Order matters and each step is separately observable through the logger:
 * 1. directories + file logger;
 * 2. Git preflight (absence degrades to read-only board, never aborts —
 *    FR-093 keeps the offline board functional);
 * 3. SQLite open + forward-only migrations (fatal when they fail);
 * 4. interrupted-work marking: queued/running review runs become
 *    `interrupted`, pending posts become `uncertain` — a restart is an
 *    observable event, in-progress results can never be trusted;
 * 5. HTTP boot: loopback bind, session/health/events/static, then job queue;
 * 6. browser launch at the resolved URL (skippable for tests);
 * 7. SIGINT/SIGTERM → cancel jobs, close HTTP, close the database.
 */
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ensureAppDirectories, type AppPaths } from './config/paths.js';
import type { AppConfig } from './config/index.js';
import { openDatabase, closeDatabase, connectionReport, type Database } from './db/connection.js';
import { runMigrations, MigrationError } from './db/migrate.js';
import { buildApp } from './api/app.js';
import { createJobQueue, type JobQueue } from './jobs/queue.js';
import {
  createLogger,
  stderrSink,
  type Logger,
  type LogRecord,
  type LogSink,
} from './observability/logger.js';

const execFileP = promisify(execFile);

export interface GitPreflight {
  readonly available: boolean;
  readonly version: string | null;
}

/** Cheap `git --version` probe; true startup uses this to degrade gracefully. */
export async function preflightGit(): Promise<GitPreflight> {
  try {
    const { stdout } = await execFileP('git', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    });
    const version = stdout.trim().match(/git version ([^\s]+)/)?.[1] ?? null;
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

export interface InterruptedMarkings {
  readonly interruptedRuns: number;
  readonly uncertainPosts: number;
}

/**
 * A restart invalidates everything in flight: runs can no longer reach their
 * provider cleanly and an accepted post may actually have landed on GitHub.
 * Review outcomes arrive through later slices; this marking is the source of
 * truth for the "interrupted run is not publishable" rule (FR-055, T095).
 */
export function markInterruptedWork(db: Database): InterruptedMarkings {
  const now = new Date().toISOString();
  const runs = db
    .prepare(
      `UPDATE review_runs SET status = 'interrupted', interrupted_at = ?, completed_at = ? WHERE status IN ('queued', 'running');`,
    )
    .run(now, now);
  const posts = db
    .prepare(`UPDATE review_posts SET status = 'uncertain' WHERE status = 'pending';`)
    .run();
  return { interruptedRuns: Number(runs.changes), uncertainPosts: Number(posts.changes) };
}

/** JSON-lines sink for `logs/app.log`; the stream flushes per record. */
export function fileSink(logPath: string): LogSink {
  const stream = createWriteStream(logPath, { flags: 'a' });
  return (record: LogRecord) => {
    stream.write(`${JSON.stringify(record)}\n`);
  };
}

function createAppLogger(paths: AppPaths): Logger {
  return createLogger({
    level: 'info',
    sinks: [stderrSink, fileSink(path.join(paths.logsDir, 'app.log'))],
  });
}

/** Open the database, run migrations, and mark interrupted work. */
export function openAndPrepareDatabase(config: AppConfig, logger: Logger): Database {
  const db = openDatabase(config.paths.databasePath);
  try {
    runMigrations(db, fileURLToPath(new URL('../migrations/', import.meta.url)));
  } catch (error) {
    closeDatabase(db);
    if (error instanceof MigrationError) {
      logger.error('Migration failed at boot', { version: error.version ?? null });
      throw error;
    }
    logger.error('Migration failed at boot', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const pragmas = connectionReport(db);
  if (!pragmas.foreignKeysOn || pragmas.journalMode !== 'wal') {
    logger.warn('SQLite pragmas did not settle', { ...pragmas });
  }
  const markings = markInterruptedWork(db);
  logger.info('Database ready', {
    ...pragmas,
    interruptedRuns: markings.interruptedRuns,
    uncertainPosts: markings.uncertainPosts,
  });
  return db;
}

function openBrowser(url: string, logger: Logger): void {
  if (process.env['NO_BROWSER'] === '1') {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    logger.warn('Browser launch failed; open the URL manually', { url });
  }
}

export interface RunningApp {
  readonly app: { close(): Promise<void> };
  readonly db: Database;
  readonly queue: JobQueue;
  readonly url: string;
  readonly port: number;
  /** Stops shutdown signals and closes everything; used by tests. */
  readonly stop: () => Promise<void>;
}

export interface StartupOptions {
  /** Skip browser launch and signal handlers (tests call stop() directly). */
  readonly headless?: boolean;
  /** Override the built-SPA check (tests without a web build). */
  readonly serveStatic?: boolean;
}

export async function startup(
  config: AppConfig,
  options: StartupOptions = {},
): Promise<RunningApp> {
  const paths = await ensureAppDirectories(config.paths);
  const logger = createAppLogger(paths);
  logger.info('Starting PR Review Dashboard', { dataRoot: paths.dataRoot });

  const git = await preflightGit();
  if (git.available) {
    logger.info('Git available', { version: git.version ?? 'unknown' });
  } else {
    logger.warn('Git unavailable — sync and diff will fail until installed', {});
  }

  const db = openAndPrepareDatabase(config, logger);
  const queue = createJobQueue();
  const serveStatic =
    options.serveStatic ??
    existsSync(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url)));
  const app = await buildApp({
    config,
    db,
    serveStatic,
  });

  let port = 0;
  let url = '';
  await app.listen({ host: '127.0.0.1', port: config.port });
  port = (app.server.address() as { port: number }).port;
  url = `http://127.0.0.1:${port}`;
  logger.info('HTTP listening', { host: '127.0.0.1', port, staticAssets: serveStatic });

  if (options.headless !== true) {
    openBrowser(url, logger);
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await queue.shutdown();
    await app.close();
    closeDatabase(db);
    logger.info('Shutdown complete', {});
  };

  if (options.headless !== true) {
    const onSignal = (): void => {
      logger.info('Shutdown requested', { signal: 'SIGINT/SIGTERM' });
      void stop()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          logger.error('Shutdown failed', {
            message: error instanceof Error ? error.message : String(error),
          });
          process.exitCode = 1;
        });
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  return { app, db, queue, url, port, stop };
}
