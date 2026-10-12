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
/**
 * Has the user ever CHOSEN a backend? Until they do, auto-detection may
 * route a fresh install to a reachable server (the packaged desktop build
 * had no way to know one existed — DB_* lives in the main process and no
 * src/ code could read it, so a configured .env.local server stayed
 * invisible and the app always ran PGlite). One explicit pick — including
 * the "use PGlite" button on the DB-error screen — pins the choice forever,
 * so auto-routing can never override a deliberate decision.
 */
const DB_MODE_EXPLICIT_KEY = 'maghzaccount-db-mode-explicit';

export function getDbMode(): DbMode {
  try {
    const stored = localStorage.getItem(DB_MODE_KEY);
    if (stored === 'pglite' || stored === 'pg') return stored;
  } catch { /* localStorage unavailable */ }
  return 'pglite';
}

/** True once the user picked a backend themselves (auto-routing then stops). */
export function isDbModeExplicit(): boolean {
  try {
    return localStorage.getItem(DB_MODE_EXPLICIT_KEY) === '1';
  } catch {
    /* localStorage unavailable → treat as auto so a server still routes */
    return false;
  }
}

/**
 * Fresh install? Auto-routing must NEVER yank an existing PGlite user onto a
 * server that merely appeared later (a fresh local PostgreSQL, a new tunnel):
 * they would boot into an empty database and reasonably conclude their data
 * was gone — while it sits untouched in IndexedDB. Only a machine that never
 * finished onboarding may be routed automatically; everyone else switches
 * deliberately from Settings → Database (whose vault gate no longer
 * deadlocks that move).
 *
 * Read straight from the persisted zustand envelope instead of importing the
 * store: adapters stay independent of the store layer, and any unreadable or
 * future-shaped value fails closed toward "not fresh" (today's behaviour).
 */
function isFreshInstall(): boolean {
  try {
    const raw = localStorage.getItem('maghzaccount-onboarding');
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { state?: { completed?: unknown } };
    return parsed?.state?.completed !== true;
  } catch {
    return false;
  }
}

export function setDbMode(mode: DbMode): void {
  try {
    localStorage.setItem(DB_MODE_KEY, mode);
  } catch { /* ignore */ }
}

/** Record a deliberate user choice and pin it against auto-detection. */
export function setDbModeExplicit(mode: DbMode): void {
  setDbMode(mode);
  try {
    localStorage.setItem(DB_MODE_EXPLICIT_KEY, '1');
  } catch { /* ignore */ }
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron;
}

