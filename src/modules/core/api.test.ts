import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/validation', () => ({
  validateInput: vi.fn(() => ({ success: true })),
  companyIdSchema: {},
  idCompanySchema: {},
}));

import { getDbAdapter } from '@/core/database/adapters';
import { coreApi } from './api';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

function mockAdapter(
  impl: (sql: string, params?: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>,
) {
  const query = vi.fn(impl);
  vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  return query;
}

beforeEach(() => {
  vi.mocked(getDbAdapter).mockReset();
});

describe('coreApi row mapping (regression: snake_case flags)', () => {
  it('getCurrencies maps is_active/is_default/exchange_rate to camelCase', async () => {
    mockAdapter(async () => ({
      success: true,
      rows: [
        { id: 'u1', company_id: COMPANY_ID, code: 'YER', name: 'ريال', symbol: 'ر.ي', exchange_rate: '1', is_default: true, is_active: true },
        { id: 'u2', company_id: COMPANY_ID, code: 'USD', name: 'دولار', symbol: '$', exchange_rate: '1500', is_default: false, is_active: true },
      ],
    }));
    const res = await coreApi.getCurrencies(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[1].isActive).toBe(true);
    expect(res.data?.[1].isDefault).toBe(false);
    expect(res.data?.[1].exchangeRate).toBe(1500);
    // The currency dropdown disables inactive rows — with raw rows every
    // option computed disabled=true and nothing was selectable.
    expect(res.data?.every((c) => c.isActive)).toBe(true);
  });

  it('getVatSettings maps vat_rate/is_inclusive to camelCase', async () => {
    mockAdapter(async () => ({
      success: true,
      rows: [{ id: 'v1', company_id: COMPANY_ID, vat_rate: '15', vat_number: '123', is_inclusive: false, is_active: true }],
    }));
    const res = await coreApi.getVatSettings(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.vatRate).toBe(15);
    expect(res.data?.isInclusive).toBe(false);
  });

  it('getBranches maps is_active to camelCase', async () => {
    mockAdapter(async () => ({
      success: true,
      rows: [{ id: 'b1', company_id: COMPANY_ID, name: 'الرئيسي', is_active: true }],
    }));
    const res = await coreApi.getBranches(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].isActive).toBe(true);
    expect(res.data?.[0].companyId).toBe(COMPANY_ID);
  });
});
