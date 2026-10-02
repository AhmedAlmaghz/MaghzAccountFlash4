import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { getDbAdapter } from './index';

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
