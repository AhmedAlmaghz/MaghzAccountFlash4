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
let lastPingAt = 0;
/**
 * Health-check TTL: pinging on EVERY acquisition doubled chat DB traffic
 * (each entity searcher re-acquires → ~38 PGlite round-trips per message on
 * a transport that runs on the UI thread). A recently-verified adapter is
 * trusted; failures anywhere below still reset it.
 */
const PING_TTL_MS = 30_000;

export async function getDbAdapter(): Promise<DbAdapter> {
  const mode = getDbMode();

  // E2E always uses the HTTP bridge — PGlite would create an empty
  // in-browser database with no seeded data (the e2e Vite config sets
  // VITE_E2E=1).
  const isE2E = (import.meta as { env?: { VITE_E2E?: string } }).env?.VITE_E2E === '1';

  // Reuse existing working adapter if mode hasn't changed
  if (adapter && adapterMode === mode) {
    const now = Date.now();
    if (now - lastPingAt < PING_TTL_MS) return adapter;
    try {
      const ping = await adapter.ping();
      if (ping.success) {
        lastPingAt = now;
        return adapter;
      }
    } catch { /* stale */ }
    adapter = null;
  }

  // 1. PGlite (PostgreSQL WASM) — local, no server required
  if (mode === 'pglite' && !isE2E) {
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
        lastPingAt = Date.now();
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
        lastPingAt = Date.now();
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
        lastPingAt = Date.now();
        return adapter;
      }
    } catch (_err) {
      // fall through
    }
  }

  // Web (Vercel) has no Electron IPC and no HTTP bridge in production.
  // Detecting this specific state gives a much clearer message than the
  // generic one below — previously it said "تأكد من تشغيل Electron" even
  // on vercel.app, which confused users who were correctly using PGlite.
  if (mode === 'pg' && !isElectron() && !isE2E) {
    throw new Error(
      'وضع خادم PostgreSQL متاح فقط في تطبيق سطح المكتب (Electron). على الاستضافة السحابية (Vercel) اختر "PGlite محلي" — يعمل مباشرة في المتصفح بدون خادم.'
    );
  }

  throw new Error(
    'قاعدة البيانات غير متوفرة. اختر "PGlite محلي" من الإعدادات، أو تأكد من تشغيل PostgreSQL.'
  );
}

export { isElectron, isElectronPg };