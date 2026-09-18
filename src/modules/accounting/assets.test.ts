import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';
import { getNextDocumentNumber } from '@/core/api';
import {
  monthsElapsed,
  computeTargetAccumulated,
  periodDepreciation,
  fixedAssetsApi,
} from './assets';

// Real zod validation runs here — valid v4 UUIDs required.
const COMPANY_ID = '11111111-2222-4333-8444-555555555555';
const ASSET_ID = '22222222-3333-4444-9555-666666666666';
const USER_ID = '55555555-6666-4777-9888-999999999999';
const BOX_ID = '66666666-7777-4888-8999-000000000000';
const CASH_BOX_ID = '77777777-8888-4999-8000-111111111111';

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
      return { success: true, results: tx.map(() => ({ rows: [], rowCount: 0 })) };
    }),
  };
  vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
  return { adapter, tx };
}

describe('monthsElapsed', () => {
  it('counts full months with floor semantics', () => {
    expect(monthsElapsed('2026-01-15', '2026-01-31')).toBe(0);
    expect(monthsElapsed('2026-01-15', '2026-02-15')).toBe(1);
    expect(monthsElapsed('2026-01-15', '2026-02-14')).toBe(0);
    expect(monthsElapsed('2026-01-01', '2027-01-01')).toBe(12);
    expect(monthsElapsed('2026-06-01', '2026-03-01')).toBe(0);
    // Month-end is NOT a completed month under floor counting (the monthly
    // run targets the 1st of the next month instead — see runDepreciation).
    expect(monthsElapsed('2026-01-01', '2026-12-31')).toBe(11);
    expect(monthsElapsed('2026-01-05', '2026-05-01')).toBe(3);
  });
});

describe('computeTargetAccumulated', () => {
  const sl = { cost: 12000, salvageValue: 0, usefulLifeMonths: 12, method: 'straight_line' as const };

  it('straight-line spreads cost evenly and caps at cost − salvage', () => {
    expect(computeTargetAccumulated(sl, '2026-01-01', '2026-04-30')).toBe(3000);
    expect(computeTargetAccumulated(sl, '2026-01-01', '2027-01-01')).toBe(12000);
    // Never exceeds the depreciable base, however late the run.
    expect(computeTargetAccumulated(sl, '2026-01-01', '2028-12-31')).toBe(12000);
    expect(computeTargetAccumulated({ ...sl, salvageValue: 2000 }, '2026-01-01', '2027-01-01')).toBe(10000);
  });

  it('declining-balance front-loads and never breaches salvage', () => {
    const db = { ...sl, method: 'declining_balance' as const };
    const m3 = computeTargetAccumulated(db, '2026-01-01', '2026-04-30');
    // DDB monthlies exceed SL monthlies early on (12000 × 2/12 = 2000 first).
    expect(m3).toBeGreaterThan(3000);
    const late = computeTargetAccumulated({ ...db, salvageValue: 1000 }, '2026-01-01', '2030-12-31');
    expect(late).toBe(11000);
  });

  it('returns zero before purchase or when cost <= salvage', () => {
    expect(computeTargetAccumulated(sl, '2026-06-01', '2026-03-31')).toBe(0);
    expect(computeTargetAccumulated({ ...sl, salvageValue: 12000 }, '2026-01-01', '2026-12-31')).toBe(0);
  });
});

describe('periodDepreciation', () => {
  it('charges target minus already-posted, floored at zero', () => {
    const base = {
      cost: 12000, salvageValue: 0, usefulLifeMonths: 12, method: 'straight_line' as const,
      purchaseDate: '2026-01-01',
    };
    expect(periodDepreciation({ ...base, accumulatedDepreciation: 2000 }, '2026-04-30')).toBe(1000);
    // Over-posted (re-estimate lowered the target) never goes negative.
    expect(periodDepreciation({ ...base, accumulatedDepreciation: 99999 }, '2026-04-30')).toBe(0);
  });
});

