import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCountryProfile, listCountryProfiles, isSupportedCountry, DEFAULT_COUNTRY_CODE } from './registry';
import {
  getCompanyTaxContext,
  setCompanyTaxContext as _setCompanyTaxContext,
  computeVat,
  assertPeriodOpen,
  openTaxPeriod,
  setTaxPeriodStatus,
  listTaxPeriods,
  computeVatReturn,
} from './engine';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';

function stubDb(impl: (sql: string, params: unknown[]) => { success: boolean; rows?: unknown[]; error?: string }) {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => impl(sql, params)),
  };
}

describe('tax registry', () => {
  it('serves SA/AE/EG/YE profiles with correct standard rates', () => {
    expect(getCountryProfile('SA').vat.standard).toBe(0.15);
    expect(getCountryProfile('AE').vat.standard).toBe(0.05);
    expect(getCountryProfile('EG').vat.standard).toBe(0.14);
    expect(getCountryProfile('YE').vat.standard).toBe(0);
    expect(listCountryProfiles()).toHaveLength(4);
    expect(DEFAULT_COUNTRY_CODE).toBe('YE');
  });

  it('falls back to the zero-rate YE profile for unknown codes', () => {
    expect(getCountryProfile('XX').countryCode).toBe('YE');
    expect(getCountryProfile('').countryCode).toBe('YE');
    expect(isSupportedCountry('SA')).toBe(true);
    expect(isSupportedCountry('XX')).toBe(false);
  });

  it('SA e-invoicing is mandatory, AE is not (yet)', () => {
    expect(getCountryProfile('SA').eInvoicing.required).toBe(true);
    expect(getCountryProfile('AE').eInvoicing.required).toBe(false);
    expect(getCountryProfile('EG').eInvoicing.required).toBe(true);
  });
});

describe('country document validators', () => {
  it('SA flags a missing seller VAT number + wrong 15% math', () => {
    const sa = getCountryProfile('SA');
    expect(sa.validateDocument({ kind: 'sales_invoice', subtotal: 1000, vatAmount: 150, totalAmount: 1150 })).toContain(
      'missing-seller-vat-number'
    );
    expect(
      sa.validateDocument({ kind: 'sales_invoice', date: '2026-01-01', sellerTaxNumber: '3100123456', subtotal: 1000, vatAmount: 100, totalAmount: 1100 })
    ).toContain('vat-not-15pct-of-net');
    expect(
      sa.validateDocument({ kind: 'sales_invoice', date: '2026-01-01', sellerTaxNumber: '3100123456', subtotal: 1000, vatAmount: 150, totalAmount: 1150 })
    ).toEqual([]);
  });

  it('YE (zero-rate) rejects any charged VAT', () => {
    const ye = getCountryProfile('YE');
    expect(
      ye.validateDocument({ kind: 'sales_invoice', subtotal: 1000, vatAmount: 50, totalAmount: 1050 })
    ).toContain('vat-charged-under-zero-rate-profile');
  });
});

describe('company tax context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to YE when unset', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(stubDb(async () => ({ success: true, rows: [] })) as never);
    const ctx = await getCompanyTaxContext('comp-1');
    expect(ctx.countryCode).toBe('YE');
    expect(ctx.profile.vat.standard).toBe(0);
  });

  it('loads country + timezone from settings keys', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async () => ({
        success: true,
        rows: [
          { key: 'tax.country_code', value: 'SA' },
          { key: 'tax.timezone', value: 'Asia/Riyadh' },
        ],
      })) as never
    );
    const ctx = await getCompanyTaxContext('comp-1');
    expect(ctx.countryCode).toBe('SA');
    expect(ctx.timezone).toBe('Asia/Riyadh');
    expect(ctx.profile.vat.standard).toBe(0.15);
  });

  it('computeVat applies the profile standard rate', () => {
    expect(computeVat(1000, getCountryProfile('SA'))).toBe(150);
    expect(computeVat(1000, getCountryProfile('AE'))).toBe(50);
    expect(computeVat(1000, getCountryProfile('YE'))).toBe(0);
  });
});

