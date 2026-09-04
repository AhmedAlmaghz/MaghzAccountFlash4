import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pbkdf2Sync, randomBytes, webcrypto } from 'node:crypto';

// jsdom ships without crypto.subtle — provide Node's WebCrypto so the
// PBKDF2 round-trip below exercises the REAL verify/hash path.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/validation', () => ({
  validateInput: vi.fn(() => ({ success: true })),
  companyIdSchema: {},
  idCompanySchema: {},
}));

import { authApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const STRONG_PASSWORD = 'NewPassword12345';

const HAS_SUBTLE = typeof crypto !== 'undefined' && !!crypto.subtle;

function makeStoredHash(password: string): string {
  const salt = randomBytes(32).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2:100000:${salt}:${hash}`;
}

function mockAdapter(
  impl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>,
) {
  const query = vi.fn(impl);
  vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  return query;
}

beforeEach(() => {
  vi.mocked(getDbAdapter).mockReset();
  delete (window as unknown as Record<string, unknown>).electronAuth;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronAuth;
  vi.restoreAllMocks();
});

describe('meetsPasswordPolicy (client mirror of main-process policy)', () => {
  it('accepts 12+ chars with a letter and a digit', () => {
    expect(authApi.meetsPasswordPolicy('NewPassword12345')).toBe(true);
  });

  it('accepts Arabic letters as the letter component', () => {
    expect(authApi.meetsPasswordPolicy('كلمةسرجديدة12')).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(authApi.meetsPasswordPolicy('Abc123')).toBe(false);
  });

  it('rejects passwords without a digit', () => {
    expect(authApi.meetsPasswordPolicy('NewPasswordLong')).toBe(false);
  });

  it('rejects passwords without a letter', () => {
    expect(authApi.meetsPasswordPolicy('12345678901234')).toBe(false);
  });
});

describe('changePasswordSelf (PGlite fallback)', () => {
  it('rejects a weak new password without touching the database', async () => {
    const query = mockAdapter(async () => ({ success: true, rows: [] }));
    const res = await authApi.changePasswordSelf(COMPANY_ID, USER_ID, 'anything123456', 'short');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/السياسة/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a wrong current password and never issues the UPDATE', async () => {
    const seen: string[] = [];
    mockAdapter(async (sql) => {
      seen.push(sql);
      if (sql.startsWith('SELECT password_hash')) {
        return { success: true, rows: [{ password_hash: 'garbage-not-a-hash' }] };
      }
      return { success: true, rows: [] };
    });
    const res = await authApi.changePasswordSelf(COMPANY_ID, USER_ID, 'WrongPassword99', STRONG_PASSWORD);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/الحالية/);
    expect(seen.some((s) => s.startsWith('UPDATE users SET password_hash'))).toBe(false);
  });

  it.runIf(HAS_SUBTLE)('verifies the current password then stores a fresh hash', async () => {
    const current = 'CurrentPassword99';
    const seenParams: unknown[][] = [];
    const query = mockAdapter(async (sql, params) => {
      if (sql.startsWith('SELECT password_hash')) {
        return { success: true, rows: [{ password_hash: makeStoredHash(current) }] };
      }
      seenParams.push(params);
      return { success: true, rows: [] };
    });
    const res = await authApi.changePasswordSelf(COMPANY_ID, USER_ID, current, STRONG_PASSWORD);
    expect(res.success).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(seenParams[0][0])).toMatch(/^pbkdf2:100000:/);
    expect(seenParams[0][2]).toBe(USER_ID);
    expect(seenParams[0][3]).toBe(COMPANY_ID);
  });
});

describe('changePasswordSelf (Electron IPC)', () => {
  it('delegates to the session-scoped channel without adapter access', async () => {
    const changePassword = vi.fn(async () => ({ success: true }));
    (window as unknown as Record<string, unknown>).electronAuth = { changePassword };
    const query = mockAdapter(async () => ({ success: true, rows: [] }));
    const res = await authApi.changePasswordSelf(COMPANY_ID, USER_ID, 'CurrentPassword99', STRONG_PASSWORD);
    expect(res.success).toBe(true);
    expect(changePassword).toHaveBeenCalledWith('CurrentPassword99', STRONG_PASSWORD);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('updateProfile (PGlite fallback)', () => {
  it('persists full name, phone and photo in one guarded UPDATE', async () => {
    const seenParams: unknown[][] = [];
    const query = mockAdapter(async (sql, params) => {
      seenParams.push([sql, ...params]);
      return { success: true, rows: [] };
    });
    const res = await authApi.updateProfile(COMPANY_ID, USER_ID, {
      fullName: '  أحمد محمد  ',
      phone: '777000111',
      photoUrl: 'data:image/png;base64,AAA',
    });
    expect(res.success).toBe(true);
    const [sql, fullName, phone, photoUrl, , id, companyId] = seenParams[0];
    expect(String(sql)).toMatch(/photo_url = \$3/);
    expect(fullName).toBe('أحمد محمد');
    expect(phone).toBe('777000111');
    expect(photoUrl).toBe('data:image/png;base64,AAA');
    expect(id).toBe(USER_ID);
    expect(companyId).toBe(COMPANY_ID);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('updateProfile (Electron IPC)', () => {
  it('delegates to auth:update-profile and maps the returned user', async () => {
    const updateProfile = vi.fn(async () => ({
      success: true,
      user: { id: USER_ID, username: 'ahmed', fullName: 'أحمد' },
    }));
    (window as unknown as Record<string, unknown>).electronAuth = { updateProfile };
    const query = mockAdapter(async () => ({ success: true, rows: [] }));
    const res = await authApi.updateProfile(COMPANY_ID, USER_ID, { fullName: 'أحمد' });
    expect(res.success).toBe(true);
    expect(updateProfile).toHaveBeenCalledWith({ fullName: 'أحمد', phone: null, photoUrl: null });
    expect(res.user).toMatchObject({ id: USER_ID });
    expect(query).not.toHaveBeenCalled();
  });
});
