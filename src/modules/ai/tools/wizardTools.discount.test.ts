import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    createInvoice: vi.fn(),
    postInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
  },
}));
vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: {
    createInvoice: vi.fn(),
    postInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'INV-0100' })),
}));
vi.mock('@/modules/core/api', () => ({
  coreApi: { getVatSettings: vi.fn(async () => ({ success: true, data: { vatRate: 5 } })) },
}));

// The wizards read invoice display flags via the REAL adapter
// (writeTools/shared getInvoiceTaxConfig) — stub it so no PGlite WASM
// spins up here.
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({
    query: vi.fn(async () => ({ success: true, rows: [] })),
  })),
  isElectronPg: vi.fn(() => false),
}));
vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    getProductUnits: vi.fn(async () => ({
      success: true,
      data: [{
        id: 'pu-base', unitId: 'u-base', unitName: 'حبة', factor: 1,
        salePrice: 500, purchasePrice: 500,
        isBase: true, isDefaultSale: true, isDefaultPurchase: true,
      }],
    })),
  },
}));

import { wizardTools } from './wizardTools';
import { salesWriteTools } from './writeTools/sales';
import { computeHeaderDiscount } from './writeTools/shared';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

// 2 × 500 = 1000 subtotal, VAT rate 5% (mocked above).
const LINES = [{ productId: 'p-1', quantity: 2, unitPrice: 500 }];

function findWizard(name: string) {
  const t = wizardTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as { execute: (a: Record<string, unknown>, c: ToolContext) => Promise<unknown> };
}

describe('computeHeaderDiscount — form-identical arithmetic', () => {
  it('percent mode wins and is capped at the subtotal', () => {
    expect(computeHeaderDiscount(1000, { discountPercent: 10 }, true)).toEqual({ headerDisc: 100, discountSkipped: false });
    expect(computeHeaderDiscount(1000, { discountPercent: 250 }, true).headerDisc).toBe(1000);
  });

  it('amount mode is capped at the subtotal', () => {
    expect(computeHeaderDiscount(1000, { discountAmount: 50 }, true)).toEqual({ headerDisc: 50, discountSkipped: false });
    expect(computeHeaderDiscount(1000, { discountAmount: 5000 }, true).headerDisc).toBe(1000);
  });

  it('a disabled company flag zeroes the discount and flags an asked one', () => {
    expect(computeHeaderDiscount(1000, { discountPercent: 10 }, false)).toEqual({ headerDisc: 0, discountSkipped: true });
    expect(computeHeaderDiscount(1000, {}, false)).toEqual({ headerDisc: 0, discountSkipped: false });
  });
});

describe('invoice tools — header discount (below-subtotal)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(salesApi.createInvoice).mockResolvedValue({ success: true, id: 'inv-1' } as never);
    vi.mocked(salesApi.postInvoice).mockResolvedValue({ success: true, cogsAmount: 640 } as never);
    vi.mocked(purchasesApi.createInvoice).mockResolvedValue({ success: true, id: 'pinv-1' } as never);
    vi.mocked(purchasesApi.postInvoice).mockResolvedValue({ success: true } as never);
  });

  it('wizards expose discountPercent/discountAmount in their schemas', () => {
    for (const name of ['sales.create_and_post_invoice', 'purchases.create_and_post_invoice']) {
      const tool = wizardTools.find((t) => t.name === name);
      const props = Object.keys((tool!.parameters as { properties: Record<string, unknown> }).properties);
      expect(props).toEqual(expect.arrayContaining(['discountPercent', 'discountAmount']));
    }
    const single = salesWriteTools.find((t) => t.name === 'sales.create_invoice');
    const singleProps = Object.keys((single!.parameters as { properties: Record<string, unknown> }).properties);
    expect(singleProps).toEqual(expect.arrayContaining(['discountPercent', 'discountAmount']));
  });

  it('sales wizard books header 10%: subtotal 1000, discount 100, VAT 45, total 945', async () => {
    const res = (await findWizard('sales.create_and_post_invoice').execute(
      { customerId: 'c-1', lines: LINES, discountPercent: 10 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(vi.mocked(salesApi.createInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 1000, discountAmount: 100, vatAmount: 45, totalAmount: 945 }),
    );
    expect(res.headerDiscount).toBe(100);
    expect(res.cogsAmount).toBe(640);
  });

  it('purchases wizard books a fixed header discount', async () => {
    const res = (await findWizard('purchases.create_and_post_invoice').execute(
      { supplierId: 's-1', lines: LINES, discountAmount: 50 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.success).toBe(true);
    // net 950, VAT 5% = 47.5, total 997.5
    expect(vi.mocked(purchasesApi.createInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 1000, discountAmount: 50, vatAmount: 47.5, totalAmount: 997.5 }),
    );
    expect(res.headerDiscount).toBe(50);
  });

  it('negative header discount is rejected before any write', async () => {
    const res = (await findWizard('sales.create_and_post_invoice').execute(
      { customerId: 'c-1', lines: LINES, discountAmount: -5 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toMatch(/سالباً/);
    expect(salesApi.createInvoice).not.toHaveBeenCalled();
  });

  it('sales.create_invoice single books the header discount identically', async () => {
    const tool = salesWriteTools.find((t) => t.name === 'sales.create_invoice');
    const res = (await (tool!.execute as (a: Record<string, unknown>, c: ToolContext) => Promise<unknown>)(
      { customerId: 'c-1', lines: LINES, discountPercent: 10 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(salesApi.createInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 1000, discountAmount: 100, vatAmount: 45, totalAmount: 945 }),
      ctx.userId,
    );
  });
});
