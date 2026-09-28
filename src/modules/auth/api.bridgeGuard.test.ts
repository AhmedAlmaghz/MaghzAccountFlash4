import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The auth module has a second guard idiom that a scanner cannot see.
 *
 * Every other module forks on `isElectronPg()`; auth forks on
 * `mainAuthBridge()`, which is non-null only when the preload bridge exists AND
 * the db mode is server-PG. The raw `adapter.query` fallback underneath is then
 * unreachable, because on Electron the adapter's `query` forwards straight to
 * the legacy `db:internal-query` channel.
 *
 * Whether that guard is real depends on control flow, not on a string matching
 * a regex: `if (mainAuth) { return }`, `if (mainAuth) return`,
 * `if (mainAuth?.listRoles)` and `if (!mainAuth) { ...adapter... }` are all
 * valid shapes, and a regex written for one will silently pass a method whose
 * guard has been broken into the fourth. Four regexes later, the honest move is
 * to stop pattern-matching and observe the behaviour.
 *
 * So: with a bridge present, no auth method may touch the adapter. That is the
 * property that matters, and it fails the moment any guard regresses.
 */
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
  getDbMode: vi.fn(() => 'pg'),
}));

vi.mock('@/core/utils/validation', () => ({
  validateInput: vi.fn(() => ({ success: true, data: {} })),
  companyIdSchema: {},
  idCompanySchema: {},
  updateUserSchema: {},
  createUserSchema: {},
}));

import { authApi } from './api';
import { getDbAdapter, getDbMode } from '@/core/database/adapters';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';

let query: ReturnType<typeof vi.fn>;

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge: Record<string, unknown> = {
    login: vi.fn(async () => ({ success: true, user: { id: USER_ID }, permissions: [] })),
    getSession: vi.fn(async () => ({ success: true, user: { id: USER_ID }, permissions: [] })),
    logout: vi.fn(async () => ({ success: true })),
    listUsers: vi.fn(async () => ({ success: true, data: [] })),
    getUserById: vi.fn(async () => ({ success: true, data: { id: USER_ID, username: 'admin' } })),
    createUser: vi.fn(async () => ({ success: true, id: USER_ID })),
    updateUser: vi.fn(async () => ({ success: true })),
    resetPassword: vi.fn(async () => ({ success: true })),
    updateProfile: vi.fn(async () => ({ success: true, user: { id: USER_ID } })),
    changePassword: vi.fn(async () => ({ success: true })),
    deleteUser: vi.fn(async () => ({ success: true })),
    listRoles: vi.fn(async () => ({ success: true, data: [] })),
    createRole: vi.fn(async () => ({ success: true, id: USER_ID })),
    updateRole: vi.fn(async () => ({ success: true })),
    deleteRole: vi.fn(async () => ({ success: true })),
    getAuditLogs: vi.fn(async () => ({ success: true, data: [] })),
    ...overrides,
  };
  (window as unknown as Record<string, unknown>).electronAuth = bridge;
  return bridge;
}

beforeEach(() => {
  query = vi.fn(async () => ({ success: true, rows: [] }));
  vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  vi.mocked(getDbMode).mockReturnValue('pg');
  delete (window as unknown as Record<string, unknown>).electronAuth;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronAuth;
  vi.restoreAllMocks();
});

describe('the auth main-process bridge is authoritative on desktop', () => {
  it('no auth method falls through to the adapter when the bridge is present', async () => {
    installBridge();

    await authApi.login({ username: 'admin', password: 'x' });
    await authApi.getUsers(COMPANY_ID);
    await authApi.getUserById(COMPANY_ID, USER_ID);
    await authApi.createUser({ username: 'u', password: 'p' } as never);
    await authApi.updateUser(COMPANY_ID, USER_ID, {});
    await authApi.deleteUser(COMPANY_ID, USER_ID);
    await authApi.resetPassword(COMPANY_ID, USER_ID, 'Abc12345');
    await authApi.updateProfile(COMPANY_ID, USER_ID, {});
    await authApi.changePasswordSelf(COMPANY_ID, 'Old12345', 'New12345');
    await authApi.getRoles(COMPANY_ID);
    await authApi.createRole(COMPANY_ID, { name: 'r', permissions: [] } as never);
    await authApi.updateRole(COMPANY_ID, USER_ID, { name: 'r' } as never);
    await authApi.deleteRole(COMPANY_ID, USER_ID);
    await authApi.getAuditLogs(COMPANY_ID);

    expect(query, 'an auth method reached adapter.query on the desktop bridge path')
      .not.toHaveBeenCalled();
  });

  it('getUserById asks the main process, which scopes the company to the session', async () => {
    const bridge = installBridge();
    const res = await authApi.getUserById(COMPANY_ID, USER_ID);

    expect(res.success).toBe(true);
    expect(bridge.getUserById).toHaveBeenCalledWith(USER_ID);
    // The company must not travel in the payload: the main process owns it.
    expect(vi.mocked(bridge.getUserById as never).mock.calls[0]).toEqual([USER_ID]);
  });

  it('drops to the adapter when the bridge is absent (browser/PGlite)', async () => {
    query = vi.fn(async () => ({
      success: true,
      rows: [{ id: USER_ID, username: 'admin', company_id: COMPANY_ID }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

    const res = await authApi.getUserById(COMPANY_ID, USER_ID);
    expect(res.success).toBe(true);
    expect(query).toHaveBeenCalled();
  });

  it('ignores the bridge unless the mode is server-PG', async () => {
    installBridge();
    vi.mocked(getDbMode).mockReturnValue('pglite');
    query = vi.fn(async () => ({
      success: true,
      rows: [{ id: USER_ID, username: 'admin', company_id: COMPANY_ID }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

    const res = await authApi.getUserById(COMPANY_ID, USER_ID);
    expect(res.success).toBe(true);
    expect(query, 'a PGlite database lives in the renderer, so the fallback is correct')
      .toHaveBeenCalled();
  });
});
