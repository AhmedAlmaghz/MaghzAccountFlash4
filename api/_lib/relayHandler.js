/**
 * Generic Postgres-over-HTTPS relay — request handler factory.
 *
 * Lets the WEB build talk to ANY Postgres provider (Supabase, self-hosted,
 * local, Neon, …) over HTTPS. The browser cannot open TCP sockets, so a
 * same-origin relay (Vercel `api/db.ts` in production, the dev twin in
 * vite.config.ts) executes parameterized statements server-side.
 *
 * Security posture (mirrors the desktop `_exec` channel, never weaker):
 *  - Stateless JWT sessions: login-gated, rate-limited, 8h absolute TTL,
 *    bound to ONE database hash (api/_lib/relayAuth.js).
 *  - Every client-composed statement passes api/_lib/relayGuard.js
 *    (module/table permissions, tenant scoping, no DDL, no comments,
 *    no sensitive columns) — the same contract as the main process.
 *  - SSRF net guard: every resolved address of a user-supplied host must be
 *    public in production; private targets only with ALLOW_PRIVATE_DB=1
 *    (local development). DNS is resolved per request (rebinding-safe: ALL
 *    answers are classified).
 *  - Parameterized node-pg only (multi-statements impossible), per-query
 *    statement_timeout, row/byte caps, secret-redacting errors.
 *  - Schema setup travels the dedicated admin-only `migrate` action that
 *    replays the bundled drizzle files server-side (like migrationRunner) —
 *    DDL never crosses the client channel.
 *
 * The factory takes injectable deps so tests run without network or
 * Electron: { pgPool, dnsLookup, readMigrations, now, env }.
 */

import {
  assertRelaySql,
  classifyRelayTarget,
  normalizeIdempotent,
  FORBIDDEN_STATEMENT_PATTERN,
} from './relayGuard.js';
import {
  issueRelayToken,
  verifyRelayToken,
  verifyRelayPassword,
  createLoginLimiter,
  dbFingerprint,
  tokenSecret,
} from './relayAuth.js';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const RELAY_VERSION = '1';
const STATEMENT_TIMEOUT_MS = 30000;
const MAX_ROWS = 5000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_TX_STATEMENTS = 200;
const PINGDB_LIMIT_PER_MIN = 20;

const PG_STATE_CODES = {
  23503: 'FK_VIOLATION',
  23505: 'UNIQUE_VIOLATION',
  23502: 'NOT_NULL_VIOLATION',
  23514: 'CHECK_VIOLATION',
  '22001': 'VALUE_TOO_LONG',
  '22P02': 'INVALID_TEXT_REPRESENTATION',
  40001: 'SERIALIZATION_FAILURE',
  '40P01': 'DEADLOCK_DETECTED',
};

function pgErrorPayload(err) {
  const code = err && typeof err.code === 'string' && /^[0-9A-Za-z]{5}$/.test(err.code) ? err.code : null;
  if (!code) return null;
  return {
    code: PG_STATE_CODES[code] || 'DB_ERROR',
    message: err.message ? String(err.message) : 'Database error',
  };
}

function redactSecrets(text, secrets) {
  let out = String(text || '');
  for (const s of secrets) {
    if (s && s.length >= 4 && out.includes(s)) out = out.split(s).join('****');
  }
  return out;
}

/** Minimal server-side URL parse (independent of client input validation). */
function parseRelayUrl(raw) {
  const s = String(raw || '').replace(/^[\uFEFF\s]+|[\s\r]+$/g, '');
  if (!s) throw Object.assign(new Error('DATABASE_URL is empty'), { code: 'invalid-url' });
  let u;
  try {
    u = new URL(s);
  } catch {
    throw Object.assign(new Error('DATABASE_URL is not a valid URL'), { code: 'invalid-url' });
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'postgres' && scheme !== 'postgresql') {
    throw Object.assign(new Error('URL must start with postgres:// or postgresql://'), { code: 'invalid-url' });
  }
  if (!u.hostname) throw Object.assign(new Error('URL is missing a host'), { code: 'invalid-url' });
  const port = u.port ? Number(u.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('URL has an invalid port'), { code: 'invalid-url' });
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw Object.assign(new Error('URL is missing a database name'), { code: 'invalid-url' });
  const user = decodeURIComponent(u.username || '');
  if (!user) throw Object.assign(new Error('URL is missing a user'), { code: 'invalid-url' });
  const password = u.password ? decodeURIComponent(u.password) : '';
  const sslMode = (u.searchParams.get('sslmode') || '').toLowerCase();
  const isLocal = u.hostname.toLowerCase() === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  let ssl;
  if (sslMode === 'disable' || sslMode === 'allow') ssl = false;
  else if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') ssl = true;
  else ssl = !isLocal;
  const strictVerify = sslMode === 'verify-ca' || sslMode === 'verify-full';
  return { raw: s, host: u.hostname, port, database, user, password, ssl, strictVerify };
}

