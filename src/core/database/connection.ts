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

// Single-source parsing lives in api/_lib/dbCore.js (runtime-neutral plain
// JS shared with the Electron main process and the relay). This module keeps
// the typed public surface and the UI-level helpers; every behavior below
// delegates so the three URL parsers can never drift again.
import {
  detectProvider as detectProviderCore,
  parseDbUrl,
  redactDatabaseUrl as redactDatabaseUrlCore,
} from '@root/api/_lib/dbCore.js';

function trimInvisible(v: string): string {
  return v.replace(/^[\uFEFF\s]+|[\s\r]+$/g, '');
}

/**
 * Detect the hosting provider from a hostname. Order matters: check the
 * managed vendors before the localhost/generic fallbacks.
 */
export function detectProvider(host: string): ConnectionProvider {
  return detectProviderCore(host) as ConnectionProvider;
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
  const parsed = parseDbUrl(url);
  return {
    raw: parsed.raw,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    user: parsed.user,
    password: parsed.password,
    ssl: parsed.ssl,
    provider: parsed.provider as ConnectionProvider,
  };
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
  return redactDatabaseUrlCore(url);
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
