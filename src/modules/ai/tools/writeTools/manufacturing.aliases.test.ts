import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/manufacturing/api', () => ({
  manufacturingApi: {
    createBom: vi.fn(),
    getBomById: vi.fn(),
    createWorkOrder: vi.fn(),
  },
}));
vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    getProducts: vi.fn(async () => ({ success: true, data: [] })),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'WO-0001' })),
}));

import { manufacturingWriteTools } from './manufacturing';
import { manufacturingApi } from '@/modules/manufacturing/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

interface TestableTool {
  summarizeArgs?: (a: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = manufacturingWriteTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

const mockedApi = vi.mocked(manufacturingApi, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('manufacturing.create_bom — line-shape aliases (transcript regression)', () => {
  // Real session 2026-09-10: the model passed `items: [{productId…}]`, then
  // `lines: [{productId…}]` — both rejected (lines wanted, then materialId
  // wanted) although the data was complete. Only the third spelling worked.
  it('accepts `items` as an alias for `lines`', async () => {
    mockedApi.createBom.mockResolvedValue({ success: true, id: 'bom-1' } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      {
        productId: 'prod-9',
        quantity: 10,
        version: '1',
        items: [{ productId: 'mat-1', quantity: 6 }],
      },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createBom).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ materialId: 'mat-1', quantity: 6 })],
      }),
      expect.anything(),
    );
  });

  it('maps line `productId` to materialId', async () => {
    mockedApi.createBom.mockResolvedValue({ success: true, id: 'bom-1' } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      { productId: 'prod-9', lines: [{ productId: 'mat-2', quantity: 2 }] },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createBom).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ materialId: 'mat-2', quantity: 2 })],
      }),
      expect.anything(),
    );
  });

  it('counts alias-shaped lines on the approval card', () => {
    const s = findTool('manufacturing.create_bom').summarizeArgs!({
      productId: 'prod-9',
      items: [{ productId: 'mat-1', quantity: 6 }],
    });
    expect(s).toContain('بعدد مواد: 1');
  });
});

describe('manufacturing.create_work_order — human-key aliases (transcript regression)', () => {
  const BOM = {
    bom: { id: 'bom-1', productId: 'prod-9' },
    lines: [{ materialId: 'mat-1', quantity: 2, unitCost: 100 }],
  };

  it('derives productId from bomId when only the tree is named', async () => {
    mockedApi.getBomById.mockResolvedValue({ success: true, data: BOM } as never);
    mockedApi.createWorkOrder.mockResolvedValue({ success: true, id: 'wo-1' } as never);
    const res = (await findTool('manufacturing.create_work_order').execute(
      { bomId: 'bom-1', quantity: 1 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'prod-9', bomId: 'bom-1', quantity: 1 }),
      expect.anything(),
    );
  });

  it('accepts plannedQuantity/startDate/endDate aliases', async () => {
    mockedApi.getBomById.mockResolvedValue({ success: true, data: BOM } as never);
    mockedApi.createWorkOrder.mockResolvedValue({ success: true, id: 'wo-1' } as never);
    const res = (await findTool('manufacturing.create_work_order').execute(
      {
        productId: 'prod-9',
        bomId: 'bom-1',
        plannedQuantity: 250,
        startDate: '2026-09-10',
        endDate: '2026-09-10',
      },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 250,
        plannedStartDate: '2026-09-10',
        plannedEndDate: '2026-09-10',
      }),
      expect.anything(),
    );
  });

  it('shows the real quantity on the approval card (never blank)', () => {
    const s = findTool('manufacturing.create_work_order').summarizeArgs!({
      productId: 'prod-9',
      plannedQuantity: 250,
    });
    expect(s).toContain('250');
  });

  it('still rejects a missing quantity with a hint listing both keys', async () => {
    const res = (await findTool('manufacturing.create_work_order').execute(
      { productId: 'prod-9', bomId: 'bom-1' },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('plannedQuantity');
  });
});
