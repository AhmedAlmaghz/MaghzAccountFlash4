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

/**
 * One-time wake-up budget for a cold/suspended remote. A Neon compute fresh
 * out of scale-to-zero needs a full wake cycle (tens of seconds, more over
 * a slow link) before the first byte flows — the per-statement budget above
 * is too tight for that first touch. Seeding is a once-per-database
 * operation: waiting beats failing.
 */
const WAKE_UP_DELAYS_MS = [5000, 10000, 20000, 30000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithWakeRetry<T extends { success: boolean; error?: string }>(
  fn: () => Promise<T>,
  delays: number[] = WAKE_DELAYS_MS,
): Promise<T> {
  // NOTE (ratchet gates): call sites pass a thunk wrapping the adapter
  // call, so the call text stays at every call site and src/test/*SqlGate
  // counters keep seeing the statements. Funneling the SQL through a
  // differently-named helper signature would hide reachable statements
  // (the laundering direction that hides debt).
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
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
 * Wake the remote before replaying anything. A single cheap SELECT proves
 * the compute is up AND the link is alive; without it the replay below
 * dies inside 0000_init with a bare TimeoutError and onboarding reports
 * "migration failed" for a database that only needed another minute.
 */
export async function wakeRemoteDatabase(
  adapter: Pick<DbAdapter, 'query'>,
  delays: number[] = WAKE_UP_DELAYS_MS,
): Promise<{ success: boolean; error?: string }> {
  try {
    const r = await queryWithWakeRetry(() => adapter.query('SELECT 1'), delays);
    // queryWithWakeRetry RETURNS non-retryable failures (it only throws
    // after an exhausted wake-class budget) — a failed probe is a failed
    // wake-up, never a success.
    if (!r.success) throw new Error(r.error || 'wake-up probe failed');
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
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
  wakeDelays: number[] = WAKE_UP_DELAYS_MS,
): Promise<{ success: boolean; applied: number; error?: string }> {
  try {
    const wake = await wakeRemoteDatabase(adapter, wakeDelays);
    if (!wake.success) {
      if (wake.error && isWakeRetryableError(wake.error)) {
        return {
          success: false,
          applied: 0,
          error: `Remote database did not wake up: ${wake.error} — the server may still be starting; wait a minute and retry`,
        };
      }
      // Non-wake errors keep the old raw-error contract (no file involved).
      return { success: false, applied: 0, error: wake.error };
    }
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
          if (!r.success) {
            // Attach the statement here (not via a loop-external variable):
            // the "failed: <msg>" prefix stays contiguous for the existing
            // contract test, and the preview names the culprit on a
            // 300-statement baseline. Leading `--` banner lines are stripped
            // so the preview starts at the real DDL, not the file header.
            const preview = stmt
              .replace(/^\s*(--[^\n]*\n\s*)+/, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 120);
            throw new Error(`${r.error || 'statement failed'} (statement: ${preview})`);
          }
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
