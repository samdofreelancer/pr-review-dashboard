/**
 * SQLite connection management (T016).
 *
 * Node's built-in `node:sqlite` (research R-DB-1). Every connection enables
 * WAL, enforced foreign keys, and a 5-second busy timeout, and callers use
 * the transaction helper for all multi-statement work.
 */
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export const BUSY_TIMEOUT_MS = 5_000;

/** Open (or create) a database with the required pragmas applied. */
export function openDatabase(dbPath: string): Database {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA foreign_keys = ON;`);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  return db;
}

/** Read back the pragmas once at startup so misconfiguration fails loudly. */
export function connectionReport(db: Database): {
  journalMode: string;
  foreignKeysOn: boolean;
  busyTimeoutMs: number;
} {
  const journalMode = db.prepare('PRAGMA journal_mode;').get() as
    { journal_mode: string } | undefined;
  const foreignKeys = db.prepare('PRAGMA foreign_keys;').get() as
    { foreign_keys: number } | undefined;
  const busyTimeout = db.prepare('PRAGMA busy_timeout;').get() as { timeout: number } | undefined;
  return {
    journalMode: journalMode?.journal_mode ?? 'unknown',
    foreignKeysOn: (foreignKeys?.foreign_keys ?? 0) === 1,
    busyTimeoutMs: Number(busyTimeout?.timeout ?? -1),
  };
}

/** Close cleanly; WAL checkpoint happens naturally on the last close. */
export function closeDatabase(db: Database): void {
  db.close();
}

/**
 * Run `fn` inside `BEGIN IMMEDIATE … COMMIT`, rolling back on any throw.
 * Immediate grabs the write lock up front, matching the short synchronous
 * transactions this app performs.
 */
export function withTransaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // A rollback failure means the transaction already ended; the original
      // error is the problem worth surfacing.
    }
    throw error;
  }
}
