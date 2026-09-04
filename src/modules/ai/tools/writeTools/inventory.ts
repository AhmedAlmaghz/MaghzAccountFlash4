import type { ToolDefinition } from '../../types';
import { getNextDocumentNumber } from '@/core/api';
import { inventoryApi } from '@/modules/inventory/api';
import { getDbAdapter } from '@/core/database/adapters';
import {
  num,
  str,
  round2,
} from './shared';
import { localToday } from '../../engine/dateUtils';

/**
 * WRITE tools — المخازن (15 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */

function today(): string {
  // LOCAL calendar day — UTC "today" is yesterday for GMT+3 between 00:00-03:00
  return localToday();
}
export const inventoryWriteTools: ToolDefinition[] = [
  // ─── ─── Inventory ─────────────────────────────────────────────────────────── ───
  {
    name: 'inventory.create_product',
    labelAr: 'إنشاء منتج',
    descriptionAr: 'ينشئ منتجاً جديداً بالاسم وسعر البيع وسعر التكلفة والوحدة، مع مخزون افتتاحي اختياري يُرحّل تلقائياً (حركة مخزون + قيد بالمخزون/الأرصدة الافتتاحية).',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم المنتج بالعربية (إلزامي)' },
        salePrice: { type: 'number', description: 'سعر البيع' },
        costPrice: { type: 'number', description: 'سعر التكلفة (افتراضي 0)' },
        unit: { type: 'string', description: 'الوحدة (افتراضي piece)' },
        barcode: { type: 'string' },
        openingStockQty: { type: 'number', description: 'كمية المخزون الافتتاحي (تُقيَّم بسعر التكلفة وتُرحّل تلقائياً)' },
        productTypeId: { type: 'string', description: 'معرف نوع المنتج (من search.product_types — اذكره مثل: منتج نهائي، خامة، خدمة)' },
        productTypeName: { type: 'string', description: 'اسم نوع المنتج نصاً (بديل — سيُبحث تلقائياً مثل: منتج نهائي)' },
      },
      required: ['nameAr', 'salePrice'],
    },
    summarizeArgs: (a) => `إنشاء منتج جديد: ${a.nameAr} — سعر البيع: ${a.salePrice}${a.openingStockQty ? ` — مخزون افتتاحي: ${a.openingStockQty}` : ''}${(a as Record<string, unknown>).productTypeName ? ` — النوع: ${(a as Record<string, unknown>).productTypeName}` : ''}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      const salePrice = num(args.salePrice);
      if (!nameAr) return { error: 'اسم المنتج مطلوب' };
      if (salePrice < 0) return { error: 'سعر البيع لا يمكن أن يكون سالباً' };

      // Resolve product type if mentioned by name
      let productTypeId = str(args.productTypeId);
      const productTypeName = str(args.productTypeName);
      if (!productTypeId && productTypeName) {
        try {
          const typesRes = await getDbAdapter().then(adapter => adapter.query(`SELECT id, name_ar FROM product_types WHERE company_id = $1 AND is_active = true`, [ctx.companyId]));
          if (typesRes.success && typesRes.rows) {
            const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/[ةه]/g, 'ه').toLowerCase().trim();
            const target = norm(productTypeName);
            const found = (typesRes.rows as Record<string, unknown>[]).find(r => norm(String(r.name_ar || '')) === target || String(r.name_ar || '').includes(productTypeName) || target.includes(norm(String(r.name_ar || ''))));
            if (found) productTypeId = String(found.id);
          }
        } catch {}
      }

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'product');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد كود المنتج' };
      const code = docNumber.number;

      // Opening stock needs a warehouse — auto-pick the first one when the
      // caller didn't specify (mirrors manufacturing completion behaviour).
      const openingQty = num(args.openingStockQty);
      let openingWarehouseId: string | undefined;
      if (openingQty > 0) {
        const wh = await inventoryApi.getWarehouses(ctx.companyId);
        openingWarehouseId = wh.success && wh.data && wh.data.length > 0 ? wh.data[0].id : undefined;
        if (!openingWarehouseId) {
          return { error: 'لا يوجد مستودع — أنشئ مستودعاً أولاً لتسجيل المخزون الافتتاحي' };
        }
      }

      const res = await inventoryApi.createProduct({
        companyId: ctx.companyId,
        code,
        nameAr,
        unit: str(args.unit) || 'piece',
        barcode: str(args.barcode),
        costPrice: num(args.costPrice),
        salePrice,
        isActive: true,
        createdBy: ctx.userId,
        ...(productTypeId ? { productTypeId } : {}),
        ...(openingQty > 0
          ? { openingStockQty: openingQty, openingWarehouseId }
          : {}),
      } as Parameters<typeof inventoryApi.createProduct>[0]);
      if (!res.success) return { error: res.error || 'فشل إنشاء المنتج' };
      return {
        created: true,
        productId: res.id,
        code,
        nameAr,
        ...(openingQty > 0
          ? {
              openingStockQty: openingQty,
              openingValue: round2(openingQty * num(args.costPrice)),
              openingPosted: !!openingWarehouseId,
              note: openingWarehouseId ? 'المخزون الافتتاحي رُحّل تلقائياً (مدين المخزون / دائن الأرصدة الافتتاحية)' : undefined,
            }
          : {}),
      };
    },
  },

  // ─── ─── Inventory Stock Adjustment ───────────────────────────────────────── ───
  {
    name: 'inventory.create_stock_adjustment',
    labelAr: 'تسوية مخزون',
    descriptionAr: 'ينشئ تسوية مخزون لتصحيح الفرق بين الكمية النظامية والكمية الفعلية. استخدم inventory.get_products أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (من inventory.get_products)' },
        warehouseId: { type: 'string', description: 'معرف المستودع' },
        systemQty: { type: 'number', description: 'الكمية في النظام' },
        actualQty: { type: 'number', description: 'الكمية الفعلية (الجرد)' },
        unitCost: { type: 'number', description: 'تكلفة الوحدة (اختياري)' },
        reason: { type: 'string', description: 'سبب التسوية' },
      },
      required: ['productId', 'warehouseId', 'systemQty', 'actualQty'],
    },
    summarizeArgs: (a) => `تسوية مخزون — منتج: ${String((a as Record<string, unknown>).productId || '').slice(0, 8)}… | نظامي: ${(a as Record<string, unknown>).systemQty ?? ''} | فعلي: ${(a as Record<string, unknown>).actualQty ?? ''}`,
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      const warehouseId = str(args.warehouseId);
      if (!productId) return { error: 'productId مطلوب — استخدم inventory.get_products أولاً' };
      if (!warehouseId) return { error: 'warehouseId مطلوب' };
      const systemQty = num(args.systemQty);
      const actualQty = num(args.actualQty);
      const difference = round2(actualQty - systemQty);

      const adjNum = await getNextDocumentNumber(ctx.companyId, 'stock_adjustment');
      if (!adjNum.success || !adjNum.number) return { error: adjNum.error || 'فشل توليد رقم التسوية' };

      const res = await inventoryApi.createStockAdjustment({
        companyId: ctx.companyId,
        date: today(),
        productId,
        warehouseId,
        systemQty,
        actualQty,
        difference,
        unitCost: args.unitCost !== undefined ? num(args.unitCost) : undefined,
        reason: str(args.reason) || '',
        status: 'posted',
        adjustmentNumber: adjNum.number,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء التسوية' };
      return { created: true, adjustmentId: res.id, productId, difference, status: 'posted' };
    },
  },

  // ─── ─── Inventory Update Product ────────────────────────────────────────── ───
  {
    name: 'inventory.update_product',
    labelAr: 'تعديل منتج',
    descriptionAr: 'يُحدّث بيانات منتج موجود — الاسم، السعر، الوحدة، الباركود، إلخ. استخدم inventory.get_products أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (من inventory.get_products)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        unit: { type: 'string', description: 'الوحدة' },
        barcode: { type: 'string' },
        sku: { type: 'string' },
        salePrice: { type: 'number', description: 'سعر البيع' },
        costPrice: { type: 'number', description: 'سعر التكلفة' },
        isActive: { type: 'boolean' },
      },
      required: ['productId'],
    },
    summarizeArgs: (a) => `تعديل منتج: ${String((a as Record<string, unknown>).productId || '').slice(0, 8)}…${(a as Record<string, unknown>).nameAr ? ` — الاسم: ${(a as Record<string, unknown>).nameAr}` : ''}`,
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      if (!productId) return { error: 'productId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.unit !== undefined) data.unit = str(args.unit);
      if (args.barcode !== undefined) data.barcode = str(args.barcode);
      if (args.sku !== undefined) data.sku = str(args.sku);
      if (args.salePrice !== undefined) data.salePrice = num(args.salePrice);
      if (args.costPrice !== undefined) data.costPrice = num(args.costPrice);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };

      const res = await inventoryApi.updateProduct(productId, ctx.companyId, ctx.userId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المنتج' };
      return { updated: true, productId };
    },
  },

  // ─── ─── Inventory: Delete Product ────────────────────────────────────── ───
  {
    name: 'inventory.delete_product',
    labelAr: 'حذف منتج',
    descriptionAr: 'يحذف منتجاً من نظام المخزون. الـ API يرفض حذف المنتجات المرتبطة بفواتير أو حركات مخزون. استخدم search.products أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (UUID)' },
      },
      required: ['productId'],
    },
    summarizeArgs: (a) => `حذف منتج: ${a.productId}`,
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      if (!productId) return { error: 'productId مطلوب — استخدم search.products أولاً' };
      const res = await inventoryApi.deleteProduct(productId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المنتج' };
      return { deleted: true, productId };
    },
  },

  // ─── ─── Inventory: Create Warehouse ──────────────────────────────────── ───
  {
    name: 'inventory.create_warehouse',
    labelAr: 'إنشاء مستودع',
    descriptionAr: 'ينشئ مستودعاً جديداً بالاسم والكود والعنوان.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم المستودع (إلزامي)' },
        code: { type: 'string', description: 'كود المستودع (اختياري)' },
        address: { type: 'string', description: 'عنوان المستودع (اختياري)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل (افتراضي true)' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء مستودع: ${a.name}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'name مطلوب' };
      const res = await inventoryApi.createWarehouse({
        companyId: ctx.companyId,
        name,
        code: str(args.code),
        isActive: args.isActive !== undefined ? Boolean(args.isActive) : true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء المستودع' };
      return { created: true, warehouseId: res.id, name };
    },
  },

  // ─── ─── Inventory: Update Warehouse ──────────────────────────────────── ───
  {
    name: 'inventory.update_warehouse',
    labelAr: 'تعديل مستودع',
    descriptionAr: 'يُحدّث بيانات مستودع موجود — الاسم، العنوان، حالة التفعيل. استخدم inventory.get_warehouses أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string', description: 'معرف المستودع (من inventory.get_warehouses)' },
        name: { type: 'string', description: 'الاسم الجديد' },
        address: { type: 'string', description: 'العنوان الجديد' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['warehouseId'],
    },
    summarizeArgs: (a) => `تعديل مستودع: ${String((a as Record<string, unknown>).warehouseId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const warehouseId = str(args.warehouseId);
      if (!warehouseId) return { error: 'warehouseId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await inventoryApi.updateWarehouse(warehouseId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المستودع' };
      return { updated: true, warehouseId };
    },
  },

  // ─── ─── Inventory: Delete Warehouse ──────────────────────────────────── ───
  {
    name: 'inventory.delete_warehouse',
    labelAr: 'حذف مستودع',
    descriptionAr: 'يحذف مستودعاً. الـ API يرفض حذف المستودعات المرتبطة بحركات مخزون. استخدم inventory.get_warehouses أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string', description: 'معرف المستودع (UUID)' },
      },
      required: ['warehouseId'],
    },
    summarizeArgs: (a) => `حذف مستودع: ${a.warehouseId}`,
    execute: async (args, ctx) => {
      const warehouseId = str(args.warehouseId);
      if (!warehouseId) return { error: 'warehouseId مطلوب — استخدم inventory.get_warehouses أولاً' };
      const res = await inventoryApi.deleteWarehouse(warehouseId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المستودع' };
      return { deleted: true, warehouseId };
    },
  },

  // ─── ─── Inventory: Delete Stock Adjustment ───────────────────────────── ───
  {
    name: 'inventory.delete_stock_adjustment',
    labelAr: 'حذف تسوية مخزون',
    descriptionAr: 'يحذف تسوية مخزون (جرد). الـ API يرفض حذف التسويات المرحلة (posted). استخدم inventory.get_stock_adjustments أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        adjustmentId: { type: 'string', description: 'معرف التسوية (UUID)' },
      },
      required: ['adjustmentId'],
    },
    summarizeArgs: (a) => `حذف تسوية مخزون: ${a.adjustmentId}`,
    execute: async (args, ctx) => {
      const adjustmentId = str(args.adjustmentId);
      if (!adjustmentId) return { error: 'adjustmentId مطلوب' };
      const res = await inventoryApi.deleteStockAdjustment(adjustmentId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف التسوية' };
      return { deleted: true, adjustmentId };
    },
  },

  // ─── ─── Inventory: Update Stock Adjustment ────────────────────────────── ───
  {
    name: 'inventory.update_stock_adjustment',
    labelAr: 'تعديل تسوية مخزون',
    descriptionAr: 'يُحدّث بيانات تسوية مخزون — الكمية النظامية، الكمية الفعلية، الفرق، السبب، تكلفة الوحدة. الفرق يُحسب تلقائياً إذا مررت الكمية النظامية والفعلية. استخدم inventory.get_stock_adjustments أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        stockAdjustmentId: { type: 'string', description: 'معرف التسوية (UUID)' },
        systemQty: { type: 'number', description: 'الكمية النظامية الجديدة' },
        actualQty: { type: 'number', description: 'الكمية الفعلية الجديدة' },
        reason: { type: 'string', description: 'سبب التسوية' },
        unitCost: { type: 'number', description: 'تكلفة الوحدة' },
      },
      required: ['stockAdjustmentId'],
    },
    summarizeArgs: (a) => `تعديل تسوية مخزون: ${String((a as Record<string, unknown>).stockAdjustmentId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.stockAdjustmentId);
      if (!id) return { error: 'stockAdjustmentId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.systemQty !== undefined) data.systemQty = num(args.systemQty);
      if (args.actualQty !== undefined) data.actualQty = num(args.actualQty);
      if (args.systemQty !== undefined && args.actualQty !== undefined) {
        data.difference = round2(num(args.actualQty) - num(args.systemQty));
      }
      if (args.reason !== undefined) data.reason = str(args.reason);
      if (args.unitCost !== undefined) data.unitCost = num(args.unitCost);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await inventoryApi.updateStockAdjustment(id, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل التسوية' };
      return { updated: true, stockAdjustmentId: id };
    },
  },

  // ─── ─── Inventory: Post Stock Adjustment ──────────────────────────────── ───
  {
    name: 'inventory.post_stock_adjustment',
    labelAr: 'ترحيل تسوية مخزون',
    descriptionAr: 'يُرحّل تسوية مخزون — يُغير حالتها إلى posted ويُحدث المخزون تلقائياً. استخدم inventory.get_stock_adjustments أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        stockAdjustmentId: { type: 'string', description: 'معرف التسوية (من inventory.get_stock_adjustments)' },
      },
      required: ['stockAdjustmentId'],
    },
    summarizeArgs: (a) => `ترحيل تسوية مخزون: ${String((a as Record<string, unknown>).stockAdjustmentId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.stockAdjustmentId);
      if (!id) return { error: 'stockAdjustmentId مطلوب' };
      const res = await inventoryApi.postStockAdjustment(id, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل ترحيل التسوية' };
      return { posted: true, stockAdjustmentId: id };
    },
  },

  // ─── ─── Inventory: Create Stock Transfer ──────────────────────────────── ───
  {
    name: 'inventory.create_stock_transfer',
    labelAr: 'إنشاء تحويل مخزون',
    descriptionAr: 'ينشئ تحويل مخزون بين مستودعين مع أصناف وكميات. يجب أن يختلف المستودع المصدر عن الهدف. استخدم inventory.get_warehouses و inventory.get_products أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        fromWarehouseId: { type: 'string', description: 'معرف المستودع المصدر (من inventory.get_warehouses)' },
        toWarehouseId: { type: 'string', description: 'معرف المستودع الهدف (من inventory.get_warehouses)' },
        date: { type: 'string', description: 'تاريخ التحويل YYYY-MM-DD (اختياري)' },
        reference: { type: 'string', description: 'رقم المرجع (اختياري)' },
        notes: { type: 'string', description: 'ملاحظات' },
        lines: {
          type: 'array',
          description: 'الأصناف المنقولة مع الكميات',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'معرف المنتج (من inventory.get_products)' },
              quantity: { type: 'number', description: 'الكمية المنقولة' },
            },
            required: ['productId', 'quantity'],
          },
        },
      },
      required: ['fromWarehouseId', 'toWarehouseId', 'lines'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray((a as Record<string, unknown>).lines) ? ((a as Record<string, unknown>).lines as unknown[]).length : 0;
      return `إنشاء تحويل مخزون: ${count} صنف`;
    },
    execute: async (args, ctx) => {
      const fromWarehouseId = str(args.fromWarehouseId);
      const toWarehouseId = str(args.toWarehouseId);
      if (!fromWarehouseId) return { error: 'fromWarehouseId مطلوب — استخدم inventory.get_warehouses أولاً' };
      if (!toWarehouseId) return { error: 'toWarehouseId مطلوب' };
      if (fromWarehouseId === toWarehouseId) return { error: 'المستودع المصدر والهدف يجب أن يكونا مختلفين' };
      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
      const lines: { productId: string; quantity: number }[] = [];
      for (const item of rawLines) {
        const productId = str((item as Record<string, unknown>).productId);
        const quantity = num((item as Record<string, unknown>).quantity);
        if (!productId) return { error: 'كل صنف يحتاج productId — استخدم inventory.get_products أولاً' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        lines.push({ productId, quantity });
      }
      const trfNum = await getNextDocumentNumber(ctx.companyId, 'inventory_transfer');
      if (!trfNum.success || !trfNum.number) return { error: trfNum.error || 'فشل توليد رقم التحويل' };
      const res = await inventoryApi.createStockTransfer({
        companyId: ctx.companyId,
        fromWarehouseId,
        toWarehouseId,
        date: str(args.date) || today(),
        reference: str(args.reference),
        notes: str(args.notes),
        transferNumber: trfNum.number,
        status: 'draft',
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء التحويل' };
      return { created: true, transferId: res.id, fromWarehouseId, toWarehouseId, linesCount: lines.length };
    },
  },

  // ─── ─── Inventory: Delete Stock Transfer ──────────────────────────────── ───
  {
    name: 'inventory.delete_stock_transfer',
    labelAr: 'حذف تحويل مخزون',
    descriptionAr: 'يحذف تحويل مخزون. الـ API يرفض حذف التحويلات المرحلة. استخدم inventory.get_stock_transfers أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        stockTransferId: { type: 'string', description: 'معرف التحويل (UUID)' },
      },
      required: ['stockTransferId'],
    },
    summarizeArgs: (a) => `حذف تحويل مخزون: ${String((a as Record<string, unknown>).stockTransferId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.stockTransferId);
      if (!id) return { error: 'stockTransferId مطلوب — استخدم inventory.get_stock_transfers أولاً' };
      const res = await inventoryApi.deleteStockTransfer(id, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف التحويل' };
      return { deleted: true, stockTransferId: id };
    },
  },

  // ─── ─── Inventory: Create Category ────────────────────────────────────── ───
  {
    name: 'inventory.create_category',
    labelAr: 'إنشاء تصنيف منتج',
    descriptionAr: 'ينشئ تصنيفاً جديداً للمنتجات بالاسم ويمكن ربطه بتصنيف أب.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم التصنيف (إلزامي)' },
        parentId: { type: 'string', description: 'معرف التصنيف الأب (اختياري)' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء تصنيف منتج: ${String((a as Record<string, unknown>).name || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم التصنيف مطلوب' };
      const data: Record<string, unknown> = { companyId: ctx.companyId, name };
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      const res = await inventoryApi.createProductCategory(data as { companyId: string; name: string; parentId?: string });
      if (!res.success) return { error: res.error || 'فشل إنشاء التصنيف' };
      return { created: true, categoryId: res.id, name };
    },
  },

  // ─── ─── Inventory: Update Category ────────────────────────────────────── ───
  {
    name: 'inventory.update_category',
    labelAr: 'تعديل تصنيف منتج',
    descriptionAr: 'يُحدّث بيانات تصنيف منتج — الاسم، التصنيف الأب. استخدم inventory.get_categories أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'معرف التصنيف (من inventory.get_categories)' },
        name: { type: 'string', description: 'الاسم الجديد' },
        parentId: { type: 'string', description: 'معرف التصنيف الأب الجديد' },
      },
      required: ['categoryId'],
    },
    summarizeArgs: (a) => `تعديل تصنيف منتج: ${String((a as Record<string, unknown>).categoryId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.categoryId);
      if (!id) return { error: 'categoryId مطلوب — استخدم inventory.get_categories أولاً' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await inventoryApi.updateProductCategory(id, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل التصنيف' };
      return { updated: true, categoryId: id };
    },
  },

  // ─── ─── Inventory: Delete Category ────────────────────────────────────── ───
  {
    name: 'inventory.delete_category',
    labelAr: 'حذف تصنيف منتج',
    descriptionAr: 'يحذف تصنيف منتج. الـ API يرفض حذف التصنيفات المرتبطة بمنتجات. استخدم inventory.get_categories أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'معرف التصنيف (UUID)' },
      },
      required: ['categoryId'],
    },
    summarizeArgs: (a) => `حذف تصنيف منتج: ${String((a as Record<string, unknown>).categoryId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.categoryId);
      if (!id) return { error: 'categoryId مطلوب — استخدم inventory.get_categories أولاً' };
      const res = await inventoryApi.deleteProductCategory(id, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف التصنيف' };
      return { deleted: true, categoryId: id };
    },
  },
];
