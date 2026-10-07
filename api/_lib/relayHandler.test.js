import { describe, it, expect, beforeEach } from 'vitest';

import { createRelayHandler, withWakeRetry, WAKE_RETRYABLE } from './relayHandler.js';
import { verifyRelayToken, issueRelayToken } from './relayAuth.js';

import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ENV = { MAGHZ_RELAY_SECRET: 'test-secret-that-is-long-enough-0123456789', ALLOW_PRIVATE_DB: '1' };
const URL = 'postgres://u:p@db.example.com:5432/app';
const CID = '00000000-0000-0000-0000-000000000001';
const UID = '00000000-0000-0000-0000-000000000099';

function hashPw(pw) {
  const salt = randomBytes(16).toString('hex');
  return `pbkdf2:100000:${salt}:${pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('hex')}`;
}

/** In-memory fake pg pool with call log. */
function makeFake({ users = [], roles = [], appliedMigrations = new Set(), failOn } = {}) {
  const log = [];
  const pool = {
    query: async (sql, params = []) => {
      log.push({ sql, params });
      if (failOn && failOn.test(sql)) throw new Error(failOn.message || 'boom');
      if (/FROM users WHERE username/i.test(sql)) return { rows: users };
      if (/FROM roles WHERE name/i.test(sql)) return { rows: roles };
      if (/FROM __pglite_migrations WHERE name/i.test(sql)) {
        return { rows: appliedMigrations.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      if (/INSERT INTO __pglite_migrations/i.test(sql)) {
        appliedMigrations.add(params[0]);
        return { rows: [] };
      }
      if (/^CREATE TABLE IF NOT EXISTS __pglite_migrations/i.test(sql)) return { rows: [] };
      return { rows: [{ id: 'row-1' }], rowCount: 1 };
    },
    connect: async () => ({
      query: async (sql, params = []) => {
        log.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (/FROM users WHERE username/i.test(sql)) return { rows: users };
        return pool.query(sql, params);
      },
      release: () => {},
    }),
    end: async () => {},
    __log: log,
  };
  return pool;
}

function handlerWith(fake, env = ENV) {
  return createRelayHandler({
    env,
    pgPool: () => fake,
    dnsLookup: async () => ['93.184.216.34'],
    readMigrations: async () => [
      { name: '0000_init', sql: 'CREATE TABLE IF NOT EXISTS t1 (id text)' },
      { name: '0001_x', sql: 'ALTER TABLE t1 ADD COLUMN IF NOT EXISTS c text' },
    ],
  });
}

function adminToken() {
  return issueRelayToken(
    { databaseUrl: URL, userId: UID, companyId: CID, role: 'admin', permissions: [] },
    ENV, Date.now(),
  );
}

describe('relayHandler — routing and parsing', () => {
  it('answers GET health without auth', async () => {
    const h = handlerWith(makeFake());
    const r = await h.handle({ method: 'GET', body: {}, headers: {}, clientIp: '1.1.1.1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, service: 'maghz-relay', version: '1' });
  });

  it('rejects non-POST and unknown actions', async () => {
    const h = handlerWith(makeFake());
    expect((await h.handle({ method: 'PUT', body: {}, headers: {}, clientIp: '1.1.1.1' })).status).toBe(405);
    expect((await h.handle({ method: 'POST', body: { action: 'nope' }, headers: {}, clientIp: '1.1.1.1' })).status).toBe(400);
  });

  it('parses URLs like the client parser (host/port/db/user/ssl)', () => {
    const { parseRelayUrl } = handlerWith(makeFake()).__test;
    const p = parseRelayUrl('postgresql://u:p@db.x.supabase.co:6543/postgres');
    expect(p).toMatchObject({ host: 'db.x.supabase.co', port: 6543, database: 'postgres', user: 'u', ssl: true });
    expect(parseRelayUrl('postgres://u:p@localhost/mydb').ssl).toBe(false);
    expect(() => parseRelayUrl('mysql://u:p@h/db')).toThrow(/postgres/);
  });
});

describe('relayHandler — pingdb', () => {
  it('rejects invalid URLs and blocked targets', async () => {
    const h = handlerWith(makeFake());
    expect(await h.handle({ method: 'POST', body: { action: 'pingdb', databaseUrl: 'junk' }, headers: {}, clientIp: '1.1.1.1' }))
      .toMatchObject({ status: 400 });
    const prod = createRelayHandler({
      env: { ...ENV, ALLOW_PRIVATE_DB: '0', NODE_ENV: 'production' },
      pgPool: () => makeFake(),
      dnsLookup: async () => ['10.0.0.9'],
    });
    expect(await prod.handle({ method: 'POST', body: { action: 'pingdb', databaseUrl: URL }, headers: {}, clientIp: '1.1.1.1' }))
      .toMatchObject({ status: 403 });
  });
});

describe('relayHandler — login', () => {  const pwHash = hashPw('admin1234');
  const users = [{
    id: UID, company_id: CID, username: 'admin', email: null, full_name: 'Admin',
    phone: null, photo_url: null, role: 'admin', branch_id: null, is_active: true, password_hash: pwHash,
  }];

  it('issues a db-bound token on valid credentials', async () => {
    const h = handlerWith(makeFake({ users, roles: [] }));
    const r = await h.handle({ method: 'POST', body: { action: 'login', databaseUrl: URL, username: 'admin', password: 'admin1234' }, headers: {}, clientIp: '5.5.5.5' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.user.username).toBe('admin');
    const v = verifyRelayToken(r.body.token, URL, ENV, Date.now());
    expect(v.ok).toBe(true);
    expect(v.session.user.companyId).toBe(CID);
  });

  it('rejects wrong passwords and rate-limits after 5 failures', async () => {
    const h = handlerWith(makeFake({ users, roles: [] }));
    const attempt = () => h.handle({ method: 'POST', body: { action: 'login', databaseUrl: URL, username: 'admin', password: 'nope' }, headers: {}, clientIp: '6.6.6.6' });
    for (let i = 0; i < 5; i++) {
      expect((await attempt()).body.code).toBe('bad-credentials');
    }
    expect((await attempt()).status).toBe(429);
  });

  it('refuses to mint tokens without a stable secret (fail closed, not doomed JWTs)', async () => {
    const h = createRelayHandler({
      env: { ALLOW_PRIVATE_DB: '1' },
      pgPool: () => makeFake({ users, roles: [] }),
      dnsLookup: async () => ['93.184.216.34'],
    });
    const r = await h.handle({ method: 'POST', body: { action: 'login', databaseUrl: URL, username: 'admin', password: 'admin1234' }, headers: {}, clientIp: '7.7.7.7' });
    expect(r).toMatchObject({ status: 500 });
    expect(r.body.code).toBe('unavailable');
  });
});

describe('relayHandler — query/transaction guards', () => {
  it('requires a token and enforces the SQL guard', async () => {
    const h = handlerWith(makeFake());
    expect(await h.handle({ method: 'POST', body: { action: 'query', databaseUrl: URL, sql: 'SELECT 1' }, headers: {}, clientIp: '1.1.1.1' }))
      .toMatchObject({ status: 401 });
    const bad = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, token: adminToken(), sql: 'DROP TABLE suppliers' },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(bad).toMatchObject({ status: 403 });
    const leak = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, token: adminToken(), sql: 'SELECT password_hash FROM users WHERE company_id = $1', params: [CID] },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(leak).toMatchObject({ status: 403 });
  });

  it('runs allowed reads and scopes tenants', async () => {
    const h = handlerWith(makeFake());
    const ok = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, token: adminToken(), sql: 'SELECT * FROM suppliers WHERE company_id = $1', params: [CID] },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    const other = '00000000-0000-0000-0000-000000000002';
    const cross = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, token: adminToken(), sql: 'SELECT * FROM suppliers WHERE company_id = $1', params: [other] },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(cross).toMatchObject({ status: 403 });
  });

  it('runs transactions atomically and rolls back on failure', async () => {
    const calls = [];
    const fake = makeFake();
    const origConnect = fake.connect.bind(fake);
    fake.connect = async () => {
      const c = await origConnect();
      const q = c.query.bind(c);
      c.query = async (sql, params) => {
        calls.push(sql);
        if (/FAIL_ME/.test(sql)) throw new Error('nope');
        return q(sql, params);
      };
      return c;
    };
    const h = handlerWith(fake);
    const good = await h.handle({
      method: 'POST',
      body: { action: 'transaction', databaseUrl: URL, token: adminToken(), queries: [{ sql: 'SELECT * FROM suppliers WHERE company_id = $1', params: [CID] }] },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(good.body.success).toBe(true);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    const bad = await h.handle({
      method: 'POST',
      body: { action: 'transaction', databaseUrl: URL, token: adminToken(), queries: [{ sql: 'SELECT * FROM no_such_table_xyz WHERE company_id = $1', params: [CID] }] },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(bad.body.success).toBe(false);
    const bad2 = await h.handle({
      method: 'POST',
      body: { action: 'transaction', databaseUrl: URL, token: adminToken(), queries: [] },
      headers: {}, clientIp: '1.1.1.1',
    });
    expect(bad2).toMatchObject({ status: 400 });
  });
});

describe('relayHandler — fresh-database provisioning (no JWT yet)', () => {
  function freshPool() {
    return {
      query: async (sql) => {
        if (/FROM users/i.test(sql)) return { rows: [{ n: 0 }] };
        if (/FROM __pglite_migrations WHERE name/i.test(sql)) return { rows: [] };
        return { rows: [{ id: 'row-1' }], rowCount: 1 };
      },
      connect: async () => ({
        query: async (sql) => {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (/FROM users/i.test(sql)) return { rows: [{ n: 0 }] };
          if (/FROM __pglite_migrations WHERE name/i.test(sql)) return { rows: [] };
          return { rows: [{ id: 'row-1' }], rowCount: 1 };
        },
        release: () => {},
      }),
      end: async () => {},
    };
  }

  function freshHandler() {
    return createRelayHandler({
      env: ENV,
      pgPool: () => freshPool(),
      dnsLookup: async () => ['93.184.216.34'],
      readMigrations: async () => [{ name: '0000_init', sql: 'CREATE TABLE IF NOT EXISTS t1 (id text)' }],
    });
  }

  it('allows setup DML without a token while the database is fresh', async () => {
    const h = freshHandler();
    const r = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, sql: 'INSERT INTO suppliers (company_id, name) VALUES ($1, $2)', params: ['c1', 's'] },
      headers: {},
      clientIp: '1.1.1.1',
    });
    expect(r).toMatchObject({ status: 200 });
    expect(r.body.success).toBe(true);
  });

  it('still bans DDL-by-client and catalogs in fresh mode', async () => {
    const h = freshHandler();
    const ddl = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, sql: 'CREATE TABLE evil (id text)' },
      headers: {},
      clientIp: '1.1.1.1',
    });
    expect(ddl).toMatchObject({ status: 403 });
    const cat = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, sql: 'SELECT * FROM pg_tables' },
      headers: {},
      clientIp: '1.1.1.1',
    });
    expect(cat).toMatchObject({ status: 403 });
  });

  it('runs server-side migrate without a token on a fresh database', async () => {
    const h = freshHandler();
    const r = await h.handle({ method: 'POST', body: { action: 'migrate', databaseUrl: URL }, headers: {}, clientIp: '1.1.1.1' });
    expect(r.body).toMatchObject({ success: true, applied: 1 });
  });

  it('demands a token once users exist (fresh window closed)', async () => {
    const users = [{ id: UID, company_id: CID, username: 'admin', is_active: true, password_hash: 'x', role: 'admin' }];
    const h = createRelayHandler({
      env: ENV,
      pgPool: () => makeFake({ users, roles: [] }),
      dnsLookup: async () => ['93.184.216.34'],
      readMigrations: async () => [],
    });
    const r = await h.handle({
      method: 'POST',
      body: { action: 'query', databaseUrl: URL, sql: 'SELECT * FROM suppliers WHERE company_id = $1', params: [CID] },
      headers: {},
      clientIp: '1.1.1.1',
    });
    expect(r).toMatchObject({ status: 401 });
    expect(r.body.code).toBe('expired-token');
  });
});

