import { ipcMain, app } from 'electron';
import pg from 'pg';
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { seedComprehensiveDemoData } from './seedDemoData.js';

const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
function hashPasswordNode(password) {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

// Generate a strong random password (20 chars, mixed sets) when the operator
// does not supply one — so no known default credential ever exists.
function crypto_randPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const { Pool } = pg;

let pool = null;
let querySeq = 0;
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
// Sliding TTL alone would keep a stolen session alive forever as long as it
// stays active. Cap the absolute lifetime (8h) and sweep expired entries so a
// crashed renderer cannot leak tokens indefinitely.
const SESSION_MAX_LIFETIME_MS = 8 * 60 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
let sessionSweepTimer = null;

function sweepExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) sessions.delete(token);
  }
}

function ensureSessionSweeper() {
  if (sessionSweepTimer) return sessionSweepTimer;
  sessionSweepTimer = setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);
  if (typeof sessionSweepTimer.unref === 'function') sessionSweepTimer.unref();
  return sessionSweepTimer;
}

function verifyPasswordNode(password, storedHash) {
  const parts = typeof storedHash === 'string' ? storedHash.split(':') : [];
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 100000 || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(expected)) return false;
  const actual = pbkdf2Sync(password, salt, iterations, expected.length / 2, 'sha256').toString('hex');
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function validateNewPassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && /[A-Za-z\u0600-\u06FF]/.test(password)
    && /\d/.test(password);
}

function createSession(webContentsId, user, permissions) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(token, {
    webContentsId,
    user,
    permissions,
    expiresAt: now + SESSION_TTL_MS,
    absoluteExpiresAt: now + SESSION_MAX_LIFETIME_MS,
  });
  ensureSessionSweeper();
  return token;
}

function getSession(webContentsId, token) {
  const session = token
    ? sessions.get(token)
    : [...sessions.values()].find((candidate) => candidate.webContentsId === webContentsId);
  if (
    !session ||
    session.webContentsId !== webContentsId ||
    session.expiresAt <= Date.now() ||
    session.absoluteExpiresAt <= Date.now()
  ) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

// Invalidate every session belonging to a user (password change / deactivation /
// deletion must cut off all existing access immediately).
function revokeUserSessions(userId) {
  for (const [token, session] of sessions) {
    if (session.user.id === userId) sessions.delete(token);
  }
}

// Mirrors src/modules/auth/store.ts FALLBACK_PERMISSIONS so role-based users
// whose DB record has no explicit permissions still get the same access in the
// main process as they do in the renderer. Without this, SQL authorization in
// the main process would deny legitimate reads for manager/accountant/... roles.
const FALLBACK_PERMISSIONS = {
  manager: [
    'core.view', 'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'sales.view', 'sales.create', 'sales.edit', 'sales.post',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post',
    'reports.view', 'reports.export',
    'settings.view',
    'ai.use',
  ],
  accountant: [
    'core.view',
    'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view',
    'sales.view', 'sales.create', 'sales.edit',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view',
    'reports.view', 'reports.export',
    'ai.use',
  ],
  sales_rep: [
    'sales.own', 'sales.create', 'sales.edit',
    'inventory.own',
    'crm.own', 'crm.create', 'crm.edit',
    'reports.view',
    'ai.use',
  ],
  viewer: [
    'core.view', 'accounting.view', 'inventory.view', 'sales.view',
    'purchases.view', 'manufacturing.view', 'reports.view',
  ],
};

function hasPermission(session, permission) {
  if (session.user.role === 'super_admin' || session.user.role === 'admin') return true;
  if (session.permissions.includes('*')) return true;
  if (session.permissions.includes(permission)) return true;
  const fallback = FALLBACK_PERMISSIONS[session.user.role];
  return !!fallback && fallback.includes(permission);
}

function sessionPublicData(session) {
  return { user: session.user, permissions: session.permissions };
}

// Privileged roles may never be created, granted, or reset by a plain admin —
// only super_admins manage them. Prevents settings.edit holders from
// escalating themselves or others to admin.
function canManageRole(session, role) {
  if (!role || !isAdminRole(role)) return true;
  return session.user.role === 'super_admin';
}

function deleteSession(session) {
  for (const [token, candidate] of sessions) {
    if (candidate === session) {
      sessions.delete(token);
      return;
    }
  }
}

// Shared session gate for cross-process handlers (AI harness). Validates the
// token against the sender's webContents and optionally enforces a permission.
// Returns { ok: true, session } or { ok: false, error }.
export function authenticateIpcSession(event, sessionToken, { permission } = {}) {
  const session = getSession(event.sender.id, sessionToken);
  if (!session) return { ok: false, error: 'Login required' };
  if (permission && !hasPermission(session, permission)) {
    return { ok: false, error: 'Permission denied' };
  }
  return { ok: true, session };
}

// ─── Destructive / onboarding channel guards ─────────────────────────────────
// These channels reconfigure the DB connection or wipe/seed data. DENY BY
// DEFAULT — they are only reachable by:
//   1. an authenticated admin session, or
//   2. during first-run bootstrap (no company exists yet — an unreachable DB
//      cannot hold company data, so a failing pool counts as bootstrap too), or
//   3. development mode.
// `confirm` + admin password re-entry is additionally required for the
// destructive "clear all" path.

function isDevMode() {
  return process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
}

async function hasAnyCompany() {
  const res = await pool.query('SELECT 1 FROM companies LIMIT 1');
  return res.rows.length > 0;
}

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

function isAdminSession(session) {
  return !!session && isAdminRole(session.user.role);
}

// Deny-by-default gate: once a company exists, only an authenticated admin
// (or dev mode) may invoke onboarding channels. Previously this function
// returned silently when `requireNoCompany` was false, letting unauthenticated
// renderer code reconfigure the DB pool or seed data.
async function assertOnboardingAllowed(event, sessionToken) {
  const session = getSession(event.sender.id, sessionToken);
  if (isAdminSession(session)) return session;
  if (isDevMode()) return session || null;
  let companyExists = false;
  try {
    companyExists = await hasAnyCompany();
  } catch {
    // Pool broken / DB unreachable — cannot contain company data. The
    // onboarding channels exist precisely to (re)establish this connection.
    companyExists = false;
  }
  if (companyExists) {
    throw new Error('Not allowed after initial setup');
  }
  return session || null;
}

async function verifyAdminPassword(username, password, companyId) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return { ok: false, error: 'Invalid admin credentials' };
  }
  // usernames are unique only per company — scope the lookup to the caller's
  // company so a same-named admin from another tenant can never authorize.
  const params = [username.trim()];
  let scope = '';
  if (companyId) {
    scope = ' AND company_id = $2';
    params.push(companyId);
  }
  const res = await pool.query(
    `SELECT id, password_hash, role FROM users WHERE username = $1${scope} AND is_active = TRUE LIMIT 1`,
    params
  );
  const row = res.rows[0];
  if (!row || (row.role !== 'admin' && row.role !== 'super_admin') || !verifyPasswordNode(password, row.password_hash)) {
    return { ok: false, error: 'Invalid admin credentials' };
  }
  return { ok: true, user: row };
}

function writeSecurityAudit(entry) {
  try {
    const logPath = path.join(app.getPath('userData'), 'security-audit.log');
    fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (err) {
    console.error('[SEC] Failed to write security audit:', err.message);
  }
}

// ─── Login rate limiting ─────────────────────────────────────────────────────
// Brute-force protection keyed by sender (webContents) AND by username. The
// username bucket is what matters across app restarts within a session — an
// attacker cannot escape it by rotating windows.
const LOGIN_LIMIT_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
const loginAttempts = new Map();

function checkLoginAttempt(key) {
  const now = Date.now();
  const bucket = loginAttempts.get(key);
  if (!bucket || now >= bucket.resetAt) return { allowed: true, remaining: LOGIN_LIMIT_PER_WINDOW };
  if (bucket.count >= LOGIN_LIMIT_PER_WINDOW) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  return { allowed: true, remaining: LOGIN_LIMIT_PER_WINDOW - bucket.count };
}

function recordFailedLogin(key) {
  const now = Date.now();
  const bucket = loginAttempts.get(key);
  if (!bucket || now >= bucket.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS + (bucket ? LOGIN_LOCKOUT_MS : 0) });
    return;
  }
  bucket.count += 1;
  if (bucket.count >= LOGIN_LIMIT_PER_WINDOW) {
    // Threshold reached: extend the window into a lockout.
    bucket.resetAt = now + LOGIN_LOCKOUT_MS;
  }
}

function clearLoginAttempts(usernameKey, senderKey) {
  loginAttempts.delete(usernameKey);
  loginAttempts.delete(senderKey);
}

function loginAttemptDenied(event, username) {
  const senderKey = `wc:${event.sender.id}`;
  const usernameKey = `u:${String(username || '').trim().toLowerCase()}`;
  const senderCheck = checkLoginAttempt(senderKey);
  if (!senderCheck.allowed) return senderCheck;
  const userCheck = checkLoginAttempt(usernameKey);
  if (!userCheck.allowed) return userCheck;
  recordFailedLogin(senderKey);
  recordFailedLogin(usernameKey);
  return null;
}

