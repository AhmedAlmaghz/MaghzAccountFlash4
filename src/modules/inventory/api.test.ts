import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

import { inventoryApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

function makeMockAdapter(
  queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>,
) {
  return {
    query: vi.fn(queryImpl),
    transaction: vi.fn(async () => ({ success: true, results: [] })),
    getProducts: vi.fn(async () => ({ success: true, data: [] })),
    createProduct: vi.fn(async () => ({ success: true, id: 'prod-1' })),
  };
}

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ROW_ID = '33333333-3333-4333-8333-333333333333';
const UNIT_ID = '44444444-4444-4434-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inventoryApi.getProductUnits', () => {
  it('scopes by product AND company (no cross-tenant leak)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.getProductUnits(PRODUCT_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/pu\.product_id = \$1::uuid AND pu\.company_id = \$2::uuid/);
    expect(capturedParams).toEqual([PRODUCT_ID, COMPANY_ID]);
  });

  it('maps catalog names onto rows', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        id: UNIT_ROW_ID, company_id: COMPANY_ID, product_id: PRODUCT_ID, unit_id: UNIT_ID,
        factor: '12', sale_price: '12000', purchase_price: '10000', barcode: null,
        is_base: false, is_default_sale: true, is_default_purchase: false,
        unit_name: 'كرتون', unit_name_en: 'Carton', unit_code: 'CTN',
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.getProductUnits(PRODUCT_ID, COMPANY_ID);
    expect(res.data?.[0]).toMatchObject({
      id: UNIT_ROW_ID, unitId: UNIT_ID, unitName: 'كرتون', factor: 12,
      salePrice: 12000, isBase: false, isDefaultSale: true,
    });
  });
});

describe('inventoryApi.ensureBaseProductUnit', () => {
  it('is idempotent (WHERE NOT EXISTS)', async () => {
    let capturedSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.ensureBaseProductUnit(PRODUCT_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/NOT EXISTS \(SELECT 1 FROM product_units/);
    expect(capturedSql).toMatch(/is_base, is_default_sale, is_default_purchase/);
  });
});

describe('inventoryApi.createProductUnit', () => {
  it('rejects non-positive factor before touching the DB', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ id: UNIT_ROW_ID }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.createProductUnit({
      companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: UNIT_ID,
      factor: 0, salePrice: 0, purchasePrice: 0, isBase: false,
      isDefaultSale: false, isDefaultPurchase: false,
    });
    expect(res.success).toBe(false);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('inserts all 10 columns with casts', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true, rows: [{ id: UNIT_ROW_ID }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.createProductUnit({
      companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: UNIT_ID,
      factor: 12, salePrice: 12000, purchasePrice: 10000, isBase: false,
      isDefaultSale: true, isDefaultPurchase: false,
    });
    expect(res.success).toBe(true);
    expect(res.id).toBe(UNIT_ROW_ID);
    expect(capturedSql).toMatch(/unit_id, factor, sale_price, purchase_price, barcode, is_base, is_default_sale, is_default_purchase/);
    expect(capturedParams).toEqual([COMPANY_ID, PRODUCT_ID, UNIT_ID, 12, 12000, 10000, null, false, true, false]);
  });
});

describe('inventoryApi uniqueness handover (uq_product_units_*)', () => {
  it('create clears sibling default flags before INSERT', async () => {
    const calls: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      calls.push(sql);
      return { success: true, rows: [{ id: UNIT_ROW_ID }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.createProductUnit({
      companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: UNIT_ID,
      factor: 12, salePrice: 12000, purchasePrice: 10000, isBase: false,
      isDefaultSale: true, isDefaultPurchase: false,
    });
    expect(res.success).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatch(/UPDATE product_units SET is_default_sale = false WHERE product_id/);
    expect(calls[1]).toMatch(/INSERT INTO product_units/);
  });

  it('update clears sibling default flags before the SET', async () => {
    const calls: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      calls.push(sql);
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.updateProductUnit(UNIT_ROW_ID, COMPANY_ID, { isDefaultPurchase: true });
    expect(res.success).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatch(/UPDATE product_units SET is_default_purchase = false WHERE product_id = \(SELECT/);
    expect(calls[1]).toMatch(/UPDATE product_units SET .* WHERE id = .* AND company_id = /);
  });

  it('update without flags issues a single statement', async () => {
    const calls: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      calls.push(sql);
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.updateProductUnit(UNIT_ROW_ID, COMPANY_ID, { factor: 24 });
    expect(res.success).toBe(true);
    expect(calls.length).toBe(1);
  });
});

describe('inventoryApi.deleteProductUnit', () => {
  it('refuses to delete the only unit row of a product', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: UNIT_ROW_ID, is_base: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.deleteProductUnit(UNIT_ROW_ID, COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/only unit/);
  });

  it('deletes when siblings exist', async () => {
    const calls: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      calls.push(sql);
      if (sql.startsWith('SELECT id, is_base')) {
        return { success: true, rows: [{ id: 'a' }, { id: UNIT_ROW_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await inventoryApi.deleteProductUnit(UNIT_ROW_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(calls.some((s) => s.startsWith('DELETE FROM product_units'))).toBe(true);
  });
});
