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
// spins up here (that costs ~15s and trips the 5s test timeout).
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({
    query: vi.fn(async () => ({ success: true, rows: [] })),
  })),
  isElectronPg: vi.fn(() => false),
}));

import { wizardTools } from './wizardTools';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const LINES = [{ productId: 'p-1', quantity: 2, unitPrice: 500 }];

function findTool(name: string) {
  return wizardTools.find((t) => t.name === name);
}

/**
 * P1-1 regression: the create_and_post wizards had NO paymentType/cashBoxId —
 * a user asking for a CASH invoice got a CREDIT one posted to the receivables
 * account (silent accounting error against system rule 28).
 */
describe('create_and_post wizards — cash support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(salesApi.createInvoice).mockResolvedValue({ success: true, id: 'inv-1' } as never);
    vi.mocked(salesApi.postInvoice).mockResolvedValue({ success: true } as never);
    vi.mocked(purchasesApi.createInvoice).mockResolvedValue({ success: true, id: 'pinv-1' } as never);
    vi.mocked(purchasesApi.postInvoice).mockResolvedValue({ success: true } as never);
  });

  it('sales wizard exposes paymentType/cashBoxId in its schema', () => {
    const tool = findTool('sales.create_and_post_invoice');
    expect(tool).toBeDefined();
    const props = (tool!.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['paymentType', 'cashBoxId']));
  });

  it('purchases wizard exposes paymentType/cashBoxId in its schema', () => {
    const tool = findTool('purchases.create_and_post_invoice');
    expect(tool).toBeDefined();
    const props = (tool!.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['paymentType', 'cashBoxId']));
  });

  it('sales wizard REJECTS cash without cashBoxId (honest error)', async () => {
    const tool = findTool('sales.create_and_post_invoice')!;
    const res = (await tool.execute(
      { customerId: 'c-1', lines: LINES, paymentType: 'cash' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toMatch(/cashBoxId مطلوب/);
    expect(salesApi.createInvoice).not.toHaveBeenCalled();
  });

  it('sales wizard passes paymentType=cash + cashBoxId through to createInvoice', async () => {
    const tool = findTool('sales.create_and_post_invoice')!;
    const res = (await tool.execute(
      { customerId: 'c-1', lines: LINES, paymentType: 'cash', cashBoxId: 'cb-1' },
      ctx,
    )) as Record<string, unknown>;

    expect(res.success).toBe(true);
    expect(res.paymentType).toBe('cash');
    expect(vi.mocked(salesApi.createInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: 'cash', cashBoxId: 'cb-1' }),
    );
  });

  it('sales wizard defaults to credit WITHOUT cashBoxId', async () => {
    const tool = findTool('sales.create_and_post_invoice')!;
    await tool.execute({ customerId: 'c-1', lines: LINES }, ctx);
    const call = vi.mocked(salesApi.createInvoice).mock.calls[0][0] as Record<string, unknown>;
    expect(call.paymentType).toBe('credit');
    expect(call.cashBoxId).toBeUndefined();
  });

  it('purchases wizard passes paymentType=cash + cashBoxId and posts', async () => {
    const tool = findTool('purchases.create_and_post_invoice')!;
    const res = (await tool.execute(
      { supplierId: 's-1', lines: LINES, paymentType: 'cash', cashBoxId: 'cb-2' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(vi.mocked(purchasesApi.createInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: 'cash', cashBoxId: 'cb-2' }),
    );
    expect(purchasesApi.postInvoice).toHaveBeenCalledWith('pinv-1', ctx.companyId);
  });

  it('rolls back the draft when posting fails (cash or credit)', async () => {
    vi.mocked(salesApi.postInvoice).mockResolvedValue({ success: false, error: 'sequence' } as never);
    const tool = findTool('sales.create_and_post_invoice')!;
    const res = (await tool.execute(
      { customerId: 'c-1', lines: LINES, paymentType: 'cash', cashBoxId: 'cb-1' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toMatch(/فشل الترحيل/);
    expect(salesApi.deleteInvoice).toHaveBeenCalledWith('inv-1', ctx.companyId);
  });
});
