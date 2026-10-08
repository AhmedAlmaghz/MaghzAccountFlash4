/**
 * Shared database core — THE single source of truth for connection-string
 * handling, pool configuration and migration-text normalization.
 *
 * RUNTIME NEUTRALITY is the whole point of this file: pure string/object
 * logic, zero imports (no node:crypto, no pg, no DOM). That is what lets
 * every runtime consume it directly instead of maintaining a mirror:
 *   - Electron main (`electron/dbHandler.js`, `electron/migrationRunner.js`)
 *   - Vercel/dev relay (`api/_lib/relayHandler.js`)
 *   - Browser renderer (`src/core/database/connection.ts`, thin wrapper)
 *   - PGlite adapter (`pgliteAdapter.ts`, migration text only)
 *   - Seed scripts (`electron/seedDemoData.js` uses dbPasswords.js instead,
 *     which needs node:crypto and therefore lives separately)
 *
 * Password hashing intentionally lives in `dbPasswords.js`, NOT here:
 * it needs node:crypto, which would poison browser imports of this module.
 *
 * PARITY: `electron/dbIpcParity.test.js` asserts every consumer imports
 * from here (no local `function parseDbUrl|normalizeIdempotent|…`
 * definitions) plus a behavior battery on the functions below.
 */

const DEFAULT_PG_PORT = 5432;

function trimInvisible(v) {
  return String(v || '').replace(/^[\uFEFF\s]+|[\s\r]+$/g, '');
}

/**
 * Detect the hosting provider from a hostname. Order matters: check the
 * managed vendors before the localhost/generic fallbacks.
 */
function detectProvider(host) {
  const h = String(host || '').trim().toLowerCase();
  if (/(^|\.)neon\.tech$/.test(h)) return 'neon';
  if (/(^|\.)supabase\.(co|in|net)$/.test(h) || h.endsWith('.supabase.co')) return 'supabase';
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'localhost';
  return 'generic';
}

/**
 * Parse a postgres connection string into parts. Accepts `postgres://` and
 * `postgresql://`, URL-encoded credentials, and an optional `?sslmode=`
 * query parameter. Throws a plain Error with a human message on invalid
 * input (callers surface `err.message` directly).
 *
 * SSL follows libpq semantics: `disable`/`allow` mean plain TCP;
 * `require`/`verify-ca`/`verify-full` mean TLS; otherwise TLS everywhere
 * except localhost. `verify-*` additionally pins the chain
 * (`strictVerify`), exactly like `psql` with the same URL.
 */
function parseDbUrl(raw) {
  const s = trimInvisible(raw);
  if (!s) throw new Error('DATABASE_URL is empty');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'postgres' && scheme !== 'postgresql') {
    throw new Error('URL must start with postgres:// or postgresql://');
  }
  if (!u.hostname) throw new Error('URL is missing a host');
  const port = u.port ? Number(u.port) : DEFAULT_PG_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('URL has an invalid port');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('URL is missing a database name');
  const user = decodeURIComponent(u.username || '');
  if (!user) throw new Error('URL is missing a user');
  const password = u.password ? decodeURIComponent(u.password) : '';
  const sslMode = (u.searchParams.get('sslmode') || '').toLowerCase();
  const isLocal = detectProvider(u.hostname) === 'localhost';
  let ssl;
  if (sslMode === 'disable' || sslMode === 'allow') ssl = false;
  else if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') ssl = true;
  else ssl = !isLocal;
  const strictVerify = sslMode === 'verify-ca' || sslMode === 'verify-full';
  return { raw: s, host: u.hostname, port, database, user, password, ssl, strictVerify, provider: detectProvider(u.hostname) };
}

/**
 * libpq-compatible pool configuration from a parsed URL. Accepts either a
 * legacy timeout number (second positional arg, as the main process always
 * passed) or an options bag. `statement_timeout` is opt-in (the relay sets
 * it; the desktop pool leaves server-side statement timing alone).
 */
function poolConfigFromParsed(p, timeoutMsOrOpts = 30000) {
  const opts = typeof timeoutMsOrOpts === 'number' ? { timeoutMs: timeoutMsOrOpts } : (timeoutMsOrOpts || {});
  const connectionTimeoutMillis = Number(opts.timeoutMs) || 15000;
  const max = Number(opts.max) || 20;
  const cfg = {
    host: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,
    ssl: p.ssl ? (p.strictVerify ? { rejectUnauthorized: true } : { require: true, rejectUnauthorized: false }) : undefined,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis,
  };
  if (opts.statementTimeoutMs) cfg.statement_timeout = Number(opts.statementTimeoutMs);
  return cfg;
}

/** Mask the password for display and logs. Never the secret. */
function redactDatabaseUrl(url) {
  try {
    const u = new URL(trimInvisible(url));
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '****';
  }
}

/**
 * Normalize a migration into an idempotent one so replaying over an
 * existing database never crashes on pre-existing tables/constraints:
 *   - CREATE TABLE / INDEX / UNIQUE INDEX → add IF NOT EXISTS
 *   - ALTER TABLE ... ADD CONSTRAINT <name> → wrapped in a DO $$ guard
 *     keyed on the constraint name (matches both drizzle-kit forms, with
 *     and without ONLY; indented lines inside existing DO blocks are left
 *     alone because the pattern anchors at line start).
 */
function normalizeIdempotent(rawSql) {
  let sql = String(rawSql || '');
  sql = sql.replace(/\bCREATE TABLE (?!IF NOT EXISTS)/g, 'CREATE TABLE IF NOT EXISTS ');
  sql = sql.replace(/\bCREATE UNIQUE INDEX (?!IF NOT EXISTS)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  sql = sql.replace(/\bCREATE INDEX (?!IF NOT EXISTS)/g, 'CREATE INDEX IF NOT EXISTS ');
  const constraintRe = /^ALTER TABLE (?:ONLY )?("[^"]+"|[\w.]+)\s+ADD CONSTRAINT\s+("[^"]+"|[\w.]+)([^;]*);/gm;
  const guarded = [];
  let last = 0;
  let m;
  while ((m = constraintRe.exec(sql)) !== null) {
    const conname = m[2].replace(/"/g, '');
    guarded.push(sql.slice(last, m.index));
    guarded.push(
      `DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${conname}') THEN\n    ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[2]}${m[3]};\n  END IF;\nEND $$;`,
    );
    last = m.index + m[0].length;
  }
  guarded.push(sql.slice(last));
  return guarded.join('\n');
}

/**
 * Split a migration file on the drizzle breakpoint marker. DO-blocks stay
 * intact — they contain no breakpoint markers by repo convention.
 */
function splitMigrationStatements(sql) {
  return String(sql || '')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

export {
  DEFAULT_PG_PORT,
  trimInvisible,
  detectProvider,
  parseDbUrl,
  poolConfigFromParsed,
  redactDatabaseUrl,
  normalizeIdempotent,
  splitMigrationStatements,
};
