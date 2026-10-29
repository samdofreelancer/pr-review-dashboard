/**
 * Application path resolution and private directory creation (T014).
 *
 * Layout per data-model.md, all under APP_DATA_DIR:
 *   <root>/data/app.db        SQLite (WAL)
 *   <root>/repos/<repoId>.git bare Git caches
 *   <root>/artifacts/<id>.log redacted diagnostics
 *   <root>/logs/app.log       structured logs
 */
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  readonly dataRoot: string;
  readonly dataDir: string;
  readonly reposDir: string;
  readonly artifactsDir: string;
  readonly logsDir: string;
  readonly databasePath: string;
}

/** `%LOCALAPPDATA%\PRReviewDashboard`, with a portable fallback when unset. */
export function defaultDataRoot(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'PRReviewDashboard');
}

export function resolveAppPaths(dataRootOverride?: string | null): AppPaths {
  const dataRoot = path.resolve(
    dataRootOverride && dataRootOverride.length > 0 ? dataRootOverride : defaultDataRoot(),
  );
  const dataDir = path.join(dataRoot, 'data');
  return {
    dataRoot,
    dataDir,
    reposDir: path.join(dataRoot, 'repos'),
    artifactsDir: path.join(dataRoot, 'artifacts'),
    logsDir: path.join(dataRoot, 'logs'),
    databasePath: path.join(dataDir, 'app.db'),
  };
}

/**
 * Create the private subdirectories recursively. On Windows the `0700` mode
 * honours the user profile ACLs; on POSIX it yields a user-only tree.
 */
export async function ensureAppDirectories(paths: AppPaths): Promise<AppPaths> {
  const privateMode = 0o700;
  await Promise.all([
    mkdir(paths.dataDir, { recursive: true, mode: privateMode }),
    mkdir(paths.reposDir, { recursive: true, mode: privateMode }),
    mkdir(paths.artifactsDir, { recursive: true, mode: privateMode }),
    mkdir(paths.logsDir, { recursive: true, mode: privateMode }),
  ]);
  return paths;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cache directory for one repository's bare clone. Only accepts UUIDs (path-traversal guard). */
export function repoCachePath(paths: AppPaths, repoId: string): string {
  if (!UUID_RE.test(repoId)) {
    throw new Error(`Unsafe repository id: not a UUID`);
  }
  // Restore working dir-correct casing: no path component may escape reposDir.
  return path.join(paths.reposDir, `${repoId.toLowerCase()}.git`);
}

/** Redacted diagnostics file for one artifact id (runs, git errors). UUID-only as well. */
export function artifactPath(paths: AppPaths, artifactId: string): string {
  if (!UUID_RE.test(artifactId)) {
    throw new Error(`Unsafe artifact id: not a UUID`);
  }
  return path.join(paths.artifactsDir, `${artifactId.toLowerCase()}.log`);
}
