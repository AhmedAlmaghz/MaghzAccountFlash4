import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    createProductUnit: vi.fn(),
    updateProductUnit: vi.fn(),
    deleteProductUnit: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
  getUnits: vi.fn(),
}));

import { inventoryWriteTools } from './inventory';
import { inventoryApi } from '@/modules/inventory/api';
import { getUnits } from '@/core/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

interface TestableTool {
  name: string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = inventoryWriteTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

const CATALOG = [
  { id: 'u-carton', nameAr: 'كرتون', nameEn: 'Carton', code: 'CTN', isActive: true },
  { id: 'u-piece', nameAr: 'حبة', nameEn: 'Piece', code: 'PC', isActive: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUnits).mockResolvedValue({ success: true, data: CATALOG } as never);
});

describe('inventory.create_product_unit', () => {
  it('resolves the unit name to a catalog id and creates the row', async () => {
    vi.mocked(inventoryApi.createProductUnit).mockResolvedValue({ success: true, id: 'pu-1' } as never);
    const res = (await findTool('inventory.create_product_unit').execute(
      { productId: 'prod-1', unitName: 'كرتون', factor: 12, salePrice: 35000 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(inventoryApi.createProductUnit)).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'prod-1', unitId: 'u-carton', factor: 12, salePrice: 35000, isBase: false }),
    );
  });

  it('rejects a non-positive factor before any DB call', async () => {
    const res = (await findTool('inventory.create_product_unit').execute(
      { productId: 'prod-1', unitName: 'كرتون', factor: 0 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toMatch(/factor/);
    expect(vi.mocked(inventoryApi.createProductUnit)).not.toHaveBeenCalled();
  });

  it('guides to settings when the unit name is unknown', async () => {
    const res = (await findTool('inventory.create_product_unit').execute(
      { productId: 'prod-1', unitName: 'برميل ضخم', factor: 5 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toMatch(/الإعدادات/);
    expect(vi.mocked(inventoryApi.createProductUnit)).not.toHaveBeenCalled();
  });

  it('matches ال-prefixed and variant spellings (للكرتون)', async () => {
    vi.mocked(inventoryApi.createProductUnit).mockResolvedValue({ success: true, id: 'pu-1' } as never);
    const res = (await findTool('inventory.create_product_unit').execute(
      { productId: 'prod-1', unitName: 'للكرتون', factor: 12 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(inventoryApi.createProductUnit)).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 'u-carton' }),
    );
  });
});

describe('inventory.update_product_unit', () => {
  it('passes partial fields through to the API', async () => {
    vi.mocked(inventoryApi.updateProductUnit).mockResolvedValue({ success: true } as never);
    const res = (await findTool('inventory.update_product_unit').execute(
      { unitRowId: 'pu-1', salePrice: 36000, isDefaultSale: true },
      ctx,
    )) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(vi.mocked(inventoryApi.updateProductUnit)).toHaveBeenCalledWith(
      'pu-1',
      ctx.companyId,
      expect.objectContaining({ salePrice: 36000, isDefaultSale: true }),
    );
  });

  it('requires at least one field', async () => {
    const res = (await findTool('inventory.update_product_unit').execute({ unitRowId: 'pu-1' }, ctx)) as Record<string, unknown>;
    expect(res.error).toMatch(/حقل واحد/);
  });
});

describe('inventory.delete_product_unit', () => {
  it('deletes by row id', async () => {
    vi.mocked(inventoryApi.deleteProductUnit).mockResolvedValue({ success: true } as never);
    const res = (await findTool('inventory.delete_product_unit').execute({ unitRowId: 'pu-1' }, ctx)) as Record<string, unknown>;
    expect(res.deleted).toBe(true);
    expect(vi.mocked(inventoryApi.deleteProductUnit)).toHaveBeenCalledWith('pu-1', ctx.companyId);
  });

  it('requires unitRowId', async () => {
    const res = (await findTool('inventory.delete_product_unit').execute({}, ctx)) as Record<string, unknown>;
    expect(res.error).toMatch(/unitRowId/);
  });
});
