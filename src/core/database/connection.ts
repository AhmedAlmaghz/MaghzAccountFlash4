/**
 * Unified database-connection model (Phase: universal DATABASE_URL).
 *
 * One connection string works everywhere the platform allows:
 *   - Electron desktop → direct TCP via `pg` (any provider: local,
 *     Supabase, Neon, GCP Cloud SQL, self-hosted).
 *   - Web / mobile browser → HTTP driver (`@neondatabase/serverless`)
 *     for Neon-compatible endpoints (browsers cannot open raw TCP
 *     sockets). PGlite stays the zero-config default everywhere.
 *
 * This module is pure (no DOM, no Electron, no network) so it is unit
 * testable and reusable in main, renderer, and tests alike.
 */

export type ConnectionProvider = 'neon' | 'supabase' | 'localhost' | 'generic';

/** Which driver serves a postgres connection on a given platform. */
export type PostgresDriver = 'direct' | 'http';

export interface ParsedConnection {
  /** Original string as pasted by the user (never logged). */
  raw: string;
  host: string;
  port: number;
  database: string;
  user: string;
  /** Decoded password (may be empty). Keep in memory only. */
  password: string;
  /** Effective SSL: true unless explicitly disabled. */
  ssl: boolean;
  provider: ConnectionProvider;
}

export interface SavedConnectionMeta {
  id: string;
  name: string;
  provider: ConnectionProvider;
  /** Redacted host for display, e.g. "db.xxx.supabase.co". */
  host: string;
  database: string;
  user: string;
  driver: PostgresDriver;
  createdAt: string;
}

const DEFAULT_PG_PORT = 5432;

function trimInvisible(v: string): string {
  return v.replace(/^[\uFEFF\s]+|[\s\r]+$/g, '');
}

/**
 * Detect the hosting provider from a hostname. Order matters: check the
 * managed vendors before the localhost/generic fallbacks.
 */
export function detectProvider(host: string): ConnectionProvider {
  const h = host.trim().toLowerCase();
  if (/(^|\.)neon\.tech$/.test(h)) return 'neon';
  if (/(^|\.)supabase\.(co|in|net)$/.test(h) || h.endsWith('.supabase.co')) return 'supabase';
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'localhost';
  return 'generic';
}

/**
 * Parse a postgres connection string into parts. Accepts
 * `postgres://` and `postgresql://`, URL-encoded credentials, and an
 * optional `?sslmode=` query parameter.
 *
 * Throws a plain Error with a human message on invalid input (the UI
 * surfaces `err.message` directly, so keep it localizable-neutral and
 * let the caller map it to an i18n key).
 */
export function parseDatabaseUrl(url: string): ParsedConnection {
  const raw = trimInvisible(url || '');
  if (!raw) throw new Error('DATABASE_URL is empty');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'postgres' && scheme !== 'postgresql') {
    throw new Error('URL must start with postgres:// or postgresql://');
  }
  const host = u.hostname;
  if (!host) throw new Error('URL is missing a host');
  const port = u.port ? Number(u.port) : DEFAULT_PG_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('URL has an invalid port');
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('URL is missing a database name');
  const user = decodeURIComponent(u.username || '');
  if (!user) throw new Error('URL is missing a user');
  const password = u.password ? decodeURIComponent(u.password) : '';
  const sslMode = (u.searchParams.get('sslmode') || '').toLowerCase();
  // Local hosts default to plain TCP; everything else defaults to TLS
  // (Neon/Supabase/GCP all terminate TLS — best practice, verified certs).
  const isLocal = detectProvider(host) === 'localhost';
  const ssl = sslMode === 'disable' || sslMode === 'allow' ? false : true;
  const effectiveSsl = sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full' ? true : isLocal ? false : ssl;
  return { raw, host, port, database, user, password, ssl: effectiveSsl, provider: detectProvider(host) };
}

/** Validate without throwing — for form UX. */
export function validateDatabaseUrl(url: string): { ok: boolean; error?: string; parsed?: ParsedConnection } {
  try {
    return { ok: true, parsed: parseDatabaseUrl(url) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid URL' };
  }
}

/**
 * Mask the password for display and logs. Keeps user/host/database so a
 * connection stays recognizable: `postgres://user:****@host:5432/db`.
 */
export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(trimInvisible(url));
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '****';
  }
}

/** Rebuild a URL from parts (used by the advanced host/port form). */
export function buildDatabaseUrl(parts: {
  host: string;
  port?: number | string;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
}): string {
  const host = trimInvisible(parts.host);
  const database = trimInvisible(parts.database);
  const user = trimInvisible(parts.user);
  if (!host || !database || !user) throw new Error('host, database and user are required');
  const port = Number(parts.port) || DEFAULT_PG_PORT;
  const auth = `${encodeURIComponent(user)}${parts.password ? `:${encodeURIComponent(parts.password)}` : ''}`;
  const sslSuffix = parts.ssl === false ? '?sslmode=disable' : '';
  return `postgres://${auth}@${host}:${port}/${encodeURIComponent(database)}${sslSuffix}`;
}

/**
 * Capability matrix: which driver can serve a provider on a platform.
 * Browsers (web/mobile) cannot open raw TCP sockets — a platform wall, not
 * an app limit — so only Neon-compatible HTTP endpoints are routable there
 * (via @neondatabase/serverless). PGlite (local) works everywhere and is the
 * zero-config default. On desktop (Electron) every provider works via direct
 * TCP, plus PGlite local. Returns null when the combination is unsupported
 * (caller shows t('settings.database.webTcpDesc') guidance).
 */
export function resolveDriver(
  provider: ConnectionProvider,
  platform: 'electron' | 'web',
): PostgresDriver | null {
  if (platform === 'electron') return 'direct';
  return provider === 'neon' ? 'http' : null;
}

/** Short human tag for the provider badge in connection lists. */
export function providerLabel(provider: ConnectionProvider): string {
  switch (provider) {
    case 'neon':
      return 'Neon';
    case 'supabase':
      return 'Supabase';
    case 'localhost':
      return 'Local';
    default:
      return 'PostgreSQL';
  }
}
