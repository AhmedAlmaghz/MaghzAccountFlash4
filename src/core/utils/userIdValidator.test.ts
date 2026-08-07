import { describe, it, expect, beforeEach, vi } from 'vitest';
import { safeUserId, resolveExistingUserId, clearUserIdCache, isUuid } from './userIdValidator';

const VALID_UUID = '27ab12b2-a7f1-4465-ad47-db2ed461b731';
const MISSING_UUID = '3776241e-a274-434b-9dc5-6e6798531eca';

describe('safeUserId', () => {
  it('returns null for null/undefined/empty', () => {
    expect(safeUserId(null)).toBeNull();
    expect(safeUserId(undefined)).toBeNull();
    expect(safeUserId('')).toBeNull();
    expect(safeUserId('   ')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(safeUserId(123)).toBeNull();
    expect(safeUserId({})).toBeNull();
    expect(safeUserId([])).toBeNull();
    expect(safeUserId(true)).toBeNull();
  });

  it('returns null for invalid UUID format', () => {
    expect(safeUserId('not-a-uuid')).toBeNull();
    expect(safeUserId('12345')).toBeNull();
    expect(safeUserId('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')).toBeNull();
    expect(safeUserId('27ab12b2-a7f1-4465-ad47-db2ed461b731x')).toBeNull();
  });

  it('returns the UUID for valid format', () => {
    expect(safeUserId(VALID_UUID)).toBe(VALID_UUID);
    expect(safeUserId(VALID_UUID.toUpperCase())).toBe(VALID_UUID.toLowerCase());
    expect(safeUserId(`  ${VALID_UUID}  `)).toBe(VALID_UUID);
  });
});

describe('isUuid', () => {
  it('validates UUID v4 format', () => {
    expect(isUuid(VALID_UUID)).toBe(true);
    expect(isUuid(MISSING_UUID)).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(isUuid('hello')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

describe('resolveExistingUserId', () => {
  beforeEach(() => {
    clearUserIdCache();
  });

  it('returns null for invalid format without querying DB', async () => {
    const adapter = { query: vi.fn() };
    expect(await resolveExistingUserId(adapter, 'not-a-uuid')).toBeNull();
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('returns the id when user exists', async () => {
    const adapter = {
      query: vi.fn().mockResolvedValue({ success: true, rows: [{ '?column?': 1 }] }),
    };
    expect(await resolveExistingUserId(adapter, VALID_UUID)).toBe(VALID_UUID);
    expect(adapter.query).toHaveBeenCalledWith(
      'SELECT 1 FROM users WHERE id = $1::uuid AND is_active = true LIMIT 1',
      [VALID_UUID]
    );
  });

  it('returns null when user does not exist (stale UUID from prior session)', async () => {
    const adapter = {
      query: vi.fn().mockResolvedValue({ success: true, rows: [] }),
    };
    expect(await resolveExistingUserId(adapter, MISSING_UUID)).toBeNull();
  });

  it('returns null when query fails', async () => {
    const adapter = {
      query: vi.fn().mockResolvedValue({ success: false, error: 'boom' }),
    };
    expect(await resolveExistingUserId(adapter, VALID_UUID)).toBeNull();
  });

  it('caches results so repeated calls do not re-query', async () => {
    const adapter = {
      query: vi.fn().mockResolvedValue({ success: true, rows: [{ '?column?': 1 }] }),
    };
    await resolveExistingUserId(adapter, VALID_UUID);
    await resolveExistingUserId(adapter, VALID_UUID);
    await resolveExistingUserId(adapter, VALID_UUID);
    expect(adapter.query).toHaveBeenCalledTimes(1);
  });

  it('caches negative results too', async () => {
    const adapter = {
      query: vi.fn().mockResolvedValue({ success: true, rows: [] }),
    };
    await resolveExistingUserId(adapter, MISSING_UUID);
    await resolveExistingUserId(adapter, MISSING_UUID);
    expect(adapter.query).toHaveBeenCalledTimes(1);
  });

  it('treats thrown errors as missing user (defense in depth)', async () => {
    const adapter = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    expect(await resolveExistingUserId(adapter, VALID_UUID)).toBeNull();
  });

  it('the fix: stale localStorage UUID is replaced with null', async () => {
    const adapter = {
      query: vi.fn().mockResolvedValue({ success: true, rows: [] }),
    };
    expect(await resolveExistingUserId(adapter, MISSING_UUID)).toBeNull();
  });
});
