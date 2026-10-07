import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ping: vi.fn(async () => ({ success: true, db: 'PGlite (local)' })),
  runMigrations: vi.fn(async () => ({ success: true })),
}));

vi.mock('./pgliteAdapter', () => ({
  pgliteAdapter: {
    ping: mocks.ping,
    query: vi.fn(async () => ({ success: true, rows: [] })),
  },
  runPgliteMigrations: mocks.runMigrations,
}));

import { getDbAdapter, isElectronPg } from './index';

describe('getDbAdapter — ping cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.removeItem('maghzaccount-db-mode');
    } catch { /* ignore */ }
  });

  it('pings once then trusts the cached adapter within the TTL', async () => {
    const first = await getDbAdapter();
    const second = await getDbAdapter();

    expect(first).toBe(second);
    expect(mocks.ping).toHaveBeenCalledTimes(1);
  });

  it('C1: a wedged acquisition rejects after 15s with an honest Arabic error (never hangs)', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const fresh = await import('./index');
      mocks.runMigrations.mockImplementationOnce(() => new Promise(() => {})); // wedged IDB/WASM
      const pending = fresh.getDbAdapter();
      const assertion = expect(pending).rejects.toThrow(/انتهت مهلة الاتصال بقاعدة البيانات/);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('C1: a slow-but-healthy acquisition under the ceiling still resolves', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const fresh = await import('./index');
      mocks.runMigrations.mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r({ success: true }), 5_000)),
      );
      const pending = fresh.getDbAdapter();
      await vi.advanceTimersByTimeAsync(5_000);
      const adapter = await pending;
      expect(adapter).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isElectronPg — mode-aware routing (desktop auth-required regression)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('maghzaccount-db-mode');
    } catch { /* ignore */ }
    delete (window as unknown as Record<string, unknown>).electronDB;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronDB;
    try {
      localStorage.removeItem('maghzaccount-db-mode');
    } catch { /* ignore */ }
  });

  it('is false without a bridge even in pg mode', () => {
    try {
      localStorage.setItem('maghzaccount-db-mode', 'pg');
    } catch { /* ignore */ }
    expect(isElectronPg()).toBe(false);
  });

  it('is false with a bridge but local-PGlite mode (no main session exists there)', () => {
    (window as unknown as Record<string, unknown>).electronDB = { ping: async () => ({ success: true }) };
    try {
      localStorage.setItem('maghzaccount-db-mode', 'pglite');
    } catch { /* ignore */ }
    // Routing renderer traffic to the main process here produced
    // "Authentication required" on saves: the main pool holds no session
    // for a database it never authenticated against.
    expect(isElectronPg()).toBe(false);
  });

  it('is true only with a bridge AND server-PG mode', () => {
    (window as unknown as Record<string, unknown>).electronDB = { ping: async () => ({ success: true }) };
    try {
      localStorage.setItem('maghzaccount-db-mode', 'pg');
    } catch { /* ignore */ }
    expect(isElectronPg()).toBe(true);
  });
});
