import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    getProductUnits: vi.fn(),
    ensureBaseProductUnit: vi.fn(),
  },
}));

import { inventoryApi } from '@/modules/inventory/api';
import { parseLines, resolveLineUnits, summarizeDocLines } from './shared';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000002';
const LEGACY_ID = '00000000-0000-0000-0000-000000000003';

const UNITS = [
  {
    id: 'pu-base', companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: 'u-piece',
    unitName: 'حبة', unitCode: 'PC', factor: 1, salePrice: 1100, purchasePrice: 900,
    isBase: true, isDefaultSale: false, isDefaultPurchase: false,
  },
  {
    id: 'pu-carton', companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: 'u-carton',
    unitName: 'كرتون', unitCode: 'CTN', factor: 12, salePrice: 12000, purchasePrice: 10000,
    isBase: false, isDefaultSale: true, isDefaultPurchase: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inventoryApi.getProductUnits).mockResolvedValue({ success: true, data: UNITS } as never);
  vi.mocked(inventoryApi.ensureBaseProductUnit).mockResolvedValue({ success: true } as never);
});

describe('resolveLineUnits — unitName path (U2 transcript regression)', () => {
  it('resolves a line unitName to the product unit row and snapshots the factor', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 3, unitPrice: 12000, discountPercent: 0, unitName: 'كرتون' },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0]).toMatchObject({ unitId: 'pu-carton', unitFactor: 12, baseQuantity: 36, unitName: 'كرتون' });
  });

  it('accepts `unit` as an alias for unitName (model vocabulary from create_product)', async () => {
    const parsed = parseLines([{ productId: PRODUCT_ID, quantity: 1, unitPrice: 1100, unit: 'حبة' }]);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    const res = await resolveLineUnits(COMPANY_ID, 'sale', parsed);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0]).toMatchObject({ unitId: 'pu-base', unitFactor: 1, baseQuantity: 1 });
  });

  it('hard-errors when the unitName does not exist for the product (never silent drop)', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 1, discountPercent: 0, unitName: 'برميل ضخم' },
    ]);
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/search\.product_units|create_product_unit/);
  });

  it('tolerates alef/teh variants and ال prefix when matching unitName', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 12000, discountPercent: 0, unitName: 'الكترون' },
    ]);
    // No exact match for a typo'd name → loud error (we do NOT fuzzy-match
    // units on invoice lines — ambiguity here corrupts stock).
    expect('error' in res).toBe(true);
  });
});

describe('resolveLineUnits — self-heal (U5)', () => {
  it('heals a product with no unit rows via ensureBaseProductUnit before degrading', async () => {
    // First read: empty (legacy product) → heal → retry returns the healed rows
    vi.mocked(inventoryApi.getProductUnits)
      .mockResolvedValueOnce({ success: true, data: [] } as never)
      .mockResolvedValueOnce({ success: true, data: [{ ...UNITS[0], productId: LEGACY_ID }] } as never);
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: LEGACY_ID, quantity: 2, unitPrice: 1100, discountPercent: 0 },
    ]);
    expect(vi.mocked(inventoryApi.ensureBaseProductUnit)).toHaveBeenCalledWith(LEGACY_ID, COMPANY_ID);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0]).toMatchObject({ unitFactor: 1, baseQuantity: 2, unitId: 'pu-base' });
  });

  it('does not loop healing for the same product within one call', async () => {
    vi.mocked(inventoryApi.getProductUnits).mockResolvedValue({ success: true, data: [] } as never);
    await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: LEGACY_ID, quantity: 1, unitPrice: 1, discountPercent: 0 },
      { productId: LEGACY_ID, quantity: 2, unitPrice: 1, discountPercent: 0 },
    ]);
    expect(vi.mocked(inventoryApi.ensureBaseProductUnit)).toHaveBeenCalledTimes(1);
  });
});

describe('resolveLineUnits — price reconciliation (U3)', () => {
  it('flags a piece price passed with a carton default unit (stock would debit 12×)', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 10, unitPrice: 1100, discountPercent: 0 },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0].priceMismatchNote).toBeTruthy();
    expect(res[0].priceMismatchNote).toMatch(/كرتون/);
  });

  it('does not flag a matching carton price', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 10, unitPrice: 12000, discountPercent: 0 },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0].priceMismatchNote).toBeUndefined();
  });

  it('does not flag when the unit row has no price (0)', async () => {
    const free = [{ ...UNITS[1], salePrice: 0, purchasePrice: 0 }];
    vi.mocked(inventoryApi.getProductUnits).mockResolvedValue({ success: true, data: free } as never);
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 500, discountPercent: 0 },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0].priceMismatchNote).toBeUndefined();
  });
});

describe('parseLines — unit fields + zero price guard (U3)', () => {
  it('parses unitName through and rejects unitId+unitName together', () => {
    const ok = parseLines([{ productId: 'p1', quantity: 1, unitPrice: 5, unitName: 'كرتون' }]);
    expect('error' in ok).toBe(false);
    const both = parseLines([{ productId: 'p1', quantity: 1, unitPrice: 5, unitId: 'u1', unitName: 'كرتون' }]);
    expect('error' in both).toBe(true);
  });

  it('rejects unitPrice <= 0 (zero used to pass and book a free line)', () => {
    const zero = parseLines([{ productId: 'p1', quantity: 1, unitPrice: 0 }]);
    expect('error' in zero).toBe(true);
    if (!('error' in zero)) return;
    expect(zero.error).toMatch(/سعر الوحدة مطلوب/);
  });
});

describe('summarizeDocLines — unit visibility (U4)', () => {
  it('lists explicit unit names on the approval card', () => {
    const s = summarizeDocLines('إنشاء فاتورة مبيعات', [
      { productId: 'p1', quantity: 3, unitPrice: 12000, unitName: 'كرتون' },
      { productId: 'p2', quantity: 5, unitPrice: 1100, unitName: 'حبة' },
    ]);
    expect(s).toContain('الوحدات');
    expect(s).toContain('كرتون');
    expect(s).toContain('حبة');
  });

  it('keeps the plain summary when no units are given', () => {
    const s = summarizeDocLines('إنشاء فاتورة مبيعات', [
      { productId: 'p1', quantity: 1, unitPrice: 100 },
    ]);
    expect(s).not.toContain('الوحدات');
    expect(s).toContain('1 أصناف');
  });
});