// Whitelist mapping EVERY business table (exact names) to its owning module.
// Tables are extracted from the SQL text itself (FROM/JOIN/INSERT INTO/UPDATE
// targets; CTE aliases are excluded), so renaming or joining a table always
// resolves to an explicit rule. A table with no rule can never be reached
// through the renderer SQL channel.
//
// Semantics:
// - READ:  requires module.view — or module.own, so roles scoped to their own
//   records (e.g. sales_rep) can still run list pages and resolve JOINed
//   display names.
// - WRITE: accepts any of module.create/.edit/.post (posting an invoice is a
//   sales flow even though it touches accounting tables too).
// - readAny/writeAny: cross-module reference & configuration data used by
//   every business flow (currency formatting, journal generation, voucher
//   forms, user JOINs). audit_logs stays append-only from business flows.
const SQL_MODULE_TABLE_RULES = [
  { module: 'settings', tables: ['roles'] },
  { module: 'settings', tables: ['audit_logs'], writeAny: true },
  { module: 'settings', tables: ['settings', 'companies', 'branches', 'currencies', 'users', 'units', 'cash_boxes', 'vat_settings', 'default_accounts'], readAny: true },
  // Document numbering is consumed by every create flow (invoices, products,
  // employees, work orders, ...) — writers only need to hold ANY create right.
  {
    module: 'settings',
    tables: ['document_sequences'],
    readAny: true,
    writePermissions: [
      'settings.edit', 'accounting.create', 'sales.create', 'purchases.create',
      'inventory.create', 'hr.create', 'manufacturing.create', 'crm.create',
    ],
  },
  { module: 'accounting', tables: ['accounts', 'transactions', 'journal_entries', 'cost_centers', 'receipt_vouchers', 'payment_vouchers'] },
  // GL tables are ALSO written by cross-module posting flows: HR payroll runs
  // (gross-up entry) and end-of-service accrual/settlement book through the
  // same journal machinery — same precedent as manufacturing on stock_movements.
  {
    module: 'accounting',
    tables: ['transactions', 'journal_entries'],
    writePermissions: [
      'accounting.create', 'accounting.edit', 'accounting.post',
      'hr.create', 'hr.edit',
    ],
  },
  { module: 'inventory', tables: ['products', 'product_types', 'product_categories', 'product_product_categories', 'stock', 'stock_adjustments', 'warehouse_transfers', 'warehouse_transfer_lines'] },
  // Warehouses & stock movements are touched by cross-module posting flows:
  // completing a work order books material consumption (out) and finished
  // goods (in) against the first warehouse. Warehouses is reference data
  // (read-only here, but the write gate applies to any statement with a
  // write verb), so the same manufacturing writers that own work orders are
  // authorized. Both writes stay scoped to the session's company inside the
  // composed CTEs.
  { module: 'inventory', tables: ['warehouses'], readAny: true, writePermissions: ['inventory.create', 'inventory.edit', 'inventory.post', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post'] },
  { module: 'inventory', tables: ['stock_movements'], writePermissions: ['inventory.create', 'inventory.edit', 'inventory.post', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post'] },
  { module: 'sales', tables: ['sales_invoices', 'sales_invoice_lines', 'sales_returns', 'sales_return_lines', 'quotations', 'quotation_lines', 'customers'] },
  { module: 'purchases', tables: ['purchase_invoices', 'purchase_invoice_lines', 'purchase_orders', 'purchase_order_lines', 'purchase_returns', 'purchase_return_lines', 'suppliers'] },
  { module: 'hr', tables: ['employees', 'payroll_runs', 'payroll_lines', 'payroll_components', 'departments', 'attendance', 'leaves', 'end_of_service'] },
  { module: 'crm', tables: ['leads', 'opportunities', 'tasks', 'activities'] },
  { module: 'manufacturing', tables: ['boms', 'bom_lines', 'work_orders', 'work_order_consumptions'] },
  { module: 'ai', tables: ['ai_chat_sessions', 'ai_chat_messages'] },
];

const TABLE_TARGET_PATTERN = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi;
const CTE_NAME_PATTERN = /\b(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
const SQL_NON_TABLE_TOKENS = new Set(['select', 'values', 'lateral', 'only', 'where', 'returning']);
// Statement-level commands. Anchored at statement start so `UPDATE ... SET`
// (legitimate everywhere) is not confused with the PG `SET` configuration
// command — the previous unanchored /\bset\b/ silently blocked every UPDATE.
const FORBIDDEN_STATEMENT_PATTERN = /^\s*(set|show|begin|commit|rollback|copy|listen|notify|vacuum|analyze|explain|prepare|execute|deallocate)\b/i;

function extractTableNames(sql) {
  const normalized = String(sql || '').toLowerCase();
  const ctes = new Set();
  for (const m of normalized.matchAll(CTE_NAME_PATTERN)) ctes.add(m[1]);
  const names = new Set();
  for (const m of normalized.matchAll(TABLE_TARGET_PATTERN)) {
    const name = m[1];
    if (ctes.has(name) || SQL_NON_TABLE_TOKENS.has(name)) continue;
    names.add(name);
  }
  return names;
}

function moduleWritePermissions(module) {
  return [`${module}.create`, `${module}.edit`, `${module}.post`];
}

function assertSqlAuthorized(session, sql, params) {
  const normalized = String(sql || '').toLowerCase();
  if (!normalized.trim() || /;|--|\/\*|\*\//.test(normalized)) throw new Error('SQL operation not permitted');
  if (FORBIDDEN_STATEMENT_PATTERN.test(normalized)) {
    throw new Error('SQL operation not permitted');
  }
  const write = /\b(insert|update|delete)\b/.test(normalized);
  const tables = extractTableNames(normalized);
  // SQL that touches no known business table at all is refused outright.
  if (tables.size === 0) throw new Error('SQL operation not permitted');
  for (const name of tables) {
    // System catalogs can never be a renderer target.
    if (name.startsWith('pg_') || name.startsWith('information_schema')) throw new Error('SQL operation not permitted');
    const rule = SQL_MODULE_TABLE_RULES.find((r) => r.tables.includes(name));
    if (!rule) throw new Error('SQL operation not permitted');
    if (write) {
      if (rule.writeAny) continue;
      const required = rule.writePermissions || moduleWritePermissions(rule.module);
      if (!required.some((p) => hasPermission(session, p))) throw new Error('Permission denied');
    } else if (!rule.readAny) {
      if (
        !hasPermission(session, `${rule.module}.view`) &&
        !hasPermission(session, `${rule.module}.own`)
      ) {
        throw new Error('Permission denied');
      }
    }
  }
  // Every tenant-scoped request must be tied to the authenticated company.
  if (normalized.includes('company_id') && !params.some((value) => value === session.user.companyId)) {
    throw new Error('Cross-company access denied');
  }
}

/**
 * Unique counter to tag each SQL query.
 * Adding a unique comment forces node-postgres to always send a fresh Parse
 * message, preventing the "inconsistent types deduced for parameter $N" error
 * that occurs when the same SQL text is reused with different param types.
 */
async function execQuery(target, sql, params) {
  const p = params || [];
  if (p.length > 0) {
    const taggedSql = `/*_q${querySeq++}_*/${sql}`;
    return await target.query(taggedSql, p);
  }
  return await target.query(sql);
}

/**
 * Runtime schema self-healing.
 *
 * If a statement fails because a column/table/relation is missing
 * (SQLSTATE 42P01 undefined_table, 42703 undefined_column), the live database
 * has drifted behind the shipped migrations. Kick off the deterministic
 * schema-sync runner once (single-flight), then let the caller retry.
 * Works against WHATEVER database the app is currently connected to — local,
 * Neon, or any future target — closing the "works on my machine" gap forever.
 */
let schemaHealPromise = null;
function healSchemaDriftOnce() {
  if (!schemaHealPromise) {
    console.warn('[DB] Schema drift detected (42703/42P01) — running self-healing schema sync...');
    schemaHealPromise = import('./migrationRunner.js')
      .then((m) => m.runDrizzleMigrations(activeDbConfig ? { ...activeDbConfig } : undefined))
      .then(() => {
        console.log('[DB] Schema self-heal completed. Retrying operation.');
      })
      .catch((e) => {
        console.error('[DB] Schema self-heal failed:', e.message);
        // Allow a later retry on the next drifting call.
        schemaHealPromise = null;
        throw e;
      });
  }
  return schemaHealPromise;
}

function isSchemaDriftError(err) {
  if (!err) return false;
  if (err.code === '42703' || err.code === '42P01') return true;
  const msg = String(err.message || err);
  return msg.includes('does not exist') && (msg.includes('column ') || msg.includes('relation '));
}

/** Execute a statement, healing schema drift once and retrying if needed. */
async function execQueryWithSelfHeal(target, sql, params) {
  try {
    return await execQuery(target, sql, params);
  } catch (err) {
    if (!isSchemaDriftError(err)) throw err;
    await healSchemaDriftOnce();
    // Second attempt after healing; if it still fails, surface the real error.
    return await execQuery(target, sql, params);
  }
}

/**
 * Wrap a pg Client to tag all parameterized queries with a unique comment,
 * preventing type inference conflicts from node-postgres statement caching.
 */
function wrapClient(client) {
  const origQuery = client.query.bind(client);
  client.query = (sql, params) => {
    if (params && params.length > 0) {
      return origQuery(`/*_q${querySeq++}_*/${sql}`, params);
    }
    return origQuery(sql, params);
  };
  return client;
}

function getRequiredEnv(key) {
  const val = process.env[key];
  const trimmed = typeof val === 'string' ? val.replace(/^[\uFEFF\s]+|[\s\r]+$/g, '') : val;
  if (!trimmed) {
    throw new Error(`Environment variable ${key} is not set. Check .env.local`);
  }
  return trimmed;
}

/** Config of the ACTIVE pool — used by schema self-heal to connect identically
 *  (same host/credentials/SSL) as the working application connection. */
let activeDbConfig = null;

// Create database connection pool
function createPool() {
  activeDbConfig = {
    host: getRequiredEnv('DB_HOST'),
    port: parseInt(getRequiredEnv('DB_PORT'), 10),
    database: getRequiredEnv('DB_NAME'),
    user: getRequiredEnv('DB_USER'),
    password: getRequiredEnv('DB_PASSWORD'),
    // Neon / managed providers require SSL; local does not.
    ssl: /^true$/i.test(process.env.DB_SSL || '') || /neon\.tech/i.test(process.env.DB_HOST || ''),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };
  pool = new Pool({ ...activeDbConfig });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return pool;
}

// Expose the shared pool to other main-process modules (e.g. aiHandler.js)
export function getPool() {
  return pool;
}

// Initialize IPC handlers for DB operations
export function registerDatabaseHandlers() {
  if (!pool) createPool();

  // Test connection
  ipcMain.handle('db:ping', async () => {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as time, current_database() as db');
      client.release();
      return { success: true, time: result.rows[0].time, db: result.rows[0].db };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  const FORBIDDEN_SQL_PATTERNS = [
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bTRUNCATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bCREATE\b\s+(?:TABLE|INDEX|DATABASE|USER|ROLE|FUNCTION|PROCEDURE|TRIGGER|VIEW)\b/i,
    /\bINSERT\b\s+INTO\s+(?:pg_|information_schema)\./i,
    /\bDELETE\b\s+FROM\s+(?:pg_|information_schema)\./i,
  ];

  function isSqlAllowed(sql) {
    const trimmed = (sql || '').trim();
    if (!trimmed) return false;
    for (const pattern of FORBIDDEN_SQL_PATTERNS) {
      if (pattern.test(trimmed)) return false;
    }
    return true;
  }

  // Internal query handler (only accessible via _exec in preload, not exposed publicly)
  ipcMain.handle('db:internal-query', async (event, { sql, params, sessionToken }) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session) return { success: false, error: 'Authentication required' };
      if (!isSqlAllowed(sql)) {
        return { success: false, error: 'SQL operation not permitted' };
      }
      assertSqlAuthorized(session, sql, params || []);
      const result = await execQueryWithSelfHeal(pool, sql, params);
      return { success: true, rows: result.rows, rowCount: result.rowCount };
    } catch (err) {
      console.error('[DB] Query error:', err.message, '\nSQL:', sql, '\nParams:', JSON.stringify(params));
      return { success: false, error: err.message };
    }
  });

  // Internal transaction handler (array of { sql, params })
  ipcMain.handle('db:internal-transaction', async (event, { queries, sessionToken }) => {
    const session = getSession(event.sender.id, sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };

    // Run the whole batch on one client; on schema drift, roll back, heal
    // once, then retry the entire batch from scratch.
    const runBatch = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const { sql, params } of queries) {
          if (!isSqlAllowed(sql)) {
            await client.query('ROLLBACK');
            return { success: false, error: 'SQL operation not permitted in transaction' };
          }
          assertSqlAuthorized(session, sql, params || []);
          const res = await execQuery(client, sql, params);
          results.push({ rows: res.rows, rowCount: res.rowCount });
        }
        await client.query('COMMIT');
        return { success: true, results };
      } catch (err) {
        await client.query('ROLLBACK');
        err._inTransaction = true;
        throw err;
      } finally {
        client.release();
      }
    };

    try {
      return await runBatch();
    } catch (err) {
      console.error('[DB] Transaction error:', err.message);
      if (isSchemaDriftError(err)) {
        try {
          await healSchemaDriftOnce();
          return await runBatch(); // single retry after healing
        } catch (retryErr) {
          return { success: false, error: retryErr.message };
        }
      }
      return { success: false, error: err.message };
    }
  });

  // ── Typed RPC handlers ─────────────────────────────────────────────
  // Each `db:rpc:<name>` channel maps to a fixed SQL statement and a fixed
  // parameter count. The renderer sends a structured `payload` (typed by
  // TypeScript) and the main process composes the SQL — so SQL strings
  // never travel the wire. All existing module/table authorization,
  // cross-company checks, and SQL-pattern guards apply automatically.
  const registerRpc = (name, { compose, paramCount, validate, mapResult }) => {
    ipcMain.handle(`db:rpc:${name}`, async (event, payload = {}) => {
      const session = getSession(event.sender.id, payload.sessionToken);
      if (!session) return { success: false, error: 'Authentication required' };
      try {
        if (validate) validate(payload, session);
        const { sql, params } = compose(payload, session);
        // paramCount === null → dynamic parameter count (e.g. partial
        // UPDATE SET clauses). The SQL is still composed entirely in the
        // main process; only scalar values travel from the renderer, so
        // the no-SQL-on-the-wire guarantee holds.
        if (paramCount === null) {
          if (!Array.isArray(params)) {
            return { success: false, error: 'Expected params array' };
          }
        } else if (!Array.isArray(params) || params.length !== paramCount) {
          return { success: false, error: `Expected ${paramCount} parameter(s), got ${Array.isArray(params) ? params.length : 'non-array'}` };
        }
        if (!isSqlAllowed(sql)) return { success: false, error: 'SQL operation not permitted' };
        assertSqlAuthorized(session, sql, params);
        const result = await execQueryWithSelfHeal(pool, sql, params);
        // mapResult: post-process the rows for business-rule failures that
        // SQL alone can't express as errors (e.g. delete-guard references).
        const rows = mapResult ? mapResult(result.rows) : result.rows;
        return { success: true, rows, rowCount: result.rowCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
  };

  // accounting.getAccounts
  // `running_balance` = SUM of ALL posted JEs (opening JEs included) — the
  // single source of truth. `balance` stays as the legacy display column so
  // existing consumers keep working, but every UI that shows a financial
  // balance must read running_balance.
  registerRpc('accounting.getAccounts', {
    paramCount: 1,
    validate: (p) => { if (!p.companyId) throw new Error('companyId required'); },
    compose: (p) => ({
      sql: `SELECT a.*, COALESCE((SELECT SUM(je.debit - je.credit)
              FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id
              WHERE je.account_id = a.id AND t.company_id = a.company_id AND t.status = 'posted'), 0) AS running_balance
            FROM accounts a WHERE a.company_id = $1 ORDER BY a.code`,
      params: [p.companyId],
    }),
  });

  // accounting.createAccount
  registerRpc('accounting.createAccount', {
    paramCount: 9,
    validate: (p) => {
      if (!p.companyId) throw new Error('companyId required');
      if (!p.code || !p.nameAr) throw new Error('code and nameAr required');
    },
    compose: (p) => ({
      sql: `INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      params: [
        p.companyId,
        String(p.code || ''),
        String(p.nameAr || ''),
        String(p.nameEn || ''),
        p.parentId ?? null,
        String(p.type || 'asset'),
        String(p.nature || 'debit'),
        p.isGroup ? true : false,
        Number(p.balance || 0),
      ],
    }),
  });

  // accounting.getTransactions — uses json_agg so the renderer no longer
  // needs a second round-trip to fetch journal entries.
  registerRpc('accounting.getTransactions', {
    paramCount: 1,
    validate: (p) => { if (!p.companyId) throw new Error('companyId required'); },
    compose: (p) => ({
      sql: `SELECT t.*, COALESCE(json_agg(json_build_object(
              'id', je.id, 'transaction_id', je.transaction_id,
              'account_id', je.account_id, 'debit', je.debit, 'credit', je.credit,
              'memo', je.memo, 'account_name', a.name_ar, 'account_code', a.code)
              ORDER BY je.id) FILTER (WHERE je.id IS NOT NULL), '[]'::json) AS entries
            FROM transactions t
            LEFT JOIN journal_entries je ON je.transaction_id = t.id
            LEFT JOIN accounts a ON a.id = je.account_id
            WHERE t.company_id = $1
            GROUP BY t.id
            ORDER BY t.date DESC`,
      params: [p.companyId],
    }),
  });

  // accounting.createTransaction — composes the dynamic CTE + VALUES in
  // the main process so the renderer only sends structured data. The
  // paramCount varies with entry count, so this method opts out of the
  // static check via a special validator that returns the final params.
  ipcMain.handle('db:rpc:accounting.createTransaction', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    try {
      const data = payload.data || {};
      const entries = Array.isArray(data.entries) ? data.entries : [];
      if (entries.length === 0) return { success: false, error: 'No journal entries provided' };
      if (!data.companyId || !data.date) return { success: false, error: 'companyId and date required' };

      // Build CTE + VALUES in the main process — typed, parameterized.
      const params = [
        data.companyId, data.date, data.reference ?? null, data.description ?? null,
        Number(data.totalAmount || 0), data.status || 'posted',
      ];
      const entryValues = [];
      let i = 7;
      for (const entry of entries) {
        entryValues.push(`((SELECT id FROM new_tx), $${i}, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`);
        params.push(entry.accountId, Number(entry.debit || 0), Number(entry.credit || 0), entry.memo ?? null, data.companyId);
        i += 5;
      }
      const sql = `
        WITH new_tx AS (
          INSERT INTO transactions (company_id, date, reference, description, total_amount, status)
          VALUES ($1, $2::timestamptz, $3, $4, $5, $6)
          RETURNING id
        )
        INSERT INTO journal_entries (transaction_id, account_id, debit, credit, memo, company_id)
        VALUES ${entryValues.join(', ')}
        RETURNING transaction_id
      `;

      if (!isSqlAllowed(sql)) return { success: false, error: 'SQL operation not permitted' };
      assertSqlAuthorized(session, sql, params);
      const result = await execQuery(pool, sql, params);
      return { success: true, rows: result.rows, rowCount: result.rowCount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── inventory + contacts (Phase 4 slice 2) ─────────────────────────

  // inventory.getProducts — embeds category_ids via json_agg so the
  // renderer doesn't need a second round-trip.
  registerRpc('inventory.getProducts', {
    paramCount: 1,
    validate: (p) => { if (!p.companyId) throw new Error('companyId required'); },
    compose: (p) => ({
      sql: `SELECT p.*, COALESCE(
              (SELECT json_agg(ppc.category_id)
               FROM product_product_categories ppc
               WHERE ppc.product_id = p.id), '[]'::json
            ) AS category_ids
            FROM products p
            WHERE p.company_id = $1
            ORDER BY p.name_ar`,
      params: [p.companyId],
    }),
  });

  // inventory.createProduct — single INSERT, returns id. Multi-table
  // fan-out (product_product_categories rows) is handled by the caller
  // since it's truly dynamic and needs `ON CONFLICT DO NOTHING`.
  registerRpc('inventory.createProduct', {
    paramCount: 14,
    validate: (p) => {
      if (!p.companyId) throw new Error('companyId required');
      if (!p.code || !p.nameAr) throw new Error('code and nameAr required');
    },
    compose: (p) => ({
      sql: `INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      params: [
        p.companyId,
        String(p.code || ''),
        String(p.nameAr || ''),
        String(p.nameEn || ''),
        p.barcode ?? null,
        p.sku ?? null,
        p.unit ?? null,
        p.categoryId ?? null,
        p.productTypeId ?? null,
        Number(p.costPrice || 0),
        Number(p.salePrice || 0),
        p.isActive === false ? false : true,
        p.createdBy ?? null,
        p.updatedBy ?? null,
      ],
    }),
  });

  // inventory.createProductCategories — fan-out handler for the m2m
  // join rows after `inventory.createProduct` returns an id.
  ipcMain.handle('db:rpc:inventory.createProductCategories', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    try {
      const productId = String(payload.productId || '');
      const categoryIds = Array.isArray(payload.categoryIds) ? payload.categoryIds.map(String) : [];
      if (!productId) return { success: false, error: 'productId required' };
      if (categoryIds.length === 0) return { success: true, rows: [], rowCount: 0 };
      const placeholders = categoryIds.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
      const params = categoryIds.flatMap((cid) => [productId, cid]);
      const sql = `INSERT INTO product_product_categories (product_id, category_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
      if (!isSqlAllowed(sql)) return { success: false, error: 'SQL operation not permitted' };
      assertSqlAuthorized(session, sql, params);
      const result = await execQuery(pool, sql, params);
      return { success: true, rows: result.rows, rowCount: result.rowCount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // contacts.getCustomers
  registerRpc('contacts.getCustomers', {
    paramCount: 1,
    validate: (p) => { if (!p.companyId) throw new Error('companyId required'); },
    compose: (p) => ({
      sql: `SELECT id, company_id, 'customer' AS type, name, phone, email, address,
            tax_number, balance, is_active, created_at, updated_at
            FROM customers WHERE company_id = $1 ORDER BY name`,
      params: [p.companyId],
    }),
  });

  // contacts.getSuppliers
  registerRpc('contacts.getSuppliers', {
    paramCount: 1,
    validate: (p) => { if (!p.companyId) throw new Error('companyId required'); },
    compose: (p) => ({
      sql: `SELECT id, company_id, 'supplier' AS type, name, phone, email, address,
            tax_number, balance, is_active, created_at, updated_at
            FROM suppliers WHERE company_id = $1 ORDER BY name`,
      params: [p.companyId],
    }),
  });

  // contacts.createCustomer
  registerRpc('contacts.createCustomer', {
    paramCount: 8,
    validate: (p) => {
      if (!p.companyId) throw new Error('companyId required');
      if (!p.name) throw new Error('name required');
    },
    compose: (p) => ({
      sql: `INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, balance)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      params: [
        p.companyId,
        p.code ?? null,
        String(p.name || ''),
        p.phone ?? null,
        p.email ?? null,
        p.address ?? null,
        p.taxNumber ?? null,
        Number(p.balance || 0),
      ],
    }),
  });

  // contacts.createSupplier
  registerRpc('contacts.createSupplier', {
    paramCount: 8,
    validate: (p) => {
      if (!p.companyId) throw new Error('companyId required');
      if (!p.name) throw new Error('name required');
    },
    compose: (p) => ({
      sql: `INSERT INTO suppliers (company_id, code, name, phone, email, address, tax_number, balance)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      params: [
        p.companyId,
        p.code ?? null,
        String(p.name || ''),
        p.phone ?? null,
        p.email ?? null,
        p.address ?? null,
        p.taxNumber ?? null,
        Number(p.balance || 0),
      ],
    }),
  });

  // ── core company (Phase 4 slice 3) ─────────────────────────────────
  // Both handlers derive the company id from the authenticated session,
  // not from the renderer payload — closing the cross-tenant read/update
  // gap of the legacy `SELECT * FROM companies LIMIT 1` / `WHERE id = $1`
  // statements. The renderer can never reference another company's row.

  // core.getCompany — zero-param; id comes from the session.
  registerRpc('core.getCompany', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: 'SELECT * FROM companies WHERE id = $1',
      params: [session.user.companyId],
    }),
  });

  // core.updateCompany — payload carries only mutable profile fields;
  // the WHERE clause uses the session company id (payload.id is ignored)
  // and `updated_by` is derived from the session (renderer value ignored).
  registerRpc('core.updateCompany', {
    paramCount: 9,
    validate: (p) => {
      if (!p.name) throw new Error('name required');
    },
    compose: (p, session) => ({
      sql: `UPDATE companies SET name = $1, name_en = $2, currency = $3, tax_number = $4, address = $5, phone = $6, email = $7, updated_by = $8, updated_at = NOW() WHERE id = $9::uuid`,
      params: [
        String(p.name || ''),
        p.nameEn ?? null,
        p.currency ?? null,
        p.taxNumber ?? null,
        p.address ?? null,
        p.phone ?? null,
        p.email ?? null,
        session.user.id,
        session.user.companyId,
      ],
    }),
  });

  // ── core settings (Phase 4 slice 6) ───────────────────────────────────
  // All settings queries derive `company_id` from the authenticated session
  // rather than the renderer payload — closing cross-tenant gaps for the
  // currencies, vat_settings, branches, and settings tables. Audit columns
  // (`created_by`/`updated_by`) are likewise session-derived.

  // core.getCurrencies
  registerRpc('core.getCurrencies', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: 'SELECT * FROM currencies WHERE company_id = $1 AND is_active = true ORDER BY is_default DESC, code',
      params: [session.user.companyId],
    }),
  });

  // core.createCurrency
  registerRpc('core.createCurrency', {
    paramCount: 7,
    validate: (p) => {
      if (!p.code || !p.name) throw new Error('code and name required');
    },
    compose: (p, session) => ({
      sql: `INSERT INTO currencies (company_id, code, name, symbol, exchange_rate, is_default, is_active, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7) RETURNING id`,
      params: [
        session.user.companyId,
        String(p.code),
        String(p.name),
        p.symbol ?? null,
        Number(p.exchangeRate ?? 0),
        Boolean(p.isDefault ?? false),
        session.user.id,
      ],
    }),
  });

  // core.updateCurrency
  registerRpc('core.updateCurrency', {
    paramCount: 9,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
    compose: (p, session) => ({
      sql: `UPDATE currencies SET code = $1, name = $2, symbol = $3, exchange_rate = $4, is_default = $5, is_active = $6, updated_by = $7, updated_at = NOW() WHERE id = $8 AND company_id = $9`,
      params: [
        p.code ?? null,
        p.name ?? null,
        p.symbol ?? null,
        p.exchangeRate != null ? Number(p.exchangeRate) : null,
        p.isDefault ?? null,
        p.isActive ?? null,
        session.user.id,
        String(p.id),
        session.user.companyId,
      ],
    }),
  });

  // core.getVatSettings
  registerRpc('core.getVatSettings', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: 'SELECT * FROM vat_settings WHERE company_id = $1 LIMIT 1',
      params: [session.user.companyId],
    }),
  });

  // core.updateVatSettings
  registerRpc('core.updateVatSettings', {
    paramCount: 7,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
    compose: (p, session) => ({
      sql: `UPDATE vat_settings SET vat_rate = $1, vat_number = $2, is_inclusive = $3, is_active = $4, updated_by = $5, updated_at = NOW() WHERE id = $6 AND company_id = $7`,
      params: [
        p.vatRate != null ? Number(p.vatRate) : null,
        p.vatNumber ?? null,
        p.isInclusive ?? null,
        p.isActive ?? null,
        session.user.id,
        String(p.id),
        session.user.companyId,
      ],
    }),
  });

  // core.getBranches
  registerRpc('core.getBranches', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: 'SELECT * FROM branches WHERE company_id = $1 AND is_active = true ORDER BY name',
      params: [session.user.companyId],
    }),
  });

  // core.createBranch
  registerRpc('core.createBranch', {
    paramCount: 5,
    validate: (p) => {
      if (!p.name) throw new Error('name required');
    },
    compose: (p, session) => ({
      sql: `INSERT INTO branches (company_id, name, code, address, is_active, created_by, updated_by)
            VALUES ($1, $2, $3, $4, true, $5, $5) RETURNING id`,
      params: [
        session.user.companyId,
        String(p.name),
        p.code ?? null,
        p.address ?? null,
        session.user.id,
      ],
    }),
  });

  // core.updateBranch
  registerRpc('core.updateBranch', {
    paramCount: 7,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
    compose: (p, session) => ({
      sql: `UPDATE branches SET name = $1, code = $2, address = $3, is_active = $4, updated_by = $5, updated_at = NOW() WHERE id = $6 AND company_id = $7`,
      params: [
        p.name ?? null,
        p.code ?? null,
        p.address ?? null,
        p.isActive ?? null,
        session.user.id,
        String(p.id),
        session.user.companyId,
      ],
    }),
  });

  // core.getSettings
  registerRpc('core.getSettings', {
    paramCount: null, // 1 or 2 params depending on category filter
    compose: (p, session) => {
      if (p.category) {
        return {
          sql: 'SELECT * FROM settings WHERE company_id = $1 AND category = $2 ORDER BY key',
          params: [session.user.companyId, String(p.category)],
        };
      }
      return {
        sql: 'SELECT * FROM settings WHERE company_id = $1 ORDER BY key',
        params: [session.user.companyId],
      };
    },
  });

  // core.setSetting
  registerRpc('core.setSetting', {
    paramCount: 4,
    validate: (p) => {
      if (!p.key) throw new Error('key required');
    },
    compose: (p, session) => ({
      sql: `INSERT INTO settings (company_id, key, value, category)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      params: [
        session.user.companyId,
        String(p.key),
        p.value ?? null,
        p.category ?? null,
      ],
    }),
  });

  // ── crm (Phase 4 slice 7) ────────────────────────────────────────────────
  // All CRM queries derive `company_id` from the authenticated session.
  // The renderer payload carries only the editable fields + filters.
  // Paginated queries use the `($N::type IS NULL OR col = $N)` pattern so
  // the SQL statement is fixed (paramCount matches) regardless of which
  // optional filters the caller passes. Filters are normalised to NULL
  // (not undefined, not empty string) so the `IS NULL` branch fires when
  // the caller omitted them.

  const TEXT_FILTER = (s) => (typeof s === 'string' && s.trim() !== '' ? `%${s.trim()}%` : null);
  const UUID_FILTER = (s) => (typeof s === 'string' && /^[0-9a-fA-F]{8}-/.test(s) ? s : null);

  // ── Leads ──

  // crm.getLeads
  registerRpc('crm.getLeads', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT l.*, u.full_name as assigned_name
              FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
             WHERE l.company_id = $1
             ORDER BY l.created_at DESC`,
      params: [session.user.companyId],
    }),
  });

  // crm.getLeadsPaginated — 6 params (company, status, assignedTo, search, pageSize, offset)
  registerRpc('crm.getLeadsPaginated', {
    paramCount: 6,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      const search = TEXT_FILTER(p.search);
      const status = typeof p.status === 'string' && p.status ? p.status : null;
      const assignedTo = UUID_FILTER(p.assignedTo);
      return {
        sql: `SELECT l.*, u.full_name as assigned_name,
                     COUNT(*) OVER() AS total_count
                FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
               WHERE l.company_id = $1
                 AND ($2::text IS NULL OR l.status = $2)
                 AND ($3::uuid IS NULL OR l.assigned_to = $3)
                 AND ($4::text IS NULL OR l.name ILIKE $4 OR l.email ILIKE $4 OR l.phone ILIKE $4)
               ORDER BY l.created_at DESC
               LIMIT $5 OFFSET $6`,
        params: [session.user.companyId, status, assignedTo, search, limit, offset],
      };
    },
  });

  // crm.getLeadById
  registerRpc('crm.getLeadById', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: `SELECT l.*, u.full_name as assigned_name
              FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
             WHERE l.id = $1 AND l.company_id = $2
             LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
  });

  // crm.createLead — 12 cols (company, name, phone, email, company_name, source, status, rating, value, assignedTo, notes, created_by)
  registerRpc('crm.createLead', {
    paramCount: 12,
    validate: (p) => { if (!p.name) throw new Error('name required'); },
    compose: (p, session) => ({
      sql: `INSERT INTO leads (company_id, name, phone, email, company, source, status, rating, estimated_value, assigned_to, notes, created_at, created_by, updated_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11, NOW(), $12::uuid, $12::uuid)
            RETURNING id`,
      params: [
        session.user.companyId,
        String(p.name),
        p.phone || null,
        p.email || null,
        p.company || null,
        p.source || null,
        p.status || 'new',
        p.rating || 'warm',
        p.estimatedValue != null ? Number(p.estimatedValue) : null,
        UUID_FILTER(p.assignedTo),
        p.notes || null,
        session.user.id,
      ],
    }),
  });

  // crm.updateLead — dynamic SET via composable SQL. `updated_by` always appended.
  registerRpc('crm.updateLead', {
    paramCount: null, // dynamic
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => {
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.name !== undefined) { fields.push(`name = $${idx++}`); values.push(p.name); }
      if (p.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(p.phone || null); }
      if (p.email !== undefined) { fields.push(`email = $${idx++}`); values.push(p.email || null); }
      if (p.company !== undefined) { fields.push(`company = $${idx++}`); values.push(p.company || null); }
      if (p.source !== undefined) { fields.push(`source = $${idx++}`); values.push(p.source || null); }
      if (p.status !== undefined) { fields.push(`status = $${idx++}`); values.push(p.status); }
      if (p.rating !== undefined) { fields.push(`rating = $${idx++}`); values.push(p.rating); }
      if (p.estimatedValue !== undefined) { fields.push(`estimated_value = $${idx++}`); values.push(p.estimatedValue != null ? Number(p.estimatedValue) : null); }
      if (p.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(UUID_FILTER(p.assignedTo)); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes || null); }
      fields.push(`updated_by = $${idx++}`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx;
      values.push(String(p.id));
      const cidIdx = idx + 1;
      values.push(session.user.companyId);
      const sql = `UPDATE leads SET ${fields.join(', ')} WHERE id = $${whereIdx}::uuid AND company_id = $${cidIdx}::uuid`;
      return { sql, params: values };
    },
  });

  // crm.deleteLead — protected: rejects when the lead still has opportunities,
  // tasks or activities referencing it (accidental history loss guard).
  registerRpc('crm.deleteLead', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: `WITH refs AS (
              SELECT
                (SELECT COUNT(*)::int FROM opportunities WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS opps,
                (SELECT COUNT(*)::int FROM tasks WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS tasks,
                (SELECT COUNT(*)::int FROM activities WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS acts
            ),
            del AS (
              DELETE FROM leads
               WHERE id = $1::uuid AND company_id = $2::uuid
                 AND (SELECT opps FROM refs) = 0
                 AND (SELECT tasks FROM refs) = 0
                 AND (SELECT acts FROM refs) = 0
              RETURNING id
            )
            SELECT (SELECT opps FROM refs) AS opps,
                   (SELECT tasks FROM refs) AS tasks,
                   (SELECT acts FROM refs) AS acts,
                   (SELECT COUNT(*)::int FROM del) AS deleted`,
      params: [String(p.id), session.user.companyId],
    }),
    mapResult: (rows) => {
      const r = rows && rows[0];
      if (r && Number(r.deleted) === 0) {
        throw new Error(
          `لا يمكن حذف العميل المحتمل: لديه ${r.opps} فرصة و ${r.tasks} مهمة و ${r.acts} نشاط مرتبطة. احذف المراجع أولاً.`
        );
      }
      return rows;
    },
  });

  // crm.convertLeadToCustomer — single atomic CTE. The renderer generates the
  // customer code via document_sequences (unified mechanism across UI/AI)
  // and passes the lead's contact fields it already loaded from getLeadById.
  // The CTE INSERTs a customer referencing them, then UPDATEs the lead status
  // to 'converted', and (optionally) creates a first opportunity — all or
  // nothing.
  registerRpc('crm.convertLeadToCustomer', {
    paramCount: 12,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
      if (!p.name) throw new Error('name required');
    },
    compose: (p, session) => ({
      sql: `WITH lead_check AS (
              SELECT id, name, phone, email, estimated_value, assigned_to
                FROM leads
               WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'converted'
               LIMIT 1
            ),
            new_customer AS (
              INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, credit_limit, balance, is_active, created_by, updated_by)
              SELECT $2::uuid, $3, $4, $5, $6, $7, $8, $9, 0, true, $12::uuid, $12::uuid
                FROM lead_check
              RETURNING id
            ),
            updated_lead AS (
              UPDATE leads SET status = 'converted', updated_by = $12::uuid, updated_at = NOW()
               WHERE id = $1::uuid AND company_id = $2::uuid
                 AND EXISTS (SELECT 1 FROM lead_check)
              RETURNING id
            ),
            new_opportunity AS (
              INSERT INTO opportunities (company_id, lead_id, customer_id, name, value, stage, probability, assigned_to, created_at, created_by, updated_by)
              SELECT $2::uuid, $1::uuid, nc.id,
                     'فرصة ' || lc.name,
                     COALESCE(lc.estimated_value, 0),
                     'new', 50, lc.assigned_to, NOW(), $12::uuid, $12::uuid
                FROM lead_check lc CROSS JOIN new_customer nc
               WHERE $11::boolean
              RETURNING id
            )
            SELECT nc.id, (SELECT id FROM new_opportunity) AS opportunity_id
              FROM new_customer nc, updated_lead`,
      params: [
        String(p.id),
        session.user.companyId,
        p.customerCode || null,
        String(p.name),
        p.phone || null,
        p.email || null,
        p.address || null,
        p.taxNumber || null,
        p.creditLimit != null ? Number(p.creditLimit) : 0,
        null,
        p.createOpportunity === true,
        session.user.id,
      ],
    }),
  });

  // ── Opportunities ──

  // crm.getOpportunityById — used by the stage-machine guard + AI tools.
  registerRpc('crm.getOpportunityById', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: `SELECT o.*, u.full_name as assigned_name
              FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id
             WHERE o.id = $1::uuid AND o.company_id = $2::uuid
             LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
  });

  // crm.getOpportunities
  registerRpc('crm.getOpportunities', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT o.*, u.full_name as assigned_name
              FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id
             WHERE o.company_id = $1
             ORDER BY o.created_at DESC`,
      params: [session.user.companyId],
    }),
  });

  // crm.getOpportunitiesPaginated
  registerRpc('crm.getOpportunitiesPaginated', {
    paramCount: 6,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      const search = TEXT_FILTER(p.search);
      const stage = typeof p.stage === 'string' && p.stage ? p.stage : null;
      const assignedTo = UUID_FILTER(p.assignedTo);
      return {
        sql: `SELECT o.*, u.full_name as assigned_name,
                     COUNT(*) OVER() AS total_count
                FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id
               WHERE o.company_id = $1
                 AND ($2::text IS NULL OR o.stage = $2)
                 AND ($3::uuid IS NULL OR o.assigned_to = $3)
                 AND ($4::text IS NULL OR o.name ILIKE $4)
               ORDER BY o.created_at DESC
               LIMIT $5 OFFSET $6`,
        params: [session.user.companyId, stage, assignedTo, search, limit, offset],
      };
    },
  });

  // crm.createOpportunity — 12 cols (company, lead, customer, name, value, stage, probability, expectedDate, assignedTo, notes, created_at, created_by)
  registerRpc('crm.createOpportunity', {
    paramCount: 11,
    validate: (p) => { if (!p.name) throw new Error('name required'); },
    compose: (p, session) => ({
      sql: `INSERT INTO opportunities (company_id, lead_id, customer_id, name, value, stage, probability, expected_close_date, assigned_to, notes, created_at, created_by, updated_by)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid, $10, NOW(), $11::uuid, $11::uuid)
            RETURNING id`,
      params: [
        session.user.companyId,
        UUID_FILTER(p.leadId),
        UUID_FILTER(p.customerId),
        String(p.name),
        Number(p.value || 0),
        p.stage || 'new',
        p.probability != null ? Number(p.probability) : null,
        p.expectedCloseDate || null,
        UUID_FILTER(p.assignedTo),
        p.notes || null,
        session.user.id,
      ],
    }),
  });

  // crm.updateOpportunity — dynamic SET. The stage-machine legality check
  // happens in the renderer API layer (crm/api.ts) via getOpportunityById
  // BEFORE the RPC call — same rule for UI and AI. The SQL below only
  // implements the mechanical side-effects: reaching won/lost stamps
  // close_date + probability (100/0). Defense-in-depth: terminal stages
  // can never move (the CASE keeps the old stage when the request tries).
  registerRpc('crm.updateOpportunity', {
    paramCount: null,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => {
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.name !== undefined) { fields.push(`name = $${idx++}`); values.push(p.name); }
      if (p.value !== undefined) { fields.push(`value = $${idx++}`); values.push(Number(p.value)); }
      if (p.stage !== undefined) {
        const stageIdx = idx++;
        fields.push(`stage = CASE
            WHEN o.stage IN ('won', 'lost') THEN o.stage
            WHEN $${stageIdx}::text = 'won' OR $${stageIdx}::text = 'lost' THEN $${stageIdx}::text
            ELSE $${stageIdx}::text
          END`);
        values.push(String(p.stage));
        fields.push(`close_date = CASE
            WHEN o.stage IN ('won', 'lost') THEN o.close_date
            WHEN $${stageIdx}::text IN ('won', 'lost') THEN CURRENT_DATE
            ELSE o.close_date
          END`);
        fields.push(`probability = CASE
            WHEN o.stage IN ('won', 'lost') THEN o.probability
            WHEN $${stageIdx}::text = 'won' THEN 100
            WHEN $${stageIdx}::text = 'lost' THEN 0
            WHEN o.stage = $${stageIdx}::text AND $${idx}::int IS NOT NULL THEN $${idx}::int
            WHEN o.stage = $${stageIdx}::text THEN o.probability
            ELSE $${idx}::int
          END`);
        values.push(p.probability != null ? Number(p.probability) : null);
      } else if (p.probability !== undefined) {
        fields.push(`probability = $${idx++}::int`);
        values.push(p.probability != null ? Number(p.probability) : null);
      }
      if (p.expectedCloseDate !== undefined) { fields.push(`expected_close_date = $${idx++}`); values.push(p.expectedCloseDate || null); }
      if (p.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(UUID_FILTER(p.leadId)); }
      if (p.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(UUID_FILTER(p.customerId)); }
      if (p.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(UUID_FILTER(p.assignedTo)); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes || null); }
      fields.push(`updated_by = $${idx++}::uuid`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx; values.push(String(p.id));
      const cidIdx = idx + 1; values.push(session.user.companyId);
      const sql = `UPDATE opportunities o SET ${fields.join(', ')}
                     WHERE o.id = $${whereIdx}::uuid AND o.company_id = $${cidIdx}::uuid
                RETURNING o.stage, o.close_date`;
      return { sql, params: values };
    },
  });

  // crm.deleteOpportunity
  registerRpc('crm.deleteOpportunity', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM opportunities WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // ── Tasks ──

  // crm.getTasks
  registerRpc('crm.getTasks', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT t.*, u.full_name as assigned_name
              FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
             WHERE t.company_id = $1
             ORDER BY t.due_date ASC`,
      params: [session.user.companyId],
    }),
  });

  // crm.getTasksPaginated
  registerRpc('crm.getTasksPaginated', {
    paramCount: 6,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      const search = TEXT_FILTER(p.search);
      const status = typeof p.status === 'string' && p.status ? p.status : null;
      const priority = typeof p.priority === 'string' && p.priority ? p.priority : null;
      return {
        sql: `SELECT t.*, u.full_name as assigned_name,
                     COUNT(*) OVER() AS total_count
                FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
               WHERE t.company_id = $1
                 AND ($2::text IS NULL OR t.status = $2)
                 AND ($3::text IS NULL OR t.priority = $3)
                 AND ($4::text IS NULL OR t.title ILIKE $4 OR t.description ILIKE $4)
               ORDER BY t.due_date ASC
               LIMIT $5 OFFSET $6`,
        params: [session.user.companyId, status, priority, search, limit, offset],
      };
    },
  });

  // crm.createTask — 12 cols
  registerRpc('crm.createTask', {
    paramCount: 11,
    validate: (p) => { if (!p.title) throw new Error('title required'); },
    compose: (p, session) => ({
      sql: `INSERT INTO tasks (company_id, opportunity_id, lead_id, customer_id, title, description, due_date, priority, status, assigned_to, created_at, created_by, updated_by)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::date, $8, $9, $10::uuid, NOW(), $11::uuid, $11::uuid)
            RETURNING id`,
      params: [
        session.user.companyId,
        UUID_FILTER(p.opportunityId),
        UUID_FILTER(p.leadId),
        UUID_FILTER(p.customerId),
        String(p.title),
        p.description || null,
        p.dueDate || null,
        p.priority || 'medium',
        p.status || 'pending',
        UUID_FILTER(p.assignedTo),
        session.user.id,
      ],
    }),
  });

  // crm.updateTask — dynamic SET
  registerRpc('crm.updateTask', {
    paramCount: null,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => {
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.title !== undefined) { fields.push(`title = $${idx++}`); values.push(p.title); }
      if (p.description !== undefined) { fields.push(`description = $${idx++}`); values.push(p.description || null); }
      if (p.dueDate !== undefined) { fields.push(`due_date = $${idx++}`); values.push(p.dueDate || null); }
      if (p.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(p.priority); }
      if (p.status !== undefined) { fields.push(`status = $${idx++}`); values.push(p.status); }
      if (p.opportunityId !== undefined) { fields.push(`opportunity_id = $${idx++}`); values.push(UUID_FILTER(p.opportunityId)); }
      if (p.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(UUID_FILTER(p.leadId)); }
      if (p.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(UUID_FILTER(p.customerId)); }
      if (p.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(UUID_FILTER(p.assignedTo)); }
      fields.push(`updated_by = $${idx++}`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx; values.push(String(p.id));
      const cidIdx = idx + 1; values.push(session.user.companyId);
      const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${whereIdx}::uuid AND company_id = $${cidIdx}::uuid`;
      return { sql, params: values };
    },
  });

  // crm.deleteTask
  registerRpc('crm.deleteTask', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM tasks WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // ── Activities ──

  // crm.getActivities
  registerRpc('crm.getActivities', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT a.*, u.full_name as assigned_name
              FROM activities a LEFT JOIN users u ON a.assigned_to = u.id
             WHERE a.company_id = $1
             ORDER BY a.activity_date DESC`,
      params: [session.user.companyId],
    }),
  });

  // crm.getActivitiesPaginated
  registerRpc('crm.getActivitiesPaginated', {
    paramCount: 6,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      const type = typeof p.type === 'string' && p.type ? p.type : null;
      const assignedTo = UUID_FILTER(p.assignedTo);
      const search = TEXT_FILTER(p.search);
      return {
        sql: `SELECT a.*, u.full_name as assigned_name,
                     COUNT(*) OVER() AS total_count
                FROM activities a LEFT JOIN users u ON a.assigned_to = u.id
               WHERE a.company_id = $1
                 AND ($2::text IS NULL OR a.type = $2)
                 AND ($3::uuid IS NULL OR a.assigned_to = $3)
                 AND ($4::text IS NULL OR a.subject ILIKE $4)
               ORDER BY a.activity_date DESC
               LIMIT $5 OFFSET $6`,
        params: [session.user.companyId, type, assignedTo, search, limit, offset],
      };
    },
  });

  // crm.createActivity — CTE: INSERT activity + atomically stamp lead last_contacted_at
  registerRpc('crm.createActivity', {
    paramCount: 11,
    validate: (p) => {
      if (!p.type) throw new Error('type required');
      if (!p.subject) throw new Error('subject required');
    },
    compose: (p, session) => ({
      sql: `WITH new_activity AS (
              INSERT INTO activities (company_id, lead_id, opportunity_id, customer_id, type, subject, description, activity_date, duration_minutes, assigned_to, created_at, created_by, updated_by)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::uuid, NOW(), $11::uuid, $11::uuid)
              RETURNING id
            ),
            touched_lead AS (
              UPDATE leads SET last_contacted_at = $8, updated_at = NOW()
               WHERE id = $2::uuid AND company_id = $1::uuid
              RETURNING id
            )
            SELECT id FROM new_activity`,
      params: [
        session.user.companyId,
        UUID_FILTER(p.leadId),
        UUID_FILTER(p.opportunityId),
        UUID_FILTER(p.customerId),
        String(p.type),
        String(p.subject),
        p.description || null,
        p.activityDate || null,
        p.durationMinutes != null ? Number(p.durationMinutes) : null,
        UUID_FILTER(p.assignedTo),
        session.user.id,
      ],
    }),
  });

  // crm.updateActivity — dynamic SET
  registerRpc('crm.updateActivity', {
    paramCount: null,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => {
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.type !== undefined) { fields.push(`type = $${idx++}`); values.push(p.type); }
      if (p.subject !== undefined) { fields.push(`subject = $${idx++}`); values.push(p.subject); }
      if (p.description !== undefined) { fields.push(`description = $${idx++}`); values.push(p.description || null); }
      if (p.activityDate !== undefined) { fields.push(`activity_date = $${idx++}`); values.push(p.activityDate || null); }
      if (p.durationMinutes !== undefined) { fields.push(`duration_minutes = $${idx++}`); values.push(p.durationMinutes != null ? Number(p.durationMinutes) : null); }
      if (p.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(UUID_FILTER(p.leadId)); }
      if (p.opportunityId !== undefined) { fields.push(`opportunity_id = $${idx++}`); values.push(UUID_FILTER(p.opportunityId)); }
      if (p.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(UUID_FILTER(p.customerId)); }
      if (p.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(UUID_FILTER(p.assignedTo)); }
      fields.push(`updated_by = $${idx++}`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx; values.push(String(p.id));
      const cidIdx = idx + 1; values.push(session.user.companyId);
      const sql = `UPDATE activities SET ${fields.join(', ')} WHERE id = $${whereIdx}::uuid AND company_id = $${cidIdx}::uuid`;
      return { sql, params: values };
    },
  });

  // crm.deleteActivity
  registerRpc('crm.deleteActivity', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM activities WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // ── manufacturing (Phase 4 slice 8) ─────────────────────────────────────
  // All manufacturing queries derive `company_id` + audit `user_id` from the
  // authenticated session. Paginated queries use the `($N::type IS NULL OR
  // col = $N)` pattern so the SQL statement is fixed; omitted filters are
  // normalised to NULL so the `IS NULL` branch fires.
  const WO_STATUSES = new Set(['planned', 'in_progress', 'completed', 'cancelled']);

  // manufacturing.getBoms
  registerRpc('manufacturing.getBoms', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: `SELECT b.*, p.name_ar AS product_name
              FROM boms b LEFT JOIN products p ON b.product_id = p.id
             WHERE b.company_id = $1
               AND ($2::uuid IS NULL OR (b.created_by = $2 OR b.created_by IS NULL))
             ORDER BY b.version DESC`,
      params: [session.user.companyId, UUID_FILTER(p.ownedByUserId)],
    }),
  });

  // manufacturing.getBomsPaginated — COUNT(*) OVER() for total, filters via NULL
  registerRpc('manufacturing.getBomsPaginated', {
    paramCount: 5,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      return {
        sql: `SELECT b.*, p.name_ar AS product_name,
                     (SELECT COUNT(*)::int FROM bom_lines bl WHERE bl.bom_id = b.id) AS lines_count,
                     COUNT(*) OVER() AS total_count
                FROM boms b LEFT JOIN products p ON b.product_id = p.id
               WHERE b.company_id = $1
                 AND ($2::text IS NULL OR p.name_ar ILIKE $2 OR b.version ILIKE $2)
                 AND ($3::boolean IS NULL OR b.is_active = $3)
               ORDER BY b.version DESC
               LIMIT $4 OFFSET $5`,
        params: [
          session.user.companyId,
          TEXT_FILTER(p.search),
          p.isActive === undefined ? null : Boolean(p.isActive),
          limit,
          offset,
        ],
      };
    },
  });

  // manufacturing.getBomById — lines embedded via json_agg (one round-trip)
  registerRpc('manufacturing.getBomById', {
    paramCount: 2,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => ({
      sql: `SELECT b.*, p.name_ar AS product_name,
                    COALESCE(json_agg(json_build_object(
                      'id', bl.id, 'bom_id', bl.bom_id, 'material_id', bl.material_id,
                      'material_name', bp.name_ar, 'quantity', bl.quantity,
                      'unit_cost', bl.unit_cost, 'total_cost', bl.total_cost
                    )) FILTER (WHERE bl.id IS NOT NULL), '[]'::json) AS lines
             FROM boms b
             LEFT JOIN products p ON b.product_id = p.id
             LEFT JOIN bom_lines bl ON bl.bom_id = b.id
             LEFT JOIN products bp ON bl.material_id = bp.id
            WHERE b.id = $1::uuid AND b.company_id = $2::uuid
            GROUP BY b.id, p.name_ar
            LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
  });

  // manufacturing.createBom — CTE inserts the BOM then its lines; the parent
  // id is composed in the main process from the structured payload.
  registerRpc('manufacturing.createBom', {
    paramCount: null,
    validate: (p) => { if (!p.productId || !p.version) throw new Error('productId and version required'); },
    compose: (p, session) => {
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const params = [
        session.user.companyId,
        p.productId,
        String(p.version),
        p.isActive !== false,
        p.outputQuantity != null ? Number(p.outputQuantity) : 1,
        p.totalCost != null ? Number(p.totalCost) : null,
        p.notes || null,
        session.user.id,
      ];
      let sql = `WITH bom AS (
        INSERT INTO boms (company_id, product_id, version, is_active, output_quantity, total_cost, notes, created_by)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::numeric, $6::numeric, $7, $8::uuid) RETURNING id
      )`;
      if (lines.length > 0) {
        const rowValues = [];
        let idx = 9;
        for (const line of lines) {
          const qty = Number(line.quantity || 0);
          const uc = line.unitCost != null ? Number(line.unitCost) : 0;
          rowValues.push(`($${idx}::uuid, $${idx + 1}::numeric, $${idx + 2}::numeric, $${idx + 3}::numeric)`);
          params.push(line.materialId, qty, uc, qty * uc);
          idx += 4;
        }
        sql += `, lines AS (
          INSERT INTO bom_lines (bom_id, material_id, quantity, unit_cost, total_cost)
          SELECT bom.id, v.material_id, v.quantity, v.unit_cost, v.total_cost
          FROM bom JOIN (VALUES ${rowValues.join(', ')}) v(material_id, quantity, unit_cost, total_cost) ON true
        )`;
      }
      sql += ' SELECT id FROM bom';
      return { sql, params };
    },
  });

  // manufacturing.deleteBom — bom_lines cascade from boms, so one DELETE suffices
  registerRpc('manufacturing.deleteBom', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM boms WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // ── Work Orders ──

  // manufacturing.getWorkOrders
  registerRpc('manufacturing.getWorkOrders', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: `SELECT w.*, p.name_ar AS product_name, e.full_name AS supervisor_name
              FROM work_orders w
              LEFT JOIN products p ON w.product_id = p.id
              LEFT JOIN employees e ON w.supervisor_id = e.id
             WHERE w.company_id = $1
               AND ($2::uuid IS NULL OR (w.created_by = $2 OR w.created_by IS NULL))
             ORDER BY w.order_number DESC`,
      params: [session.user.companyId, UUID_FILTER(p.ownedByUserId)],
    }),
  });

  // manufacturing.getWorkOrdersPaginated
  registerRpc('manufacturing.getWorkOrdersPaginated', {
    paramCount: 4,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      return {
        sql: `SELECT w.*, p.name_ar AS product_name, e.full_name AS supervisor_name, COUNT(*) OVER() AS total_count
                FROM work_orders w
                LEFT JOIN products p ON w.product_id = p.id
                LEFT JOIN employees e ON w.supervisor_id = e.id
               WHERE w.company_id = $1
                 AND ($2::text IS NULL OR w.status = $2)
               ORDER BY w.order_number DESC
               LIMIT $3 OFFSET $4`,
        params: [session.user.companyId, typeof p.status === 'string' && p.status ? p.status : null, limit, offset],
      };
    },
  });

  // manufacturing.getWorkOrderById — consumptions embedded via json_agg
  registerRpc('manufacturing.getWorkOrderById', {
    paramCount: 2,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => ({
      sql: `SELECT w.*, p.name_ar AS product_name, e.full_name AS supervisor_name,
                    COALESCE(json_agg(json_build_object(
                      'id', c.id, 'work_order_id', c.work_order_id, 'material_id', c.material_id,
                      'material_name', cp.name_ar, 'planned_quantity', c.planned_quantity,
                      'actual_quantity', c.actual_quantity, 'unit_cost', c.unit_cost,
                      'actual_unit_cost', c.actual_unit_cost
                    )) FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS lines
             FROM work_orders w
             LEFT JOIN products p ON w.product_id = p.id
             LEFT JOIN employees e ON w.supervisor_id = e.id
             LEFT JOIN work_order_consumptions c ON c.work_order_id = w.id
             LEFT JOIN products cp ON c.material_id = cp.id
            WHERE w.id = $1::uuid AND w.company_id = $2::uuid
            GROUP BY w.id, p.name_ar, e.full_name
            LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
  });

  // manufacturing.createWorkOrder — CTE inserts the order then consumptions.
  // batchNumber is generated in the API layer (shared by screens + AI agent).
  registerRpc('manufacturing.createWorkOrder', {
    paramCount: null,
    validate: (p) => { if (!p.orderNumber || !p.productId) throw new Error('orderNumber and productId required'); },
    compose: (p, session) => {
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const params = [
        session.user.companyId,
        String(p.orderNumber),
        p.productId,
        UUID_FILTER(p.bomId),
        Number(p.quantity || 0),
        WO_STATUSES.has(p.status) ? p.status : 'planned',
        p.plannedStartDate || null,
        p.plannedEndDate || null,
        p.totalCost != null ? Number(p.totalCost) : null,
        p.batchNumber || null,
        UUID_FILTER(p.supervisorId),
        JSON.stringify(Array.isArray(p.productionCosts) ? p.productionCosts : []),
        p.notes || null,
        session.user.id,
      ];
      let sql = `WITH wo AS (
        INSERT INTO work_orders (company_id, order_number, product_id, bom_id, quantity, status, planned_start_date, planned_end_date, total_cost, batch_number, supervisor_id, production_costs, notes, created_by)
        VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::numeric, $6, $7::date, $8::date, $9::numeric, $10, $11::uuid, $12::jsonb, $13, $14::uuid) RETURNING id
      )`;
      if (lines.length > 0) {
        const rowValues = [];
        let idx = 15;
        for (const line of lines) {
          rowValues.push(`($${idx}::uuid, $${idx + 1}::numeric, $${idx + 2}::numeric)`);
          params.push(line.materialId, Number(line.plannedQuantity || 0), line.unitCost != null ? Number(line.unitCost) : null);
          idx += 3;
        }
        sql += `, cons AS (
          INSERT INTO work_order_consumptions (work_order_id, material_id, planned_quantity, unit_cost)
          SELECT wo.id, v.material_id, v.planned_quantity, v.unit_cost
          FROM wo JOIN (VALUES ${rowValues.join(', ')}) v(material_id, planned_quantity, unit_cost) ON true
        )`;
      }
      sql += ' SELECT id FROM wo';
      return { sql, params };
    },
  });

  // manufacturing.deleteWorkOrder — consumptions cascade from work_orders
  registerRpc('manufacturing.deleteWorkOrder', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM work_orders WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // manufacturing.updateWorkOrderStatus was REMOVED from the RPC surface:
  // start/complete/cancel run through the renderer-side unified flow
  // (manufacturingApi.updateWorkOrderStatus → startWorkOrder / completeWorkOrder
  // / cancelWorkOrder) which handles stock upserts, WIP + GL posting and cost
  // rollup atomically via runTransaction. The old branching-CTE handler here
  // duplicated that logic and drifted (it wrote stock_movements without ever
  // updating stock quantities) — a single source of truth lives in the API.

  // manufacturing.batchUpdateConsumptions — single UPDATE joined to a VALUES
  // list, scoped to the session's company via the parent work order.
  registerRpc('manufacturing.batchUpdateConsumptions', {
    paramCount: null,
    validate: (p) => { if (!Array.isArray(p.consumptions) || p.consumptions.length === 0) throw new Error('consumptions required'); },
    compose: (p, session) => {
      const rowValues = [];
      const params = [];
      let idx = 1;
      for (const c of p.consumptions) {
        rowValues.push(`($${idx}::uuid, $${idx + 1}::numeric, $${idx + 2}::numeric)`);
        params.push(String(c.id), Number(c.actualQuantity || 0), Number(c.actualUnitCost || 0));
        idx += 3;
      }
      params.push(session.user.companyId);
      return {
        sql: `UPDATE work_order_consumptions AS woc
              SET actual_quantity = v.actual_quantity, actual_unit_cost = v.actual_unit_cost
              FROM (VALUES ${rowValues.join(', ')}) v(id, actual_quantity, actual_unit_cost)
              WHERE woc.id = v.id AND woc.work_order_id IN (SELECT id FROM work_orders WHERE company_id = $${idx}::uuid)`,
        params,
      };
    },
  });

  // manufacturing.updateConsumption — dynamic SET for actual quantity / cost
  registerRpc('manufacturing.updateConsumption', {
    paramCount: null,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => {
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.actualQuantity !== undefined) { fields.push(`actual_quantity = $${idx++}`); values.push(Number(p.actualQuantity)); }
      if (p.actualUnitCost !== undefined) { fields.push(`actual_unit_cost = $${idx++}`); values.push(Number(p.actualUnitCost)); }
      if (fields.length === 0) {
        return { sql: 'SELECT 1 FROM work_orders WHERE id = $1::uuid AND company_id = $2::uuid', params: [String(p.id), session.user.companyId] };
      }
      values.push(String(p.id));
      values.push(session.user.companyId);
      return {
        sql: `UPDATE work_order_consumptions SET ${fields.join(', ')}
              WHERE id = $${idx}::uuid AND work_order_id IN (SELECT id FROM work_orders WHERE company_id = $${idx + 1}::uuid)`,
        params: values,
      };
    },
  });

  // manufacturing.getManufacturingKpis — aggregate in one statement
  registerRpc('manufacturing.getManufacturingKpis', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'planned')::int AS active,
                   COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                   COALESCE(SUM(total_cost) FILTER (WHERE status = 'completed'), 0) AS total_cost
              FROM work_orders WHERE company_id = $1::uuid`,
      params: [session.user.companyId],
    }),
  });

  // manufacturing.updateBom — dynamic header SET + optional lines rebuild. The
  // two concerns must be atomic, so this runs as an explicit transaction with
  // SQL composed in the main process (renderer sends only the payload).
  ipcMain.handle('db:rpc:manufacturing.updateBom', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    const p = payload.data || {};
    if (!p.id) return { success: false, error: 'id required' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.productId !== undefined) { fields.push(`product_id = $${idx++}`); values.push(UUID_FILTER(p.productId)); }
      if (p.version !== undefined) { fields.push(`version = $${idx++}`); values.push(p.version); }
      if (p.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(Boolean(p.isActive)); }
      if (p.outputQuantity !== undefined) { fields.push(`output_quantity = $${idx++}`); values.push(Number(p.outputQuantity) || 1); }
      if (p.totalCost !== undefined) { fields.push(`total_cost = $${idx++}`); values.push(p.totalCost != null ? Number(p.totalCost) : null); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes || null); }
      fields.push(`updated_by = $${idx++}`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx; values.push(String(p.id));
      const cidIdx = idx + 1; values.push(session.user.companyId);
      const headerSql = `UPDATE boms SET ${fields.join(', ')} WHERE id = $${whereIdx}::uuid AND company_id = $${cidIdx}::uuid`;
      assertSqlAuthorized(session, headerSql, values);
      await execQuery(client, headerSql, values);

      if (Array.isArray(p.lines)) {
        const delSql = `DELETE FROM bom_lines WHERE bom_id = $1::uuid
                         AND EXISTS (SELECT 1 FROM boms WHERE id = $1::uuid AND company_id = $2::uuid)`;
        assertSqlAuthorized(session, delSql, [String(p.id), session.user.companyId]);
        await execQuery(client, delSql, [String(p.id), session.user.companyId]);
        if (p.lines.length > 0) {
          const rowValues = [];
          const lineParams = [];
          let li = 1;
          for (const line of p.lines) {
            const qty = Number(line.quantity || 0);
            const uc = line.unitCost != null ? Number(line.unitCost) : 0;
            rowValues.push(`($${li}::uuid, $${li + 1}::uuid, $${li + 2}::numeric, $${li + 3}::numeric, $${li + 4}::numeric)`);
            lineParams.push(String(p.id), line.materialId, qty, uc, qty * uc);
            li += 5;
          }
          const insSql = `INSERT INTO bom_lines (bom_id, material_id, quantity, unit_cost, total_cost) VALUES ${rowValues.join(', ')}`;
          assertSqlAuthorized(session, insSql, lineParams);
          await execQuery(client, insSql, lineParams);
        }
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      return { success: false, error: err.message };
    } finally {
      client.release();
    }
  });

  // manufacturing.updateWorkOrder — dynamic header SET + optional consumptions
  // rebuild, run atomically in a transaction (same pattern as updateBom).
  ipcMain.handle('db:rpc:manufacturing.updateWorkOrder', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    const p = payload.data || {};
    if (!p.id) return { success: false, error: 'id required' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.orderNumber !== undefined) { fields.push(`order_number = $${idx++}`); values.push(p.orderNumber); }
      if (p.productId !== undefined) { fields.push(`product_id = $${idx++}`); values.push(UUID_FILTER(p.productId)); }
      if (p.bomId !== undefined) { fields.push(`bom_id = $${idx++}`); values.push(UUID_FILTER(p.bomId)); }
      if (p.quantity !== undefined) { fields.push(`quantity = $${idx++}`); values.push(Number(p.quantity)); }
      if (p.producedQuantity !== undefined) { fields.push(`produced_quantity = $${idx++}`); values.push(Number(p.producedQuantity)); }
      if (p.status !== undefined) { fields.push(`status = $${idx++}`); values.push(WO_STATUSES.has(p.status) ? p.status : 'planned'); }
      if (p.plannedStartDate !== undefined) { fields.push(`planned_start_date = $${idx++}`); values.push(p.plannedStartDate || null); }
      if (p.plannedEndDate !== undefined) { fields.push(`planned_end_date = $${idx++}`); values.push(p.plannedEndDate || null); }
      if (p.actualStartDate !== undefined) { fields.push(`actual_start_date = $${idx++}`); values.push(p.actualStartDate || null); }
      if (p.actualEndDate !== undefined) { fields.push(`actual_end_date = $${idx++}`); values.push(p.actualEndDate || null); }
      if (p.totalCost !== undefined) { fields.push(`total_cost = $${idx++}`); values.push(p.totalCost != null ? Number(p.totalCost) : null); }
      if (p.batchNumber !== undefined) { fields.push(`batch_number = $${idx++}`); values.push(p.batchNumber || null); }
      if (p.supervisorId !== undefined) { fields.push(`supervisor_id = $${idx++}`); values.push(UUID_FILTER(p.supervisorId)); }
      if (p.productionCosts !== undefined) { fields.push(`production_costs = $${idx++}::jsonb`); values.push(JSON.stringify(Array.isArray(p.productionCosts) ? p.productionCosts : [])); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes || null); }
      fields.push(`updated_by = $${idx++}`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx; values.push(String(p.id));
      const cidIdx = idx + 1; values.push(session.user.companyId);
      const headerSql = `UPDATE work_orders SET ${fields.join(', ')} WHERE id = $${whereIdx}::uuid AND company_id = $${cidIdx}::uuid`;
      assertSqlAuthorized(session, headerSql, values);
      await execQuery(client, headerSql, values);

      if (Array.isArray(p.lines)) {
        const delSql = `DELETE FROM work_order_consumptions WHERE work_order_id = $1::uuid
                         AND EXISTS (SELECT 1 FROM work_orders WHERE id = $1::uuid AND company_id = $2::uuid)`;
        assertSqlAuthorized(session, delSql, [String(p.id), session.user.companyId]);
        await execQuery(client, delSql, [String(p.id), session.user.companyId]);
        if (p.lines.length > 0) {
          const rowValues = [];
          const lineParams = [];
          let li = 1;
          for (const line of p.lines) {
            rowValues.push(`($${li}::uuid, $${li + 1}::uuid, $${li + 2}::numeric, $${li + 3}::numeric, $${li + 4}::numeric, $${li + 5}::numeric)`);
            lineParams.push(
              String(p.id),
              line.materialId,
              Number(line.plannedQuantity || 0),
              line.actualQuantity != null ? Number(line.actualQuantity) : null,
              line.unitCost != null ? Number(line.unitCost) : null,
              line.actualUnitCost != null ? Number(line.actualUnitCost) : null
            );
            li += 6;
          }
          const insSql = `INSERT INTO work_order_consumptions (work_order_id, material_id, planned_quantity, actual_quantity, unit_cost, actual_unit_cost) VALUES ${rowValues.join(', ')}`;
          assertSqlAuthorized(session, insSql, lineParams);
          await execQuery(client, insSql, lineParams);
        }
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      return { success: false, error: err.message };
    } finally {
      client.release();
    }
  });

  // ── hr (Phase 4 slice 9) ──────────────────────────────────────────────────
  // All HR queries derive `company_id` + audit `user_id` from the session.
  // NOTE: the live schema (base + migrations) has NO `updated_at` column on
  // `attendance`, `leaves` or `payroll_runs` — handlers deliberately omit it
  // (the legacy direct-SQL path set it and would have crashed).

  const LEAVE_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
  const EOS_STATUSES = new Set(['draft', 'approved', 'paid']);
  const RUN_STATUSES = new Set(['draft', 'posted', 'cancelled']);

  // hr.getEmployees — 1 param (session companyId)
  registerRpc('hr.getEmployees', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT e.*, d.name AS department_name
              FROM employees e LEFT JOIN departments d ON e.department_id = d.id
             WHERE e.company_id = $1::uuid
             ORDER BY e.full_name`,
      params: [session.user.companyId],
    }),
  });

  // hr.getEmployeesPaginated — 6 params (company, isActive, departmentId, search, limit, offset)
  registerRpc('hr.getEmployeesPaginated', {
    paramCount: 6,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      return {
        sql: `SELECT e.*, d.name AS department_name, COUNT(*) OVER() AS total_count
                FROM employees e LEFT JOIN departments d ON e.department_id = d.id
               WHERE e.company_id = $1::uuid
                 AND ($2::boolean IS NULL OR e.is_active = $2)
                 AND ($3::uuid IS NULL OR e.department_id = $3)
                 AND ($4::text IS NULL OR e.full_name ILIKE $4 OR e.employee_number ILIKE $4 OR e.email ILIKE $4)
               ORDER BY e.full_name
               LIMIT $5 OFFSET $6`,
        params: [
          session.user.companyId,
          p.isActive === undefined ? null : Boolean(p.isActive),
          UUID_FILTER(p.departmentId),
          TEXT_FILTER(p.search),
          limit,
          offset,
        ],
      };
    },
  });

  // hr.getEmployeeById
  registerRpc('hr.getEmployeeById', {
    paramCount: 2,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => ({
      sql: `SELECT e.*, d.name AS department_name
              FROM employees e LEFT JOIN departments d ON e.department_id = d.id
             WHERE e.id = $1::uuid AND e.company_id = $2::uuid
             LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
  });

  // hr.createEmployee — 16 params (session-derived companyId + createdBy).
  // The renderer still resolves `employeeNumber` upfront via the guarded
  // document_sequences flow, so it is required here.
  registerRpc('hr.createEmployee', {
    paramCount: 16,
    validate: (p) => {
      if (!p.employeeNumber || !p.fullName) throw new Error('employeeNumber and fullName required');
      if (!p.hireDate) throw new Error('hireDate required');
    },
    compose: (p, session) => ({
      sql: `INSERT INTO employees (company_id, employee_number, full_name, national_id, phone, email, address, department_id, position, grade, hire_date, termination_date, base_salary, is_active, photo_url, attachments, created_by, updated_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11::date, $12::date, $13::numeric, $14, $15, $16::jsonb, $17::uuid, $17::uuid)
            RETURNING id`,
      params: [
        session.user.companyId,
        String(p.employeeNumber),
        String(p.fullName),
        p.nationalId || null,
        p.phone || null,
        p.email || null,
        p.address || null,
        UUID_FILTER(p.departmentId),
        p.position || null,
        p.grade || null,
        String(p.hireDate),
        p.terminationDate || null,
        Number(p.baseSalary || 0),
        p.isActive !== false,
        p.photoUrl || null,
        p.attachments ? (typeof p.attachments === 'string' ? p.attachments : JSON.stringify(p.attachments)) : null,
        session.user.id,
      ],
    }),
  });

  // hr.updateEmployee — dynamic SET (`paramCount: null`). `updated_at`/
  // `updated_by` always applied (employees has both columns).
  registerRpc('hr.updateEmployee', {
    paramCount: null,
    validate: (p) => { if (!p.id) throw new Error('id required'); },
    compose: (p, session) => {
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.employeeNumber !== undefined) { fields.push(`employee_number = $${idx++}`); values.push(p.employeeNumber); }
      if (p.fullName !== undefined) { fields.push(`full_name = $${idx++}`); values.push(p.fullName); }
      if (p.nationalId !== undefined) { fields.push(`national_id = $${idx++}`); values.push(p.nationalId || null); }
      if (p.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(p.phone || null); }
      if (p.email !== undefined) { fields.push(`email = $${idx++}`); values.push(p.email || null); }
      if (p.address !== undefined) { fields.push(`address = $${idx++}`); values.push(p.address || null); }
      if (p.departmentId !== undefined) { fields.push(`department_id = $${idx++}`); values.push(UUID_FILTER(p.departmentId)); }
      if (p.position !== undefined) { fields.push(`position = $${idx++}`); values.push(p.position || null); }
      if (p.grade !== undefined) { fields.push(`grade = $${idx++}`); values.push(p.grade || null); }
      if (p.hireDate !== undefined) { fields.push(`hire_date = $${idx++}`); values.push(p.hireDate || null); }
      if (p.terminationDate !== undefined) { fields.push(`termination_date = $${idx++}`); values.push(p.terminationDate || null); }
      if (p.baseSalary !== undefined) { fields.push(`base_salary = $${idx++}`); values.push(Number(p.baseSalary || 0)); }
      if (p.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(Boolean(p.isActive)); }
      if (p.photoUrl !== undefined) { fields.push(`photo_url = $${idx++}`); values.push(p.photoUrl || null); }
      if (p.attachments !== undefined) {
        fields.push(`attachments = $${idx++}`);
        values.push(p.attachments ? (typeof p.attachments === 'string' ? p.attachments : JSON.stringify(p.attachments)) : null);
      }
      fields.push(`updated_by = $${idx++}`); values.push(session.user.id);
      fields.push(`updated_at = NOW()`);
      const whereIdx = idx; values.push(String(p.id));
      const cidIdx = idx + 1; values.push(session.user.companyId);
      const sql = `UPDATE employees SET ${fields.join(', ')} WHERE id = $${whereIdx}::uuid AND company_id = $${cidIdx}::uuid`;
      return { sql, params: values };
    },
  });

  // hr.deleteEmployee
  registerRpc('hr.deleteEmployee', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM employees WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // hr.getAttendance — month/year via EXTRACT
  registerRpc('hr.getAttendance', {
    paramCount: 3,
    compose: (p, session) => ({
      sql: `SELECT a.*, e.full_name AS employee_name
              FROM attendance a JOIN employees e ON a.employee_id = e.id
             WHERE a.company_id = $1::uuid
               AND EXTRACT(MONTH FROM a.date) = $2
               AND EXTRACT(YEAR FROM a.date) = $3
             ORDER BY a.date DESC`,
      params: [session.user.companyId, Number(p.month), Number(p.year)],
    }),
  });

  // hr.saveAttendance — fetch-then-upsert inside one transaction. `attendance`
  // has no UNIQUE(employee_id, date) constraint, so ON CONFLICT is not usable;
  // we pre-fetch existing ids for the session's company then UPDATE/INSERT.
  ipcMain.handle('db:rpc:hr.saveAttendance', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    const records = Array.isArray(payload.data?.records) ? payload.data.records : [];
    if (records.length === 0) return { success: true };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tuples = records.map((_r, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::date)`).join(', ');
      const tupleParams = records.flatMap((r) => [String(r.employeeId), String(r.date)]);
      tupleParams.push(session.user.companyId);
      const lookupSql = `SELECT employee_id, date::text AS day, id FROM attendance
                          WHERE company_id = $${records.length * 2 + 1}::uuid AND (employee_id, date) IN (VALUES ${tuples})`;
      assertSqlAuthorized(session, lookupSql, tupleParams);
      const existingRes = await execQuery(client, lookupSql, tupleParams);
      const existingMap = new Map();
      for (const row of existingRes.rows || []) {
        existingMap.set(`${row.employee_id}:${String(row.day).slice(0, 10)}`, String(row.id));
      }
      for (const rec of records) {
        const key = `${rec.employeeId}:${String(rec.date).slice(0, 10)}`;
        const existingId = existingMap.get(key);
        if (existingId) {
          const sql = `UPDATE attendance SET check_in = $1, check_out = $2, overtime_hours = $3, status = $4, notes = $5, updated_by = $6
                       WHERE id = $7::uuid AND company_id = $8::uuid`;
          const params = [
            rec.checkIn || null, rec.checkOut || null,
            rec.overtimeHours != null ? Number(rec.overtimeHours) : null,
            rec.status || 'present', rec.notes || null,
            session.user.id, existingId, session.user.companyId,
          ];
          assertSqlAuthorized(session, sql, params);
          await execQuery(client, sql, params);
        } else {
          const sql = `INSERT INTO attendance (company_id, employee_id, date, check_in, check_out, overtime_hours, status, notes, created_by, updated_by)
                       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, $9::uuid, $9::uuid)`;
          const params = [
            session.user.companyId, String(rec.employeeId), String(rec.date),
            rec.checkIn || null, rec.checkOut || null,
            rec.overtimeHours != null ? Number(rec.overtimeHours) : null,
            rec.status || 'present', rec.notes || null, session.user.id,
          ];
          assertSqlAuthorized(session, sql, params);
          await execQuery(client, sql, params);
        }
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      return { success: false, error: err.message };
    } finally {
      client.release();
    }
  });

  // hr.getPayrollRuns — lines embedded via json_agg (one round-trip)
  registerRpc('hr.getPayrollRuns', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT pr.*, COALESCE(json_agg(json_build_object(
              'id', pl.id, 'payroll_run_id', pl.payroll_run_id, 'employee_id', pl.employee_id,
              'employee_name', e.full_name, 'base_salary', pl.base_salary, 'allowances', pl.allowances,
              'deductions', pl.deductions, 'overtime', pl.overtime, 'net_salary', pl.net_salary
            )) FILTER (WHERE pl.id IS NOT NULL), '[]'::json) AS lines
             FROM payroll_runs pr
             LEFT JOIN payroll_lines pl ON pl.payroll_run_id = pr.id
             LEFT JOIN employees e ON pl.employee_id = e.id
            WHERE pr.company_id = $1::uuid
            GROUP BY pr.id
            ORDER BY pr.year DESC, pr.month DESC`,
      params: [session.user.companyId],
    }),
  });

  // hr.getPayrollRunsPaginated — status filter via NULL branch + json_agg lines
  registerRpc('hr.getPayrollRunsPaginated', {
    paramCount: 4,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      return {
        sql: `SELECT pr.*, COALESCE(json_agg(json_build_object(
                'id', pl.id, 'payroll_run_id', pl.payroll_run_id, 'employee_id', pl.employee_id,
                'employee_name', e.full_name, 'base_salary', pl.base_salary, 'allowances', pl.allowances,
                'deductions', pl.deductions, 'overtime', pl.overtime, 'net_salary', pl.net_salary
              )) FILTER (WHERE pl.id IS NOT NULL), '[]'::json) AS lines,
              COUNT(*) OVER() AS total_count
               FROM payroll_runs pr
               LEFT JOIN payroll_lines pl ON pl.payroll_run_id = pr.id
               LEFT JOIN employees e ON pl.employee_id = e.id
              WHERE pr.company_id = $1::uuid
                AND ($2::text IS NULL OR pr.status = $2)
              GROUP BY pr.id
              ORDER BY pr.year DESC, pr.month DESC
              LIMIT $3 OFFSET $4`,
        params: [session.user.companyId, typeof p.status === 'string' && p.status ? p.status : null, limit, offset],
      };
    },
  });

  // hr.createPayrollRun — CTE inserts the run then its lines. `run_number` is
  // resolved upstream via the guarded document_sequences flow.
  registerRpc('hr.createPayrollRun', {
    paramCount: null,
    validate: (p) => {
      if (!Number.isFinite(Number(p.month)) || !Number.isFinite(Number(p.year))) throw new Error('month and year required');
      if (!Array.isArray(p.lines) || p.lines.length === 0) throw new Error('lines required');
    },
    compose: (p, session) => {
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const status = RUN_STATUSES.has(p.status) ? p.status : 'draft';
      const params = [
        session.user.companyId,
        Number(p.month),
        Number(p.year),
        Number(p.totalAmount || 0),
        status,
        p.runNumber || null,
        session.user.id,
      ];
      const rowValues = [];
      let idx = 8;
      for (const line of lines) {
        rowValues.push(`($${idx}::uuid, $${idx + 1}::numeric, $${idx + 2}::numeric, $${idx + 3}::numeric, $${idx + 4}::numeric, $${idx + 5}::numeric)`);
        params.push(
          String(line.employeeId),
          Number(line.baseSalary || 0),
          line.allowances != null ? Number(line.allowances) : 0,
          line.deductions != null ? Number(line.deductions) : 0,
          line.overtime != null ? Number(line.overtime) : 0,
          Number(line.netSalary || 0)
        );
        idx += 6;
      }
      const sql = `WITH run AS (
        INSERT INTO payroll_runs (company_id, month, year, total_amount, status, run_number, created_by, updated_by)
        VALUES ($1::uuid, $2, $3, $4::numeric, $5, $6, $7::uuid, $7::uuid) RETURNING id
      ), ins AS (
        INSERT INTO payroll_lines (payroll_run_id, employee_id, base_salary, allowances, deductions, overtime, net_salary)
        SELECT run.id, v.employee_id, v.base_salary, v.allowances, v.deductions, v.overtime, v.net_salary
        FROM run JOIN (VALUES ${rowValues.join(', ')}) v(employee_id, base_salary, allowances, deductions, overtime, net_salary) ON true
      ) SELECT id FROM run`;
      return { sql, params };
    },
  });

  // hr.postPayrollRun — `payroll_runs` has no updated_at column; omitted.
  registerRpc('hr.postPayrollRun', {
    paramCount: 3,
    compose: (p, session) => ({
      sql: `UPDATE payroll_runs SET status = 'posted', updated_by = $1::uuid
            WHERE id = $2::uuid AND company_id = $3::uuid RETURNING id`,
      params: [session.user.id, String(p.id), session.user.companyId],
    }),
  });

  // hr.deletePayrollRun — draft-only delete (lines cascade via FK). Posted
  // runs are financial history and can never be removed.
  registerRpc('hr.deletePayrollRun', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: `DELETE FROM payroll_runs
             WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'
            RETURNING id`,
      params: [String(p.id), session.user.companyId],
    }),
  });

  // hr.getLeaves
  registerRpc('hr.getLeaves', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT l.*, e.full_name AS employee_name
              FROM leaves l JOIN employees e ON l.employee_id = e.id
             WHERE l.company_id = $1::uuid
             ORDER BY l.created_at DESC`,
      params: [session.user.companyId],
    }),
  });

  // hr.getLeavesPaginated
  registerRpc('hr.getLeavesPaginated', {
    paramCount: 4,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      return {
        sql: `SELECT l.*, e.full_name AS employee_name, COUNT(*) OVER() AS total_count
                FROM leaves l JOIN employees e ON l.employee_id = e.id
               WHERE l.company_id = $1::uuid
                 AND ($2::text IS NULL OR l.status = $2)
               ORDER BY l.created_at DESC
               LIMIT $3 OFFSET $4`,
        params: [session.user.companyId, typeof p.status === 'string' && p.status ? p.status : null, limit, offset],
      };
    },
  });

  // hr.createLeave — 10 params
  registerRpc('hr.createLeave', {
    paramCount: 10,
    validate: (p) => { if (!p.employeeId || !p.startDate || !p.endDate) throw new Error('employeeId, startDate and endDate required'); },
    compose: (p, session) => ({
      sql: `INSERT INTO leaves (company_id, employee_id, type, start_date, end_date, days, status, reason, created_by, updated_by)
            VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6::numeric, $7, $8, $9::uuid, $9::uuid)
            RETURNING id`,
      params: [
        session.user.companyId,
        String(p.employeeId),
        String(p.leaveType || 'annual'),
        String(p.startDate),
        String(p.endDate),
        Number(p.days || 0),
        LEAVE_STATUSES.has(p.status) ? p.status : 'pending',
        p.reason || null,
        session.user.id,
      ],
    }),
  });

  // hr.updateLeaveStatus — `leaves` has no updated_at column; omitted.
  registerRpc('hr.updateLeaveStatus', {
    paramCount: 6,
    validate: (p) => { if (!p.id || !LEAVE_STATUSES.has(p.status)) throw new Error('id and valid status required'); },
    compose: (p, session) => ({
      sql: `UPDATE leaves SET status = $1, approved_by = $2::uuid, approved_at = $3, updated_by = $4::uuid
            WHERE id = $5::uuid AND company_id = $6::uuid RETURNING id`,
      params: [
        p.status,
        UUID_FILTER(p.approvedBy),
        p.status === 'approved' ? new Date().toISOString() : null,
        session.user.id,
        String(p.id),
        session.user.companyId,
      ],
    }),
  });

  // hr.deleteLeave
  registerRpc('hr.deleteLeave', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM leaves WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // hr.getEndOfServices
  registerRpc('hr.getEndOfServices', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT eos.*, emp.full_name AS employee_name
              FROM end_of_service eos JOIN employees emp ON eos.employee_id = emp.id
             WHERE eos.company_id = $1::uuid
             ORDER BY eos.created_at DESC`,
      params: [session.user.companyId],
    }),
  });

  // hr.getEndOfServicesPaginated
  registerRpc('hr.getEndOfServicesPaginated', {
    paramCount: 4,
    compose: (p, session) => {
      const limit = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = Math.max(0, (Number(p.page) || 1) - 1) * limit;
      return {
        sql: `SELECT eos.*, emp.full_name AS employee_name, COUNT(*) OVER() AS total_count
                FROM end_of_service eos JOIN employees emp ON eos.employee_id = emp.id
               WHERE eos.company_id = $1::uuid
                 AND ($2::text IS NULL OR eos.status = $2)
               ORDER BY eos.created_at DESC
               LIMIT $3 OFFSET $4`,
        params: [session.user.companyId, typeof p.status === 'string' && p.status ? p.status : null, limit, offset],
      };
    },
  });

  // hr.createEndOfService — 11 params
  registerRpc('hr.createEndOfService', {
    paramCount: 11,
    validate: (p) => { if (!p.employeeId || !p.terminationDate) throw new Error('employeeId and terminationDate required'); },
    compose: (p, session) => ({
      sql: `INSERT INTO end_of_service (company_id, employee_id, termination_date, service_years, last_salary, eos_amount, reason, status, notes, created_by, updated_by)
            VALUES ($1::uuid, $2::uuid, $3::date, $4::numeric, $5::numeric, $6::numeric, $7, $8, $9, $10::uuid, $10::uuid)
            RETURNING id`,
      params: [
        session.user.companyId,
        String(p.employeeId),
        String(p.terminationDate),
        Number(p.serviceYears || 0),
        Number(p.lastSalary || 0),
        Number(p.eosAmount || 0),
        String(p.reason),
        EOS_STATUSES.has(p.status) ? p.status : 'draft',
        p.notes || null,
        session.user.id,
      ],
    }),
  });

  // hr.updateEndOfServiceStatus — end_of_service HAS updated_at; kept.
  registerRpc('hr.updateEndOfServiceStatus', {
    paramCount: 4,
    validate: (p) => { if (!p.id || !EOS_STATUSES.has(p.status)) throw new Error('id and valid status required'); },
    compose: (p, session) => ({
      sql: `UPDATE end_of_service SET status = $1, updated_by = $2::uuid, updated_at = NOW()
            WHERE id = $3::uuid AND company_id = $4::uuid RETURNING id`,
      params: [p.status, session.user.id, String(p.id), session.user.companyId],
    }),
  });

  // hr.deleteEndOfService
  registerRpc('hr.deleteEndOfService', {
    paramCount: 2,
    compose: (p, session) => ({
      sql: 'DELETE FROM end_of_service WHERE id = $1::uuid AND company_id = $2::uuid',
      params: [String(p.id), session.user.companyId],
    }),
  });

  // hr.getHrKpis — four aggregates in one statement
  registerRpc('hr.getHrKpis', {
    paramCount: 1,
    compose: (_p, session) => ({
      sql: `SELECT (SELECT COUNT(*) FROM employees WHERE company_id = $1::uuid)::int AS total_employees,
                   (SELECT COUNT(*) FROM employees WHERE company_id = $1::uuid AND is_active = true)::int AS active_employees,
                   (SELECT COUNT(*) FROM leaves WHERE company_id = $1::uuid AND status = 'pending')::int AS pending_leaves,
                   (SELECT COALESCE(SUM(pl.net_salary), 0)
                      FROM payroll_lines pl
                      JOIN payroll_runs pr ON pl.payroll_run_id = pr.id
                      JOIN employees e ON pl.employee_id = e.id
                     WHERE pr.company_id = $1::uuid AND e.company_id = $1::uuid AND pr.status = 'posted') AS total_payroll`,
      params: [session.user.companyId],
    }),
  });

  // ── sales (Phase 4 slice 10) ──────────────────────────────────────────────
  // All sales queries derive `company_id` and audit `user_id` from the
  // authenticated session (never from the renderer payload). create* use CTEs
  // with VALUES joins so header + lines insert atomically; update* run as
  // transactions (dynamic header SET + optional line rebuild); delete* / post*
  // use guarded CTEs so rows only change when the business rules allow it.

  // sales.getCustomers
  registerRpc('sales.getCustomers', {
    compose: (p, session) => ({
      sql: `SELECT * FROM customers WHERE company_id = $1::uuid ORDER BY name ASC`,
      params: [session.user.companyId],
    }),
    paramCount: 1,
  });

  // sales.getCustomersPaginated
  registerRpc('sales.getCustomersPaginated', {
    compose: (p, session) => {
      const page = Math.max(1, Number(p.page) || 1);
      const pageSize = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = (page - 1) * pageSize;
      const isActive = p.isActive === undefined || p.isActive === null ? null : (p.isActive === true || p.isActive === 'true');
      return {
        sql: `SELECT c.*, (COUNT(*) OVER())::int AS total_count FROM customers c WHERE c.company_id = $1::uuid AND ($2::boolean IS NULL OR c.is_active = $2) AND ($3::text IS NULL OR c.name ILIKE $3 OR c.phone ILIKE $3 OR c.code ILIKE $3) ORDER BY c.name ASC LIMIT $4 OFFSET $5`,
        params: [session.user.companyId, isActive, TEXT_FILTER(p.search), pageSize, offset],
      };
    },
    paramCount: 5,
  });

  // sales.getCustomerById
  registerRpc('sales.getCustomerById', {
    compose: (p, session) => ({
      sql: `SELECT * FROM customers WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.createCustomer
  registerRpc('sales.createCustomer', {
    compose: (p, session) => ({
      sql: `INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, credit_limit, balance, is_active, created_by, updated_by) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12::uuid) RETURNING id`,
      params: [session.user.companyId, String(p.code || ''), String(p.name || ''), p.phone || null, p.email || null, p.address || null, p.taxNumber || null, Number(p.creditLimit) || 0, Number(p.balance) || 0, p.isActive !== false, session.user.id, session.user.id],
    }),
    paramCount: 12,
    validate: (p) => {
      if (!p.code) throw new Error('code required');
      if (!p.name) throw new Error('name required');
    },
  });

  // sales.updateCustomer
  registerRpc('sales.updateCustomer', {
    compose: (p, session) => {
      const cid = session.user.companyId;
      const uid = session.user.id;
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.code !== undefined) { fields.push(`code = $${idx++}`); values.push(p.code); }
      if (p.name !== undefined) { fields.push(`name = $${idx++}`); values.push(p.name); }
      if (p.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(p.phone || null); }
      if (p.email !== undefined) { fields.push(`email = $${idx++}`); values.push(p.email || null); }
      if (p.address !== undefined) { fields.push(`address = $${idx++}`); values.push(p.address || null); }
      if (p.taxNumber !== undefined) { fields.push(`tax_number = $${idx++}`); values.push(p.taxNumber || null); }
      if (p.creditLimit !== undefined) { fields.push(`credit_limit = $${idx++}::numeric`); values.push(Number(p.creditLimit) || 0); }
      if (p.balance !== undefined) { fields.push(`balance = $${idx++}::numeric`); values.push(Number(p.balance) || 0); }
      if (p.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(p.isActive === true || p.isActive === 'true'); }
      fields.push(`updated_by = $${idx++}::uuid`, `updated_at = NOW()`);
      values.push(uid);
      values.push(String(p.id), cid);
      return {
        sql: `UPDATE customers SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`,
        params: values,
      };
    },
    paramCount: null,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.deleteCustomer
  registerRpc('sales.deleteCustomer', {
    compose: (p, session) => ({
      sql: `DELETE FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.getCustomerStatement
  // Includes the customer's opening balance as the first row so the running
  // balance (and the last row's closing balance) always equals the FULL
  // balance = opening + invoices - receipts.
  registerRpc('sales.getCustomerStatement', {
    compose: (p, session) => ({
      sql: `WITH entries AS (SELECT COALESCE(c.opening_date, DATE '1900-01-01') AS date, 'رصيد افتتاحي'::varchar AS document_type, 'OPENING'::varchar AS document_number, CASE WHEN c.opening_balance >= 0 THEN c.opening_balance ELSE 0 END AS debit, CASE WHEN c.opening_balance < 0 THEN -c.opening_balance ELSE 0 END AS credit, NULL::text AS notes, 0 AS sort_type FROM customers c WHERE c.id = $1::uuid AND c.company_id = $2::uuid AND c.opening_balance <> 0 UNION ALL SELECT date, 'فاتورة'::varchar as document_type, invoice_number as document_number, total_amount as debit, 0::numeric as credit, notes, 1 as sort_type FROM sales_invoices WHERE customer_id = $1::uuid AND company_id = $2::uuid AND status <> 'cancelled' UNION ALL SELECT date, 'سند قبض'::varchar as document_type, voucher_number as document_number, 0::numeric as debit, amount as credit, notes, 2 as sort_type FROM receipt_vouchers WHERE customer_id = $1::uuid AND company_id = $2::uuid AND status = 'posted') SELECT date, document_type, document_number, debit, credit, SUM(debit - credit) OVER (ORDER BY date, sort_type, document_number) as balance, notes FROM entries ORDER BY date, sort_type, document_number`,
      params: [String(p.customerId), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.customerId) throw new Error('customerId required');
    },
  });

  // sales.getCustomerArAging
  // Includes each customer's opening balance as an undated (1900-01-01) row
  // so it always lands in the oldest bucket (>90).
  registerRpc('sales.getCustomerArAging', {
    compose: (p, session) => ({
      sql: `SELECT c.id as customer_id, c.name as customer_name, (i.total_amount - i.paid_amount) as due_amount, COALESCE(i.due_date, i.date) as aging_date FROM customers c JOIN sales_invoices i ON i.customer_id = c.id WHERE c.company_id = $1 AND i.status IN ('posted', 'partially_paid') AND (i.total_amount - i.paid_amount) > 0 UNION ALL SELECT c.id as customer_id, c.name as customer_name, c.opening_balance as due_amount, COALESCE(c.opening_date, DATE '1900-01-01') as aging_date FROM customers c WHERE c.company_id = $1 AND c.opening_balance > 0`,
      params: [session.user.companyId],
    }),
    paramCount: 1,
  });

  // sales.getInvoices
  registerRpc('sales.getInvoices', {
    compose: (p, session) => ({
      sql: `SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address, c.tax_number as customer_tax_number, c.balance as customer_balance, c.is_active as customer_is_active FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.company_id = $1 ORDER BY i.date DESC`,
      params: [session.user.companyId],
    }),
    paramCount: 1,
  });

  // sales.getOutstandingInvoicesForCustomer
  registerRpc('sales.getOutstandingInvoicesForCustomer', {
    compose: (p, session) => ({
      sql: `SELECT i.*, c.name as customer_name FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.company_id = $1::uuid AND i.customer_id = $2::uuid AND i.status IN ('posted', 'partially_paid') AND (i.total_amount - COALESCE(i.paid_amount, 0)) > 0 ORDER BY i.date DESC`,
      params: [session.user.companyId, String(p.customerId)],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.customerId) throw new Error('customerId required');
    },
  });

  // sales.getPostedInvoicesWithLines
  registerRpc('sales.getPostedInvoicesWithLines', {
    compose: (p, session) => ({
      sql: `SELECT i.*, c.name as customer_name, COALESCE(json_agg(json_build_object('id', l.id, 'invoice_id', l.invoice_id, 'product_id', l.product_id, 'product_name', p.name_ar, 'product_code', p.code, 'barcode', p.barcode, 'sku', p.sku, 'unit', p.unit, 'quantity', l.quantity, 'unit_price', l.unit_price, 'discount_percent', l.discount_percent, 'vat_percent', l.vat_percent, 'line_total', l.line_total, 'currency_code', l.currency_code, 'exchange_rate', l.exchange_rate, 'base_currency_line_total', l.base_currency_line_total)) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN sales_invoice_lines l ON l.invoice_id = i.id LEFT JOIN products p ON l.product_id = p.id WHERE i.company_id = $1::uuid AND i.status IN ('posted', 'partially_paid', 'paid') GROUP BY i.id, c.name ORDER BY i.date DESC`,
      params: [session.user.companyId],
    }),
    paramCount: 1,
  });

  // sales.getInvoicesPaginated
  registerRpc('sales.getInvoicesPaginated', {
    compose: (p, session) => {
      const page = Math.max(1, Number(p.page) || 1);
      const pageSize = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = (page - 1) * pageSize;
      return {
        sql: `SELECT i.*, c.name as customer_name, (COUNT(*) OVER())::int AS total_count FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.company_id = $1::uuid AND ($2::text IS NULL OR i.status = $2) AND ($3::uuid IS NULL OR i.customer_id = $3) AND ($4::uuid IS NULL OR i.created_by = $4 OR i.created_by IS NULL) ORDER BY i.date DESC LIMIT $5 OFFSET $6`,
        params: [session.user.companyId, p.status || null, UUID_FILTER(p.customerId), UUID_FILTER(p.createdBy), pageSize, offset],
      };
    },
    paramCount: 6,
  });

  // sales.getInvoiceById
  registerRpc('sales.getInvoiceById', {
    compose: (p, session) => ({
      sql: `SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address, c.tax_number as customer_tax_number, c.balance as customer_balance, c.is_active as customer_is_active, COALESCE(json_agg(json_build_object('id', l.id, 'invoice_id', l.invoice_id, 'product_id', l.product_id, 'product_name', p.name_ar, 'product_code', p.code, 'barcode', p.barcode, 'sku', p.sku, 'unit', p.unit, 'quantity', l.quantity, 'unit_price', l.unit_price, 'discount_percent', l.discount_percent, 'vat_percent', l.vat_percent, 'line_total', l.line_total, 'currency_code', l.currency_code, 'exchange_rate', l.exchange_rate, 'base_currency_line_total', l.base_currency_line_total)) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN sales_invoice_lines l ON l.invoice_id = i.id LEFT JOIN products p ON l.product_id = p.id WHERE i.id = $1::uuid AND i.company_id = $2::uuid GROUP BY i.id, c.name, c.phone, c.email, c.address, c.tax_number, c.balance, c.is_active LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });// sales.createInvoice
  registerRpc('sales.createInvoice', {
    compose: (p, session) => {
      const cid = session.user.companyId;
      const uid = session.user.id;
      const lr = Number(p.exchangeRate) > 0 ? Number(p.exchangeRate) : 1;
      const params = [cid, String(p.invoiceNumber || ''), String(p.customerId), p.date || null, p.dueDate || null, Number(p.subtotal) || 0, Number(p.discountAmount) || 0, Number(p.vatAmount) || 0, Number(p.totalAmount) || 0, Number(p.paidAmount) || 0, p.currencyCode || 'YER', lr, Number(p.baseCurrencyAmount) || Number(p.totalAmount) || 0, Number(p.baseCurrencyPaid) || 0, p.status || 'draft', p.paymentType || 'credit', p.cashBoxId || null, p.notes || null, uid, uid];
      let sql = `WITH inv AS (INSERT INTO sales_invoices (company_id, invoice_number, customer_id, date, due_date, subtotal, discount_amount, vat_amount, total_amount, paid_amount, currency_code, exchange_rate, base_currency_amount, base_currency_paid, status, payment_type, cash_box_id, notes, created_by, updated_by) VALUES ($1::uuid, $2, $3::uuid, $4::date, $5::date, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::varchar, $12::numeric, $13::numeric, $14::numeric, $15::varchar, $16, $17::uuid, $18, $19::uuid, $20::uuid) RETURNING id)`;
      if (Array.isArray(p.lines) && p.lines.length) {
        const lineValues = [];
        for (const line of p.lines) {
          const off = params.length;
          const lineRate = line.exchangeRate !== undefined && line.exchangeRate !== null ? Number(line.exchangeRate) : lr;
          const lineBaseTotal = line.baseCurrencyLineTotal !== undefined && line.baseCurrencyLineTotal !== null ? Number(line.baseCurrencyLineTotal) : (Number(line.lineTotal) || 0) * lineRate;
          lineValues.push(`($${off + 1}::uuid, $${off + 2}::numeric, $${off + 3}::numeric, $${off + 4}::numeric, $${off + 5}::numeric, $${off + 6}::numeric, $${off + 7}::varchar, $${off + 8}::numeric, $${off + 9}::numeric)`);
          params.push(String(line.productId), Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.discountPercent) || 0, Number(line.vatPercent) || 0, Number(line.lineTotal) || 0, line.currencyCode || p.currencyCode || 'YER', lineRate, lineBaseTotal);
        }
        sql += `,lines_ins AS (INSERT INTO sales_invoice_lines (invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total, currency_code, exchange_rate, base_currency_line_total) SELECT inv.id, v.product_id, v.quantity, v.unit_price, v.discount_percent, v.vat_percent, v.line_total, v.currency_code, v.exchange_rate, v.base_currency_line_total FROM inv JOIN (VALUES ${lineValues.join(', ')}) v(product_id, quantity, unit_price, discount_percent, vat_percent, line_total, currency_code, exchange_rate, base_currency_line_total) ON true)`;
      }
      sql += ' SELECT id FROM inv';
      return { sql, params };
    },
    paramCount: null,
    validate: (p) => {
      if (!p.invoiceNumber) throw new Error('invoiceNumber required');
      if (!p.customerId) throw new Error('customerId required');
      if (p.paidAmount !== undefined && p.totalAmount !== undefined && Number(p.paidAmount) > Number(p.totalAmount)) throw new Error('Paid amount cannot exceed total amount.');
      if (p.exchangeRate !== undefined && Number(p.exchangeRate) <= 0) throw new Error('Exchange rate must be positive.');
    },
  });

  // sales.updateInvoice (transaction: dynamic header SET + guarded line rebuild)
  ipcMain.handle('db:rpc:sales.updateInvoice', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    const p = payload.data || {};
    if (!p.id) return { success: false, error: 'id required' };
    const cid = session.user.companyId;
    const uid = session.user.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await execQuery(client, `SELECT status, paid_amount FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid`, [String(p.id), cid]);
      if (!check.rows || !check.rows.length) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Invoice not found' };
      }
      const status = String(check.rows[0].status || '');
      const currentPaid = Number(check.rows[0].paid_amount) || 0;
      if (status !== 'draft' && p.lines !== undefined) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Cannot modify lines of posted invoice. Cancel it first.' };
      }
      if (status !== 'draft' && p.paidAmount !== undefined && Number(p.paidAmount) < currentPaid) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Cannot reduce paid amount below current payments.' };
      }
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.customerId !== undefined) { fields.push(`customer_id = $${idx++}::uuid`); values.push(p.customerId); }
      if (p.date !== undefined) { fields.push(`date = $${idx++}::date`); values.push(p.date); }
      if (p.dueDate !== undefined) { fields.push(`due_date = $${idx++}::date`); values.push(p.dueDate); }
      if (p.subtotal !== undefined) { fields.push(`subtotal = $${idx++}::numeric`); values.push(p.subtotal); }
      if (p.discountAmount !== undefined) { fields.push(`discount_amount = $${idx++}::numeric`); values.push(p.discountAmount); }
      if (p.vatAmount !== undefined) { fields.push(`vat_amount = $${idx++}::numeric`); values.push(p.vatAmount); }
      if (p.totalAmount !== undefined) { fields.push(`total_amount = $${idx++}::numeric`); values.push(p.totalAmount); }
      if (p.paidAmount !== undefined) { fields.push(`paid_amount = $${idx++}::numeric`); values.push(p.paidAmount); }
      if (p.currencyCode !== undefined) { fields.push(`currency_code = $${idx++}::varchar`); values.push(p.currencyCode); }
      if (p.exchangeRate !== undefined) { fields.push(`exchange_rate = $${idx++}::numeric`); values.push(p.exchangeRate); }
      if (p.baseCurrencyAmount !== undefined) { fields.push(`base_currency_amount = $${idx++}::numeric`); values.push(p.baseCurrencyAmount); }
      if (p.baseCurrencyPaid !== undefined) { fields.push(`base_currency_paid = $${idx++}::numeric`); values.push(p.baseCurrencyPaid); }
      if (p.status !== undefined) { fields.push(`status = $${idx++}::varchar`); values.push(p.status); }
      if (p.paymentType !== undefined) { fields.push(`payment_type = $${idx++}`); values.push(p.paymentType); }
      if (p.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}::uuid`); values.push(p.cashBoxId || null); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes); }
      fields.push(`updated_by = $${idx++}::uuid`, `updated_at = NOW()`);
      values.push(uid);
      values.push(String(p.id), cid);
      await execQuery(client, `UPDATE sales_invoices SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (p.lines !== undefined) {
        if (!Array.isArray(p.lines) || p.lines.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'At least one line is required.' };
        }
        await execQuery(client, `DELETE FROM sales_invoice_lines WHERE invoice_id = $1::uuid AND $2::uuid = (SELECT company_id FROM sales_invoices WHERE id = $1)`, [String(p.id), cid]);
        const lr = Number(p.exchangeRate) > 0 ? Number(p.exchangeRate) : 1;
        const lineValues = [];
        const lineParams = [];
        for (const line of p.lines) {
          const off = lineParams.length;
          const lineRate = line.exchangeRate !== undefined && line.exchangeRate !== null ? Number(line.exchangeRate) : lr;
          const lineBaseTotal = line.baseCurrencyLineTotal !== undefined && line.baseCurrencyLineTotal !== null ? Number(line.baseCurrencyLineTotal) : (Number(line.lineTotal) || 0) * lineRate;
          lineValues.push(`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7}, $${off + 8}, $${off + 9}, $${off + 10})`);
          lineParams.push(String(p.id), String(line.productId), Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.discountPercent) || 0, Number(line.vatPercent) || 0, Number(line.lineTotal) || 0, line.currencyCode || p.currencyCode || 'YER', lineRate, lineBaseTotal);
        }
        await execQuery(client, `INSERT INTO sales_invoice_lines (invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total, currency_code, exchange_rate, base_currency_line_total) VALUES ${lineValues.join(', ')}`, lineParams);
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (rbErr) { void rbErr; }
      return { success: false, error: e.message || String(e) };
    } finally {
      client.release();
    }
  });

  // sales.deleteInvoice (guarded CTE: draft + unpaid only)
  registerRpc('sales.deleteInvoice', {
    compose: (p, session) => ({
      sql: `WITH check_row AS (SELECT status, paid_amount FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid), del AS (DELETE FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft' AND paid_amount = 0 RETURNING id) SELECT (SELECT status::text FROM check_row), (SELECT paid_amount::numeric FROM check_row), (SELECT id::text FROM del)`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.postInvoice (atomic: status flip + customer balance in one CTE)
  registerRpc('sales.postInvoice', {
    compose: (p, session) => ({
      sql: `WITH upd AS (UPDATE sales_invoices SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft' RETURNING customer_id, total_amount, paid_amount, subtotal, vat_amount, invoice_number, date), bal AS (UPDATE customers SET balance = balance + (SELECT (total_amount - paid_amount) FROM upd), updated_by = $3::uuid, updated_at = NOW() WHERE id = (SELECT customer_id FROM upd) AND company_id = $2::uuid AND (SELECT (total_amount - paid_amount) FROM upd) <> 0) SELECT customer_id, total_amount, paid_amount, subtotal, vat_amount, invoice_number, date FROM upd`,
      params: [String(p.id), session.user.companyId, session.user.id],
    }),
    paramCount: 3,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.getQuotations
  registerRpc('sales.getQuotations', {
    compose: (p, session) => ({
      sql: `SELECT q.*, c.name as customer_name FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.company_id = $1 ORDER BY q.date DESC`,
      params: [session.user.companyId],
    }),
    paramCount: 1,
  });

  // sales.getQuotationsPaginated
  registerRpc('sales.getQuotationsPaginated', {
    compose: (p, session) => {
      const page = Math.max(1, Number(p.page) || 1);
      const pageSize = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = (page - 1) * pageSize;
      return {
        sql: `SELECT q.*, c.name as customer_name, (COUNT(*) OVER())::int AS total_count FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.company_id = $1::uuid AND ($2::text IS NULL OR q.status = $2) AND ($3::uuid IS NULL OR q.customer_id = $3) ORDER BY q.date DESC LIMIT $4 OFFSET $5`,
        params: [session.user.companyId, p.status || null, UUID_FILTER(p.customerId), pageSize, offset],
      };
    },
    paramCount: 5,
  });

  // sales.getQuotationById
  registerRpc('sales.getQuotationById', {
    compose: (p, session) => ({
      sql: `SELECT q.*, c.name as customer_name, COALESCE(json_agg(json_build_object('id', l.id, 'quotation_id', l.quotation_id, 'product_id', l.product_id, 'product_name', p.name_ar, 'product_code', p.code, 'barcode', p.barcode, 'sku', p.sku, 'unit', p.unit, 'quantity', l.quantity, 'unit_price', l.unit_price, 'discount_percent', l.discount_percent, 'line_total', l.line_total)) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id LEFT JOIN quotation_lines l ON l.quotation_id = q.id LEFT JOIN products p ON l.product_id = p.id WHERE q.id = $1::uuid AND q.company_id = $2::uuid GROUP BY q.id, c.name LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.createQuotation
  registerRpc('sales.createQuotation', {
    compose: (p, session) => {
      const cid = session.user.companyId;
      const uid = session.user.id;
      const params = [cid, String(p.quotationNumber || ''), String(p.customerId), p.date || null, p.expiryDate || null, Number(p.totalAmount) || 0, p.status || 'draft', p.paymentType || 'credit', p.cashBoxId || null, p.notes || null, uid, uid];
      let sql = `WITH quo AS (INSERT INTO quotations (company_id, quotation_number, customer_id, date, expiry_date, total_amount, status, payment_type, cash_box_id, notes, created_by, updated_by) VALUES ($1::uuid, $2, $3::uuid, $4::date, $5::date, $6::numeric, $7::varchar, $8, $9::uuid, $10, $11::uuid, $12::uuid) RETURNING id)`;
      if (Array.isArray(p.lines) && p.lines.length) {
        const lineValues = [];
        for (const line of p.lines) {
          const off = params.length;
          lineValues.push(`($${off + 1}::uuid, $${off + 2}::numeric, $${off + 3}::numeric, $${off + 4}::numeric, $${off + 5}::numeric)`);
          params.push(String(line.productId), Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.discountPercent) || 0, Number(line.lineTotal) || 0);
        }
        sql += `,lines_ins AS (INSERT INTO quotation_lines (quotation_id, product_id, quantity, unit_price, discount_percent, line_total) SELECT quo.id, v.product_id, v.quantity, v.unit_price, v.discount_percent, v.line_total FROM quo JOIN (VALUES ${lineValues.join(', ')}) v(product_id, quantity, unit_price, discount_percent, line_total) ON true)`;
      }
      sql += ' SELECT id FROM quo';
      return { sql, params };
    },
    paramCount: null,
    validate: (p) => {
      if (!p.quotationNumber) throw new Error('quotationNumber required');
      if (!p.customerId) throw new Error('customerId required');
    },
  });// sales.updateQuotation (transaction: dynamic header SET + line rebuild)
  ipcMain.handle('db:rpc:sales.updateQuotation', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    const p = payload.data || {};
    if (!p.id) return { success: false, error: 'id required' };
    const cid = session.user.companyId;
    const uid = session.user.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await execQuery(client, `SELECT id FROM quotations WHERE id = $1::uuid AND company_id = $2::uuid`, [String(p.id), cid]);
      if (!check.rows || !check.rows.length) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Quotation not found' };
      }
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.customerId !== undefined) { fields.push(`customer_id = $${idx++}::uuid`); values.push(p.customerId); }
      if (p.date !== undefined) { fields.push(`date = $${idx++}::date`); values.push(p.date); }
      if (p.expiryDate !== undefined) { fields.push(`expiry_date = $${idx++}::date`); values.push(p.expiryDate); }
      if (p.totalAmount !== undefined) { fields.push(`total_amount = $${idx++}::numeric`); values.push(p.totalAmount); }
      if (p.status !== undefined) { fields.push(`status = $${idx++}::varchar`); values.push(p.status); }
      if (p.paymentType !== undefined) { fields.push(`payment_type = $${idx++}`); values.push(p.paymentType); }
      if (p.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}::uuid`); values.push(p.cashBoxId || null); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes); }
      fields.push(`updated_by = $${idx++}::uuid`, `updated_at = NOW()`);
      values.push(uid);
      values.push(String(p.id), cid);
      await execQuery(client, `UPDATE quotations SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (p.lines !== undefined) {
        if (!Array.isArray(p.lines) || p.lines.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'At least one line is required.' };
        }
        await execQuery(client, `DELETE FROM quotation_lines WHERE quotation_id = $1::uuid AND $2::uuid = (SELECT company_id FROM quotations WHERE id = $1)`, [String(p.id), cid]);
        const lineValues = [];
        const lineParams = [];
        for (const line of p.lines) {
          const off = lineParams.length;
          lineValues.push(`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6})`);
          lineParams.push(String(p.id), String(line.productId), Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.discountPercent) || 0, Number(line.lineTotal) || 0);
        }
        await execQuery(client, `INSERT INTO quotation_lines (quotation_id, product_id, quantity, unit_price, discount_percent, line_total) VALUES ${lineValues.join(', ')}`, lineParams);
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (rbErr) { void rbErr; }
      return { success: false, error: e.message || String(e) };
    } finally {
      client.release();
    }
  });

  // sales.deleteQuotation (guarded CTE: not converted/accepted)
  registerRpc('sales.deleteQuotation', {
    compose: (p, session) => ({
      sql: `WITH check_row AS (SELECT status FROM quotations WHERE id = $1::uuid AND company_id = $2::uuid), del AS (DELETE FROM quotations WHERE id = $1::uuid AND company_id = $2::uuid AND status NOT IN ('converted', 'accepted') RETURNING id) SELECT (SELECT status::text FROM check_row), (SELECT id::text FROM del)`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.getReturns
  registerRpc('sales.getReturns', {
    compose: (p, session) => ({
      sql: `SELECT r.*, c.name as customer_name, i.invoice_number as invoice_number_ref FROM sales_returns r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN sales_invoices i ON r.invoice_id = i.id WHERE r.company_id = $1 ORDER BY r.date DESC`,
      params: [session.user.companyId],
    }),
    paramCount: 1,
  });

  // sales.getReturnsPaginated
  registerRpc('sales.getReturnsPaginated', {
    compose: (p, session) => {
      const page = Math.max(1, Number(p.page) || 1);
      const pageSize = Math.max(1, Math.min(500, Number(p.pageSize) || 25));
      const offset = (page - 1) * pageSize;
      return {
        sql: `SELECT r.*, c.name as customer_name, i.invoice_number as invoice_number_ref, (COUNT(*) OVER())::int AS total_count FROM sales_returns r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN sales_invoices i ON r.invoice_id = i.id WHERE r.company_id = $1::uuid AND ($2::text IS NULL OR r.status = $2) AND ($3::uuid IS NULL OR r.customer_id = $3) ORDER BY r.date DESC LIMIT $4 OFFSET $5`,
        params: [session.user.companyId, p.status || null, UUID_FILTER(p.customerId), pageSize, offset],
      };
    },
    paramCount: 5,
  });

  // sales.getReturnById
  registerRpc('sales.getReturnById', {
    compose: (p, session) => ({
      sql: `SELECT r.*, c.name as customer_name, i.invoice_number as invoice_number_ref, COALESCE(json_agg(json_build_object('id', l.id, 'return_id', l.return_id, 'product_id', l.product_id, 'product_name', p.name_ar, 'product_code', p.code, 'barcode', p.barcode, 'sku', p.sku, 'unit', p.unit, 'quantity', l.quantity, 'unit_price', l.unit_price, 'discount_percent', l.discount_percent, 'line_total', l.line_total)) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines FROM sales_returns r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN sales_invoices i ON r.invoice_id = i.id LEFT JOIN sales_return_lines l ON l.return_id = r.id LEFT JOIN products p ON l.product_id = p.id WHERE r.id = $1::uuid AND r.company_id = $2::uuid GROUP BY r.id, c.name, i.invoice_number LIMIT 1`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.createReturn
  registerRpc('sales.createReturn', {
    compose: (p, session) => {
      const cid = session.user.companyId;
      const uid = session.user.id;
      const params = [cid, String(p.returnNumber || ''), p.invoiceId || null, String(p.customerId), p.date || null, Number(p.subtotal) || 0, Number(p.vatAmount) || 0, Number(p.totalAmount) || 0, p.reason || null, p.status || 'draft', p.paymentType || 'credit', p.cashBoxId || null, p.notes || null, uid, uid];
      let sql = `WITH ret AS (INSERT INTO sales_returns (company_id, return_number, invoice_id, customer_id, date, subtotal, vat_amount, total_amount, reason, status, payment_type, cash_box_id, notes, created_by, updated_by) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::date, $6::numeric, $7::numeric, $8::numeric, $9, $10::varchar, $11, $12::uuid, $13, $14::uuid, $15::uuid) RETURNING id)`;
      if (Array.isArray(p.lines) && p.lines.length) {
        const lineValues = [];
        for (const line of p.lines) {
          const off = params.length;
          lineValues.push(`($${off + 1}::uuid, $${off + 2}::numeric, $${off + 3}::numeric, $${off + 4}::numeric)`);
          params.push(String(line.productId), Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.lineTotal) || 0);
        }
        sql += `,lines_ins AS (INSERT INTO sales_return_lines (return_id, product_id, quantity, unit_price, line_total) SELECT ret.id, v.product_id, v.quantity, v.unit_price, v.line_total FROM ret JOIN (VALUES ${lineValues.join(', ')}) v(product_id, quantity, unit_price, line_total) ON true)`;
      }
      sql += ' SELECT id FROM ret';
      return { sql, params };
    },
    paramCount: null,
    validate: (p) => {
      if (!p.returnNumber) throw new Error('returnNumber required');
      if (!p.customerId) throw new Error('customerId required');
    },
  });

  // sales.updateReturn (transaction: dynamic header SET + line rebuild)
  ipcMain.handle('db:rpc:sales.updateReturn', async (event, payload = {}) => {
    const session = getSession(event.sender.id, payload.sessionToken);
    if (!session) return { success: false, error: 'Authentication required' };
    const p = payload.data || {};
    if (!p.id) return { success: false, error: 'id required' };
    const cid = session.user.companyId;
    const uid = session.user.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await execQuery(client, `SELECT id FROM sales_returns WHERE id = $1::uuid AND company_id = $2::uuid`, [String(p.id), cid]);
      if (!check.rows || !check.rows.length) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Return not found' };
      }
      const fields = [];
      const values = [];
      let idx = 1;
      if (p.invoiceId !== undefined) { fields.push(`invoice_id = $${idx++}::uuid`); values.push(p.invoiceId || null); }
      if (p.customerId !== undefined) { fields.push(`customer_id = $${idx++}::uuid`); values.push(p.customerId); }
      if (p.date !== undefined) { fields.push(`date = $${idx++}::date`); values.push(p.date); }
      if (p.subtotal !== undefined) { fields.push(`subtotal = $${idx++}::numeric`); values.push(p.subtotal); }
      if (p.vatAmount !== undefined) { fields.push(`vat_amount = $${idx++}::numeric`); values.push(p.vatAmount); }
      if (p.totalAmount !== undefined) { fields.push(`total_amount = $${idx++}::numeric`); values.push(p.totalAmount); }
      if (p.reason !== undefined) { fields.push(`reason = $${idx++}`); values.push(p.reason); }
      if (p.status !== undefined) { fields.push(`status = $${idx++}::varchar`); values.push(p.status); }
      if (p.paymentType !== undefined) { fields.push(`payment_type = $${idx++}`); values.push(p.paymentType); }
      if (p.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}::uuid`); values.push(p.cashBoxId || null); }
      if (p.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(p.notes); }
      fields.push(`updated_by = $${idx++}::uuid`, `updated_at = NOW()`);
      values.push(uid);
      values.push(String(p.id), cid);
      await execQuery(client, `UPDATE sales_returns SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (p.lines !== undefined) {
        if (!Array.isArray(p.lines) || p.lines.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'At least one line is required.' };
        }
        await execQuery(client, `DELETE FROM sales_return_lines WHERE return_id = $1::uuid AND $2::uuid = (SELECT company_id FROM sales_returns WHERE id = $1)`, [String(p.id), cid]);
        const lineValues = [];
        const lineParams = [];
        for (const line of p.lines) {
          const off = lineParams.length;
          lineValues.push(`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}, $${off + 4}, $${off + 5})`);
          lineParams.push(String(p.id), String(line.productId), Number(line.quantity) || 0, Number(line.unitPrice) || 0, Number(line.lineTotal) || 0);
        }
        await execQuery(client, `INSERT INTO sales_return_lines (return_id, product_id, quantity, unit_price, line_total) VALUES ${lineValues.join(', ')}`, lineParams);
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (rbErr) { void rbErr; }
      return { success: false, error: e.message || String(e) };
    } finally {
      client.release();
    }
  });

  // sales.deleteReturn (guarded CTE: draft only)
  registerRpc('sales.deleteReturn', {
    compose: (p, session) => ({
      sql: `WITH check_row AS (SELECT status FROM sales_returns WHERE id = $1::uuid AND company_id = $2::uuid), del AS (DELETE FROM sales_returns WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft' RETURNING id) SELECT (SELECT status::text FROM check_row), (SELECT id::text FROM del)`,
      params: [String(p.id), session.user.companyId],
    }),
    paramCount: 2,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });

  // sales.postReturn (atomic: status flip + customer balance decrement)
  registerRpc('sales.postReturn', {
    compose: (p, session) => ({
      sql: `WITH upd AS (UPDATE sales_returns SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft' RETURNING customer_id, total_amount, return_number, date), bal AS (UPDATE customers SET balance = balance - (SELECT total_amount FROM upd), updated_by = $3::uuid, updated_at = NOW() WHERE id = (SELECT customer_id FROM upd) AND company_id = $2::uuid AND (SELECT total_amount FROM upd) <> 0) SELECT u.customer_id, u.total_amount, u.return_number, u.date, c.name AS customer_name FROM upd u LEFT JOIN customers c ON u.customer_id = c.id`,
      params: [String(p.id), session.user.companyId, session.user.id],
    }),
    paramCount: 3,
    validate: (p) => {
      if (!p.id) throw new Error('id required');
    },
  });
