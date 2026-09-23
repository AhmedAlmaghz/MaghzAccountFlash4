import {
  parseDatabaseUrl,
  redactDatabaseUrl,
  type ConnectionProvider,
  type PostgresDriver,
  type SavedConnectionMeta,
} from './connection';

/**
 * Connection vault — where remote DATABASE_URLs live.
 *
 * Best practice is platform-dependent:
 *   - Electron: secrets are encrypted with `safeStorage` and stored in a
 *     vault file inside userData. The renderer only ever sees metadata
 *     (id/name/host) — the password never crosses the IPC bridge except
 *     when the user pastes it (save) or the user explicitly tests it.
 *     The main-process pool reads the URL directly from the vault.
 *   - Web / mobile browser: no OS keychain exists, so the URL is kept in
 *     device localStorage. This is disclosed in the UI: anyone with the
 *     device can read it. Prefer device-level encryption / a private
 *     device for production secrets.
 *
 * This module never imports adapters (adapters import the vault) — the
 * dependency edge is one-directional.
 */

export type VaultConnectionMeta = SavedConnectionMeta;

interface ElectronConnectionsBridge {
  list?: () => Promise<{ success: boolean; connections?: VaultConnectionMeta[]; error?: string }>;
  save?: (payload: { name: string; databaseUrl: string; id?: string }) => Promise<{ success: boolean; connection?: VaultConnectionMeta; error?: string }>;
  remove?: (payload: { id: string }) => Promise<{ success: boolean; error?: string }>;
  setActive?: (payload: { id: string | null }) => Promise<{ success: boolean; error?: string }>;
  test?: (payload: { databaseUrl: string }) => Promise<{ success: boolean; db?: string; version?: string; error?: string }>;
}

function isElectronEnv(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron
  );
}

function bridge(): ElectronConnectionsBridge | null {
  if (!isElectronEnv()) return null;
  const b = (window as { electronDB?: { connections?: ElectronConnectionsBridge } }).electronDB?.connections;
  return b ?? null;
}

const WEB_KEY = 'maghzaccount-connections';
const WEB_ACTIVE_KEY = 'maghzaccount-active-connection';

