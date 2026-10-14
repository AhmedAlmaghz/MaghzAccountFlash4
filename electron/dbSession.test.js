import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { hashPasswordNode } from '../api/_lib/dbPasswords.js';

/**
 * Main-process session lifecycle across pool-target changes.
 *
 * Switching databases (Settings → Database → activate) rebuilds the pool.
 * Sessions carry user/role/companyId authenticated against the OLD database —
 * letting them authorize queries on the NEW one is cross-database confusion
 * (a companyId from DB-A scoping rows in DB-B). The pool rebuild must drop
 * every session, so the next boot lands on the login page (fresh login
 * against the new target), never in onboarding with a stale identity.
 *
 * Also covers db:has-company: the sessionless existence probe that lets the
 * boot layer tell "populated database, go log in" apart from "empty
 * database, start onboarding".
 */

const handlers = {};
const pools = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((name, fn) => {
      handlers[name] = fn;
    }),
  },
  app: {
    getPath: (key) => (key === 'userData' ? globalThis.__TEST_USERDATA__ : key),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(String(s), 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  },
}));

class MockPool {
  constructor(config) {
    this.config = config;
    this.ended = false;
    pools.push(this);
  }

  on() {}

  async end() {
    this.ended = true;
  }

  async connect() {
    const self = this;
    return { query: (sql, params) => self.query(sql, params), release() {} };
  }

  async query(sql, params) {
    return globalThis.__TEST_PG_ROUTER__(sql, params, this);
  }
}

vi.mock('pg', () => ({ default: { Pool: MockPool } }));

const ADMIN_PASSWORD = 'admin1234valid';
let adminHash = '';

async function loadHandlers() {
  vi.resetModules();
  pools.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  const mod = await import('./dbHandler.js');
  mod.registerDatabaseHandlers();
  mod.registerAuthHandlers();
  mod.registerOnboardingHandlers();
  return mod;
}

function freshUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maghz-session-test-'));
  globalThis.__TEST_USERDATA__ = dir;
  return dir;
}

const SENDER = { sender: { id: 7 } };
const CLOUD_URL = 'postgres://u:p@cloud.example.com:5432/appdb';
const OTHER_URL = 'postgres://u:p@other.example.com:5432/appdb';

function baseRouter({ companies = [], adminRow = null } = {}) {
  return async (sql, params) => {
    if (/FROM companies/i.test(sql)) return { rows: companies };
    if (/FROM users WHERE username/i.test(sql)) {
      return { rows: adminRow ? [adminRow] : [] };
    }
    if (/FROM roles WHERE name/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };
}

function adminRow() {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    username: 'admin',
    email: null,
    full_name: 'Admin',
    phone: null,
    photo_url: null,
    role: 'admin',
    branch_id: null,
    is_active: true,
    password_hash: adminHash,
  };
}

describe('db pool-target changes invalidate main-process sessions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    freshUserData();
    if (!adminHash) adminHash = hashPasswordNode(ADMIN_PASSWORD);
    globalThis.__TEST_PG_ROUTER__ = baseRouter();
    await loadHandlers();
  });

  async function loginAsAdmin(senderId = 7) {
    globalThis.__TEST_PG_ROUTER__ = baseRouter({ adminRow: adminRow() });
    const r = await handlers['auth:login'](
      { sender: { id: senderId } },
      { username: 'admin', password: ADMIN_PASSWORD },
    );
    expect(r.success).toBe(true);
    expect(typeof r.sessionToken).toBe('string');
    return r.sessionToken;
  }

  async function saveConnection(url = CLOUD_URL) {
    const r = await handlers['db:connections-save'](
      SENDER,
      { sessionToken: null, name: 'Cloud', databaseUrl: url },
    );
    expect(r.success).toBe(true);
    return r.connection.id;
  }

  it('db:connections-set-active rebuilds the pool and kills pre-switch sessions', async () => {
    const token = await loginAsAdmin();
    expect(
      await handlers['auth:get-session'](SENDER, { sessionToken: token }),
    ).toMatchObject({ success: true });

    const id = await saveConnection();
    const poolsBefore = pools.length;
    const r = await handlers['db:connections-set-active'](SENDER, { sessionToken: null, id });
    expect(r).toMatchObject({ success: true });
    // Pool rebuilt from the vault target…
    expect(pools.length).toBeGreaterThan(poolsBefore);
    expect(pools[pools.length - 1].config.host).toBe('cloud.example.com');
    // …and the pre-switch session is dead: the next boot must show login,
    // never silently operate on the new database with the old identity.
    expect(
      await handlers['auth:get-session'](SENDER, { sessionToken: token }),
    ).toMatchObject({ success: false });
  });

  it('db:update-config rebuilds the pool and kills sessions too', async () => {
    const token = await loginAsAdmin();
    const r = await handlers['db:update-config'](
      SENDER,
      { sessionToken: token, databaseUrl: OTHER_URL },
    );
    expect(r.success).toBe(true);
    expect(pools[pools.length - 1].config.host).toBe('other.example.com');
    expect(
      await handlers['auth:get-session'](SENDER, { sessionToken: token }),
    ).toMatchObject({ success: false });
    // …while a fresh login against the new target works.
    const token2 = await loginAsAdmin();
    expect(
      await handlers['auth:get-session'](SENDER, { sessionToken: token2 }),
    ).toMatchObject({ success: true });
  });

  it('db:has-company answers without a session (populated vs empty vs broken)', async () => {
    globalThis.__TEST_PG_ROUTER__ = baseRouter({ companies: [{ '?column?': 1 }] });
    expect(await handlers['db:has-company'](SENDER, {})).toEqual({
      success: true,
      exists: true,
    });
    globalThis.__TEST_PG_ROUTER__ = baseRouter({ companies: [] });
    expect(await handlers['db:has-company'](SENDER, {})).toEqual({
      success: true,
      exists: false,
    });
    globalThis.__TEST_PG_ROUTER__ = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    };
    const down = await handlers['db:has-company'](SENDER, {});
    expect(down.success).toBe(false);
  });
});
