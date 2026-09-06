import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    getProductUnits: vi.fn(),
  },
}));

import { inventoryApi } from '@/modules/inventory/api';
import { resolveLineUnits } from './shared';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000002';

const UNITS = [
  {
    id: 'pu-base', companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: 'u-piece',
    unitName: 'حبة', factor: 1, salePrice: 1100, purchasePrice: 900,
    isBase: true, isDefaultSale: false, isDefaultPurchase: false,
  },
  {
    id: 'pu-carton', companyId: COMPANY_ID, productId: PRODUCT_ID, unitId: 'u-carton',
    unitName: 'كرتون', factor: 12, salePrice: 12000, purchasePrice: 10000,
    isBase: false, isDefaultSale: true, isDefaultPurchase: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inventoryApi.getProductUnits).mockResolvedValue({ success: true, data: UNITS });
});

describe('resolveLineUnits', () => {
  it('resolves an explicit unitId to its factor snapshot (2 cartons -> base 24)', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 2, unitPrice: 12000, discountPercent: 0, unitId: 'pu-carton' },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0]).toMatchObject({ unitId: 'pu-carton', unitFactor: 12, baseQuantity: 24 });
  });

  it('falls back to the default sale unit when unitId is omitted', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 12000, discountPercent: 0 },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0]).toMatchObject({ unitId: 'pu-carton', unitFactor: 12, baseQuantity: 12 });
  });

  it('falls back to the default purchase unit in purchase mode', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'purchase', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 10000, discountPercent: 0 },
    ]);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res[0]).toMatchObject({ unitId: 'pu-carton', unitFactor: 12, baseQuantity: 12 });
  });

  it('hard-errors on an unknown unitId (never silently factor 1)', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 1, discountPercent: 0, unitId: 'no-such-unit' },
    ]);
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/search\.product_units/);
  });

  it('fetches units once per product across lines', async () => {
    const res = await resolveLineUnits(COMPANY_ID, 'sale', [
      { productId: PRODUCT_ID, quantity: 1, unitPrice: 1100, discountPercent: 0 },
      { productId: PRODUCT_ID, quantity: 2, unitPrice: 1100, discountPercent: 0 },
    ]);
    expect('error' in res).toBe(false);
    expect(vi.mocked(inventoryApi.getProductUnits)).toHaveBeenCalledTimes(1);
  });
});