function isElectronPg(effectiveMode?: DbMode): boolean {
  // ROUTING predicate, not mere bridge detection: renderer traffic goes
  // through the main-process PG pool only when the bridge exists AND
  // server-PG mode is selected. Mere bridge presence (desktop running the
  // local PGlite database) must NOT divert traffic to a main process that
  // holds no session for this database — that mismatch surfaced as
  // "Authentication required" on saves while reads looked fine.
  // Mirrors auth/api.ts mainAuthBridge: authentication follows the data.
  //
  // `effectiveMode` lets the caller pass the mode it already resolved (the
  // ladder probes for a server before re-reading localStorage); omitting it
  // keeps the original stored-flag behaviour for every other call site.
  if (typeof window === 'undefined' || !(window as { electronDB?: { ping?: unknown } }).electronDB?.ping) return false;
  try {
    const mode = effectiveMode ?? (typeof getDbMode !== 'function' ? null : getDbMode());
    if (mode !== 'pg') return false;
  } catch {
    return false;
  }
  return true;
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

/**
 * Desktop only: ask the main process whether a server database is configured
 * AND reachable. Read-only (no session token — same posture as db:ping) and
 * secret-free: the answer is a boolean plus current_database() and which
 * source configured the pool.
 *
 * Never throws and never blocks the ladder: any doubt answers "no server",
 * which leaves today's PGlite behaviour exactly as it was.
 *
 * Exported for the Settings → Database screen, which shows a "server
 * detected" hint so the user knows the PostgreSQL card will actually work.
 */
export async function probeServerDatabase(): Promise<{ configured: boolean; reachable: boolean; db?: string; source: string }> {
  const none = { configured: false, reachable: false, source: 'none' };
  try {
    if (typeof window === 'undefined') return none;
    const db = (window as { electronDB?: { probeServer?: () => Promise<{ configured: boolean; reachable: boolean; source: string; db?: string }> } }).electronDB;
    if (!db?.probeServer) return none;
    const r = await db.probeServer();
    if (!r || !r.configured) return none;
    // `configured` alone is not enough: createPool() fills localhost
    // defaults, so every desktop looks configured until a query proves
    // otherwise. Only a real connection counts as reachable.
    return { configured: true, reachable: !!r.reachable, source: r.source, db: r.db };
  } catch {
    return none;
  }
}

/**
 * Resolve the backend for this session.
 *
 * The stored default is 'pglite' and NOTHING in src/ could see a server:
 * DB_* is loaded in the main process only, so a perfectly working local or
 * cloud PostgreSQL was structurally invisible and the app always ran PGlite.
 * Probe the main process instead — but only while the user has never chosen
 * a backend by hand.
 *
 * The verdict is PERSISTED (never the "explicit" flag) so every consumer that
 * reads the mode — auth's mainAuthBridge, the AI settings reader, the relay
 * check — agrees with the adapter actually in use. Without that, auth would
 * route to the renderer while the adapter was the main-process pool, and
 * every login came back "Authentication required".
 *
 * Fresh installs only (see isFreshInstall): an existing PGlite user keeps
 * their database even if a server appears later; they move deliberately
 * from Settings → Database.
 *
 * Failure posture differs by source, because the two mean different things:
 *   - vault (the user saved this connection in Settings): they meant it, so
 *     an unreachable server must surface as an honest error rather than
 *     silently moving the company onto a different database.
 *   - env (.env.local, ambient/dev config): not reachable → stay on PGlite,
 *     exactly today's behaviour, so an ambient hint can never brick a
 *     machine whose server happens to be down.
 */
function resolveAutoMode(probe: { configured: boolean; reachable: boolean; db?: string; source: string }): DbMode {
  if (!probe.configured) return 'pglite';
  if (!probe.reachable) return probe.source === 'vault' ? 'pg' : 'pglite';
  console.log(`[DB Adapter] Server database detected (${probe.source}${probe.db ? `: ${probe.db}` : ''}) — using PostgreSQL.`);
  return 'pg';
}

async function acquireDbAdapter(): Promise<DbAdapter> {
  let mode = getDbMode();

  // E2E always uses the HTTP bridge — PGlite would create an empty
  // in-browser database with no seeded data (the e2e Vite config sets
  // VITE_E2E=1).
  const isE2E = (import.meta as { env?: { VITE_E2E?: string } }).env?.VITE_E2E === '1';

  // Auto-routing (desktop): the stored default is 'pglite' and NOTHING in
  // src/ could see a server — DB_* is loaded in the main process only, so a
  // working local/cloud PostgreSQL was structurally invisible and the app
  // always ran PGlite. Ask the main process instead, and prefer the server
  // ONLY while the user has never chosen a backend themselves AND the
  // machine never finished onboarding (fresh installs only — see
  // isFreshInstall).
  if (mode === 'pglite' && !isE2E && !isDbModeExplicit() && isFreshInstall() && typeof window !== 'undefined' && (window as { electronDB?: unknown }).electronDB) {
    const probed = resolveAutoMode(await probeServerDatabase());
    if (probed !== mode) {
      // Persist so auth/AI/relay agree with the live adapter (see
      // resolveAutoMode). setDbMode — NOT setDbModeExplicit: this is still
      // the app's own inference, so removing the server restores PGlite.
      setDbMode(probed);
      mode = probed;
    }
  }

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

  // 2. PostgreSQL via Electron IPC (desktop + server-PG mode; the gate
  //    already verified bridge presence and mode, so a main session exists
  //    for this database by construction — see mainAuthBridge).
  //
  //    `mode` is passed explicitly: after auto-routing the stored flag still
  //    says 'pglite', so re-reading localStorage here would reject the very
  //    server the probe just found.
  if (isElectronPg(mode)) {
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
  //
  //    Mode-gated like step 2, NOT on bridge presence: db:ping needs no
  //    session, so on a desktop install whose PGlite boot failed this branch
  //    used to bind the renderer to a main-process pool it holds no session
  //    for — every save then failed with "Authentication required".
  if (mode === 'pg' && typeof window !== 'undefined' && (window as { electronDB?: { ping?: unknown } }).electronDB?.ping) {
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