describe('relayHandler — migrate (admin only)', () => {
  it('refuses non-admin tokens', async () => {
    const h = handlerWith(makeFake());
    const viewerToken = issueRelayToken(
      { databaseUrl: URL, userId: UID, companyId: CID, role: 'viewer', permissions: [] }, ENV, Date.now(),
    );
    const r = await h.handle({ method: 'POST', body: { action: 'migrate', databaseUrl: URL, token: viewerToken }, headers: {}, clientIp: '1.1.1.1' });
    expect(r).toMatchObject({ status: 403 });
  });

  it('applies pending files once for admins', async () => {
    const applied = new Set(['0000_init']);
    const h = handlerWith(makeFake({ appliedMigrations: applied }));
    const r = await h.handle({ method: 'POST', body: { action: 'migrate', databaseUrl: URL, token: adminToken() }, headers: {}, clientIp: '1.1.1.1' });
    expect(r.body).toMatchObject({ success: true, applied: 1 });
    const again = await h.handle({ method: 'POST', body: { action: 'migrate', databaseUrl: URL, token: adminToken() }, headers: {}, clientIp: '1.1.1.1' });
    expect(again.body).toMatchObject({ success: true, applied: 0 });
  });
});

describe('relayHandler — cold-start wake tolerance', () => {
  it('retries timeout-class failures, not auth failures', async () => {
    expect(WAKE_RETRYABLE.test('TimeoutError: signal timed out')).toBe(true);
    expect(WAKE_RETRYABLE.test('password authentication failed')).toBe(false);
    expect(WAKE_RETRYABLE.test('syntax error at or near "x"')).toBe(false);
    let calls = 0;
    const r = await withWakeRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('TimeoutError: signal timed out');
      return 'awake';
    }, [1, 1]);
    expect(r).toBe('awake');
    expect(calls).toBe(3);
    await expect(withWakeRetry(async () => { throw new Error('password authentication failed'); }, [1])).rejects.toThrow(
      /password authentication failed/,
    );
    await expect(withWakeRetry(async () => { throw new Error('TimeoutError: x'); }, [])).rejects.toThrow(/TimeoutError/);
  });
});

