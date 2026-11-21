import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { getDbAdapter } from './adapters';
import { checkDatabaseHasData } from './databaseSetup';

const setBridge = (bridge: unknown) => {
  (window as unknown as { electronDB?: unknown }).electronDB = bridge;
};

describe('checkDatabaseHasData — existing-database onboarding probe', () => {
  beforeEach(() => {
    delete (window as unknown as { electronDB?: unknown }).electronDB;
    vi.mocked(getDbAdapter).mockReset();
  });

  it('Electron: reads bridge probes, company null (no session)', async () => {
    setBridge({
      hasCompany: vi.fn().mockResolvedValue({ success: true, exists: true }),
      hasUsers: vi.fn().mockResolvedValue({ success: true, hasUsers: true }),
    });
    expect(await checkDatabaseHasData()).toEqual({ exists: true, hasUsers: true, company: null });
  });

  it('Electron: exists=false when the company row is missing', async () => {
    setBridge({
      hasCompany: vi.fn().mockResolvedValue({ success: true, exists: false }),
      hasUsers: vi.fn().mockResolvedValue({ success: true, hasUsers: false }),
    });
    expect(await checkDatabaseHasData()).toEqual({ exists: false, hasUsers: false, company: null });
  });

  it('Electron: surfaces a hasCompany bridge failure', async () => {
    setBridge({ hasCompany: vi.fn().mockResolvedValue({ success: false, error: 'nope' }) });
    expect(await checkDatabaseHasData()).toEqual({ error: 'nope' });
  });

  it('Electron: surfaces a hasUsers bridge failure', async () => {
    setBridge({
      hasCompany: vi.fn().mockResolvedValue({ success: true, exists: true }),
      hasUsers: vi.fn().mockResolvedValue({ success: false, error: 'users check failed' }),
    });
    expect(await checkDatabaseHasData()).toEqual({ error: 'users check failed' });
  });

  it('Electron: missing hasUsers bridge is an honest error', async () => {
    setBridge({ hasCompany: vi.fn().mockResolvedValue({ success: true, exists: true }) });
    const r = await checkDatabaseHasData();
    expect(r).toHaveProperty('error');
  });

  it('Web/PGlite/relay: counts companies + users via adapter.query', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue({
      query: vi.fn().mockResolvedValue({ success: true, rows: [{ name: 'Maghz Co', companies: '2', user_count: '1' }] }),
    } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
    expect(await checkDatabaseHasData()).toEqual({ exists: true, hasUsers: true, company: 'Maghz Co' });
  });

  it('Web: no company → exists=false, no users', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue({
      query: vi.fn().mockResolvedValue({ success: true, rows: [{ name: null, companies: '0', user_count: '0' }] }),
    } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
    expect(await checkDatabaseHasData()).toEqual({ exists: false, hasUsers: false, company: null });
  });

  it('Web: propagates adapter.query failure', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue({
      query: vi.fn().mockResolvedValue({ success: false, error: 'pg down' }),
    } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
    expect(await checkDatabaseHasData()).toEqual({ error: 'pg down' });
  });
});
