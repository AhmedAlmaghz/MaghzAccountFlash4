import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';
import {
  getFiscalYearBounds,
  assertAccountingPeriodOpen,
  openAccountingPeriod,
  previewFiscalClose,
  closeFiscalYear,
} from './yearEnd';

// Real zod validation runs here (not mocked) — Zod 4 strict UUIDs need a
// version (1-8) and variant (8/9/a/b) nibble, so no all-zeros UUID.
const COMPANY_ID = '11111111-2222-4333-8444-555555555555';

type Row = Record<string, unknown>;
type Impl = (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: Row[]; error?: string }>;

function mockDb(impl: Impl) {
  const tx: Array<{ sql: string; params?: unknown[] }> = [];
  const adapter = {
    query: vi.fn(impl),
    transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
      for (const q of queries) {
        const r = await impl(q.sql, q.params || []);
        if (!r.success) return { success: false, error: r.error };
        tx.push(q);
      }
      return { success: true, results: [] };
    }),
  };
  vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
  return { adapter, tx };
}

describe('getFiscalYearBounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to the calendar year when the company has no fiscal start', async () => {
    mockDb(async () => ({ success: true, rows: [] }));
    const b = await getFiscalYearBounds(COMPANY_ID, 2025);
    expect(b).toEqual({ year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' });
  });

  it('honors a mid-year fiscal start (April year)', async () => {
    mockDb(async (sql) => {
      if (sql.includes('FROM companies')) return { success: true, rows: [{ fiscal_year_start: '2024-04-01' }] };
      return { success: true, rows: [] };
    });
    const b = await getFiscalYearBounds(COMPANY_ID, 2025);
    expect(b).toEqual({ year: 2025, startDate: '2025-04-01', endDate: '2026-03-31' });
  });
});

describe('assertAccountingPeriodOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is open when no period covers the date (legacy data posts freely)', async () => {
    mockDb(async () => ({ success: true, rows: [] }));
    expect(await assertAccountingPeriodOpen(COMPANY_ID, '2025-06-01')).toEqual({ open: true });
  });

  it('refuses dates inside a closed period', async () => {
    mockDb(async () => ({
      success: true,
      rows: [{ id: 'p1', company_id: COMPANY_ID, year: 2024, start_date: '2024-01-01', end_date: '2024-12-31', status: 'closed', closed_at: '2025-01-05' }],
    }));
    const res = await assertAccountingPeriodOpen(COMPANY_ID, '2024-06-01');
    expect(res.open).toBe(false);
    if (!res.open) expect(res.period.year).toBe(2024);
  });

  it('allows dates inside an open period', async () => {
    mockDb(async () => ({
      success: true,
      rows: [{ id: 'p1', company_id: COMPANY_ID, year: 2025, start_date: '2025-01-01', end_date: '2025-12-31', status: 'open', closed_at: null }],
    }));
    expect(await assertAccountingPeriodOpen(COMPANY_ID, '2025-06-01')).toEqual({ open: true });
  });

  it('allows malformed dates (fail-open like the tax guard)', async () => {
    const { adapter } = mockDb(async () => ({ success: true, rows: [] }));
    expect(await assertAccountingPeriodOpen(COMPANY_ID, 'not-a-date')).toEqual({ open: true });
    expect(adapter.query).not.toHaveBeenCalled();
  });
});

describe('openAccountingPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects absurd years', async () => {
    mockDb(async () => ({ success: true, rows: [] }));
    expect((await openAccountingPeriod(COMPANY_ID, 1999)).success).toBe(false);
    expect((await openAccountingPeriod(COMPANY_ID, 2200)).success).toBe(false);
  });

  it('creates the row with fiscal bounds', async () => {
    const { adapter } = mockDb(async (sql) => {
      if (sql.includes('FROM companies')) return { success: true, rows: [] };
      if (sql.startsWith('INSERT INTO accounting_periods')) {
        return { success: true, rows: [{ id: 'p1', company_id: COMPANY_ID, year: 2025, start_date: '2025-01-01', end_date: '2025-12-31', status: 'open', closed_at: null }] };
      }
      return { success: true, rows: [] };
    });
    const res = await openAccountingPeriod(COMPANY_ID, 2025);
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('open');
    expect(adapter.query).toHaveBeenCalled();
  });
});

describe('previewFiscalClose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits revenue debits from expense credits and nets the year', async () => {
    mockDb(async (sql) => {
      if (sql.includes('FROM companies')) return { success: true, rows: [] };
      if (sql.includes('FROM accounts')) {
        return {
          success: true,
          rows: [
            { account_id: 'a-rev', code: '41101', name: 'مبيعات', type: 'revenue', rev_net: 1000, exp_net: 0 },
            { account_id: 'a-exp', code: '52101', name: 'رواتب', type: 'expense', rev_net: 0, exp_net: 400 },
          ],
        };
      }
      return { success: true, rows: [] };
    });
    const res = await previewFiscalClose(COMPANY_ID, 2024);
    expect(res.success).toBe(true);
    expect(res.data?.revenue).toBe(1000);
    expect(res.data?.expense).toBe(400);
    expect(res.data?.net).toBe(600);
    // Revenue closes Dr, expense closes Cr.
    expect(res.data?.lines.find((l) => l.code === '41101')).toMatchObject({ debit: 1000, credit: 0 });
    expect(res.data?.lines.find((l) => l.code === '52101')).toMatchObject({ debit: 0, credit: 400 });
  });
});