describe('relayHandler — reset (onboarding start-fresh)', () => {
  const pwHashOf = (pw) => {
    const salt = randomBytes(16).toString('hex');
    return `pbkdf2:100000:${salt}:${pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('hex')}`;
  };
  const adminRow = (password) => ({
    id: UID, company_id: CID, username: 'admin', role: 'admin', is_active: true, password_hash: pwHashOf(password),
  });

  function resetFake() {
    const calls = [];
    const pool = {
      query: async (sql) => {
        calls.push(sql);
        if (/FROM users WHERE username/i.test(sql)) return { rows: [adminRow('admin1234')] };
        if (/FROM pg_tables/i.test(sql)) {
          // Faithful to the real statement's NOT IN (...) filter.
          return { rows: [{ tablename: 'suppliers' }] };
        }
        return { rows: [] };
      },
      connect: async () => { throw new Error('no client needed'); },
      end: async () => {},
    };
    return { pool, calls };
  }

  it('requires confirm + valid admin credentials, then truncates (migrations spared)', async () => {
    const { pool, calls } = resetFake();
    const h = createRelayHandler({
      env: ENV,
      pgPool: () => pool,
      dnsLookup: async () => ['93.184.216.34'],
    });
    const noConfirm = await h.handle({
      method: 'POST', body: { action: 'reset', databaseUrl: URL, username: 'admin', password: 'admin1234' }, headers: {}, clientIp: '1.1.1.1',
    });
    expect(noConfirm).toMatchObject({ status: 400 });
    const wrong = await h.handle({
      method: 'POST', body: { action: 'reset', databaseUrl: URL, confirm: true, username: 'admin', password: 'nope' }, headers: {}, clientIp: '1.1.1.1',
    });
    expect(wrong.body.code).toBe('bad-credentials');
    const ok = await h.handle({
      method: 'POST', body: { action: 'reset', databaseUrl: URL, confirm: true, username: 'admin', password: 'admin1234' }, headers: {}, clientIp: '1.1.1.1',
    });
    expect(ok.body).toMatchObject({ success: true });
    const truncate = calls.find((s) => s.startsWith('TRUNCATE'));
    expect(truncate).toContain('"suppliers"');
    // Migration-tracking tables are spared by the listing query itself —
    // PG enforces the NOT IN filter, so assert the statement carries it.
    const listing = calls.find((s) => s.includes('FROM pg_tables'));
    expect(listing).toContain("'__pglite_migrations'");
    expect(listing).toContain("'app_schema_migrations'");
  });
});
