import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getStockPolicies,
  writeSetting,
  resolveDefaultWarehouse,
  checkStockSufficiency,
  formatShortages,
  getCashBoxGlBalance,
} from './stockPolicy';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';

function stubDb(impl: (sql: string, params: unknown[]) => { success: boolean; rows?: unknown[]; error?: string }) {
  return { query: vi.fn(async (sql: string, params: unknown[]) => impl(sql, params)) };
}

describe('getStockPolicies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is fail-closed: unknown settings mean block everything', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(stubDb(async () => ({ success: true, rows: [] })) as never);
    const p = await getStockPolicies('comp-1');
    expect(p.allowNegativeSale).toBe(false);
    expect(p.allowNegativePurchaseReturn).toBe(false);
    expect(p.allowNegativeIssue).toBe(false);
    expect(p.allowNegativeCashbox).toBe(false);
    expect(p.creditOverlimit).toBe('block');
    expect(p.defaultWarehouseId).toBeNull();
  });

  it('parses stored values (true/1/mode strings)', async () => {
    const kv: Record<string, string> = {
      'inventory.default_warehouse_id': 'wh-1',
      'policy.allow_negative_sale': '1',
      'policy.allow_negative_cashbox': 'true',
      'policy.credit_overlimit': 'warn',
    };
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (_sql, params) => ({ success: true, rows: [{ value: kv[String(params[1])] ?? null }] })) as never
    );
    const p = await getStockPolicies('comp-1');
    expect(p.defaultWarehouseId).toBe('wh-1');
    expect(p.allowNegativeSale).toBe(true);
    expect(p.allowNegativeCashbox).toBe(true);
    expect(p.allowNegativeIssue).toBe(false);
    expect(p.creditOverlimit).toBe('warn');
  });

  it('unknown credit mode falls back to block', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async () => ({ success: true, rows: [{ value: 'sometimes' }] })) as never
    );
    const p = await getStockPolicies('comp-1');
    expect(p.creditOverlimit).toBe('block');
  });

  it('writeSetting upserts with category', async () => {
    const queries: string[] = [];
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        queries.push(sql);
        return { success: true, rows: [] };
      }) as never
    );
    const res = await writeSetting('comp-1', 'policy.allow_negative_sale', 'true', 'policy');
    expect(res.success).toBe(true);
    expect(queries.some((q) => q.includes('ON CONFLICT (company_id, key)'))).toBe(true);
  });
});

describe('resolveDefaultWarehouse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when unset', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(stubDb(async () => ({ success: true, rows: [] })) as never);
    expect(await resolveDefaultWarehouse('comp-1')).toBeNull();
  });

  it('validates existence + active flag (stale ids degrade to null)', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        if (sql.includes('FROM settings')) return { success: true, rows: [{ value: 'wh-gone' }] };
        return { success: true, rows: [] };
      }) as never
    );
    expect(await resolveDefaultWarehouse('comp-1')).toBeNull();
  });

  it('returns the id for a live warehouse', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        if (sql.includes('FROM settings')) return { success: true, rows: [{ value: 'wh-1' }] };
        return { success: true, rows: [{ id: 'wh-1' }] };
      }) as never
    );
    expect(await resolveDefaultWarehouse('comp-1')).toBe('wh-1');
  });
});

describe('checkStockSufficiency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes on empty input without touching the DB', async () => {
    const adapter = stubDb(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await checkStockSufficiency('comp-1', []);
    expect(res).toEqual({ ok: true });
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('compares need vs richest stock and names the short product', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        if (sql.includes('FROM stock')) {
          return { success: true, rows: [{ product_id: 'p1', have: 2 }] };
        }
        return { success: true, rows: [{ id: 'p1', name_ar: 'أرز' }] };
      }) as never
    );
    const res = await checkStockSufficiency('comp-1', [{ productId: 'p1', baseQty: 5 }]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.shortages).toHaveLength(1);
      expect(res.shortages[0].name).toBe('أرز');
      expect(res.shortages[0].need).toBe(5);
      expect(res.shortages[0].have).toBe(2);
      expect(formatShortages(res.shortages)).toMatch(/أرز/);
    }
  });

  it('checks a single warehouse when pinned', async () => {
    const queries: string[] = [];
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        queries.push(sql);
        if (sql.includes('FROM stock')) return { success: true, rows: [] };
        return { success: true, rows: [] };
      }) as never
    );
    await checkStockSufficiency('comp-1', [{ productId: 'p1', baseQty: 1 }], undefined, 'wh-9');
    expect(queries.some((q) => q.includes('warehouse_id'))).toBe(true);
  });
});

describe('getCashBoxGlBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the box has no GL account (uncheckable, not zero)', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(
      stubDb(async (sql) => {
        if (sql.includes('FROM cash_boxes')) return { success: true, rows: [{ account_id: null }] };
        return { success: true, rows: [] };
      }) as never
    );
    expect(await getCashBoxGlBalance('comp-1', 'box-1')).toBeNull();
  });

  it('returns null for a missing box id', async () => {
    const adapter = stubDb(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    expect(await getCashBoxGlBalance('comp-1', null)).toBeNull();
    expect(adapter.query).not.toHaveBeenCalled();
  });
});