describe('fixedAssetsApi CRUD guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createFixedAsset numbers via sequence, capitalizes with an acquisition JE, rejects salvage >= cost', async () => {
    vi.mocked(getNextDocumentNumber).mockResolvedValue({ success: true, number: 'FA-0007' } as never);
    const { adapter, tx } = mockDb(async (sql, params) => {
      if (sql.includes('FROM default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(params[1]) }] };
      }
      if (sql.includes('FROM cash_boxes')) return { success: true, rows: [{ account_id: 'acc-box' }] };
      return { success: true, rows: [] };
    });
    const res = await fixedAssetsApi.createFixedAsset({
      companyId: COMPANY_ID, nameAr: 'شاحنة', purchaseDate: '2026-01-05',
      cost: 60000, usefulLifeMonths: 60, method: 'straight_line',
      funding: { kind: 'cash', cashBoxId: CASH_BOX_ID },
    }, USER_ID);
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.code).toBe('FA-0007');
    // Acquisition JE: Dr 12101 60000 / Cr box 60000, reference = asset code.
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    expect(je).toBeDefined();
    expect(je.params?.[2]).toBe('FA-0007');
    const flat = je.params || [];
    const legs = [0, 1].map((i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    expect(legs.find((l) => l.acc === 'acc-default_fixed_assets')).toMatchObject({ debit: 60000, credit: 0 });
    expect(legs.find((l) => l.acc === 'acc-box')).toMatchObject({ debit: 0, credit: 60000 });
    // Register row rides the same atomic batch.
    expect(tx.some((q) => q.sql.includes('INSERT INTO fixed_assets'))).toBe(true);
    void adapter;

    const bad = await fixedAssetsApi.createFixedAsset({
      companyId: COMPANY_ID, nameAr: 'x', purchaseDate: '2026-01-05',
      cost: 1000, salvageValue: 1000, usefulLifeMonths: 12, method: 'straight_line',
      funding: { kind: 'opening' },
    }, USER_ID);
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/Salvage/);

    const noBox = await fixedAssetsApi.createFixedAsset({
      companyId: COMPANY_ID, nameAr: 'y', purchaseDate: '2026-01-05',
      cost: 1000, usefulLifeMonths: 12, method: 'straight_line',
      funding: { kind: 'cash' },
    }, USER_ID);
    expect(noBox.success).toBe(false);
    expect(noBox.error).toMatch(/Cash box/);
  });

  it('deleteFixedAsset refuses depreciated or disposed assets', async () => {
    mockDb(async () => ({
      success: true, rows: [{ status: 'active', accumulated_depreciation: 500 }],
    }));
    const dep = await fixedAssetsApi.deleteFixedAsset(ASSET_ID, COMPANY_ID);
    expect(dep.success).toBe(false);
    expect(dep.error).toMatch(/dispose/);

    mockDb(async () => ({
      success: true, rows: [{ status: 'disposed', accumulated_depreciation: 0 }],
    }));
    const dis = await fixedAssetsApi.deleteFixedAsset(ASSET_ID, COMPANY_ID);
    expect(dis.success).toBe(false);
  });

  it('updateFixedAsset locks the purchase date once depreciation posted', async () => {
    const { adapter } = mockDb(async () => ({
      success: true, rows: [{ status: 'active', accumulated_depreciation: 100 }],
    }));
    const locked = await fixedAssetsApi.updateFixedAsset(ASSET_ID, COMPANY_ID, { purchaseDate: '2026-02-01' }, USER_ID);
    expect(locked.success).toBe(false);
    expect(locked.error).toMatch(/locked/);
    // ...but life re-estimates stay editable (prospective by design).
    const ok = await fixedAssetsApi.updateFixedAsset(ASSET_ID, COMPANY_ID, { usefulLifeMonths: 72 }, USER_ID);
    expect(ok.success).toBe(true);
    expect(adapter.query).toHaveBeenCalled();
  });
});

describe('fixedAssetsApi.runDepreciation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ASSET_ROW = {
    id: ASSET_ID, company_id: COMPANY_ID, code: 'FA-0001', name_ar: 'شاحنة',
    purchase_date: '2026-01-05', cost: 12000, salvage_value: 0,
    useful_life_months: 12, method: 'straight_line',
    accumulated_depreciation: 2000, status: 'active',
  };

  function runDb() {
    return mockDb(async (sql) => {
      if (sql.includes('FROM fixed_assets')) return { success: true, rows: [ASSET_ROW] };
      if (sql.includes('FROM default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' }] };
      }
      if (sql.includes('FROM transactions')) return { success: true, rows: [] };
      return { success: true, rows: [] };
    });
  }

  it('posts one balanced JE per asset + bumps accumulated', async () => {
    const { tx } = runDb();
    // As of 2026-04-30: 3 elapsed months × 1000 = 3000 target − 2000 posted.
    const res = await fixedAssetsApi.runDepreciation(COMPANY_ID, 2026, 4, USER_ID);
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.data?.posted).toBe(1);
    expect(res.data?.total).toBe(1000);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    expect(flat[2]).toBe('DEP-2026-04-FA-0001');
    const legs = [0, 1].map((i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    expect(legs[0]).toMatchObject({ debit: 1000, credit: 0 });
    expect(legs[1]).toMatchObject({ debit: 0, credit: 1000 });
    const bump = tx.find((q) => q.sql.includes('accumulated_depreciation'))!;
    expect(Number(bump.params?.[0])).toBe(1000);
  });

  it('skips idempotently when the period reference already exists', async () => {
    const { tx } = mockDb(async (sql) => {
      if (sql.includes('FROM fixed_assets')) return { success: true, rows: [ASSET_ROW] };
      if (sql.includes('FROM default_accounts')) return { success: true, rows: [{ account_id: 'acc-' }] };
      if (sql.includes('FROM transactions')) return { success: true, rows: [{ id: 't-old' }] };
      return { success: true, rows: [] };
    });
    const res = await fixedAssetsApi.runDepreciation(COMPANY_ID, 2026, 4, USER_ID);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data?.posted).toBe(0);
    expect(res.data?.skipped).toBe(1);
    expect(tx.some((q) => q.sql.includes('WITH new_tx'))).toBe(false);
  });

  it('refuses future months', async () => {
    mockDb(async () => ({ success: true, rows: [] }));
    const res = await fixedAssetsApi.runDepreciation(COMPANY_ID, 2100, 1, USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/future/);
  });
});

