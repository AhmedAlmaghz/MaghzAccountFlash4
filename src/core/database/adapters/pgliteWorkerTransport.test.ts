import { describe, expect, it, vi } from 'vitest';
import { WorkerTransport } from './pgliteWorkerTransport';
import type { WorkerDb } from './pgliteWorkerTransport';

const fakeDb = (overrides?: Partial<WorkerDb>): WorkerDb & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push(`query:${sql}:${JSON.stringify(params ?? [])}`);
      return { rows: [{ n: 1 }] };
    }),
    exec: vi.fn(async (sql: string) => {
      calls.push(`exec:${sql}`);
    }),
    ...overrides,
  };
};

/**
 * WorkerTransport slice-2 lock: protocol behaviour with fake workers only —
 * no real Worker boot, no WASM. The dual-transport matrix (real boot on
 * both paths) belongs to step 3.
 */
describe('pgliteWorkerTransport slice-2', () => {
  it('queryRaw returns rows + rowCount and defaults params to []', async () => {
    const db = fakeDb();
    const t = new WorkerTransport(async () => db);
    const out = await t.queryRaw('SELECT 1', undefined);
    expect(out).toEqual({ rows: [{ n: 1 }], rowCount: 1 });
    expect(db.calls[0]).toBe('query:SELECT 1:[]');
  });

  it('execRaw forwards the statement', async () => {
    const db = fakeDb();
    const t = new WorkerTransport(async () => db);
    await t.execRaw('BEGIN');
    expect(db.calls).toEqual(['exec:BEGIN']);
  });

  it('boots once for many calls (single-flight)', async () => {
    const db = fakeDb();
    const factory = vi.fn(async () => db);
    const t = new WorkerTransport(factory);
    await Promise.all([t.queryRaw('SELECT 1'), t.queryRaw('SELECT 2'), t.execRaw('COMMIT')]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('a poisoned boot does not stick — next call retries', async () => {
    const db = fakeDb();
    let attempts = 0;
    const t = new WorkerTransport(async () => {
      attempts++;
      if (attempts === 1) throw new Error('IDB locked');
      return db;
    });
    await expect(t.queryRaw('SELECT 1')).rejects.toThrow('IDB locked');
    const out = await t.queryRaw('SELECT 1');
    expect(out.rowCount).toBe(1);
    expect(attempts).toBe(2);
  });

  it('a hung query rejects with a named timeout instead of hanging', async () => {
    const hung: WorkerDb = {
      query: () => new Promise<never>(() => {}),
      exec: async () => {},
    };
    const t = new WorkerTransport(async () => hung, 20);
    await expect(t.queryRaw('SELECT pg_sleep(999)')).rejects.toThrow('worker query timed out');
  });

  it('engine errors surface as Error(message) across the boundary', async () => {
    const failing = fakeDb({
      query: async () => {
        throw new Error('column "nope" does not exist');
      },
    });
    const t = new WorkerTransport(async () => failing);
    await expect(t.queryRaw('SELECT nope')).rejects.toThrow('column "nope" does not exist');
  });
});
