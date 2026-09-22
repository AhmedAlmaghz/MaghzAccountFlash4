import type { DbAdapter } from './types';
import { getBundledMigrations, splitMigrationStatements, MIGRATION_TRACKING_TABLE } from './pgliteAdapter';

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
    const track = await adapter.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATION_TRACKING_TABLE} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`,
    );
    if (!track.success) return { success: false, applied: 0, error: track.error };

    const migrations = getBundledMigrations();
    let applied = 0;
    for (const migration of migrations) {
      const existing = await adapter.query(
        `SELECT 1 FROM ${MIGRATION_TRACKING_TABLE} WHERE name = $1 LIMIT 1`,
        [migration.name],
      );
      if (!existing.success) return { success: false, applied, error: existing.error };
      if ((existing.rows?.length ?? 0) > 0) continue;
      try {
        for (const stmt of splitMigrationStatements(migration.sql)) {
          const r = await adapter.query(stmt);
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
      const mark = await adapter.query(`INSERT INTO ${MIGRATION_TRACKING_TABLE} (name) VALUES ($1)`, [migration.name]);
      if (!mark.success) return { success: false, applied, error: mark.error };
      applied++;
      onProgress?.(applied, migrations.length, migration.name);
    }
    return { success: true, applied };
  } catch (err) {
    return { success: false, applied: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
