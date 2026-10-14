import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { electronPgAdapter } from './electronPgAdapter';

/**
 * getCompany must distinguish "populated database, no session" (→ login
 * page) from "empty database" (→ onboarding). The typed RPC derives the
 * company from the session, so after a reload/DB-switch there is often no
 * session yet — and folding that 'Authentication required' into
 * 'No company found' sent every logged-out boot into the onboarding wizard
 * (wiping the completed flag), instead of the login page.
 */
const SURFACES = [
  'accounting',
  'inventory',
  'contacts',
  'crm',
  'manufacturing',
  'hr',
  'sales',
  'pos',
  'tax',
  'purchases',
  'audit',
  'core',
] as const;

function bridge(options: {
  getCompanyResult: unknown;
  hasCompanyResult?: unknown;
  withHasCompany?: boolean;
}) {
  const core: Record<string, unknown> = {
    getCompany: vi.fn(async () => options.getCompanyResult),
  };
  const db: Record<string, unknown> = {
    ping: vi.fn(async () => ({ success: true })),
    core,
  };
  for (const name of SURFACES) {
    if (!(name in db)) db[name] = {};
  }
  if (options.withHasCompany !== false) {
    db.hasCompany = vi.fn(async () => options.hasCompanyResult);
  }
  (window as unknown as Record<string, unknown>).electronDB = db;
  return db;
}

describe('electronPgAdapter.getCompany — auth failure vs empty database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronDB;
  });

  it('returns the company row when the session is alive', async () => {
    bridge({
      getCompanyResult: { success: true, rows: [{ id: 'c1', name: 'Co' }] },
      hasCompanyResult: { success: true, exists: true },
    });
    const r = await electronPgAdapter.getCompany();
    expect(r).toEqual({ success: true, data: { id: 'c1', name: 'Co' } });
  });

  it('preserves Authentication required when the database is populated (→ login, not onboarding)', async () => {
    bridge({
      getCompanyResult: { success: false, error: 'Authentication required' },
      hasCompanyResult: { success: true, exists: true },
    });
    const r = await electronPgAdapter.getCompany();
    expect(r).toEqual({ success: false, error: 'Authentication required' });
  });

  it('reports No company found when the database is truly empty', async () => {
    bridge({
      getCompanyResult: { success: false, error: 'Authentication required' },
      hasCompanyResult: { success: true, exists: false },
    });
    const r = await electronPgAdapter.getCompany();
    expect(r).toEqual({ success: false, error: 'No company found' });
  });

  it('falls back to the legacy mapping when the bridge predates hasCompany', async () => {
    bridge({
      getCompanyResult: { success: false, error: 'Authentication required' },
      withHasCompany: false,
    });
    const r = await electronPgAdapter.getCompany();
    expect(r).toEqual({ success: false, error: 'No company found' });
  });
});
