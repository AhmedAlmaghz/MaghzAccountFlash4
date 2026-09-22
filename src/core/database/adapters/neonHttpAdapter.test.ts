import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeon = vi.fn();

vi.mock('@neondatabase/serverless', () => ({
  neon: (...args: unknown[]) => mockNeon(...args),
}));

import { neonHttpAdapter, configureNeonHttp, resetNeonHttp } from './neonHttpAdapter';

const URL = 'postgres://user:s3cret@ep-x.aws.neon.tech:5432/appdb';

function fakeSql(impl: (sqlText: string, params?: unknown[]) => Promise<unknown[]>) {
  const query = vi.fn(impl);
  const fn = Object.assign(query, {
    query,
    transaction: vi.fn(async (qs: Promise<unknown[]>[]) => Promise.all(qs)),
  });
  return fn;
}

beforeEach(() => {
  resetNeonHttp();
  mockNeon.mockReset();
});

describe('configureNeonHttp', () => {
  it('rejects empty input', () => {
    expect(() => configureNeonHttp('  ')).toThrow(/empty/);
  });
  it('unconfigured adapter fails with guidance, not a crash', async () => {
    const r = await neonHttpAdapter.query('SELECT 1');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not configured/);
  });
});

describe('query', () => {
  it('returns normalized rows', async () => {
    mockNeon.mockReturnValue(fakeSql(async () => [{ total_amount: '1500.50', name: 'x' }]));
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.query<{ total_amount: number }>('SELECT * FROM t WHERE a = $1', ['v']);
    expect(r.success).toBe(true);
    expect(r.rows?.[0]?.total_amount).toBe(1500.5);
    expect(mockNeon).toHaveBeenCalledTimes(1);
  });
  it('maps driver errors to {success:false}', async () => {
    mockNeon.mockReturnValue(
      fakeSql(async () => {
        throw new Error('relation "nope" does not exist');
      }),
    );
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.query('SELECT * FROM nope');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/does not exist/);
  });
  it('redacts the password if it ever appears in an error', async () => {
    mockNeon.mockReturnValue(
      fakeSql(async () => {
        throw new Error('auth failed, tried password s3cret against db');
      }),
    );
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.query('SELECT 1');
    expect(r.success).toBe(false);
    expect(r.error).not.toContain('s3cret');
    expect(r.error).toContain('****');
  });
});

describe('transaction', () => {
  it('runs as a single driver transaction', async () => {
    const fn = fakeSql(async (s) => [{ ran: s }]);
    mockNeon.mockReturnValue(fn);
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.transaction([
      { sql: 'INSERT INTO a VALUES ($1)', params: [1] },
      { sql: 'UPDATE b SET x = $1', params: [2] },
    ]);
    expect(r.success).toBe(true);
    expect(fn.transaction).toHaveBeenCalledTimes(1);
    expect(r.results).toHaveLength(2);
  });
});

describe('ping', () => {
  it('reports the database name', async () => {
    mockNeon.mockReturnValue(fakeSql(async () => [{ db: 'appdb' }]));
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.ping();
    expect(r).toEqual({ success: true, db: 'appdb' });
  });
});

describe('updateConfig', () => {
  it('binds a DATABASE_URL', async () => {
    mockNeon.mockReturnValue(fakeSql(async () => [{ db: 'appdb' }]));
    const r = await neonHttpAdapter.updateConfig({ databaseUrl: URL });
    expect(r.success).toBe(true);
    const ping = await neonHttpAdapter.ping();
    expect(ping.success).toBe(true);
  });
  it('is a harmless no-op without a URL', async () => {
    const r = await neonHttpAdapter.updateConfig({});
    expect(r.success).toBe(true);
  });
});

describe('clearAll', () => {
  it('requires confirmation', async () => {
    const r = await neonHttpAdapter.clearAll({});
    expect(r.success).toBe(false);
  });
  it('truncates every public table in one transaction', async () => {
    const fn = fakeSql(async (s) => (s.includes('pg_tables') ? [{ tablename: 't1' }, { tablename: 't2' }] : []));
    mockNeon.mockReturnValue(fn);
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.clearAll({ confirm: true });
    expect(r.success).toBe(true);
    expect(fn.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('getCompany', () => {
  it('returns the first company row', async () => {
    mockNeon.mockReturnValue(fakeSql(async () => [{ id: 'c1', name: 'Co' }]));
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.getCompany();
    expect(r).toEqual({ success: true, data: { id: 'c1', name: 'Co' } });
  });
  it('reports no company on empty', async () => {
    mockNeon.mockReturnValue(fakeSql(async () => []));
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.getCompany();
    expect(r.success).toBe(false);
  });
});

describe('seedDefault', () => {
  it('fails fast when the remote schema cannot be ensured', async () => {
    mockNeon.mockReturnValue(
      fakeSql(async () => {
        throw new Error('connection refused');
      }),
    );
    configureNeonHttp(URL);
    const r = await neonHttpAdapter.seedDefault('admin1234');
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