export function getStoredActiveRemoteId(): string | null {
  try {
    return localStorage.getItem(WEB_ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setStoredActiveRemoteId(id: string | null): void {
  try {
    if (id) localStorage.setItem(WEB_ACTIVE_KEY, id);
    else localStorage.removeItem(WEB_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

interface WebVaultShape {
  connections: Array<VaultConnectionMeta & { databaseUrl: string }>;
}

function readWebVault(): WebVaultShape {
  try {
    const raw = localStorage.getItem(WEB_KEY);
    if (!raw) return { connections: [] };
    const parsed = JSON.parse(raw) as WebVaultShape;
    if (!Array.isArray(parsed.connections)) return { connections: [] };
    return parsed;
  } catch {
    return { connections: [] };
  }
}

function writeWebVault(v: WebVaultShape): void {
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(v));
  } catch {
    /* ignore (private mode quota etc.) */
  }
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `conn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Metadata-only list (never includes secrets). */
export async function listRemoteConnections(): Promise<VaultConnectionMeta[]> {
  const b = bridge();
  if (b?.list) {
    const r = await b.list();
    if (r.success && Array.isArray(r.connections)) return r.connections;
    return [];
  }
  return readWebVault().connections.map(({ databaseUrl: _secret, ...meta }) => meta);
}

export interface SaveConnectionInput {
  id?: string;
  name: string;
  databaseUrl: string;
}

/**
 * Validate + persist a remote connection. Returns metadata (no secret).
 * Throws on invalid URL so forms can surface `err.message`.
 */
export async function saveRemoteConnection(
  input: SaveConnectionInput,
): Promise<{ success: boolean; connection?: VaultConnectionMeta; error?: string }> {
  const name = (input.name || '').trim() || 'PostgreSQL';
  const parsed = parseDatabaseUrl(input.databaseUrl); // throws on invalid
  // Platform wall: browsers cannot open TCP — only Neon works on web.
  // Save would succeed but activation would always fail with "desktop-only".
  // Fail fast with honest guidance instead of a silent dead connection.
  if (!isElectronEnv() && parsed.provider !== 'neon') {
    return {
      success: false,
      error: 'webTcpUnsupported',
    };
  }
  const b = bridge();
  if (b?.save) {
    return b.save({ name, databaseUrl: parsed.raw, id: input.id });
  }
  // Web fallback: device storage (disclosed in UI).
  const vault = readWebVault();
  const now = new Date().toISOString();
  const driver: PostgresDriver = 'http';
  const existing = input.id ? vault.connections.findIndex((c) => c.id === input.id) : -1;
  if (existing >= 0) {
    const prev = vault.connections[existing];
    vault.connections[existing] = {
      ...prev,
      name,
      provider: parsed.provider,
      host: parsed.host,
      database: parsed.database,
      user: parsed.user,
      driver,
      databaseUrl: parsed.raw,
    };
  } else {
    vault.connections.push({
      id: makeId(),
      name,
      provider: parsed.provider,
      host: parsed.host,
      database: parsed.database,
      user: parsed.user,
      driver,
      createdAt: now,
      databaseUrl: parsed.raw,
    });
  }
  writeWebVault(vault);
  const saved = vault.connections[existing >= 0 ? existing : vault.connections.length - 1];
  const { databaseUrl: _secret, ...meta } = saved;
  return { success: true, connection: meta };
}

export async function deleteRemoteConnection(id: string): Promise<{ success: boolean; error?: string }> {
  const b = bridge();
  if (b?.remove) return b.remove({ id });
  const vault = readWebVault();
  vault.connections = vault.connections.filter((c) => c.id !== id);
  writeWebVault(vault);
  if (getStoredActiveRemoteId() === id) setStoredActiveRemoteId(null);
  return { success: true };
}

/** The secret URL for the active web connection (null on Electron — main holds it). */
export async function getActiveRemoteUrl(): Promise<string | null> {
  if (bridge()) return null;
  const activeId = getStoredActiveRemoteId();
  if (!activeId) return null;
  return readWebVault().connections.find((c) => c.id === activeId)?.databaseUrl ?? null;
}

export type RemoteCapabilityCode = 'no-remote-connection' | 'non-neon-on-web' | 'invalid-remote-url';

/** Structured capability failure — the UI maps `code` to guidance copy. */
export class RemoteCapabilityError extends Error {
  code: RemoteCapabilityCode;
  constructor(code: RemoteCapabilityCode, message: string) {
    super(message);
    this.name = 'RemoteCapabilityError';
    this.code = code;
  }
}

/**
 * Resolve the active remote connection for a TCP-less platform (web /
 * mobile browser). Only Neon-compatible endpoints are routable there —
 * browsers cannot open raw TCP sockets, so Supabase/self-hosted/local
 * URLs need the desktop app (direct TCP). Throws RemoteCapabilityError
 * with a stable code; never a transport-level mystery.
 */
export async function resolveActiveWebRemote(): Promise<{ driver: 'http'; databaseUrl: string }> {
  const url = await getActiveRemoteUrl();
  if (!url) {
    throw new RemoteCapabilityError(
      'no-remote-connection',
      'No remote database selected. Add a Neon DATABASE_URL in Settings → Database, or keep using the local database.',
    );
  }
  let provider;
  try {
    provider = parseDatabaseUrl(url).provider;
  } catch {
    throw new RemoteCapabilityError('invalid-remote-url', 'The saved connection URL is invalid. Re-enter it in Settings → Database.');
  }
  if (provider !== 'neon') {
    throw new RemoteCapabilityError(
      'non-neon-on-web',
      'Direct TCP connections (Supabase, self-hosted, local) need the desktop app. On web, remote databases must be Neon (HTTP driver).',
    );
  }
  return { driver: 'http', databaseUrl: url };
}

/** Find a saved connection's metadata by id (either platform). */
export async function findRemoteConnection(id: string): Promise<VaultConnectionMeta | null> {
  const all = await listRemoteConnections();
  return all.find((c) => c.id === id) ?? null;
}

/** Test a URL without saving. Electron tests via main TCP; web tests Neon HTTP. */
export async function testRemoteConnection(
  databaseUrl: string,
): Promise<{ success: boolean; db?: string; version?: string; error?: string }> {
  const parsed = parseDatabaseUrl(databaseUrl); // throws on invalid
  const b = bridge();
  if (b?.test) return b.test({ databaseUrl: parsed.raw });
  // Web: only Neon-compatible endpoints are routable (no TCP in browsers).
  if (parsed.provider !== 'neon') {
    return {
      success: false,
      error: 'webTcpUnsupported',
    };
  }
  try {
    const { configureNeonHttp, neonHttpAdapter } = await import('./adapters/neonHttpAdapter');
    configureNeonHttp(parsed.raw);
    const ping = await neonHttpAdapter.ping();
    if (!ping.success) return { success: false, error: ping.message };
    return { success: true, db: ping.db };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Redacted one-liner for logs and confirmations (never the secret). */
export function describeConnection(input: {
  provider: ConnectionProvider;
  host: string;
  database: string;
  user: string;
}): string {
  return `${input.provider} · ${input.user}@${input.host}/${input.database}`;
}

export { redactDatabaseUrl };
