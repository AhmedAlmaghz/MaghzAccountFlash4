import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'main' as 'main' | 'worker',
  mainCalls: [] as string[],
  workerCalls: [] as string[],
}));

vi.mock('./transportMode', () => ({
  getTransportMode: vi.fn(() => state.mode),
  setTransportMode: vi.fn(),
}));

vi.mock('./pgliteTransport', () => ({
  getInstance: vi.fn(),
  mainThreadTransport: {
    queryRaw: vi.fn(async (sql: string) => {
      state.mainCalls.push(`q:${sql}`);
      return { rows: [{ v: 'main' }], rowCount: 1 };
    }),
    execRaw: vi.fn(async (sql: string) => {
      state.mainCalls.push(`e:${sql}`);
    }),
  },
}));

vi.mock('./pgliteWorkerTransport', () => ({
  getWorkerTransport: vi.fn(() => ({
    queryRaw: vi.fn(async (sql: string) => {
      state.workerCalls.push(`q:${sql}`);
      return { rows: [{ v: 'worker' }], rowCount: 1 };
    }),
    execRaw: vi.fn(async (sql: string) => {
      state.workerCalls.push(`e:${sql}`);
    }),
  })),
}));

import { pgliteAdapter } from './pgliteAdapter';

/**
 * Step-3 routing matrix (unit level): the flag flips the WHOLE engine —
 * reads, writes, transactions and migrations together (per-query splitting
 * is unsound on one IndexedDB lock). Real-boot equivalence rides on
 * pgliteSmoke (main path, real WASM); the worker real-boot matrix belongs
 * to the browser rollout.
 */
describe('pgliteAdapter transport routing', () => {
  beforeEach(() => {
    state.mainCalls.length = 0;
    state.workerCalls.length = 0;
  });

  it('main mode executes reads on the main transport only', async () => {
    state.mode = 'main';
    const out = await pgliteAdapter.query('SELECT 1');
    expect(out.success).toBe(true);
    expect(state.mainCalls.some((c) => c.startsWith('q:SELECT 1'))).toBe(true);
    expect(state.workerCalls).toHaveLength(0);
  });

  it('worker mode executes reads on the worker transport only', async () => {
    state.mode = 'worker';
    const out = await pgliteAdapter.query('SELECT 1');
    expect(out.success).toBe(true);
    expect(state.workerCalls.some((c) => c.startsWith('q:SELECT 1'))).toBe(true);
    expect(state.mainCalls).toHaveLength(0);
  });

  it('worker mode executes writes on the worker transport only', async () => {
    state.mode = 'worker';
    const out = await pgliteAdapter.query('UPDATE t SET a = $1', [1]);
    expect(out.success).toBe(true);
    expect(state.workerCalls.some((c) => c.startsWith('q:UPDATE'))).toBe(true);
    expect(state.mainCalls).toHaveLength(0);
  });

  it('worker mode runs transactions on the worker transport (BEGIN/COMMIT)', async () => {
    state.mode = 'worker';
    const out = await pgliteAdapter.transaction([{ sql: 'SELECT 1' }]);
    expect(out.success).toBe(true);
    expect(state.workerCalls).toContain('e:BEGIN');
    expect(state.workerCalls).toContain('e:COMMIT');
    expect(state.mainCalls).toHaveLength(0);
  });

  it('worker mode pings through the worker transport', async () => {
    state.mode = 'worker';
    const out = await pgliteAdapter.ping();
    expect(out.success).toBe(true);
    expect(state.workerCalls.some((c) => c.includes('version()'))).toBe(true);
    expect(state.mainCalls).toHaveLength(0);
  });
});