function poolConfigFromParsed(p) {
  return {
    host: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password: p.password,
    ssl: p.ssl ? (p.strictVerify ? { rejectUnauthorized: true } : { require: true, rejectUnauthorized: false }) : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  };
}

function privateTargetsAllowed(env) {
  const e = env || {};
  if (String(e.ALLOW_PRIVATE_DB || '') === '1') return true;
  if (e.VERCEL_ENV === 'production' || e.NODE_ENV === 'production') return false;
  return true;
}

function clientIpOf(headers, fallback) {
  const h = headers || {};
  const fwd = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return fallback || 'unknown';
}

function createRelayHandler(deps = {}) {
  const env = deps.env || process.env;
  const dnsLookup = deps.dnsLookup || null;
  const PoolFactory = deps.pgPool || ((config) => new Pool(config));
  const now = deps.now || (() => Date.now());
  const loginLimiter = createLoginLimiter({ now });
  const pingBuckets = new Map();
  const pools = new Map();
  // Resolved once: without a stable secret, issued tokens could never
  // verify (a fresh random secret per call). Login refuses loudly instead
  // of minting doomed tokens; all other paths keep working (they only
  // verify caller-supplied tokens against the same resolution).
  const secretInfo = tokenSecret(env);

  function checkPingBudget(ip) {
    const t = now();
    const b = pingBuckets.get(ip);
    if (!b || t >= b.resetAt) {
      pingBuckets.set(ip, { count: 1, resetAt: t + 60000 });
      return true;
    }
    if (b.count >= PINGDB_LIMIT_PER_MIN) return false;
    b.count += 1;
    return true;
  }

  async function resolveAddresses(host) {
    if (!dnsLookup) {
      const dns = await import('node:dns/promises');
      const found = await dns.lookup(host, { all: true });
      return found.map((r) => r.address);
    }
    return dnsLookup(host);
  }

  function getPool(parsed) {
    const key = dbFingerprint(parsed.raw);
    const hit = pools.get(key);
    if (hit) {
      hit.lastUsed = now();
      return hit.pool;
    }
    if (!PoolFactory) {
      throw new Error('relay pool factory unavailable');
    }
    const pool = PoolFactory(poolConfigFromParsed(parsed));
    pools.set(key, { pool, lastUsed: now() });
    if (pools.size > 20) {
      let oldest = null;
      for (const [k, v] of pools) {
        if (!oldest || v.lastUsed < oldest[1].lastUsed) oldest = [k, v];
      }
      if (oldest) {
        try { oldest[1].pool.end(); } catch { /* ignore */ }
        pools.delete(oldest[0]);
      }
    }
    return pool;
  }

  async function guardedTarget(parsed) {
    let addresses = [];
    try {
      addresses = await resolveAddresses(parsed.host);
    } catch {
      return { ok: false, code: 'unreachable', error: 'host does not resolve' };
    }
    const verdict = classifyRelayTarget(parsed.host, addresses, { allowPrivate: privateTargetsAllowed(env) });
    if (!verdict.ok) return { ok: false, code: 'blocked-target', error: verdict.reason };
    return { ok: true };
  }

  function capRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const sliced = list.length > MAX_ROWS ? list.slice(0, MAX_ROWS) : list;
    const json = JSON.stringify(sliced);
    if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) {
      throw Object.assign(new Error('result too large'), { code: 'too-large' });
    }
    return { rows: sliced, truncated: list.length > MAX_ROWS };
  }

  function failure(err, secrets) {
    const payload = pgErrorPayload(err);
    const raw = err instanceof Error ? err.message : String(err);
    if (payload) return { success: false, error: redactSecrets(payload.message, secrets), errorCode: payload.code };
    return { success: false, error: redactSecrets(raw, secrets) };
  }

  async function actionPingdb(body) {
    let parsed;
    try {
      parsed = parseRelayUrl(body.databaseUrl);
    } catch (e) {
      return { status: 400, body: { success: false, code: 'invalid-url', error: e.message } };
    }
    const gate = await guardedTarget(parsed);
    if (!gate.ok) return { status: 403, body: { success: false, code: gate.code, error: gate.error } };
    let pool;
    try {
      pool = getPool(parsed);
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay pool unavailable' } };
    }
    try {
      const client = await pool.connect();
      try {
        const r = await client.query('SELECT current_database() AS db, version() AS version');
        return { status: 200, body: { success: true, db: r.rows[0].db, version: r.rows[0].version } };
      } finally {
        client.release();
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/ENOTFOUND|getaddrinfo/i.test(raw)) {
        return { status: 200, body: { success: false, code: 'unreachable', error: 'host does not resolve — verify the host and that the project is active' } };
      }
      if (/ETIMEDOUT|timeout/i.test(raw)) {
        return { status: 200, body: { success: false, code: 'unreachable', error: 'connection timed out — check network, firewall and port' } };
      }
      if (/password authentication failed|28P01/i.test(raw)) {
        return { status: 200, body: { success: false, code: 'auth-failed', error: 'authentication failed — check user and password' } };
      }
      return { status: 200, body: { success: false, code: 'unreachable', error: redactSecrets(raw, [parsed.password]).slice(0, 300) } };
    }
  }

  async function actionLogin(body, clientIp) {
    if (secretInfo.ephemeral) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay misconfigured: set a stable MAGHZ_RELAY_SECRET' } };
    }
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || username.length > 100 || !password || password.length > 1024) {
      return { status: 400, body: { success: false, code: 'bad-request', error: 'username and password required' } };
    }
    const allowed = loginLimiter.check(clientIp, username);
    if (!allowed.allowed) {
      const minutes = Math.ceil((allowed.retryAfterMs || 0) / 60000);
      return { status: 429, body: { success: false, code: 'rate-limited', error: `too many attempts — retry in ${minutes} minute(s)` } };
    }
    let parsed;
    try {
      parsed = parseRelayUrl(body.databaseUrl);
    } catch (e) {
      return { status: 400, body: { success: false, code: 'invalid-url', error: e.message } };
    }
    const gate = await guardedTarget(parsed);
    if (!gate.ok) return { status: 403, body: { success: false, code: gate.code, error: gate.error } };
    let pool;
    try {
      pool = getPool(parsed);
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay pool unavailable' } };
    }
    try {
      const result = await pool.query(
        'SELECT id, company_id, username, email, full_name, phone, photo_url, role, branch_id, is_active, password_hash FROM users WHERE username = $1',
        [username.trim()],
      );
      const row = (result.rows || []).find((r) => r.is_active && verifyRelayPassword(password, r.password_hash));
      if (!row) {
        loginLimiter.recordFailure(clientIp, username);
        return { status: 200, body: { success: false, code: 'bad-credentials', error: 'invalid username or password' } };
      }
      let permissions = [];
      let roleId;
      try {
        const roles = await pool.query('SELECT id, permissions FROM roles WHERE name = $1 AND company_id = $2', [row.role, row.company_id]);
        roleId = roles.rows[0]?.id || undefined;
        const raw = roles.rows[0]?.permissions;
        if (Array.isArray(raw)) permissions = raw;
        else if (typeof raw === 'string') {
          try { permissions = JSON.parse(raw); } catch { permissions = []; }
        }
      } catch { /* roles table may be unreachable — fall back to empty */ }
      try {
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1 AND company_id = $2', [row.id, row.company_id]);
      } catch { /* best-effort */ }
      loginLimiter.clear(clientIp, username);
      const token = issueRelayToken(
        { databaseUrl: parsed.raw, userId: row.id, companyId: row.company_id, role: row.role, permissions },
        env,
        now(),
      );
      return {
        status: 200,
        body: {
          success: true,
          token,
          user: {
            id: row.id, companyId: row.company_id, username: row.username,
            email: row.email || undefined, fullName: row.full_name || undefined,
            phone: row.phone || undefined, photoUrl: row.photo_url || undefined,
            role: row.role, roleId, branchId: row.branch_id || undefined, isActive: row.is_active,
          },
          permissions,
        },
      };
    } catch (err) {
      return { status: 200, body: failure(err, [parsed.password]) };
    }
  }

  /**
   * Fresh-database provisioning (onboarding without credentials yet).
   *
   * A caller that supplies VALID database credentials for a database with
   * no users yet gains nothing beyond what those credentials already grant
   * via psql — so setup statements (schema replay + seed DML) are allowed
   * without a JWT exactly while the database is fresh. The moment a user
   * row exists, the full JWT + guard contract applies. Freshness is checked
   * on EVERY unauthenticated request (no cache) so creating the first admin
   * closes the window immediately. The reduced guard still bans DDL-by-
   * client, comments, stacked statements and system catalogs.
   */
  async function isFreshDatabase(pool) {
    try {
      const r = await pool.query('SELECT count(*)::int AS n FROM users');
      return Number(r.rows?.[0]?.n ?? 1) === 0;
    } catch {
      // users table missing (pre-migration database) counts as fresh.
      return true;
    }
  }

  function assertFreshSql(sql) {
    const normalized = String(sql || '').toLowerCase();
    if (!normalized.trim() || /;|--|\/\*|\*\//.test(normalized)) throw new Error('SQL operation not permitted');
    if (FORBIDDEN_STATEMENT_PATTERN.test(normalized)) throw new Error('SQL operation not permitted');
    const tables = new Set();
    for (const m of normalized.matchAll(/\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi)) {
      tables.add(m[1]);
    }
    for (const name of tables) {
      if (name.startsWith('pg_') || name.startsWith('information_schema')) throw new Error('SQL operation not permitted');
    }
  }

  async function freshSessionBypass(pool) {
    if (!(await isFreshDatabase(pool))) return null;
    return { user: { id: 'setup', companyId: '', role: '' }, permissions: [] };
  }

  /**
   * Session resolution with fresh-database provisioning: a valid JWT wins;
   * otherwise (missing or stale token) an EMPTY database still allows setup
   * statements under the reduced fresh guard. Populated databases demand a
   * valid token — never silently.
   */
  async function sessionOrFresh(body, pool) {
    const token = typeof body.token === 'string' ? body.token : '';
    const raw = typeof body.databaseUrl === 'string' ? body.databaseUrl : '';
    let tokenError = 'login required';
    if (token) {
      const checked = verifyRelayToken(token, raw, env, now());
      if (checked.ok) return { kind: 'jwt', session: checked.session };
      tokenError = checked.error || tokenError;
    }
    const setup = await freshSessionBypass(pool);
    if (setup) return { kind: 'fresh', session: setup };
    return { kind: 'denied', status: 401, body: { success: false, code: 'expired-token', error: tokenError } };
  }

  function guardFor(kind, session, sql, params) {
    if (kind === 'fresh') assertFreshSql(sql);
    else assertRelaySql(session, sql, params);
  }

  async function actionQuery(body) {
    const raw = typeof body.databaseUrl === 'string' ? body.databaseUrl : '';
    let parsed;
    try {
      parsed = parseRelayUrl(raw);
    } catch (e) {
      return { status: 400, body: { success: false, code: 'invalid-url', error: e.message } };
    }
    const gate = await guardedTarget(parsed);
    if (!gate.ok) return { status: 403, body: { success: false, code: gate.code, error: gate.error } };
    let pool;
    try {
      pool = getPool(parsed);
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay pool unavailable' } };
    }
    const auth = await sessionOrFresh(body, pool);
    if (auth.kind === 'denied') return { status: auth.status, body: auth.body };
    const sql = typeof body.sql === 'string' ? body.sql : '';
    const params = Array.isArray(body.params) ? body.params : [];
    try {
      guardFor(auth.kind, auth.session, sql, params);
    } catch (e) {
      return { status: 403, body: { success: false, code: 'forbidden-op', error: e.message } };
    }
    try {
      const res = await pool.query(`/*relay*/${sql}`, params);
      const capped = capRows(res.rows);
      return { status: 200, body: { success: true, rows: capped.rows, rowCount: res.rowCount, truncated: capped.truncated || undefined } };
    } catch (err) {
      if (err && err.code === 'too-large') return { status: 413, body: { success: false, code: 'too-large', error: 'result too large' } };
      return { status: 200, body: failure(err, [parsed.password]) };
    }
  }

  async function actionTransaction(body) {
    const raw = typeof body.databaseUrl === 'string' ? body.databaseUrl : '';
    let parsed;
    try {
      parsed = parseRelayUrl(raw);
    } catch (e) {
      return { status: 400, body: { success: false, code: 'invalid-url', error: e.message } };
    }
    const gate = await guardedTarget(parsed);
    if (!gate.ok) return { status: 403, body: { success: false, code: gate.code, error: gate.error } };
    const queries = Array.isArray(body.queries) ? body.queries : [];
    if (queries.length === 0 || queries.length > MAX_TX_STATEMENTS) {
      return { status: 400, body: { success: false, code: 'bad-request', error: `1-${MAX_TX_STATEMENTS} statements required` } };
    }
    let pool;
    try {
      pool = getPool(parsed);
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay pool unavailable' } };
    }
    const auth = await sessionOrFresh(body, pool);
    if (auth.kind === 'denied') return { status: auth.status, body: auth.body };
    for (const q of queries) {
      if (!q || typeof q.sql !== 'string') {
        return { status: 400, body: { success: false, code: 'bad-request', error: 'each item needs { sql, params? }' } };
      }
      try {
        guardFor(auth.kind, auth.session, q.sql, Array.isArray(q.params) ? q.params : []);
      } catch (e) {
        return { status: 403, body: { success: false, code: 'forbidden-op', error: e.message } };
      }
    }
    const client = await pool.connect().catch((err) => null);
    if (!client) return { status: 502, body: { success: false, code: 'unreachable', error: 'database unreachable' } };
    try {
      await client.query('BEGIN');
      const results = [];
      for (const q of queries) {
        const tag = `/*relay*/${q.sql}`;
        const res = await client.query(tag, Array.isArray(q.params) ? q.params : []);
        const capped = capRows(res.rows);
        results.push({ rows: capped.rows, rowCount: res.rowCount });
      }
      await client.query('COMMIT');
      return { status: 200, body: { success: true, results } };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      return { status: 200, body: failure(err, [parsed.password]) };
    } finally {
      client.release();
    }
  }

  async function actionMigrate(body) {
    const raw = typeof body.databaseUrl === 'string' ? body.databaseUrl : '';
    let parsed;
    try {
      parsed = parseRelayUrl(raw);
    } catch (e) {
      return { status: 400, body: { success: false, code: 'invalid-url', error: e.message } };
    }
    const gate = await guardedTarget(parsed);
    if (!gate.ok) return { status: 403, body: { success: false, code: gate.code, error: gate.error } };
    let pool;
    try {
      pool = getPool(parsed);
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay pool unavailable' } };
    }
    // Admin JWT, or no/invalid token on a FRESH database (first provisioning
    // has no users yet to sign in with — the DB password is the credential).
    const auth = await sessionOrFresh(body, pool);
    if (auth.kind === 'denied') return { status: auth.status, body: auth.body };
    if (auth.kind === 'jwt') {
      const role = auth.session.user.role;
      if (role !== 'admin' && role !== 'super_admin') {
        return { status: 403, body: { success: false, code: 'forbidden-op', error: 'admin role required' } };
      }
    }
    let files;
    try {
      files = await depsReadMigrations();
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'migration bundle unavailable' } };
    }
    try {
      await pool.query('CREATE TABLE IF NOT EXISTS __pglite_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())');
      let applied = 0;
      for (const file of files) {
        const seen = await pool.query('SELECT 1 FROM __pglite_migrations WHERE name = $1 LIMIT 1', [file.name]);
        if ((seen.rows || []).length > 0) continue;
      try {
        for (const stmt of splitStatements(file.sql)) {
          await pool.query(normalizeIdempotent(stmt));
        }
      } catch (e) {
          return { status: 200, body: { success: false, code: 'migration-failed', error: `migration ${file.name} failed` } };
        }
        await pool.query('INSERT INTO __pglite_migrations (name) VALUES ($1)', [file.name]);
        applied++;
      }
      return { status: 200, body: { success: true, applied } };
    } catch (err) {
      return { status: 200, body: failure(err, [parsed.password]) };
    }
  }

  async function depsReadMigrations() {
    if (deps.readMigrations) return deps.readMigrations();
    const roots = [process.cwd(), new URL('../../', import.meta.url).pathname];
    let dir = null;
    for (const r of roots) {
      try {
        if (fs.statSync(path.join(r, 'drizzle')).isDirectory()) { dir = path.join(r, 'drizzle'); break; }
      } catch { /* try next */ }
    }
    if (!dir) throw new Error('drizzle directory not found');
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => ({ name: f.replace(/\.sql$/, ''), sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
  }

  function splitStatements(sql) {
    return String(sql || '')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Full database reset (onboarding "start fresh"). Mirrors the desktop
   * db:clear-all channel: requires explicit confirm plus valid ADMIN
   * credentials re-verified here, then truncates server-side (CASCADE makes
   * table order irrelevant). TRUNCATE can never travel the client SQL
   * channel, so it lives here — never in the guard.
   */
  async function actionReset(body, clientIp) {
    const raw = typeof body.databaseUrl === 'string' ? body.databaseUrl : '';
    let parsed;
    try {
      parsed = parseRelayUrl(raw);
    } catch (e) {
      return { status: 400, body: { success: false, code: 'invalid-url', error: e.message } };
    }
    const gate = await guardedTarget(parsed);
    if (!gate.ok) return { status: 403, body: { success: false, code: gate.code, error: gate.error } };
    if (body.confirm !== true) {
      return { status: 400, body: { success: false, code: 'bad-request', error: 'Confirmation required to clear all data.' } };
    }
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      return { status: 400, body: { success: false, code: 'bad-request', error: 'username and password required' } };
    }
    const allowed = loginLimiter.check(clientIp, username);
    if (!allowed.allowed) {
      return { status: 429, body: { success: false, code: 'rate-limited', error: 'too many attempts — retry later' } };
    }
    let pool;
    try {
      pool = getPool(parsed);
    } catch (e) {
      return { status: 500, body: { success: false, code: 'unavailable', error: 'relay pool unavailable' } };
    }
    try {
      const found = await pool.query(
        'SELECT id, company_id, role, is_active, password_hash FROM users WHERE username = $1',
        [username.trim()],
      );
      const row = (found.rows || []).find((r) => r.is_active && verifyRelayPassword(password, r.password_hash));
      if (!row || (row.role !== 'admin' && row.role !== 'super_admin')) {
        loginLimiter.recordFailure(clientIp, username);
        return { status: 200, body: { success: false, code: 'bad-credentials', error: 'invalid username or password' } };
      }
      loginLimiter.clear(clientIp, username);
      const tables = await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('__pglite_migrations', 'app_schema_migrations')",
      );
      const names = ((tables.rows || []).map((r) => String(r.tablename)).filter(Boolean))
        .map((t) => `"${t.replace(/"/g, '')}"`)
        .join(', ');
      if (!names) return { status: 200, body: { success: true } };
      await pool.query(`TRUNCATE ${names} CASCADE`);
      return { status: 200, body: { success: true } };
    } catch (err) {
      return { status: 200, body: failure(err, [parsed.password]) };
    }
  }

  async function handle({ method, body, headers, clientIp }) {
    const raw = body && typeof body === 'object' ? body : {};
    const upper = String(method || 'GET').toUpperCase();
    if (upper === 'GET') {
      return {
        status: 200,
        body: {
          ok: true, service: 'maghz-relay', version: RELAY_VERSION,
          privateTargetsAllowed: privateTargetsAllowed(env),
        },
      };
    }
    if (upper !== 'POST') return { status: 405, body: { success: false, code: 'bad-request', error: 'POST only' } };
    let size = 0;
    try {
      size = Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8');
    } catch { /* ignore */ }
    if (size > MAX_BODY_BYTES) {
      return { status: 413, body: { success: false, code: 'too-large', error: 'request too large' } };
    }
    const action = typeof raw.action === 'string' ? raw.action : '';
    const ip = clientIp || clientIpOf(headers, 'unknown');
    if (action === 'pingdb') {
      if (!checkPingBudget(ip)) {
        return { status: 429, body: { success: false, code: 'rate-limited', error: 'too many checks — retry in a minute' } };
      }
      return actionPingdb(raw);
    }
    if (action === 'login') return actionLogin(raw, ip);
    if (action === 'query') return actionQuery(raw);
    if (action === 'transaction') return actionTransaction(raw);
    if (action === 'migrate') return actionMigrate(raw);
    if (action === 'reset') return actionReset(raw, ip);
    return { status: 400, body: { success: false, code: 'bad-request', error: 'unknown action' } };
  }

  return {
    handle,
    privateTargetsAllowed: () => privateTargetsAllowed(env),
    __test: { parseRelayUrl, poolConfigFromParsed, splitStatements },
  };
}

export { createRelayHandler, RELAY_VERSION };
