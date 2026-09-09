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
});
