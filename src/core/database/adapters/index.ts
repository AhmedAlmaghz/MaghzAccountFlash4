import type { DbAdapter } from './types';

/**
 * Database Adapter Factory
 * Supports two database backends selected by the user in Settings:
 *
 *   1. "pglite"  — PGlite (PostgreSQL WASM) — local, no-install, persists in IndexedDB
 *   2. "pg"      — PostgreSQL server (via Electron IPC in desktop, or HTTP bridge in web)
 *
 * The user's choice is stored in localStorage under `maghzaccount-db-mode`.
 * No application code changes are needed — every module calls getDbAdapter()
 * and receives the correct adapter automatically.
 */

export type DbMode = 'pglite' | 'pg';

const DB_MODE_KEY = 'maghzaccount-db-mode';

export function getDbMode(): DbMode {
  try {
    const stored = localStorage.getItem(DB_MODE_KEY);
    if (stored === 'pglite' || stored === 'pg') return stored;
  } catch { /* localStorage unavailable */ }
  return 'pglite';
}

export function setDbMode(mode: DbMode): void {
  try {
    localStorage.setItem(DB_MODE_KEY, mode);
  } catch { /* ignore */ }
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron;
}

function isElectronPg(): boolean {
  return typeof window !== 'undefined' && !!(window as { electronDB?: { ping?: unknown } }).electronDB?.ping;
}

let adapter: DbAdapter | null = null;
let adapterMode: DbMode | null = null;

export async function getDbAdapter(): Promise<DbAdapter> {
  const mode = getDbMode();

  // Reuse existing working adapter if mode hasn't changed
  if (adapter && adapterMode === mode) {
    try {
      const ping = await adapter.ping();
      if (ping.success) return adapter;
    } catch { /* stale */ }
    adapter = null;
  }

  // 1. PGlite (PostgreSQL WASM) — local, no server required
  if (mode === 'pglite') {
    try {
      const { pgliteAdapter, runPgliteMigrations } = await import('./pgliteAdapter');
      const migrationResult = await runPgliteMigrations();
      if (!migrationResult.success) {
        throw new Error(`PGlite migration failed: ${migrationResult.error}`);
      }
      const ping = await pgliteAdapter.ping();
      if (ping.success) {
        console.log('[DB Adapter] PGlite (PostgreSQL WASM) — local');
        adapter = pgliteAdapter;
        adapterMode = mode;
        return adapter;
      }
    } catch (err) {
      console.warn('[DB Adapter] PGlite unavailable, falling back to PostgreSQL:', err instanceof Error ? err.message : err);
    }
  }

  // 2. PostgreSQL via Electron IPC (desktop production)
  if (isElectronPg()) {
    try {
      const { electronPgAdapter } = await import('./electronPgAdapter');
      const ping = await electronPgAdapter.ping();
      if (ping.success) {
        console.log('[DB Adapter] PostgreSQL via Electron IPC');
        adapter = electronPgAdapter;
        adapterMode = mode;
        return adapter;
      }
    } catch (_err) {
      // PG unavailable — fall through
    }
  }

  // 3. PostgreSQL via HTTP bridge (web mode with a backend API)
  //    The e2e bridge (vite-e2e-plugin) implements this same interface.
  if (typeof window !== 'undefined' && (window as { electronDB?: { ping?: unknown } }).electronDB?.ping) {
    try {
      const { electronPgAdapter } = await import('./electronPgAdapter');
      const ping = await electronPgAdapter.ping();
      if (ping.success) {
        console.log('[DB Adapter] PostgreSQL via Web bridge');
        adapter = electronPgAdapter;
        adapterMode = mode;
        return adapter;
      }
    } catch (_err) {
      // fall through
    }
  }

  throw new Error(
    'قاعدة البيانات غير متوفرة. اختر "PGlite محلي" من الإعدادات، أو تأكد من تشغيل PostgreSQL.'
  );
}

export { isElectron, isElectronPg };