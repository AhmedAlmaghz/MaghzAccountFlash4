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

describe('auto-routing — server detection on fresh desktop installs', () => {
  const MODE_KEY = 'maghzaccount-db-mode';
  const EXPLICIT_KEY = 'maghzaccount-db-mode-explicit';
  const ONBOARDING_KEY = 'maghzaccount-onboarding';

  function cleanStorage() {
    try {
      localStorage.removeItem(MODE_KEY);
      localStorage.removeItem(EXPLICIT_KEY);
      localStorage.removeItem(ONBOARDING_KEY);
    } catch { /* ignore */ }
    delete (window as unknown as Record<string, unknown>).electronDB;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cleanStorage();
  });

  afterEach(() => {
    cleanStorage();
  });

  async function freshIndex() {
    vi.resetModules();
    return import('./index');
  }

  function bridge(probe: { configured: boolean; reachable: boolean; source: string; db?: string }) {
    (window as unknown as Record<string, unknown>).electronDB = {
      ping: async () => ({ success: true }),
      probeServer: async () => ({ success: true, ...probe }),
    };
  }

  it('routes a fresh install to a reachable server and persists the verdict (not the explicit flag)', async () => {
    bridge({ configured: true, reachable: true, source: 'env', db: 'MaghzAccountFlash35' });
    const fresh = await freshIndex();
    const adapter = await fresh.getDbAdapter();
    expect(adapter).toBeTruthy();
    // PGlite was never booted…
    expect(mocks.ping).not.toHaveBeenCalled();
    // …and every mode reader (auth bridge, AI settings, relay check) now
    // agrees with the live adapter.
    expect(localStorage.getItem(MODE_KEY)).toBe('pg');
    expect(localStorage.getItem(EXPLICIT_KEY)).toBeNull();
  });

  it('stays on PGlite when no server is configured (today’s behaviour, byte for byte)', async () => {
    bridge({ configured: false, reachable: false, source: 'none' });
    const fresh = await freshIndex();
    await fresh.getDbAdapter();
    expect(mocks.ping).toHaveBeenCalled();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it('stays on PGlite when the env server is down (ambient hints never brick)', async () => {
    bridge({ configured: true, reachable: false, source: 'env' });
    const fresh = await freshIndex();
    await fresh.getDbAdapter();
    expect(mocks.ping).toHaveBeenCalled();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it('an explicit user choice pins the backend — a later server never overrides it', async () => {
    bridge({ configured: true, reachable: true, source: 'env', db: 'MaghzAccountFlash35' });
    try {
      localStorage.setItem(MODE_KEY, 'pglite');
      localStorage.setItem(EXPLICIT_KEY, '1');
    } catch { /* ignore */ }
    const fresh = await freshIndex();
    await fresh.getDbAdapter();
    expect(mocks.ping).toHaveBeenCalled();
    expect(localStorage.getItem(MODE_KEY)).toBe('pglite');
  });

  it('never auto-routes an existing PGlite install, even when a server appears', async () => {
    bridge({ configured: true, reachable: true, source: 'env', db: 'MaghzAccountFlash35' });
    try {
      // zustand-persist envelope shape: { state: { completed }, version }
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ state: { completed: true }, version: 0 }));
    } catch { /* ignore */ }
    const fresh = await freshIndex();
    await fresh.getDbAdapter();
    expect(mocks.ping).toHaveBeenCalled();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it('a saved vault connection that is down surfaces pg mode (honest error, no silent PGlite)', async () => {
    bridge({ configured: true, reachable: false, source: 'vault' });
    const fresh = await freshIndex();
    await fresh.getDbAdapter();
    // The user saved this connection in Settings: they meant it, so the
    // ladder must attempt the server path (which fails honestly downstream)
    // instead of quietly moving the company to another database.
    expect(localStorage.getItem(MODE_KEY)).toBe('pg');
    expect(mocks.ping).not.toHaveBeenCalled();
  });

  it('an unreadable onboarding envelope fails closed toward PGlite', async () => {
    bridge({ configured: true, reachable: true, source: 'env', db: 'MaghzAccountFlash35' });
    try {
      localStorage.setItem(ONBOARDING_KEY, 'not-json{{{');
    } catch { /* ignore */ }
    const fresh = await freshIndex();
    await fresh.getDbAdapter();
    expect(mocks.ping).toHaveBeenCalled();
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
