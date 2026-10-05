/**
 * Relay client — browser side of the generic Postgres-over-HTTPS relay.
 *
 * The relay (same-origin `/api/db` in production, the dev twin in
 * `vite dev`) lets the WEB build reach ANY Postgres provider (Supabase,
 * self-hosted, local, Neon, …). Browsers cannot open TCP sockets, so all
 * traffic rides here; Electron keeps direct TCP and never uses this.
 *
 * Session model mirrors the main-process bridge: the JWT lives in memory +
 * sessionStorage (tab-scoped, dies with the tab) and is presented per call.
 * The database URL itself stays in the connection vault (device storage on
 * web, disclosed in the UI) — it travels per request over TLS, exactly like
 * the Neon HTTP driver sends its credentials per request.
 */

export interface RelayLoginResult {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  permissions?: any[];
  error?: string;
  code?: string;
}

const RELAY_PATH = '/api/db';
const HEALTH_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 45000;
const SESSION_KEY = 'maghzaccount-relay-token';

function relayBaseUrl(): string {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    const configured = env?.VITE_RELAY_URL;
    if (typeof configured === 'string' && configured.trim()) return configured.trim().replace(/\/+$/, '');
  } catch {
    /* non-Vite runtime */
  }
  return '';
}

function relayUrl(path = ''): string {
  return `${relayBaseUrl()}${RELAY_PATH}${path}`;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

let healthCache: { at: number; up: boolean; privateTargetsAllowed: boolean } | null = null;

/** Probe the relay without auth. Cached briefly; failures are cheap. */
export async function isRelayAvailable(): Promise<{ up: boolean; privateTargetsAllowed: boolean }> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) {
    return { up: healthCache.up, privateTargetsAllowed: healthCache.privateTargetsAllowed };
  }
  try {
    const { status, body } = await fetchJson(relayUrl(), { method: 'GET' }, 8000);
    const record = (body ?? {}) as Record<string, unknown>;
    const up = status === 200 && record.ok === true;
    const out = { up, privateTargetsAllowed: record.privateTargetsAllowed === true };
    healthCache = { at: now, ...out };
    return out;
  } catch {
    healthCache = { at: now, up: false, privateTargetsAllowed: false };
    return { up: false, privateTargetsAllowed: false };
  }
}

/** Forget a stale probe (tests + explicit disconnect). */
export function resetRelayHealth(): void {
  healthCache = null;
}

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

let memoryToken: string | null = null;

export function getRelayToken(): string | null {
  // sessionStorage first: it is shared across module instances (and tabs
  // do not share it), memory is the private-mode fallback.
  return readStoredToken() ?? memoryToken;
}

export function setRelayToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode — memory only */
  }
}

export function clearRelayToken(): void {
  setRelayToken(null);
}

/**
 * Company id the current relay JWT was issued for (unsigned read of the
 * payload — the server re-verifies signature + binding on every call).
 * Lets read paths scope themselves to the session company so the relay
 * tenant guard (same contract as the desktop channel) accepts them.
 */
export function getRelayCompanyId(): string | null {
  const token = getRelayToken();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // atob exists in browsers and in Node ≥16 — no Buffer dependency.
    // Base64url often omits padding, which atob rejects — restore it.
    const unpadded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as {
      cid?: unknown;
    };
    return typeof payload.cid === 'string' && payload.cid ? payload.cid : null;
  } catch {
    return null;
  }
}

export async function relayLogin(databaseUrl: string, username: string, password: string): Promise<RelayLoginResult> {
  try {
    const { status, body } = await fetchJson(
      relayUrl(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', databaseUrl, username, password }),
      },
    );
    const record = (body ?? {}) as Record<string, unknown>;
    if (status === 200 && record.success === true && typeof record.token === 'string') {
      setRelayToken(record.token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, user: record.user as any, permissions: (record.permissions ?? []) as any[] };
    }
    clearRelayToken();
    return {
      success: false,
      error: typeof record.error === 'string' ? record.error : 'login failed',
      code: typeof record.code === 'string' ? record.code : undefined,
    };
  } catch (err) {
    clearRelayToken();
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface RelayCallResult {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows?: any[];
  rowCount?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results?: any[];
  truncated?: boolean;
  db?: string;
  version?: string;
  error?: string;
  code?: string;
  errorCode?: string;
}

/** Authenticated relay call (query / transaction / migrate / reset / pingdb). */
export async function relayCall(
  action: 'query' | 'transaction' | 'migrate' | 'reset' | 'pingdb',
  payload: Record<string, unknown>,
): Promise<RelayCallResult> {
  try {
    const token = action === 'pingdb' ? undefined : getRelayToken();
    const { body } = await fetchJson(
      relayUrl(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload, ...(token ? { token } : {}) }),
      },
    );
    const record = (body ?? {}) as Record<string, unknown>;
    if (record.code === 'expired-token') clearRelayToken();
    return {
      success: record.success === true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows: (record.rows ?? undefined) as any[] | undefined,
      rowCount: typeof record.rowCount === 'number' ? record.rowCount : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: (record.results ?? undefined) as any[] | undefined,
      truncated: record.truncated === true ? true : undefined,
      db: typeof record.db === 'string' ? record.db : undefined,
      version: typeof record.version === 'string' ? record.version : undefined,
      error: typeof record.error === 'string' ? record.error : undefined,
      code: typeof record.code === 'string' ? record.code : undefined,
      errorCode: typeof record.errorCode === 'string' ? record.errorCode : undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
