import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

import { getDbAdapter } from '@/core/database/adapters';
import {
  mapCompanyRow,
  getCompany,
  updateCompany,
  createCompany,
  applyOnboardingCompany,
} from './company';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

function mockAdapter(
  impl: (sql: string, params?: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>,
) {
  const query = vi.fn(impl);
  const getCompanyFn = vi.fn();
  const updateCompanyFn = vi.fn();
  vi.mocked(getDbAdapter).mockResolvedValue({
    query,
    getCompany: getCompanyFn,
    updateCompany: updateCompanyFn,
  } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  return { query, getCompanyFn, updateCompanyFn };
}

beforeEach(() => {
  vi.mocked(getDbAdapter).mockReset();
});

describe('mapCompanyRow', () => {
  it('maps snake_case columns to camelCase with defaults', () => {
    const c = mapCompanyRow({
      id: COMPANY_ID,
      name: 'شركة الاختبار',
      currency: 'USD',
      decimal_places: '3',
      fiscal_year_start: '2026-01-01T00:00:00.000Z',
    });
    expect(c.id).toBe(COMPANY_ID);
    expect(c.name).toBe('شركة الاختبار');
    expect(c.currency).toBe('USD');
    expect(c.decimalPlaces).toBe(3);
    expect(c.fiscalYearStart).toBe('2026-01-01');
    expect(c.dateFormat).toBe('yyyy-MM-dd');
    expect(c.calendar).toBe('gregorian');
    expect(c.nameEn).toBeUndefined();
  });

  it('normalizes hijri calendar and passes gregorian through', () => {
    expect(mapCompanyRow({ calendar: 'hijri' }).calendar).toBe('hijri');
    expect(mapCompanyRow({ calendar: 'something-else' }).calendar).toBe('gregorian');
  });
});

describe('getCompany', () => {
  it('returns the mapped company from the adapter', async () => {
    const { getCompanyFn } = mockAdapter(async () => ({ success: true, rows: [] }));
    getCompanyFn.mockResolvedValue({
      success: true,
      data: { id: COMPANY_ID, name: 'N', currency: 'YER' },
    });
    const res = await getCompany();
    expect(res.success).toBe(true);
    expect(res.data?.id).toBe(COMPANY_ID);
    expect(res.data?.currency).toBe('YER');
  });

  it('fails honestly when no company row exists', async () => {
    const { getCompanyFn } = mockAdapter(async () => ({ success: true, rows: [] }));
    getCompanyFn.mockResolvedValue({ success: false, error: 'No company found' });
    const res = await getCompany();
    expect(res.success).toBe(false);
  });
});

describe('updateCompany', () => {
  it('rejects an empty name before touching the database', async () => {
    const { updateCompanyFn } = mockAdapter(async () => ({ success: true, rows: [] }));
    const res = await updateCompany(COMPANY_ID, { name: '   ', currency: 'YER' }, null);
    expect(res.success).toBe(false);
    expect(updateCompanyFn).not.toHaveBeenCalled();
  });

  it('rejects decimalPlaces outside 0-6', async () => {
    const { updateCompanyFn } = mockAdapter(async () => ({ success: true, rows: [] }));
    const res = await updateCompany(COMPANY_ID, { name: 'N', currency: 'YER', decimalPlaces: 9 }, null);
    expect(res.success).toBe(false);
    expect(updateCompanyFn).not.toHaveBeenCalled();
  });

  it('delegates the full profile to the adapter', async () => {
    const { updateCompanyFn } = mockAdapter(async () => ({ success: true, rows: [] }));
    updateCompanyFn.mockResolvedValue({ success: true });
    const res = await updateCompany(
      COMPANY_ID,
      { name: 'N', currency: 'SAR', calendar: 'hijri', decimalPlaces: 3, fiscalYearStart: '2026-01-01' },
      null,
    );
    expect(res.success).toBe(true);
    const [payload, passedUser] = updateCompanyFn.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(payload.id).toBe(COMPANY_ID);
    expect(payload.currency).toBe('SAR');
    expect(payload.calendar).toBe('hijri');
    expect(payload.fiscalYearStart).toBe('2026-01-01');
    expect(passedUser).toBeNull();
  });
});

describe('createCompany', () => {
  it('inserts all profile columns and returns the id', async () => {
    const { query } = mockAdapter(async () => ({ success: true, rows: [{ id: COMPANY_ID }] }));
    const res = await createCompany({ name: 'New Co', currency: 'USD' }, null);
    expect(res.success).toBe(true);
    expect(res.id).toBe(COMPANY_ID);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO companies/);
    expect(sql).toMatch(/fiscal_year_start/);
    expect(params[0]).toBe('New Co');
    expect(params[2]).toBe('USD');
  });
});

describe('applyOnboardingCompany', () => {
  it('updates the seeded row when one exists', async () => {
    const { getCompanyFn, updateCompanyFn, query } = mockAdapter(async () => ({ success: true, rows: [] }));
    getCompanyFn
      .mockResolvedValueOnce({ success: true, data: { id: COMPANY_ID, name: 'Old', currency: 'YER' } })
      .mockResolvedValueOnce({
        success: true,
        data: { id: COMPANY_ID, name: 'Onboarded Co', currency: 'SAR' },
      });
    updateCompanyFn.mockResolvedValue({ success: true });
    void query;

    const res = await applyOnboardingCompany({
      name: 'Onboarded Co',
      nameEn: '',
      currency: 'SAR',
      taxNumber: '',
      address: '',
      phone: '',
      email: '',
      calendar: 'gregorian',
      decimalPlaces: 2,
      dateFormat: 'yyyy-MM-dd',
      fiscalYearStart: '2026-01-01',
    });
    expect(res.success).toBe(true);
    expect(res.data?.name).toBe('Onboarded Co');
    expect(updateCompanyFn).toHaveBeenCalledTimes(1);
  });

  it('creates the row when none exists (seed-none path)', async () => {
    const { getCompanyFn, query } = mockAdapter(async (_sql, params) => ({
      success: true,
      rows: [{ id: params?.[0] === 'Seedless Co' ? COMPANY_ID : COMPANY_ID }],
    }));
    getCompanyFn
      .mockResolvedValueOnce({ success: false, error: 'No company found' })
      .mockResolvedValueOnce({ success: true, data: { id: COMPANY_ID, name: 'Seedless Co', currency: 'YER' } });

    const res = await applyOnboardingCompany({
      name: 'Seedless Co',
      nameEn: '',
      currency: 'YER',
      taxNumber: '',
      address: '',
      phone: '',
      email: '',
    });
    expect(res.success).toBe(true);
    expect(query).toHaveBeenCalled();
  });

  it('never throws — transport failures become an honest error', async () => {
    vi.mocked(getDbAdapter).mockRejectedValue(new Error('Authentication required'));
    const res = await applyOnboardingCompany({
      name: 'X',
      nameEn: '',
      currency: 'YER',
      taxNumber: '',
      address: '',
      phone: '',
      email: '',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Authentication required/);
  });
});