describe('period guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is open when no period covers the date (legacy data posts freely)', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(stubDb(async () => ({ success: true, rows: [] })) as never);
    const res = await assertPeriodOpen('comp-1', '2026-09-15');
    expect(res.open).toBe(true);
  });

  it('rejects dates inside closed/filed periods', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async () => ({
        success: true,
        rows: [{ id: 'p1', company_id: 'comp-1', country_code: 'SA', period_type: 'monthly', start_date: '2026-08-01', end_date: '2026-08-31', status: 'filed', filed_at: '2026-09-05' }],
      })) as never
    );
    const res = await assertPeriodOpen('comp-1', '2026-08-15');
    expect(res.open).toBe(false);
    if (!res.open) expect(res.period.status).toBe('filed');
  });

  it('lets open periods through', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async () => ({
        success: true,
        rows: [{ id: 'p1', company_id: 'comp-1', country_code: 'SA', period_type: 'monthly', start_date: '2026-09-01', end_date: '2026-09-30', status: 'open', filed_at: null }],
      })) as never
    );
    const res = await assertPeriodOpen('comp-1', '2026-09-15');
    expect(res.open).toBe(true);
  });
});

describe('period lifecycle + VAT return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a period idempotently and lists newest-first', async () => {
    const queries: string[] = [];
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO tax_periods')) return { success: true, rows: [{ id: 'p-new' }] };
        if (sql.includes('FROM tax_periods')) {
          return {
            success: true,
            rows: [
              { id: 'p2', company_id: 'c', country_code: 'SA', period_type: 'monthly', start_date: '2026-09-01', end_date: '2026-09-30', status: 'open', filed_at: null },
              { id: 'p1', company_id: 'c', country_code: 'SA', period_type: 'monthly', start_date: '2026-08-01', end_date: '2026-08-31', status: 'filed', filed_at: '2026-09-05' },
            ],
          };
        }
        return { success: true, rows: [] };
      }) as never
    );
    const opened = await openTaxPeriod('comp-1', { countryCode: 'SA', periodType: 'monthly', startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(opened.success).toBe(true);
    expect(opened.id).toBe('p-new');
    expect(queries.some((q) => q.includes('ON CONFLICT (company_id, start_date, end_date)'))).toBe(true);
    const list = await listTaxPeriods('comp-1');
    expect(list[0].id).toBe('p2');
  });

  it('computes the return from posted JE legs (output − input)', async () => {
    // Deterministic mock: output legs vs input legs routed by account id.
    vi.mocked(getDbAdapter).mockResolvedValue(
      {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          if (sql.includes('FROM settings')) return { success: true, rows: [] };
          if (sql.includes('FROM default_accounts')) {
            const key = String(params[1]);
            return { success: true, rows: [{ account_id: key === 'default_vat_output' ? 'ACC-OUT' : 'ACC-IN' }] };
          }
          if (sql.includes('FROM journal_entries')) {
            const acc = String(params[1]);
            // output account: Cr 1500 − Dr 150 (return reversal) = 1350 net
            if (acc === 'ACC-OUT') return { success: true, rows: [{ cr: 1500, dr: 150 }] };
            return { success: true, rows: [{ dr: 400, cr: 0 }] };
          }
          return { success: true, rows: [] };
        }),
      } as never
    );

    const period = {
      id: 'p1', companyId: 'comp-1', countryCode: 'SA', periodType: 'monthly',
      startDate: '2026-09-01', endDate: '2026-09-30', status: 'closed' as const, filedAt: null,
    };
    const res = await computeVatReturn('comp-1', period);
    expect(res.success, res.error || '').toBe(true);
    expect(res.data?.outputVat).toBe(1350);
    expect(res.data?.inputVat).toBe(400);
    expect(res.data?.netPayable).toBe(950);
    expect(res.data?.payable).toBe(true);
  });

  it('fails honestly when VAT accounts are unconfigured', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql: string) => {
        if (sql.includes('FROM settings')) return { success: true, rows: [] };
        return { success: true, rows: [] };
      }) as never
    );
    const period = {
      id: 'p1', companyId: 'comp-1', countryCode: 'SA', periodType: 'monthly',
      startDate: '2026-09-01', endDate: '2026-09-30', status: 'open' as const, filedAt: null,
    };
    const res = await computeVatReturn('comp-1', period);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });

  it('setTaxPeriodStatus flips status', async () => {
    const queries: string[] = [];
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        queries.push(sql);
        return { success: true, rows: [] };
      }) as never
    );
    const res = await setTaxPeriodStatus('comp-1', 'p1', 'closed');
    expect(res.success).toBe(true);
    expect(queries.some((q) => q.includes('UPDATE tax_periods'))).toBe(true);
  });
});