describe('fixedAssetsApi.disposeFixedAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ASSET_ROW = {
    id: ASSET_ID, company_id: COMPANY_ID, code: 'FA-0001', name_ar: 'شاحنة',
    purchase_date: '2026-01-05', cost: 12000, salvage_value: 0,
    useful_life_months: 12, method: 'straight_line',
    accumulated_depreciation: 3000, status: 'active',
  };

  function disposeDb() {
    return mockDb(async (sql, params) => {
      if (sql.includes('FROM fixed_assets')) return { success: true, rows: [ASSET_ROW] };
      if (sql.includes('FROM accounting_periods')) return { success: true, rows: [] };
      if (sql.includes('FROM default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(params[1]) }] };
      }
      if (sql.includes('FROM cash_boxes')) return { success: true, rows: [{ account_id: 'acc-box' }] };
      if (sql.includes('FROM transactions')) return { success: true, rows: [] };
      return { success: true, rows: [] };
    });
  }

  it('books a balanced disposal JE (loss) + terminal flip', async () => {
    const { tx } = disposeDb();
    // NBV 9000, proceeds 7000 → loss 2000.
    const res = await fixedAssetsApi.disposeFixedAsset(
      COMPANY_ID, ASSET_ID,
      { date: '2026-09-01', proceeds: 7000, cashBoxId: BOX_ID, reason: 'sold below book value' },
      USER_ID
    );
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.data?.loss).toBe(2000);
    expect(res.data?.gain).toBe(0);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    // Dr accumulated 3000 + Dr cash 7000 + Dr loss 2000 = Cr cost 12000.
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    expect(dr).toBe(12000);
    expect(dr).toBe(legs.reduce((s, l) => s + l.credit, 0));
    expect(legs.find((l) => l.acc === 'acc-default_misc_expense')).toMatchObject({ debit: 2000 });
    const flip = tx.find((q) => q.sql.includes("status = 'disposed'"))!;
    expect(flip).toBeDefined();
  });

  it('books a gain when proceeds exceed NBV', async () => {
    const { tx } = disposeDb();
    const res = await fixedAssetsApi.disposeFixedAsset(
      COMPANY_ID, ASSET_ID,
      { date: '2026-09-01', proceeds: 10000, cashBoxId: BOX_ID, reason: 'sold above book value' },
      USER_ID
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data?.gain).toBe(1000);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    expect(legs.find((l) => l.acc === 'acc-default_inventory_surplus')).toMatchObject({ credit: 1000 });
  });

  it('requires a cash box when proceeds exist, and refuses disposed assets', async () => {
    disposeDb();
    const noBox = await fixedAssetsApi.disposeFixedAsset(
      COMPANY_ID, ASSET_ID, { date: '2026-09-01', proceeds: 100, reason: 'missing box test' }, USER_ID
    );
    expect(noBox.success).toBe(false);
    expect(noBox.error).toMatch(/Cash box/);

    mockDb(async (sql) => {
      if (sql.includes('FROM fixed_assets')) {
        return { success: true, rows: [{ ...ASSET_ROW, status: 'disposed' }] };
      }
      return { success: true, rows: [] };
    });
    const gone = await fixedAssetsApi.disposeFixedAsset(
      COMPANY_ID, ASSET_ID, { date: '2026-09-01', reason: 'second disposal attempt' }, USER_ID
    );
    expect(gone.success).toBe(false);
    expect(gone.error).toMatch(/already disposed/);
  });
});
