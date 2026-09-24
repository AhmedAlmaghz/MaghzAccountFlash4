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

const PROD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAT1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAT2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BOMA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('manufacturing.create_bom — line-shape aliases (transcript regression)', () => {
  // Real session 2026-09-10: the model passed `items: [{productId…}]`, then
  // `lines: [{productId…}]` — both rejected (lines wanted, then materialId
  // wanted) although the data was complete. Only the third spelling worked.
  it('accepts `items` as an alias for `lines`', async () => {
    mockedApi.createBom.mockResolvedValue({ success: true, id: 'bom-1' } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      {
        productId: PROD,
        quantity: 10,
        version: '1',
        items: [{ productId: MAT1, quantity: 6 }],
      },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createBom).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ materialId: MAT1, quantity: 6 })],
      }),
      expect.anything(),
    );
  });

  it('maps line `productId` to materialId', async () => {
    mockedApi.createBom.mockResolvedValue({ success: true, id: 'bom-1' } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      { productId: PROD, lines: [{ productId: MAT2, quantity: 2 }] },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createBom).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ materialId: MAT2, quantity: 2 })],
      }),
      expect.anything(),
    );
  });

  it('counts alias-shaped lines on the approval card', () => {
    const s = findTool('manufacturing.create_bom').summarizeArgs!({
      productId: PROD,
      items: [{ productId: MAT1, quantity: 6 }],
    });
    expect(s).toContain('بعدد مواد: 1');
  });
});

describe('manufacturing.create_bom — human names resolve internally (session 2026-09-24)', () => {
  // Five consecutive batches died with "productId مطلوب"/"materialId" after
  // approval because the model passes Arabic names in id fields. Names now
  // resolve inside the tool instead of failing post-approval.
  const PRODUCTS = [
    { id: PROD, nameAr: 'شوكلاتة سويت مون صغير', nameEn: '', code: 'PRD-001', costPrice: 10000 },
    { id: MAT1, nameAr: 'شوكلاتة خام', nameEn: '', code: 'RM-01', costPrice: 6500 },
  ];

  it('resolves productName + materialName to UUIDs', async () => {
    const { inventoryApi } = await import('@/modules/inventory/api');
    vi.mocked(inventoryApi.getProducts).mockResolvedValue({ success: true, data: PRODUCTS } as never);
    mockedApi.createBom.mockResolvedValue({ success: true, id: 'bom-9' } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      {
        productName: 'شوكلاتة سويت مون صغير',
        lines: [{ materialName: 'شوكلاتة خام', quantity: 6 }],
      },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createBom).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PROD,
        lines: [expect.objectContaining({ materialId: MAT1, quantity: 6 })],
      }),
      expect.anything(),
    );
  });

  it('resolves a literal name passed inside productId itself', async () => {
    const { inventoryApi } = await import('@/modules/inventory/api');
    vi.mocked(inventoryApi.getProducts).mockResolvedValue({ success: true, data: PRODUCTS } as never);
    mockedApi.createBom.mockResolvedValue({ success: true, id: 'bom-9' } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      { productId: 'شوكلاتة خام', lines: [{ materialId: MAT1, quantity: 1 }] },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createBom).toHaveBeenCalledWith(
      expect.objectContaining({ productId: MAT1 }),
      expect.anything(),
    );
  });

  it('rejects an unresolvable name with a search.products hint', async () => {
    const { inventoryApi } = await import('@/modules/inventory/api');
    vi.mocked(inventoryApi.getProducts).mockResolvedValue({ success: true, data: PRODUCTS } as never);
    const res = (await findTool('manufacturing.create_bom').execute(
      { productName: 'منتج غير موجود أبداً', lines: [{ materialId: MAT1, quantity: 1 }] },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('search.products');
    expect(mockedApi.createBom).not.toHaveBeenCalled();
  });
});

describe('manufacturing.create_work_order — human-key aliases (transcript regression)', () => {
  const BOM = {
    bom: { id: BOMA, productId: PROD },
    lines: [{ materialId: MAT1, quantity: 2, unitCost: 100 }],
  };

  it('derives productId from bomId when only the tree is named', async () => {
    mockedApi.getBomById.mockResolvedValue({ success: true, data: BOM } as never);
    mockedApi.createWorkOrder.mockResolvedValue({ success: true, id: 'wo-1' } as never);
    const res = (await findTool('manufacturing.create_work_order').execute(
      { bomId: BOMA, quantity: 1 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PROD, bomId: BOMA, quantity: 1 }),
      expect.anything(),
    );
  });

  it('accepts plannedQuantity/startDate/endDate aliases', async () => {
    mockedApi.getBomById.mockResolvedValue({ success: true, data: BOM } as never);
    mockedApi.createWorkOrder.mockResolvedValue({ success: true, id: 'wo-1' } as never);
    const res = (await findTool('manufacturing.create_work_order').execute(
      {
        productId: PROD,
        bomId: BOMA,
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
      productId: PROD,
      plannedQuantity: 250,
    });
    expect(s).toContain('250');
  });

  it('still rejects a missing quantity with a hint listing both keys', async () => {
    const res = (await findTool('manufacturing.create_work_order').execute(
      { productId: PROD, bomId: BOMA },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('plannedQuantity');
  });
});
