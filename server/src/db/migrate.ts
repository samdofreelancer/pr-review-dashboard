/**
 * Forward-only migration runner (T017).
 *
 * Applies files named `NNNN_description.sql` from `server/migrations/` in
 * lexicographic filename order (the version prefix is the order). Each file
 * plus its bookkeeping row are applied inside one transaction; any failure
 * aborts with `MigrationError` so startup (T028) refuses to run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { withTransaction, type Database } from './connection.js';

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly version: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationResult {
  /** Versions newly applied in this call. */
  readonly applied: readonly string[];
  /** Versions already recorded before this call. */
  readonly skipped: readonly string[];
}

interface MigrationFile {
  readonly version: string;
  readonly fileName: string;
  readonly sql: string;
}

const MIGRATION_FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

function ensureBookkeeping(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
}

function appliedVersions(db: Database): Set<string> {
  const rows = db.prepare('SELECT version FROM schema_migrations;').all() as Array<{
    version: string;
  }>;
  return new Set(rows.map((row) => row.version));
}

/** List migrations sorted by version prefix; invalid names abort. */
function listMigrations(migrationsDir: string): MigrationFile[] {
  const names = readdirSync(migrationsDir).filter((name) => MIGRATION_FILE_RE.test(name));
  const malformed = readdirSync(migrationsDir).filter(
    (name) => name.endsWith('.sql') && !MIGRATION_FILE_RE.test(name),
  );
  if (malformed.length > 0) {
    throw new MigrationError(
      `Migration directory contains files outside the NNNN_description.sql convention: ${malformed.join(', ')}`,
      '0000',
    );
  }
  names.sort((a, b) => a.localeCompare(b));
  return names.map((fileName) => ({
    version: fileName.match(MIGRATION_FILE_RE)?.[1] ?? fileName,
    fileName,
    sql: readFileSync(`${migrationsDir}/${fileName}`, 'utf8'),
  }));
}

/**
 * Bring the database schema up to date. Returns what was applied and what
 * was already recorded; never rewinds and never rewrites applied files.
 */
export function runMigrations(db: Database, migrationsDir: string): MigrationResult {
  ensureBookkeeping(db);
  const known = appliedVersions(db);
  const migrations = listMigrations(migrationsDir);

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const migration of migrations) {
    if (known.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }
    try {
      withTransaction(db, () => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);').run(
          migration.version,
          new Date().toISOString(),
        );
      });
      applied.push(migration.version);
    } catch (error) {
      throw new MigrationError(
        `Migration ${migration.version} (${migration.fileName}) failed: ${error instanceof Error ? error.message : String(error)}`,
        migration.version,
      );
    }
  }
  return { applied, skipped };
}