describe('closeFiscalYear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function closeAdapter(o: { laterClosed?: boolean; alreadyClosed?: boolean; clsExists?: boolean }) {
    return mockDb(async (sql) => {
      if (sql.includes('FROM companies')) return { success: true, rows: [] };
      if (sql.includes('year >') && sql.includes("status = 'closed'")) {
        return { success: true, rows: o.laterClosed ? [{ year: 2026 }] : [] };
      }
      // The CLS reference travels as a bound param — match the query shape.
      if (sql.includes('FROM transactions')) {
        return { success: true, rows: o.clsExists ? [{ id: 't-cls' }] : [] };
      }
      if (sql.includes('FROM accounts')) {
        return {
          success: true,
          rows: [
            { account_id: 'a-rev', code: '41101', name: 'مبيعات', type: 'revenue', rev_net: 1000, exp_net: 0 },
            { account_id: 'a-exp', code: '52101', name: 'رواتب', type: 'expense', rev_net: 0, exp_net: 400 },
          ],
        };
      }
      if (sql.includes('FROM default_accounts')) {
        return { success: true, rows: [{ account_id: 'a-retained' }] };
      }
      if (sql.includes('FROM accounting_periods') && sql.includes('year =')) {
        return { success: true, rows: o.alreadyClosed ? [{ status: 'closed' }] : [] };
      }
      return { success: true, rows: [] };
    });
  }

  it('refuses a year that has not ended yet', async () => {
    mockDb(async () => ({ success: true, rows: [] }));
    const res = await closeFiscalYear(COMPANY_ID, 2100, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/has not ended/);
  });

  it('refuses out-of-order close when a later year is closed', async () => {
    closeAdapter({ laterClosed: true });
    const res = await closeFiscalYear(COMPANY_ID, 2024, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already closed/);
  });

  it('refuses a second close of an already-closed year', async () => {
    closeAdapter({ alreadyClosed: true, clsExists: true });
    const res = await closeFiscalYear(COMPANY_ID, 2024, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already closed/);
  });

  it('posts a balanced CLS JE (Dr revenue / Cr expense / Cr retained) + flips the period', async () => {
    const { tx } = closeAdapter({});
    const res = await closeFiscalYear(COMPANY_ID, 2024, 'user-1');
    expect(res.success, res.error || '').toBe(true);
    expect(res.data?.reference).toBe('CLS-2024');
    expect(res.data?.net).toBe(600);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    expect(je).toBeDefined();
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    expect(legs.find((l) => l.acc === 'a-rev')).toMatchObject({ debit: 1000, credit: 0 });
    expect(legs.find((l) => l.acc === 'a-exp')).toMatchObject({ debit: 0, credit: 400 });
    expect(legs.find((l) => l.acc === 'a-retained')).toMatchObject({ debit: 0, credit: 600 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(1000);
    const flip = tx.find((q) => q.sql.includes('accounting_periods') && q.sql.includes("'closed'"))!;
    expect(flip).toBeDefined();
  });

  it('heals an open period when the CLS JE already exists (no double JE)', async () => {
    const { tx } = closeAdapter({ clsExists: true });
    const res = await closeFiscalYear(COMPANY_ID, 2024, 'user-1');
    expect(res.success, res.error || '').toBe(true);
    expect(tx.some((q) => q.sql.includes('WITH new_tx'))).toBe(false);
    expect(tx.some((q) => q.sql.includes('accounting_periods'))).toBe(true);
  });

  it('closes a zero-activity year with a flip and no JE', async () => {
    const { tx } = mockDb(async (sql) => {
      if (sql.includes('FROM companies')) return { success: true, rows: [] };
      if (sql.includes('year >')) return { success: true, rows: [] };
      if (sql.includes('FROM transactions')) return { success: true, rows: [] };
      if (sql.includes('FROM accounts')) return { success: true, rows: [] };
      if (sql.includes('FROM default_accounts')) return { success: true, rows: [{ account_id: 'a-retained' }] };
      if (sql.includes('FROM accounting_periods')) return { success: true, rows: [] };
      return { success: true, rows: [] };
    });
    const res = await closeFiscalYear(COMPANY_ID, 2024, 'user-1');
    expect(res.success, res.error || '').toBe(true);
    expect(tx.some((q) => q.sql.includes('WITH new_tx'))).toBe(false);
  });

  it('requires a configured retained-earnings account', async () => {
    mockDb(async (sql) => {
      if (sql.includes('FROM companies')) return { success: true, rows: [] };
      if (sql.includes('year >')) return { success: true, rows: [] };
      if (sql.includes('FROM transactions')) return { success: true, rows: [] };
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ account_id: 'a-rev', code: '41101', name: 'م', type: 'revenue', rev_net: 100, exp_net: 0 }] };
      }
      return { success: true, rows: [] };
    });
    const res = await closeFiscalYear(COMPANY_ID, 2024, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/retained/i);
  });
});
