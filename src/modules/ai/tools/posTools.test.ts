import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/pos/api', () => ({
  posApi: {
    getActiveShift: vi.fn(),
    getShiftSummary: vi.fn(),
    getShiftsPaginated: vi.fn(),
    checkout: vi.fn(),
  },
}));

import { posApi } from '@/modules/pos/api';
import { posTools } from './posTools';
import { ALL_PERMISSIONS } from '@/modules/auth/types';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const SHIFT_ID = '00000000-0000-0000-0000-000000000010';
const BOX_ID = '00000000-0000-0000-0000-000000000020';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000030';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000040';
const SAMPLE_LINE = { productId: PRODUCT_ID, quantity: 2, unitPrice: 100 };

interface TestableTool {
  permission: string;
  dangerLevel: string;
  summarizeArgs?: (a: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = posTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pos.get_active_shift', () => {
  it('calls posApi.getActiveShift with (companyId, userId)', async () => {
    vi.mocked(posApi.getActiveShift).mockResolvedValue({ success: true, data: null });
    const res = (await findTool('pos.get_active_shift').execute({}, ctx)) as Record<string, unknown>;
    expect(vi.mocked(posApi.getActiveShift)).toHaveBeenCalledWith(ctx.companyId, ctx.userId);
    expect(res.active).toBe(false);
  });

  it('reports the open shift when present', async () => {
    vi.mocked(posApi.getActiveShift).mockResolvedValue({
      success: true,
      data: { id: SHIFT_ID } as never,
    });
    const res = (await findTool('pos.get_active_shift').execute({}, ctx)) as Record<string, unknown>;
    expect(res.active).toBe(true);
  });
});

describe('pos.get_shift_summary / pos.list_shifts', () => {
  it('falls back to the active shift when shiftId is omitted', async () => {
    vi.mocked(posApi.getActiveShift).mockResolvedValue({ success: true, data: { id: SHIFT_ID } as never });
    vi.mocked(posApi.getShiftSummary).mockResolvedValue({ success: true, data: { netTotal: 500 } as never });
    const res = (await findTool('pos.get_shift_summary').execute({}, ctx)) as Record<string, unknown>;
    expect(vi.mocked(posApi.getShiftSummary)).toHaveBeenCalledWith(ctx.companyId, SHIFT_ID);
    expect(res.shiftId).toBe(SHIFT_ID);
  });

  it('rejects invalid pagination before touching the API', async () => {
    const res = (await findTool('pos.list_shifts').execute({ pageSize: 500 }, ctx)) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(posApi.getShiftsPaginated)).not.toHaveBeenCalled();
  });
});

describe('pos.checkout_sale', () => {
  const line = { productId: PRODUCT_ID, quantity: 2, unitPrice: 100 };

  it('computes totals and calls posApi.checkout', async () => {
    vi.mocked(posApi.checkout).mockResolvedValue({ success: true, invoiceId: 'inv-1', receiptNumber: 'POS-000001' });
    const res = (await findTool('pos.checkout_sale').execute(
      { shiftId: SHIFT_ID, cashBoxId: BOX_ID, lines: [line], cashAmount: 200, creditAmount: 0 },
      ctx
    )) as Record<string, unknown>;
    expect(res.sold).toBe(true);
    expect(res.receiptNumber).toBe('POS-000001');
    const input = vi.mocked(posApi.checkout).mock.calls[0][0] as Record<string, unknown>;
    expect(input.companyId).toBe(ctx.companyId);
    expect(input.subtotal).toBe(200);
    expect(input.totalAmount).toBe(200);
  });

  it('rejects cash+credit mismatch without calling the API', async () => {
    const res = (await findTool('pos.checkout_sale').execute(
      { shiftId: SHIFT_ID, cashBoxId: BOX_ID, lines: [line], cashAmount: 100, creditAmount: 0 },
      ctx
    )) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(posApi.checkout)).not.toHaveBeenCalled();
  });

  it('rejects credit sales without a customer', async () => {
    const res = (await findTool('pos.checkout_sale').execute(
      { shiftId: SHIFT_ID, cashBoxId: BOX_ID, lines: [line], cashAmount: 0, creditAmount: 200 },
      ctx
    )) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(posApi.checkout)).not.toHaveBeenCalled();
  });

  it('accepts credit sales with a registered customer', async () => {
    vi.mocked(posApi.checkout).mockResolvedValue({ success: true, invoiceId: 'inv-2', receiptNumber: 'POS-000002' });
    const res = (await findTool('pos.checkout_sale').execute(
      { shiftId: SHIFT_ID, cashBoxId: BOX_ID, lines: [line], cashAmount: 0, creditAmount: 200, customerId: CUSTOMER_ID },
      ctx
    )) as Record<string, unknown>;
    expect(res.sold).toBe(true);
  });

  it('rejects empty lines and bad quantities', async () => {
    const empty = (await findTool('pos.checkout_sale').execute(
      { shiftId: SHIFT_ID, cashBoxId: BOX_ID, lines: [], cashAmount: 0, creditAmount: 0 },
      ctx
    )) as Record<string, unknown>;
    expect(empty.error).toBeDefined();
    const badQty = (await findTool('pos.checkout_sale').execute(
      {
        shiftId: SHIFT_ID, cashBoxId: BOX_ID,
        lines: [{ productId: PRODUCT_ID, quantity: 0, unitPrice: 100 }],
        cashAmount: 0, creditAmount: 0,
      },
      ctx
    )) as Record<string, unknown>;
    expect(badQty.error).toBeDefined();
    expect(vi.mocked(posApi.checkout)).not.toHaveBeenCalled();
  });
});

describe('pos tools contract', () => {
  it('uses valid permissions with correct danger levels and summaries for writes', () => {
    const valid = new Set<string>([...ALL_PERMISSIONS, '*']);
    for (const t of posTools) {
      expect(valid.has(t.permission), `${t.name} permission`).toBe(true);
      expect(t.name).toMatch(/^[a-z][a-z0-9]*\.[a-z0-9_]+$/);
    }
    const reads = posTools.filter((t) => t.dangerLevel === 'read');
    expect(reads.every((t) => t.permission === 'pos.view')).toBe(true);
    const write = findTool('pos.checkout_sale');
    expect(write.permission).toBe('pos.create');
    expect(write.dangerLevel).toBe('write');
    expect(typeof write.summarizeArgs).toBe('function');
    expect(write.summarizeArgs?.({ lines: [SAMPLE_LINE], totalAmount: 200, cashAmount: 200, creditAmount: 0 })).toContain('200');
  });
});
