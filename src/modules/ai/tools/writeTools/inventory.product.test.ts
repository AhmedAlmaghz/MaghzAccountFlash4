import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    getWarehouses: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
  getUnits: vi.fn(),
}));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { inventoryWriteTools } from './inventory';
import { inventoryApi } from '@/modules/inventory/api';
import { getNextDocumentNumber, getUnits } from '@/core/api';
import { getDbAdapter } from '@/core/database/adapters';
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
  const t = inventoryWriteTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

const mockedApi = vi.mocked(inventoryApi, true);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNextDocumentNumber).mockResolvedValue({ success: true, number: 'PRD-0100' } as never);
  mockedApi.createProduct.mockResolvedValue({ success: true, id: 'prod-1' });
  mockedApi.getWarehouses.mockResolvedValue({ success: true, data: [{ id: 'wh-1' }] } as never);
  mockedApi.updateProduct.mockResolvedValue({ success: true });
});

describe('inventory.create_product — human-name aliases (transcript regression)', () => {
  // Real session 2026-09-10: the model passed plain `name` (like the
  // supplier/customer tools accept) and all 10 products failed with
  // "اسم المنتج مطلوب" although the name was right there in args.
  it('accepts plain `name` as an alias for nameAr', async () => {
    const res = (await findTool('inventory.create_product').execute(
      { name: 'شوكلاتة سويت مون صغير', salePrice: 10800, costPrice: 10000 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ nameAr: 'شوكلاتة سويت مون صغير' }),
    );
  });

  it('maps purchasePrice → costPrice and forwards sku/minStock/nameEn', async () => {
    const res = (await findTool('inventory.create_product').execute(
      {
        nameAr: 'أرز بسمتي',
        salePrice: 55000,
        purchasePrice: 45000,
        sku: 'PRD-001',
        nameEn: 'Basmati Rice',
        minStockLevel: 6,
      },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        nameAr: 'أرز بسمتي',
        costPrice: 45000,
        sku: 'PRD-001',
        nameEn: 'Basmati Rice',
        minStock: 6,
      }),
    );
  });

  it('honors an explicit warehouseId instead of auto-picking', async () => {
    await findTool('inventory.create_product').execute(
      { nameAr: 'صنف', salePrice: 100, openingStockQty: 4, warehouseId: 'wh-9' },
      ctx,
    );
    expect(mockedApi.getWarehouses).not.toHaveBeenCalled();
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ openingStockQty: 4, openingWarehouseId: 'wh-9' }),
    );
  });

  it('auto-picks the first warehouse only when none is given', async () => {
    await findTool('inventory.create_product').execute(
      { nameAr: 'صنف', salePrice: 100, initialStockQuantity: 4 },
      ctx,
    );
    expect(mockedApi.getWarehouses).toHaveBeenCalled();
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ openingStockQty: 4, openingWarehouseId: 'wh-1' }),
    );
  });

  it('shows the real name on the approval card (never undefined)', () => {
    const s = findTool('inventory.create_product').summarizeArgs!({ name: 'شوكلاتة', salePrice: 100 });
    expect(s).toContain('شوكلاتة');
    expect(s).not.toContain('undefined');
  });

  it('still rejects a product with no name at all', async () => {
    const res = (await findTool('inventory.create_product').execute({ salePrice: 100 }, ctx)) as Record<string, unknown>;
    expect(res.error).toMatch(/اسم المنتج مطلوب/);
    expect(mockedApi.createProduct).not.toHaveBeenCalled();
  });

  it('resolves productType by code or English name, not just Arabic', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue({
      query: vi.fn(async () => ({
        success: true,
        rows: [
          { id: 'type-fg', name_ar: 'منتج نهائي', name_en: 'Finished Goods', code: 'FG' },
          { id: 'type-raw', name_ar: 'مواد خام', name_en: 'Raw Materials', code: 'RAW' },
        ],
      })),
    } as never);
    const byCode = (await findTool('inventory.create_product').execute(
      { nameAr: 'صنف', salePrice: 100, productType: 'raw' },
      ctx,
    )) as Record<string, unknown>;
    expect(byCode.created).toBe(true);
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ productTypeId: 'type-raw' }),
    );
  });
});

describe('inventory.update_product — name alias (no silent drop)', () => {
  it('maps plain `name` to nameAr instead of ignoring it', async () => {
    const res = (await findTool('inventory.update_product').execute(
      { productId: 'prod-1', name: 'اسم جديد' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(mockedApi.updateProduct).toHaveBeenCalledWith(
      'prod-1',
      ctx.companyId,
      ctx.userId,
      expect.objectContaining({ nameAr: 'اسم جديد' }),
    );
  });
});

describe('inventory.create_product — unit catalog validation (transcript regression)', () => {
  const CATALOG = [
    { id: 'u-shd', nameAr: 'شدة', nameEn: 'Shadah', code: 'SHD', isActive: true },
    { id: 'u-dzn', nameAr: 'درزن', nameEn: 'Dozen', code: 'DZ', isActive: true },
    { id: 'u-pc', nameAr: 'حبة', nameEn: 'Piece', code: 'PC', isActive: true },
  ];

  beforeEach(() => {
    vi.mocked(getUnits).mockResolvedValue({ success: true, data: CATALOG } as never);
  });

  // Real session 2026-09-10: the model passed `unitName: "شدة"` while the
  // tool only read `unit` — every product silently landed on 'piece'.
  it('accepts `unitName` and stores the canonical catalog name', async () => {
    const res = (await findTool('inventory.create_product').execute(
      { nameAr: 'شوكلاتة', salePrice: 10800, costPrice: 10000, unitName: 'شدة' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ unit: 'شدة' }),
    );
  });

  it('rejects unknown unit names loudly instead of defaulting silently', async () => {
    const res = (await findTool('inventory.create_product').execute(
      { nameAr: 'شوكلاتة', salePrice: 10800, unitName: 'برميل ضخم' },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('غير موجودة في الكتالوج');
    expect(mockedApi.createProduct).not.toHaveBeenCalled();
  });

  it('resolves the piece default FROM the catalog so ensureBaseProductUnit can match it', async () => {
    // Regression (U1): the raw 'piece' literal matched neither name_ar nor
    // code in ensureBaseProductUnit's JOIN → every AI product created without
    // a unit ended with NO product_units row and later invoice lines
    // silently degraded to factor=1. The default must now come from the
    // catalog (English "Piece" → Arabic حبة → code PC).
    const res = (await findTool('inventory.create_product').execute(
      { nameAr: 'شوكلاتة', salePrice: 10800 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(getUnits)).toHaveBeenCalled();
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ unit: 'حبة' }),
    );
  });

  it('falls back to the legacy piece literal only when the catalog has no piece unit', async () => {
    vi.mocked(getUnits).mockResolvedValue({
      success: true,
      data: [{ id: 'u-ton', nameAr: 'طن', nameEn: 'Ton', code: 'TON', isActive: true }],
    } as never);
    const res = (await findTool('inventory.create_product').execute(
      { nameAr: 'صنف', salePrice: 100 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ unit: 'piece' }),
    );
  });

  it('validates the unit on update too', async () => {
    const res = (await findTool('inventory.update_product').execute(
      { productId: 'prod-1', unitName: 'وحدة وهمية' },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('غير موجودة في الكتالوج');
    expect(mockedApi.updateProduct).not.toHaveBeenCalled();
  });
});
