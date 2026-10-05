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

/**
 * C1 outer bound on adapter acquisition. Dynamic imports, PGlite
 * migrations and ping() each hang forever on a wedged transport
 * (saturated UI thread / locked IDB) — previously the chat preamble's
 * 30s deadlines detached but the underlying work kept the thread
 * saturated AND every other caller (settings screens, reports) spun with
 * no bound at all. 15s then an honest Arabic error the DbError screen
 * shows verbatim (diagnosable, never a silent spinner).
 */
const ADAPTER_ACQUIRE_TIMEOUT_MS = 15_000;

export async function getDbAdapter(): Promise<DbAdapter> {
  const pending = acquireDbAdapter();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            'انتهت مهلة الاتصال بقاعدة البيانات (15 ثانية) — قد تكون قاعدة PGlite المحلية عالقة (تبويب آخر مفتوح؟) أو الخادم لا يستجيب. أغلق التبويبات الزائدة وحاول مجدداً.',
          ),
        ),
      ADAPTER_ACQUIRE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([pending, timeout]);
  } catch (err) {
    // Abandoned acquisition may reject later with no listener — swallow so
    // the late failure can't surface as an unhandled rejection crash.
    pending.catch(() => {});
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function acquireDbAdapter(): Promise<DbAdapter> {
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

  // Web / mobile browser with a remote database selected.
  //   - Neon-compatible endpoints ride the official HTTP driver directly
  //     (no extra hop).
  //   - Every other provider (Supabase, self-hosted, local, …) rides the
  //     same-origin relay (/api/db) when one answers the health probe —
  //     browsers cannot open TCP sockets, so the relay executes the
  //     parameterized statements server-side under the same SQL contract
  //     as the desktop channel. Without a relay the structured capability
  //     error below maps to guidance in the settings UI — never a mystery.
  if (mode === 'pg' && !isElectron() && !isE2E) {
    const { getActiveRemoteUrl, RemoteCapabilityError } = await import('../connectionVault');
    const { parseDatabaseUrl } = await import('../connection');
    const url = await getActiveRemoteUrl();
    if (!url) {
      throw new RemoteCapabilityError(
        'no-remote-connection',
        'No remote database selected. Add a DATABASE_URL in Settings → Database, or keep using the local database.',
      );
    }
    let provider: string;
    try {
      provider = parseDatabaseUrl(url).provider;
    } catch {
      throw new RemoteCapabilityError(
        'invalid-remote-url',
        'The saved connection URL is invalid. Re-enter it in Settings → Database.',
      );
    }
    if (provider === 'neon') {
      const { resolveActiveWebRemote } = await import('../connectionVault');
      const remote = await resolveActiveWebRemote();
      try {
        const { configureNeonHttp, neonHttpAdapter } = await import('./neonHttpAdapter');
        configureNeonHttp(remote.databaseUrl);
        const ping = await neonHttpAdapter.ping();
        if (ping.success) {
          console.log('[DB Adapter] Neon Postgres via HTTPS (web)');
          adapter = neonHttpAdapter;
          adapterMode = mode;
          lastPingAt = Date.now();
          return adapter;
        }
        throw new Error(ping.message || 'Neon ping failed');
      } catch (err) {
        adapter = null;
        if (err instanceof Error && err.name === 'RemoteCapabilityError') throw err;
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
    const { isRelayAvailable } = await import('../relayClient');
    const relay = await isRelayAvailable();
    if (!relay.up) {
      throw new RemoteCapabilityError(
        'non-neon-on-web',
        'Direct TCP connections (Supabase, self-hosted, local) need the desktop app. On web, remote databases must be Neon (HTTP driver).',
      );
    }
    try {
      const { relayHttpAdapter } = await import('./relayHttpAdapter');
      const ping = await relayHttpAdapter.ping();
      if (ping.success) {
        console.log('[DB Adapter] Postgres via relay HTTPS (web)');
        adapter = relayHttpAdapter;
        adapterMode = mode;
        lastPingAt = Date.now();
        return adapter;
      }
      throw new Error(ping.message || 'Relay ping failed');
    } catch (err) {
      adapter = null;
      if (err instanceof Error && err.name === 'RemoteCapabilityError') throw err;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(
    'قاعدة البيانات غير متوفرة. اختر "PGlite محلي" من الإعدادات، أو تأكد من تشغيل PostgreSQL.'
  );
}

/**
 * Is the active route a web-relay remote (non-Neon provider through a
 * reachable same-origin relay)? Used by the auth layer (relay login) and
 * the settings UI. Never throws — unknown means "not a relay route".
 */
export async function isRelayRouteActive(): Promise<boolean> {
  try {
    if (getDbMode() !== 'pg' || isElectron()) return false;
    if (typeof window !== 'undefined' && (window as { electronDB?: { ping?: unknown } }).electronDB?.ping) return false;
    const { getActiveRemoteUrl } = await import('../connectionVault');
    const { parseDatabaseUrl } = await import('../connection');
    const url = await getActiveRemoteUrl();
    if (!url) return false;
    if (parseDatabaseUrl(url).provider === 'neon') return false;
    const { isRelayAvailable } = await import('../relayClient');
    return (await isRelayAvailable()).up;
  } catch {
    return false;
  }
}

export { isElectron, isElectronPg };
export { getTransportMode, setTransportMode, type PgliteTransportMode } from './transportMode';