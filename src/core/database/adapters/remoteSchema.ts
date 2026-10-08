import type { DbAdapter } from './types';
import { getBundledMigrations, MIGRATION_TRACKING_TABLE } from './pgliteAdapter';
import { splitMigrationStatements } from '@root/api/_lib/dbCore.js';

/**
 * Whether a failure looks like a cold/waking remote (Neon scale-to-zero,
 * pooler queueing, transient network) rather than a real schema problem.
 * Only these are worth retrying — auth errors, syntax errors and constraint
 * violations must fail fast with their message intact.
 */
export function isWakeRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /timed out|timeout|fetch failed|network|ECONNRESET|ECONNREFUSED|EPIPE|connection terminated|too many clients|remaining connection slots/i.test(msg);
}

const WAKE_DELAYS_MS = [4000, 12000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithWakeRetry<T extends { success: boolean; error?: string }>(
  fn: () => Promise<T>,
): Promise<T> {
  // NOTE (ratchet gates): call sites pass a thunk wrapping the adapter
  // call, so the call text stays at every call site and src/test/*SqlGate
  // counters keep seeing the statements. Funneling the SQL through a
  // differently-named helper signature would hide reachable statements
  // (the laundering direction that hides debt).
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= WAKE_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(WAKE_DELAYS_MS[attempt - 1]);
    try {
      const r = await fn();
      if (r.success) return r;
      lastError = new Error(r.error || 'statement failed');
      if (!isWakeRetryableError(lastError)) return r;
    } catch (err) {
      lastError = err;
      if (!isWakeRetryableError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Ensure the bundled schema on a REMOTE Postgres (Neon HTTP, Electron TCP).
 * Replays the same idempotent migrations PGlite boots locally, tracked in
 * the same table — one schema, every backend.
 *
 * Each statement runs individually because HTTP query endpoints execute a
 * single statement per call. The whole ensure is naturally resumable: a
 * crash mid-migration leaves the file untracked, so the next boot replays
 * it (every file is idempotent by repo convention).
 */
export async function ensureRemoteSchema(
  adapter: Pick<DbAdapter, 'query'>,
  onProgress?: (applied: number, total: number, name: string) => void,
): Promise<{ success: boolean; applied: number; error?: string }> {
  try {
    const track = await queryWithWakeRetry(() =>
      adapter.query(
        `CREATE TABLE IF NOT EXISTS ${MIGRATION_TRACKING_TABLE} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`,
      ),
    );
    if (!track.success) return { success: false, applied: 0, error: track.error };

    const migrations = getBundledMigrations();
    let applied = 0;
    for (const migration of migrations) {
      const existing = await queryWithWakeRetry(() =>
        adapter.query(
          `SELECT 1 FROM ${MIGRATION_TRACKING_TABLE} WHERE name = $1 LIMIT 1`,
          [migration.name],
        ),
      );
      if (!existing.success) return { success: false, applied, error: existing.error };
      if ((existing.rows?.length ?? 0) > 0) continue;
      try {
        for (const stmt of splitMigrationStatements(migration.sql)) {
          const r = await queryWithWakeRetry(() => adapter.query(stmt));
          if (!r.success) throw new Error(r.error || 'statement failed');
        }
      } catch (err) {
        // Name the file — a bare PG error never tells WHICH migration broke.
        return {
          success: false,
          applied,
          error: `Remote migration ${migration.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const mark = await queryWithWakeRetry(() =>
        adapter.query(`INSERT INTO ${MIGRATION_TRACKING_TABLE} (name) VALUES ($1)`, [migration.name]),
      );
      if (!mark.success) return { success: false, applied, error: mark.error };
      applied++;
      onProgress?.(applied, migrations.length, migration.name);
    }
    return { success: true, applied };
  } catch (err) {
    return { success: false, applied: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
