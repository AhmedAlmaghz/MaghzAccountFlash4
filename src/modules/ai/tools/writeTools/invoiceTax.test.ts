import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    createInvoice: vi.fn(),
    createQuotation: vi.fn(),
    createReturn: vi.fn(),
    postInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
  },
}));
vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: {
    createInvoice: vi.fn(),
    createReturn: vi.fn(),
    postInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'INV-0100' })),
}));
vi.mock('@/modules/core/api', () => ({
  coreApi: { getVatSettings: vi.fn(async () => ({ success: true, data: { vatRate: 15 } })) },
}));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));
vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    getProductUnits: vi.fn(async () => ({
      success: true,
      data: [{
        id: 'pu-base', unitId: 'u-base', unitName: 'حبة', factor: 1,
        salePrice: 1000, purchasePrice: 900,
        isBase: true, isDefaultSale: true, isDefaultPurchase: true,
      }],
    })),
  },
}));

import { salesWriteTools } from './sales';
import { purchasesWriteTools } from './purchases';
import { wizardTools } from '../wizardTools';
import { getInvoiceTaxConfig } from './shared';
import { getDbAdapter } from '@/core/database/adapters';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const LINES = [{ productId: 'p-1', quantity: 2, unitPrice: 1000 }];

/** Drive the settings-table read behind getInvoiceTaxConfig. */
function mockInvoiceSettings(showVat: boolean | null, showDiscount: boolean | null) {
  const rows: { key: string; value: string }[] = [];
  if (showVat !== null) rows.push({ key: 'invoice.showVat', value: String(showVat) });
  if (showDiscount !== null) rows.push({ key: 'invoice.showDiscount', value: String(showDiscount) });
  vi.mocked(getDbAdapter).mockResolvedValue({
    query: vi.fn(async () => ({ success: true, rows })),
  } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
}

interface TestableTool {
  name: string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(list: TestableTool[], name: string): TestableTool {
  const tool = list.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

/**
 * Company invoice flags (settings invoice.showVat / invoice.showDiscount)
 * win over the VAT rate — a company that switched VAT off must get
 * zero-VAT documents from the agent, exactly like the invoice forms.
 */
describe('getInvoiceTaxConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to visible VAT/discount with the company rate', async () => {
    mockInvoiceSettings(null, null);
    await expect(getInvoiceTaxConfig(ctx.companyId)).resolves.toEqual({
      vatRate: 15,
      showVat: true,
      showDiscount: true,
    });
  });

  it('zeroes the rate when the company disabled VAT on invoices', async () => {
    mockInvoiceSettings(false, true);
    await expect(getInvoiceTaxConfig(ctx.companyId)).resolves.toEqual({
      vatRate: 0,
      showVat: false,
      showDiscount: true,
    });
  });

  it('reads the discount flag independently', async () => {
    mockInvoiceSettings(true, false);
    await expect(getInvoiceTaxConfig(ctx.companyId)).resolves.toMatchObject({
      showVat: true,
      showDiscount: false,
    });
  });
});

describe('invoice tools obey the company tax flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(salesApi.createInvoice).mockResolvedValue({ success: true, id: 'inv-1' } as never);
    vi.mocked(salesApi.createReturn).mockResolvedValue({ success: true, id: 'ret-1' } as never);
    vi.mocked(purchasesApi.createInvoice).mockResolvedValue({ success: true, id: 'pinv-1' } as never);
    vi.mocked(purchasesApi.createReturn).mockResolvedValue({ success: true, id: 'pret-1' } as never);
  });

  it('sales.create_invoice books zero VAT + flags it when VAT is off', async () => {
    mockInvoiceSettings(false, true);
    const tool = findTool(salesWriteTools as unknown as TestableTool[], 'sales.create_invoice');
    const res = (await tool.execute(
      { customerId: 'c1', lines: LINES },
      ctx,
    )) as Record<string, unknown>;
    expect(res.vatAmount).toBe(0);
    expect(res.totalAmount).toBe(2000);
    expect(res.vatSkipped).toBe(true);
    const payload = vi.mocked(salesApi.createInvoice).mock.calls[0][0] as {
      lines: { vatPercent: number }[];
      vatAmount: number;
    };
    expect(payload.vatAmount).toBe(0);
    expect(payload.lines.every((l) => l.vatPercent === 0)).toBe(true);
  });

  it('sales.create_invoice applies the rate + discounts when flags are on', async () => {
    mockInvoiceSettings(true, true);
    const tool = findTool(salesWriteTools as unknown as TestableTool[], 'sales.create_invoice');
    const res = (await tool.execute(
      { customerId: 'c1', lines: [{ productId: 'p-1', quantity: 2, unitPrice: 1000, discountPercent: 10 }] },
      ctx,
    )) as Record<string, unknown>;
    expect(res.vatAmount).toBe(270);
    expect(res.totalAmount).toBe(2070);
    expect(res.vatSkipped).toBeUndefined();
  });

  it('sales.create_invoice zeroes line discounts when the company hides them', async () => {
    mockInvoiceSettings(true, false);
    const tool = findTool(salesWriteTools as unknown as TestableTool[], 'sales.create_invoice');
    await tool.execute(
      { customerId: 'c1', lines: [{ productId: 'p-1', quantity: 2, unitPrice: 1000, discountPercent: 50 }] },
      ctx,
    );
    const payload = vi.mocked(salesApi.createInvoice).mock.calls[0][0] as {
      lines: { discountPercent: number }[];
    };
    expect(payload.lines[0].discountPercent).toBe(0);
  });

  it('purchases.create_invoice books zero VAT when VAT is off', async () => {
    mockInvoiceSettings(false, true);
    const tool = findTool(purchasesWriteTools as unknown as TestableTool[], 'purchases.create_invoice');
    const res = (await tool.execute(
      { supplierId: 's1', lines: LINES },
      ctx,
    )) as Record<string, unknown>;
    expect(res.totalAmount).toBe(2000);
    expect(res.vatSkipped).toBe(true);
    const payload = vi.mocked(purchasesApi.createInvoice).mock.calls[0][0] as {
      lines: { vatPercent: number }[];
      vatAmount: number;
    };
    expect(payload.vatAmount).toBe(0);
    expect(payload.lines.every((l) => l.vatPercent === 0)).toBe(true);
  });

  it('sales.create_sales_return skips VAT when VAT is off', async () => {
    mockInvoiceSettings(false, true);
    const tool = findTool(salesWriteTools as unknown as TestableTool[], 'sales.create_sales_return');
    const res = (await tool.execute(
      { customerId: 'c1', lines: LINES },
      ctx,
    )) as Record<string, unknown>;
    expect(res.totalAmount).toBe(2000);
    expect(res.vatSkipped).toBe(true);
  });

  it('purchases.create_purchase_return skips VAT when VAT is off', async () => {
    mockInvoiceSettings(false, true);
    const tool = findTool(purchasesWriteTools as unknown as TestableTool[], 'purchases.create_purchase_return');
    const res = (await tool.execute(
      { supplierId: 's1', lines: LINES },
      ctx,
    )) as Record<string, unknown>;
    expect(res.totalAmount).toBe(2000);
    expect(res.vatSkipped).toBe(true);
  });

  it('create_and_post wizards post zero-VAT totals when VAT is off', async () => {
    mockInvoiceSettings(false, true);
    vi.mocked(salesApi.postInvoice).mockResolvedValue({ success: true } as never);
    vi.mocked(purchasesApi.postInvoice).mockResolvedValue({ success: true } as never);
    const salesWiz = findTool(wizardTools as unknown as TestableTool[], 'sales.create_and_post_invoice');
    const salesRes = (await salesWiz.execute({ customerId: 'c1', lines: LINES }, ctx)) as Record<string, unknown>;
    expect(salesRes.vatAmount).toBe(0);
    expect(salesRes.totalAmount).toBe(2000);
    expect(salesRes.vatSkipped).toBe(true);

    const purchWiz = findTool(wizardTools as unknown as TestableTool[], 'purchases.create_and_post_invoice');
    const purchRes = (await purchWiz.execute({ supplierId: 's1', lines: LINES }, ctx)) as Record<string, unknown>;
    expect(purchRes.vatAmount).toBe(0);
    expect(purchRes.totalAmount).toBe(2000);
    expect(purchRes.vatSkipped).toBe(true);
  });
});