console.log('[DB] PostgreSQL IPC handlers registered.');
}

export function registerAuthHandlers() {
  ipcMain.handle('auth:login', async (event, { username, password } = {}) => {
    try {
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 1024) {
        return { success: false, error: 'Invalid credentials' };
      }
      // Brute-force protection: 5 attempts/window, then a 5-minute lockout —
      // enforced per sender AND per username.
      const denied = loginAttemptDenied(event, username);
      if (denied) {
        const minutes = Math.ceil(denied.retryAfterMs / 60000);
        writeSecurityAudit({ action: 'auth:login-rate-limited', user: username, ip: 'ipc' });
        return { success: false, error: `محاولات كثيرة — حاول مجددا بعد ${minutes} دقيقة` };
      }
      // usernames are unique per company only — collect every matching account
      // and accept the first active one whose password verifies (LIMIT 1 used
      // to pick an arbitrary tenant on collisions).
      const result = await pool.query(
        `SELECT id, company_id, username, email, full_name, phone, role, branch_id, is_active, password_hash
           FROM users WHERE username = $1`,
        [username.trim()]
      );
      const row = result.rows.find((r) => r.is_active && verifyPasswordNode(password, r.password_hash));
      if (!row) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
      }
      let permissions = [];
      let roleId;
      if (row.role) {
        const roles = await pool.query('SELECT id, permissions FROM roles WHERE name = $1 AND company_id = $2', [row.role, row.company_id]);
        roleId = roles.rows[0]?.id || undefined;
        const raw = roles.rows[0]?.permissions;
        if (Array.isArray(raw)) permissions = raw;
        else if (typeof raw === 'string') {
          try { permissions = JSON.parse(raw); } catch { permissions = []; }
        }
      }
      const user = {
        id: row.id,
        companyId: row.company_id,
        username: row.username,
        email: row.email || undefined,
        fullName: row.full_name || undefined,
        phone: row.phone || undefined,
        role: row.role,
        roleId,
        branchId: row.branch_id || undefined,
        isActive: row.is_active,
      };
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1 AND company_id = $2', [row.id, row.company_id]);
      const sessionToken = createSession(event.sender.id, user, permissions);
      clearLoginAttempts(`u:${username.trim().toLowerCase()}`, `wc:${event.sender.id}`);
      return { success: true, sessionToken, ...sessionPublicData(getSession(event.sender.id, sessionToken)) };
    } catch (err) {
      console.error('[Auth] Login failed:', err.message);
      return { success: false, error: 'حدث خطأ أثناء تسجيل الدخول' };
    }
  });

  ipcMain.handle('auth:get-session', (event, { sessionToken } = {}) => {
    const session = getSession(event.sender.id, sessionToken);
    return session ? { success: true, ...sessionPublicData(session) } : { success: false };
  });

  ipcMain.handle('auth:logout', (event, { sessionToken } = {}) => {
    const session = getSession(event.sender.id, sessionToken);
    if (session) deleteSession(session);
    return { success: true };
  });

  ipcMain.handle('auth:list-users', async (event, { sessionToken } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.view')) return { success: false, error: 'Permission denied' };
      const result = await pool.query(
        `SELECT id, company_id, username, email, full_name, phone, role, branch_id, is_active, last_login_at, created_at, updated_at
           FROM users WHERE company_id = $1 ORDER BY username`,
        [session.user.companyId]
      );
      return { success: true, data: result.rows };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:create-user', async (event, { sessionToken, data } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      if (!canManageRole(session, data?.role)) {
        return { success: false, error: 'Only super_admin can create admin accounts' };
      }
      if (!data || typeof data.username !== 'string' || !/^[\p{L}\p{N}_.-]{3,100}$/u.test(data.username) || !validateNewPassword(data.password)) {
        return { success: false, error: 'Invalid user data or password' };
      }
      const result = await pool.query(
        `INSERT INTO users (company_id, username, email, full_name, phone, role, branch_id, is_active, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, NOW()) RETURNING id`,
        [session.user.companyId, data.username.trim(), data.email || null, data.fullName || data.username.trim(), data.phone || null,
          data.role || 'viewer', data.branchId || null, data.isActive !== false, hashPasswordNode(data.password)]
      );
      return { success: true, id: result.rows[0].id };
    } catch (err) {
      return { success: false, error: err.code === '23505' ? 'Username already exists' : err.message };
    }
  });

  ipcMain.handle('auth:update-user', async (event, { sessionToken, id, data } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      if (id === session.user.id && data?.isActive === false) return { success: false, error: 'Cannot deactivate current user' };
      // Role changes: never allow granting a privileged role unless the caller
      // is super_admin; never allow demoting/removing the privileged role of an
      // existing admin unless the caller is super_admin.
      if (data?.role !== undefined && !canManageRole(session, data.role)) {
        return { success: false, error: 'Only super_admin can grant the admin role' };
      }
      if (data?.role !== undefined) {
        const target = await pool.query('SELECT role FROM users WHERE id = $1::uuid AND company_id = $2', [id, session.user.companyId]);
        if (target.rows.length === 0) return { success: false, error: 'User not found' };
        if (!canManageRole(session, target.rows[0].role)) {
          return { success: false, error: 'Only super_admin can modify admin accounts' };
        }
      }
      const result = await pool.query(
        `UPDATE users SET username = $1, email = $2, full_name = $3, phone = $4, role = $5,
         branch_id = $6::uuid, is_active = $7, updated_at = NOW() WHERE id = $8::uuid AND company_id = $9 RETURNING id`,
        [data?.username, data?.email || null, data?.fullName || null, data?.phone || null, data?.role,
          data?.branchId || null, data?.isActive !== false, id, session.user.companyId]
      );
      if (result.rows.length) {
        // Deactivating a user must cut off their live sessions immediately.
        if (data?.isActive === false) revokeUserSessions(id);
        return { success: true };
      }
      return { success: false, error: 'User not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:reset-password', async (event, { sessionToken, id, password } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      if (!validateNewPassword(password)) return { success: false, error: 'Password does not meet policy' };
      // Admins may not reset the password of a privileged account (incl. their
      // own takeover protection) unless they are super_admin.
      const target = await pool.query('SELECT role FROM users WHERE id = $1::uuid AND company_id = $2', [id, session.user.companyId]);
      if (target.rows.length === 0) return { success: false, error: 'User not found' };
      if (!canManageRole(session, target.rows[0].role)) {
        return { success: false, error: 'Only super_admin can reset admin passwords' };
      }
      const result = await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3 RETURNING id',
        [hashPasswordNode(password), id, session.user.companyId]
      );
      if (result.rows.length) {
        // A password reset must immediately cut off all sessions of that user.
        revokeUserSessions(id);
        return { success: true };
      }
      return { success: false, error: 'User not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:delete-user', async (event, { sessionToken, id } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      if (id === session.user.id) return { success: false, error: 'Cannot delete current user' };
      const target = await pool.query('SELECT role FROM users WHERE id = $1::uuid AND company_id = $2', [id, session.user.companyId]);
      if (target.rows.length === 0) return { success: false, error: 'User not found' };
      if (!canManageRole(session, target.rows[0].role)) {
        return { success: false, error: 'Only super_admin can delete admin accounts' };
      }
      const result = await pool.query('DELETE FROM users WHERE id = $1::uuid AND company_id = $2 RETURNING id', [id, session.user.companyId]);
      if (result.rows.length) {
        revokeUserSessions(id);
        return { success: true };
      }
      return { success: false, error: 'User not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Roles ─────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:list-roles', async (event, { sessionToken } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.view')) return { success: false, error: 'Permission denied' };
      const result = await pool.query(
        `SELECT id, company_id, name, description, permissions, is_system, created_at, updated_at
           FROM roles WHERE company_id = $1 OR company_id IS NULL ORDER BY name`,
        [session.user.companyId]
      );
      const roles = (result.rows || []).map((row) => {
        let permissions = row.permissions;
        if (typeof permissions === 'string') {
          try { permissions = JSON.parse(permissions); } catch { permissions = []; }
        }
        return { ...row, permissions: Array.isArray(permissions) ? permissions : [] };
      });
      return { success: true, data: roles };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:create-role', async (event, { sessionToken, data } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      if (!data || typeof data.name !== 'string' || !data.name.trim()) {
        return { success: false, error: 'Role name is required' };
      }
      const perms = Array.isArray(data.permissions) ? data.permissions : [];
      const result = await pool.query(
        `INSERT INTO roles (company_id, name, description, permissions, is_system, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
        [session.user.companyId, data.name.trim(), data.description || null, JSON.stringify(perms), data.isSystem === true]
      );
      return { success: true, id: result.rows[0].id };
    } catch (err) {
      return { success: false, error: err.code === '23505' ? 'Role already exists' : err.message };
    }
  });

  ipcMain.handle('auth:update-role', async (event, { sessionToken, id, data } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      const current = await pool.query('SELECT is_system FROM roles WHERE id = $1::uuid AND company_id = $2', [id, session.user.companyId]);
      if (current.rows.length === 0) return { success: false, error: 'Role not found' };
      if (current.rows[0].is_system) return { success: false, error: 'Cannot modify system role' };
      const perms = data.permissions !== undefined && Array.isArray(data.permissions)
        ? JSON.stringify(data.permissions)
        : undefined;
      const result = await pool.query(
        `UPDATE roles SET name = COALESCE($1, name), description = COALESCE($2, description),
           permissions = COALESCE($3, permissions), is_system = COALESCE($4, is_system),
           updated_at = NOW() WHERE id = $5::uuid AND company_id = $6 RETURNING id`,
        [data?.name ?? null, data?.description ?? null, perms ?? null, data?.isSystem ?? null, id, session.user.companyId]
      );
      return result.rows.length ? { success: true } : { success: false, error: 'Role not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:delete-role', async (event, { sessionToken, id } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.edit')) return { success: false, error: 'Permission denied' };
      const current = await pool.query('SELECT is_system FROM roles WHERE id = $1::uuid AND company_id = $2', [id, session.user.companyId]);
      if (current.rows.length === 0) return { success: false, error: 'Role not found' };
      if (current.rows[0].is_system) return { success: false, error: 'Cannot delete system role' };
      await pool.query('DELETE FROM roles WHERE id = $1::uuid AND company_id = $2', [id, session.user.companyId]);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Audit logs ────────────────────────────────────────────────────────────
  ipcMain.handle('auth:get-audit-logs', async (event, { sessionToken, filters } = {}) => {
    try {
      const session = getSession(event.sender.id, sessionToken);
      if (!session || !hasPermission(session, 'settings.view')) return { success: false, error: 'Permission denied' };
      let sql = `SELECT al.id, al.user_id, al.action, al.table_name, al.record_id,
                        al.old_values, al.new_values, al.ip_address, al.company_id, al.created_at,
                        u.username
                   FROM audit_logs al
                   LEFT JOIN users u ON u.id = al.user_id
                   WHERE al.company_id = $1`;
      const params = [session.user.companyId];
      if (filters?.userId) { sql += ` AND al.user_id = $${params.length + 1}`; params.push(filters.userId); }
      if (filters?.tableName) { sql += ` AND al.table_name = $${params.length + 1}`; params.push(filters.tableName); }
      if (filters?.action) { sql += ` AND al.action = $${params.length + 1}`; params.push(filters.action); }
      if (filters?.fromDate) { sql += ` AND al.created_at >= $${params.length + 1}`; params.push(filters.fromDate); }
      if (filters?.toDate) { sql += ` AND al.created_at <= $${params.length + 1}`; params.push(filters.toDate); }
      sql += ' ORDER BY al.created_at DESC LIMIT 1000';
      const result = await pool.query(sql, params);
      return { success: true, data: result.rows };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

/* initializeSchema removed — schema is managed exclusively by Drizzle migrations (drizzle/*.sql). */

// Seed initial data
export async function seedInitialData(adminPassword) {
  if (!pool) createPool();

  // Check if already seeded
  const check = await pool.query("SELECT COUNT(*) FROM companies");
  if (parseInt(check.rows[0].count) > 0) {
    console.log('[DB] Data already seeded, skipping.');
    const existing = await pool.query('SELECT id FROM companies LIMIT 1');
    return existing.rows[0]?.id;
  }

  console.log('[DB] Seeding initial data...');
  const client = wrapClient(await pool.connect());
  let effectiveAdminPassword = null;
  try {
    await client.query('BEGIN');
    await client.query('DEALLOCATE ALL');

    // 1. Seed company with YER currency
    const companyResult = await client.query(`
      INSERT INTO companies (name, name_en, currency, tax_number, address, phone, email, date_format, decimal_places, calendar, fiscal_year_start)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'yyyy-MM-dd', 2, 'gregorian', $8)
      RETURNING id;
    `, [
      'ط´ط±ظƒط© ط§ظ„ظ…ط؛ط² ط§ظ„طھط¬ط§ط±ظٹط© ط§ظ„ظ…ط­ط¯ظˆط¯ط©',
      'Maghz Trading Company Ltd.',
      'YER',
      '100123456789',
      'طµظ†ط¹ط§ط،طŒ ط§ظ„ط¬ظ…ظ‡ظˆط±ظٹط© ط§ظ„ظٹظ…ظ†ظٹط©',
      '+967712345678',
      'info@maghz-erp.com',
      `${new Date().getFullYear()}-01-01`
    ]);

    const companyId = companyResult.rows[0].id;

    // 2. Seed admin user — use the operator-provided password, never a default.
    const adminPw = typeof adminPassword === 'string' && adminPassword.length >= 8
      ? adminPassword
      : (crypto_randPassword());
    effectiveAdminPassword = adminPw;
    const adminPasswordHash = hashPasswordNode(adminPw);
    const userResult = await client.query(`
      INSERT INTO users (company_id, username, email, full_name, role, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
    `, [companyId, 'مدير النظام', 'admin@maghz-erp.com', 'مدير النظام', 'admin', adminPasswordHash]);

    const adminId = userResult.rows[0].id;
    writeSecurityAudit({ action: 'seed:admin-created', companyId, username: 'admin' });

    // 2a. Seed default admin role
    await client.query(`
      INSERT INTO roles (company_id, name, description, permissions, is_system)
      SELECT $1, 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ…', 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ… - طµظ„ط§ط­ظٹط§طھ ظƒط§ظ…ظ„ط©', '["all"]', TRUE
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE roles.company_id = $1 AND roles.is_system = TRUE);
    `, [companyId]);

    // 3. Seed Chart of Accounts

    // Assets
    const assetsRes = await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, type, nature, is_group)
      VALUES ($1, '1', 'ط§ظ„ط£طµظˆظ„', 'Assets', 'asset', 'debit', TRUE) RETURNING id;
    `, [companyId]);
    const assetsId = assetsRes.rows[0].id;

    const curAssetsRes = await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group)
      VALUES ($1, '11', 'ط§ظ„ط£طµظˆظ„ ط§ظ„ظ…طھط¯ط§ظˆظ„ط©', 'Current Assets', $2, 'asset', 'debit', TRUE) RETURNING id;
    `, [companyId, assetsId]);
    const curAssetsId = curAssetsRes.rows[0].id;

    const cashGroupRes = await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group)
      VALUES ($1, '111', 'ط§ظ„طµظ†ط¯ظˆظ‚ ظˆط§ظ„ط¨ظ†ظˆظƒ', 'Cash & Treasuries', $2, 'asset', 'debit', TRUE) RETURNING id;
    `, [companyId, curAssetsId]);
    const cashGroupId = cashGroupRes.rows[0].id;

    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '11101', 'ط§ظ„طµظ†ط¯ظˆظ‚ ط§ظ„ط±ط¦ظٹط³ظٹ', 'Main Cash', $2, 'asset', 'debit', FALSE, 5000000);
    `, [companyId, cashGroupId]);

    await client.query(`
      
    `, [companyId]);
    const equityId = equityRes.rows[0].id;

    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '31101', 'ط±ط£ط³ ط§ظ„ظ…ط§ظ„ ط§ظ„ظ…ط¯ظپظˆط¹', 'Paid-in Capital', $2, 'equity', 'credit', FALSE, 20000000);
    `, [companyId, equityId]);

    // Revenues
    const revenueRes = await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, type, nature, is_group)
      VALUES ($1, '4', 'ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ', 'Revenues', 'revenue', 'credit', TRUE) RETURNING id;
    `, [companyId]);
    const revenueId = revenueRes.rows[0].id;

    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '41101', 'ظ…ط¨ظٹط¹ط§طھ ط§ظ„ظ…ظ†طھط¬ط§طھ', 'Product Sales', $2, 'revenue', 'credit', FALSE, 0);
    `, [companyId, revenueId]);

    // Expenses
    const expenseRes = await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, type, nature, is_group)
      VALUES ($1, '5', 'ط§ظ„ظ…طµط±ظˆظپط§طھ', 'Expenses', 'expense', 'debit', TRUE) RETURNING id;
    `, [companyId]);
    const expenseId = expenseRes.rows[0].id;

    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '52201', 'ظ…طµط±ظˆظپط§طھ ط§ظ„ط¥ظٹط¬ط§ط±', 'Rent Expense', $2, 'expense', 'debit', FALSE, 0);
    `, [companyId, expenseId]);

    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '52101', 'ط±ظˆط§طھط¨ ط§ظ„ظ…ظˆط¸ظپظٹظ†', 'Employee Salaries', $2, 'expense', 'debit', FALSE, 0);
    `, [companyId, expenseId]);

    // Trade Debtors
    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '11201', 'ط§ظ„ظ…ط¯ظٹظ†ظˆظ† ط§ظ„طھط¬ط§ط±ظٹظˆظ†', 'Trade Customers', $2, 'asset', 'debit', FALSE, 0);
    `, [companyId, curAssetsId]);

    // Inventory
    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '11301', 'ط¨ط¶ط§ط¹ط© ط£ظˆظ„ ط§ظ„ظ…ط¯ط©', 'Opening Inventory', $2, 'asset', 'debit', FALSE, 0);
    `, [companyId, curAssetsId]);

    // Liabilities sub-accounts
    const liabRes = await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, type, nature, is_group)
      VALUES ($1, '2', 'ط§ظ„ط§ظ„طھط²ط§ظ…ط§طھ', 'Liabilities', 'liability', 'credit', TRUE) RETURNING id;
    `, [companyId]);
    const liabId = liabRes.rows[0].id;

    // Trade Creditors
    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '21101', 'ط§ظ„ط¯ط§ط¦ظ†ظˆظ† ط§ظ„طھط¬ط§ط±ظٹظˆظ†', 'Trade Suppliers', $2, 'liability', 'credit', FALSE, 0);
    `, [companyId, liabId]);

    // VAT Payable
    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '21301', 'ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©', 'VAT Payable', $2, 'liability', 'credit', FALSE, 0);
    `, [companyId, liabId]);

    // Additional revenue accounts
    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '41102', 'ظ…ط¨ظٹط¹ط§طھ ط§ظ„ط®ط¯ظ…ط§طھ', 'Services Sales', $2, 'revenue', 'credit', FALSE, 0);
    `, [companyId, revenueId]);

    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '41103', 'ظ…ط±ط¯ظˆط¯ط§طھ ط§ظ„ظ…ط¨ظٹط¹ط§طھ', 'Sales Returns', $2, 'revenue', 'credit', FALSE, 0);
    `, [companyId, revenueId]);

    // COGS
    await client.query(`
      INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
      VALUES ($1, '51101', 'طھظƒظ„ظپط© ط¨ط¶ط§ط¹ط© ظ…ط¨ط§ط¹ط©', 'Cost of Goods Sold', $2, 'expense', 'debit', FALSE, 0);
    `, [companyId, expenseId]);

    // 4. Seed basic settings
    await client.query(`
      INSERT INTO vat_settings (company_id, vat_rate, vat_number, is_inclusive, is_active)
      VALUES ($1, 15, '3100123456', false, true) ON CONFLICT DO NOTHING;
    `, [companyId]);

    await client.query(`
      INSERT INTO currencies (company_id, code, name, symbol, exchange_rate, is_default, is_active)
      VALUES ($1, 'YER', 'ط§ظ„ط±ظٹط§ظ„ ط§ظ„ظٹظ…ظ†ظٹ', 'ط±.ظٹ', 1, true, true) ON CONFLICT DO NOTHING;
    `, [companyId]);

    await client.query(`
      INSERT INTO branches (company_id, name, code, address, is_active)
      VALUES ($1, 'ط§ظ„ظپط±ط¹ ط§ظ„ط±ط¦ظٹط³ظٹ', 'HQ', 'طµظ†ط¹ط§ط، - ط´ط§ط±ط¹ ط§ظ„ط³طھظٹظ†', true) ON CONFLICT DO NOTHING;
    `, [companyId]);

    // 5. Seed document sequences
    const docSeqs = [
      { type: 'sales_invoice', prefix: 'INV-', start: 1, current: 1 },
      { type: 'quotation', prefix: 'QOT-', start: 1, current: 1 },
      { type: 'purchase_order', prefix: 'PO-', start: 1, current: 1 },
      { type: 'purchase_invoice', prefix: 'PINV-', start: 1, current: 1 },
      { type: 'journal_voucher', prefix: 'JV-', start: 1, current: 1 },
      { type: 'receipt_voucher', prefix: 'RV-', start: 1, current: 1 },
      { type: 'payment_voucher', prefix: 'PV-', start: 1, current: 1 },
    ];
    for (const s of docSeqs) {
      await client.query(`
        INSERT INTO document_sequences (company_id, document_type, prefix, suffix, starting_number, current_number, increment_step, padding_length, year_reset, is_active)
        VALUES ($1, $2, $3, '', $4, $5, 1, 4, false, true) ON CONFLICT DO NOTHING;
      `, [companyId, s.type, s.prefix, s.start, s.current]);
    }

    // 5-extra. Additional document sequences
    const additionalDocSeqs = [
      { type: 'sales_return', prefix: 'SR-', start: 1, current: 1 },
      { type: 'purchase_return', prefix: 'PR-', start: 1, current: 1 },
      { type: 'work_order', prefix: 'WO-', start: 1, current: 1 },
      { type: 'stock_adjustment', prefix: 'ADJ-', start: 1, current: 1 },
      { type: 'inventory_transfer', prefix: 'TRF-', start: 1, current: 1 },
      { type: 'payroll_run', prefix: 'PAY-', start: 1, current: 1 },
      { type: 'product', prefix: 'PRD-', start: 1, current: 1 },
      { type: 'customer', prefix: 'CUS-', start: 1, current: 1 },
      { type: 'supplier', prefix: 'SUP-', start: 1, current: 1 },
      { type: 'employee', prefix: 'EMP-', start: 1, current: 1 },
    ];
    for (const s of additionalDocSeqs) {
      await client.query(`
        INSERT INTO document_sequences (company_id, document_type, prefix, suffix, starting_number, current_number, increment_step, padding_length, year_reset, is_active)
        SELECT $1, $2, $3, '', $4, $5, 1, 6, FALSE, TRUE
        WHERE NOT EXISTS (SELECT 1 FROM document_sequences WHERE company_id = $1 AND document_type = $2);
      `, [companyId, s.type, s.prefix, s.start, s.current]);
    }

    // 5a. Seed default accounts
    const defaultAccountMappings = [
      { key: 'default_cash', code: '11101' },
      { key: 'default_sales', code: '41101' },
      { key: 'default_cogs', code: '51101' },
      { key: 'default_inventory', code: '11301' },
      { key: 'default_debtors', code: '11201' },
      { key: 'default_creditors', code: '21101' },
      { key: 'default_vat_output', code: '21301' },
      { key: 'default_vat_input', code: '21301' },
      { key: 'default_salaries', code: '52101' },
      { key: 'default_sales_returns', code: '41103' },
    ];
    for (const mapping of defaultAccountMappings) {
      const accRes = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1;`,
        [companyId, mapping.code]
      );
      if (accRes.rows.length > 0) {
        await client.query(`
          INSERT INTO default_accounts (company_id, function_key, account_id, is_required, description)
          VALUES ($1, $2, $3, true, '') ON CONFLICT DO NOTHING;
        `, [companyId, mapping.key, accRes.rows[0].id]);
      }
    }

    // 5a-extra. Additional default accounts
    const additionalDefaultAccounts = [
      { key: 'default_discount_allowed', code: '41101', required: false },
      { key: 'default_discount_received', code: '21101', required: false },
      { key: 'default_purchase_returns', code: '21101', required: true },
    ];
    for (const mapping of additionalDefaultAccounts) {
      const accRes = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1;`,
        [companyId, mapping.code]
      );
      if (accRes.rows.length > 0) {
        await client.query(`
          INSERT INTO default_accounts (company_id, function_key, account_id, is_required)
          SELECT $1, $2, $3, $4
          WHERE NOT EXISTS (SELECT 1 FROM default_accounts WHERE company_id = $1 AND function_key = $2);
        `, [companyId, mapping.key, accRes.rows[0].id, mapping.required]);
      }
    }

    // 5b. Seed product types
    await client.query(`
      INSERT INTO product_types (company_id, name_ar, name_en, code, appears_in_sales, appears_in_purchases, appears_in_inventory, has_stock_tracking)
      VALUES ($1, $2, $3, $4, true, true, true, true) ON CONFLICT DO NOTHING;
    `, [companyId, 'ط³ظ„ط¹ط© طھط¬ط§ط±ظٹط©', 'Trading Goods', 'TRADE']);

    // 5c. Seed units
    await client.query(`
      INSERT INTO units (company_id, name_ar, name_en, code, conversion_factor)
      VALUES ($1, $2, $3, $4, 1) ON CONFLICT DO NOTHING;
    `, [companyId, 'ظ‚ط·ط¹ط©', 'Piece', 'PC']);

    // 5d. Seed cash boxes
    const cashBoxAccRes = await client.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1;`,
      [companyId, '11101']
    );
    if (cashBoxAccRes.rows.length > 0) {
      await client.query(`
        INSERT INTO cash_boxes (company_id, name, code, current_balance, account_id)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING;
      `, [companyId, 'ط§ظ„طµظ†ط¯ظˆظ‚ ط§ظ„ط±ط¦ظٹط³ظٹ', 'MAIN-CB', 5000000, cashBoxAccRes.rows[0].id]);

      await client.query(`
        INSERT INTO cash_boxes (company_id, name, code, current_balance, account_id)
        SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (SELECT 1 FROM cash_boxes WHERE company_id = $1 AND code = $3);
      `, [companyId, 'طµظ†ط¯ظˆظ‚ ظپط±ط¹ ط§ظ„ط­ط¯ظٹط¯ط©', 'CB-HOD', 200000, cashBoxAccRes.rows[0].id]);

      await client.query(`
        INSERT INTO cash_boxes (company_id, name, code, current_balance, account_id)
        SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (SELECT 1 FROM cash_boxes WHERE company_id = $1 AND code = $3);
      `, [companyId, 'طµظ†ط¯ظˆظ‚ ظپط±ط¹ ط¹ط¯ظ†', 'CB-ADN', 300000, cashBoxAccRes.rows[0].id]);
    }

    // 5f. Seed cost centers
    await client.query(`
      INSERT INTO cost_centers (company_id, name_ar, name_en, code, type, budget_amount)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING;
    `, [companyId, 'ط§ظ„ظپط±ط¹ ط§ظ„ط±ط¦ظٹط³ظٹ', 'Main Branch', 'HQ', 'branch', 0]);

    await client.query(`
      INSERT INTO cost_centers (company_id, name_ar, name_en, code, type, budget_amount)
      SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (SELECT 1 FROM cost_centers WHERE company_id = $1 AND code = $4);
    `, [companyId, 'ظ‚ط³ظ… ط§ظ„ظ…ط¨ظٹط¹ط§طھ', 'Sales Department', 'CC-SAL', 'department', 1500000]);

    await client.query(`
      INSERT INTO cost_centers (company_id, name_ar, name_en, code, type, budget_amount)
      SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (SELECT 1 FROM cost_centers WHERE company_id = $1 AND code = $4);
    `, [companyId, 'ظ‚ط³ظ… ط§ظ„ط¥ظ†طھط§ط¬', 'Production Department', 'CC-PRD', 'department', 2500000]);

    // 5g. Seed payroll components
    const payrollComps = [
      { name_ar: 'ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹ', name_en: 'Base Salary', code: 'BAS', type: 'earning', method: 'fixed', amount: 0, gross: true, tax: true, ins: false },
      { name_ar: 'ط¨ط¯ظ„ ط³ظƒظ†', name_en: 'Housing Allowance', code: 'HOU', type: 'earning', method: 'fixed', amount: 150000, gross: true, tax: false, ins: false },
      { name_ar: 'ط¨ط¯ظ„ ظ†ظ‚ظ„', name_en: 'Transport Allowance', code: 'TRN', type: 'earning', method: 'fixed', amount: 50000, gross: true, tax: false, ins: false },
      { name_ar: 'ط¶ط±ظٹط¨ط© ط¯ط®ظ„', name_en: 'Income Tax', code: 'TAX', type: 'tax', method: 'formula', amount: 0, gross: false, tax: true, ins: false },
      { name_ar: 'طھط£ظ…ظٹظ†ط§طھ ط§ط¬طھظ…ط§ط¹ظٹط©', name_en: 'Social Insurance', code: 'INS', type: 'deduction', method: 'percentage', amount: 9, gross: false, tax: false, ins: true },
    ];
    for (const pc of payrollComps) {
      await client.query(`
        INSERT INTO payroll_components (company_id, name_ar, name_en, code, type, calculation_method, default_amount, affects_gross_salary, affects_tax, affects_social_insurance)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING;
      `, [companyId, pc.name_ar, pc.name_en, pc.code, pc.type, pc.method, pc.amount, pc.gross, pc.tax, pc.ins]);
    }

    // 6. Seed sample customer and supplier
    await client.query(`
      INSERT INTO customers (company_id, code, name, phone, email, address, balance, is_active)
      VALUES ($1, 'CUST-001', 'ط¹ظ…ظٹظ„ ط§ظپطھط±ط§ط¶ظٹ', '+967700000001', 'demo@customer.ye', 'طµظ†ط¹ط§ط،', 0, true) ON CONFLICT DO NOTHING;
    `, [companyId]);
    await client.query(`
      INSERT INTO suppliers (company_id, code, name, phone, email, address, balance, is_active)
      VALUES ($1, 'SUP-001', 'ظ…ظˆط±ط¯ ط§ظپطھط±ط§ط¶ظٹ', '+967700000002', 'demo@supplier.ye', 'ط¬ط¯ط©', 0, true) ON CONFLICT DO NOTHING;
    `, [companyId]);

    // Set created_by for seeded document tables
    await client.query(`UPDATE accounts SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]);
    await client.query(`UPDATE customers SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]);
    await client.query(`UPDATE suppliers SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]);
    try { await client.query(`UPDATE products SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE leads SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE opportunities SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE employees SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE work_orders SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE sales_invoices SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE purchase_invoices SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }
    try { await client.query(`UPDATE transactions SET created_by = $1 WHERE company_id = $2 AND created_by IS NULL`, [adminId, companyId]); } catch (e) { /* column may not exist yet */ }

    // 7. Seed activity log (defensive: skip if table doesn't exist)
    try {
      await client.query(`
        INSERT INTO activity_logs (company_id, user_id, user_name, action, module, details)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [
        companyId,
        adminId,
        'ط§ظ„ظ†ط¸ط§ظ…',
        'طھظ‡ظٹط¦ط© ظˆطھط؛ط°ظٹط© ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ MaghzAccountFlash35',
        'ط§ظ„ط£ط³ط§ط³ (Core)',
        `طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط¬ط¯ط§ظˆظ„ ط§ظ„ط£ط³ط§ط³ظٹط© ظˆطھط£ط³ظٹط³ ط¯ظ„ظٹظ„ ط§ظ„ط­ط³ط§ط¨ط§طھ ظ„ظ„ط´ط±ظƒط© "${companyId}" ط¨ط§ظ„ط±ظٹط§ظ„ ط§ظ„ظٹظ…ظ†ظٹ (YER) ط¨ظ†ط¬ط§ط­.`
      ]);
    } catch (logErr) {
      console.warn('[DB] Could not write activity log:', logErr.message);
    }

    await client.query('COMMIT');
    console.log('[DB] Initial data seeding completed with YER currency.');
    return { companyId, adminPassword: effectiveAdminPassword };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] Seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// â”€â”€â”€ IPC Handlers for Onboarding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function registerOnboardingHandlers() {
  // Test connection with provided config
  ipcMain.handle('db:test-connection', async (event, config, sessionToken) => {
    try {
      await assertOnboardingAllowed(event, sessionToken);
    } catch (err) {
      return { success: false, error: err.message };
    }
    const testPool = new Pool({
      host: config.host || 'localhost',
      port: parseInt(config.port || '5432'),
      database: config.database || 'postgres',
      user: config.user || 'postgres',
      password: config.password || '',
      connectionTimeoutMillis: 5000,
      max: 2,
    });
    try {
      const client = await testPool.connect();
      const result = await client.query('SELECT NOW() as time, current_database() as db, version() as version');
      client.release();
      await testPool.end();
      return { success: true, time: result.rows[0].time, db: result.rows[0].db, version: result.rows[0].version };
    } catch (err) {
      await testPool.end();
      return { success: false, error: err.message };
    }
  });

  // Update active pool config
  ipcMain.handle('db:update-config', async (event, config, sessionToken) => {
    try {
      await assertOnboardingAllowed(event, sessionToken);
    } catch (err) {
      return { success: false, error: err.message };
    }
    if (pool) {
      await pool.end();
    }
    pool = new Pool({
      host: config.host || 'localhost',
      port: parseInt(config.port || '5432'),
      database: config.database || 'MaghzAccountFlash35',
      user: config.user || 'maghz',
      password: config.password || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
    return { success: true };
  });

  // Get DB info
  ipcMain.handle('db:info', async () => {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT current_database() as db, NOW() as time');
      client.release();
      return { success: true, db: result.rows[0].db, time: result.rows[0].time };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Clear all data (factory reset) — requires confirmation + admin re-auth
  ipcMain.handle('db:clear-all', async (event, { confirm, password, sessionToken } = {}) => {
    try {
      const session = await assertOnboardingAllowed(event, sessionToken);

      if (confirm !== true) {
        return { success: false, error: 'Confirmation required for destructive operation' };
      }
      if (!isAdminSession(session)) {
        return { success: false, error: 'Admin session required to clear all data' };
      }

      // Re-authentication: re-enter the current admin's password to authorize
      // the wipe. Scoped to the session's company to avoid username collisions
      // across companies.
      const auth = await verifyAdminPassword(session.user.username, password, session.user.companyId);
      if (!auth.ok) return { success: false, error: 'Admin password required to clear all data' };

      writeSecurityAudit({
        action: 'db:clear-all',
        user: session.user.username,
        ip: 'ipc',
      });

      const client = wrapClient(await pool.connect());
      try {
        await client.query('BEGIN');

        // Get all table names in the public schema
        const tablesResult = await client.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename != 'pg_stat_statements'
        `);

        const tables = tablesResult.rows.map(r => r.tablename);
        console.log(`[DB] Clearing ${tables.length} tables...`);

        if (tables.length > 0) {
          // Drop all foreign key constraints first, then truncate
          const truncateList = tables.map(t => `"${t}"`).join(', ');
          await client.query(`TRUNCATE ${truncateList} CASCADE`);
        }

        await client.query('COMMIT');
        console.log('[DB] All data cleared successfully.');
        return { success: true, tablesCleared: tables.length };
      } catch (err) {
        console.error('[DB] Clear failed, rolling back:', err.message);
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[DB] Clear all error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Seed default data (chart of accounts, company, admin user, basic settings)
  ipcMain.handle('db:seed-default', async (event, { sessionToken, adminPassword } = {}) => {
    try {
      await assertOnboardingAllowed(event, sessionToken);
      const result = await seedInitialData(adminPassword);
      const companyId = typeof result === 'string' ? result : result?.companyId;
      const effectivePassword = typeof result === 'string' ? undefined : result?.adminPassword;
      if (!companyId) {
        // Data already exists â€” find the existing company
        const check = await pool.query('SELECT id FROM companies LIMIT 1');
        const existingId = check.rows[0]?.id;
        if (!existingId) {
          return { success: false, error: 'ظپط´ظ„ ط§ظ„ط¨ط°ط±: ظ„ط§ طھظˆط¬ط¯ ط¨ظٹط§ظ†ط§طھ ظˆظ„ط§ ظٹظ…ظƒظ† ط¥ظ†ط´ط§ط¦ظ‡ط§' };
        }
        return { success: true, companyId: existingId };
      }
      return { success: true, companyId, adminPassword: effectivePassword };
    } catch (err) {
      console.error('[DB] Seed failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Seed demo data (extensive fake data for all modules)
  ipcMain.handle('db:seed-demo', async (event, { sessionToken, adminPassword } = {}) => {
    try {
      await assertOnboardingAllowed(event, sessionToken);
      const companyCheck = await pool.query('SELECT id FROM companies LIMIT 1');
      let companyId;
      let effectivePassword;
      if (companyCheck.rows.length === 0) {
        const res = await seedInitialData(adminPassword);
        companyId = typeof res === 'string' ? res : res?.companyId;
        effectivePassword = typeof res === 'string' ? undefined : res?.adminPassword;
      } else {
        companyId = companyCheck.rows[0].id;
      }

      const client = wrapClient(await pool.connect());
      try {
        await client.query('BEGIN');
        await client.query('DEALLOCATE ALL');
        const demoResult = await seedComprehensiveDemoData(client, companyId, adminPassword);
        if (demoResult?.adminPassword) effectivePassword = demoResult.adminPassword;
        await client.query('COMMIT');
        console.log('[DB] Demo data seeded successfully.');
        return { success: true, companyId, adminPassword: effectivePassword };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[DB] Demo seeding failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[DB] Onboarding IPC handlers registered.');
}
