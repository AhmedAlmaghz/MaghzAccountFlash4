import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    createStockAdjustment: vi.fn(),
    postStockAdjustment: vi.fn(),
    createStockTransfer: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
}));

import { inventoryWriteTools } from './inventory';
import { inventoryApi } from '@/modules/inventory/api';
import { getNextDocumentNumber } from '@/core/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

interface TestableTool {
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = inventoryWriteTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

const mockedApi = vi.mocked(inventoryApi, true);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNextDocumentNumber).mockResolvedValue({ success: true, number: 'ADJ-0001' } as never);
  mockedApi.createStockAdjustment.mockResolvedValue({ success: true, id: 'adj-1' } as never);
  mockedApi.postStockAdjustment.mockResolvedValue({ success: true } as never);
});

describe('inventory.create_stock_adjustment — draft+post pipeline (P0-5 regression)', () => {
  // The old tool INSERTed with status:'posted' — zero stock_movements, zero
  // journal entry, zero stock update (the posting pipeline was bypassed and
  // the row could never be posted later). It must create DRAFT then post.
  it('creates as draft then posts through postStockAdjustment', async () => {
    const res = (await findTool('inventory.create_stock_adjustment').execute(
      { productId: 'prod-1', warehouseId: 'wh-1', systemQty: 100, actualQty: 98, reason: 'جرد' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(res.posted).toBe(true);
    expect(mockedApi.createStockAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft' }),
    );
    expect(mockedApi.postStockAdjustment).toHaveBeenCalledWith('adj-1', ctx.companyId);
  });

  it('leaves an honest draft (not fake posted) when posting fails', async () => {
    mockedApi.postStockAdjustment.mockResolvedValueOnce({ success: false, error: 'لا يوجد حساب مخزون' } as never);
    const res = (await findTool('inventory.create_stock_adjustment').execute(
      { productId: 'prod-1', warehouseId: 'wh-1', systemQty: 100, actualQty: 98 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBeUndefined();
    expect(res.status).toBe('draft');
    expect(String(res.error)).toContain('لا يوجد حساب مخزون');
    expect(res.adjustmentId).toBe('adj-1');
  });
});
