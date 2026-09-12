import type { ToolDefinition } from '../../types';
import { getNextDocumentNumber } from '@/core/api';
import { inventoryApi } from '@/modules/inventory/api';
import { getDbAdapter } from '@/core/database/adapters';
import {
  num,
  str,
  round2,
  resolveBaseQty,
} from './shared';
import { localToday } from '../../engine/dateUtils';
import { normalizeArabic } from '@/core/utils/normalizeArabic';
import { getUnits } from '@/core/api';

/** Normalized comparison key for catalog unit matching (alef/teh variants + ال prefix). */
function unitNorm(s: unknown): string {
  return normalizeArabic(String(s || '')).replace(/^(ال|لل)/, '');
}

async function fetchUnitCatalog(
  companyId: string,
): Promise<Array<{ nameAr?: string; nameEn?: string; code?: string; isActive?: boolean }> | { error: string }> {
  try {
    const res = await getUnits(companyId);
    if (!res || !res.success || !res.data) return { error: 'تعذر التحقق من الوحدة — أعد المحاولة' };
    return res.data;
  } catch {
    return { error: 'تعذر التحقق من الوحدة — أعد المحاولة' };
  }
}

/**
 * Validate a unit NAME against the company catalog and return its canonical
 * form. Products store the unit as a name string — accepting any free text
 * silently produced rows with unit='piece' for شدة/درزن/... (real session:
 * every product landed on the default). Unknown names fail LOUDLY with
 * guidance instead of corrupting master data.
 *
 * Absent names resolve the piece unit FROM THE CATALOG (حبة/PC/Piece) — the
 * raw 'piece' literal matched neither `name_ar` nor `code` in
 * ensureBaseProductUnit's JOIN, so every AI product created without a unit
 * ended with NO product_units row at all (silent 0-row INSERT) and every
 * later invoice line silently degraded to factor=1. Falling back to the
 * legacy 'piece' literal only when the catalog has no piece-equivalent.
 */
async function resolveUnitName(
  companyId: string,
  rawUnit: string | undefined,
): Promise<{ unit: string } | { error: string }> {
  const name = str(rawUnit);
  const catalog = await fetchUnitCatalog(companyId);
  if ('error' in catalog) {
    // Unreadable catalog: only fail when a name was explicitly given (loud
    // contract for user-specified units); the absent-name default keeps the
    // legacy literal so creation never blocks on a settings read.
    if (!name) return { unit: 'piece' };
    return { error: catalog.error };
  }
  if (!name) {
    const piece = catalog.find(
      (u) => u.isActive !== false && unitNorm(u.nameEn) === 'piece',
    );
    // Prefer: English name "Piece" → Arabic حبة → code PC
    const byEn = piece;
    const byAr = catalog.find((u) => u.isActive !== false && ['حبه', 'حبه'].includes(unitNorm(u.nameAr)));
    const byCode = catalog.find((u) => u.isActive !== false && String(u.code || '').toUpperCase() === 'PC');
    const hit = byEn ?? byAr ?? byCode;
    return { unit: (hit && (hit.nameAr || hit.nameEn)) || 'piece' };
  }
  const norm = unitNorm(name);
  const hit = catalog.find(
    (u) =>
      u.isActive !== false &&
      [u.nameAr || '', u.nameEn || '', u.code || ''].some((c) => {
        const cn = unitNorm(c);
        return !!cn && cn === norm;
      }),
  );
  if (!hit) return { error: `الوحدة "${name}" غير موجودة في الكتالوج — ابحث بـ search.units أو أنشئها من الإعدادات (وحدات القياس) أولاً` };
  return { unit: hit.nameAr || name };
}

/**
 * Resolve a catalog unit by human name ("كرتون") to its units.id.
 * Tolerates alef/yeh/teh variants and the ال prefix — returns null when
 * the unit does not exist so the tool can guide the model to create it.
 */
async function resolveCatalogUnitId(companyId: string, unitName: string): Promise<string | null> {
  const norm = normalizeArabic(unitName).replace(/^(ال|لل)/, '');
  if (!norm) return null;
  try {
    const res = await getUnits(companyId);
    if (!res.success || !res.data) return null;
    for (const u of res.data) {
      if (!u.isActive) continue;
      const candidates = [u.nameAr || '', u.nameEn || '', u.code || ''].map((s) => normalizeArabic(s).replace(/^(ال|لل)/, ''));
      if (candidates.some((c) => c && (c === norm || c.includes(norm) || norm.includes(c)))) {
        return u.id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
        nameAr: { type: 'string', description: 'اسم المنتج بالعربية (إلزامي — يقبل name كبديل)' },
        name: { type: 'string', description: 'بديل لـ nameAr (يُستخدم عند غيابه)' },
        nameEn: { type: 'string', description: 'اسم المنتج بالإنجليزية' },
        salePrice: { type: 'number', description: 'سعر البيع' },
        costPrice: { type: 'number', description: 'سعر التكلفة (افتراضي 0 — يقبل purchasePrice كبديل)' },
        purchasePrice: { type: 'number', description: 'بديل لـ costPrice' },
        unit: { type: 'string', description: 'اسم الوحدة من الكتالوج (يُتحقق منها — ابحث بـ search.units أولاً؛ افتراضي: حبة/piece من الكتالوج)' },
        unitName: { type: 'string', description: 'بديل لـ unit' },
        barcode: { type: 'string' },
        sku: { type: 'string', description: 'رمز SKU' },
        openingStockQty: { type: 'number', description: 'كمية المخزون الافتتاحي (تُقيَّم بسعر التكلفة وتُرحّل تلقائياً — يقبل initialStockQuantity كبديل)' },
        initialStockQuantity: { type: 'number', description: 'بديل لـ openingStockQty' },
        minStock: { type: 'number', description: 'حد الطلب/المخزون الأدنى (يقبل minStockLevel كبديل)' },
        minStockLevel: { type: 'number', description: 'بديل لـ minStock' },
        warehouseId: { type: 'string', description: 'مستودع الرصيد الافتتاحي (افتراضي: أول مستودع)' },
        productTypeId: { type: 'string', description: 'معرف نوع المنتج (من search.product_types — اذكره مثل: منتج نهائي، خامة، خدمة)' },
        productTypeName: { type: 'string', description: 'اسم نوع المنتج نصاً (بديل — سيُبحث تلقائياً مثل: منتج نهائي)' },
        productType: { type: 'string', description: 'بديل لـ productTypeName (يقبل الاسم العربي/الإنجليزي/الكود)' },
      },
      required: ['nameAr', 'salePrice'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      const nm = r.nameAr ?? r.name;
      const un = r.unit ?? r.unitName;
      return `إنشاء منتج جديد: ${nm} — سعر البيع: ${r.salePrice}${un ? ` — الوحدة: ${un}` : ''}${r.openingStockQty ?? r.initialStockQuantity ? ` — مخزون افتتاحي: ${r.openingStockQty ?? r.initialStockQuantity}` : ''}${r.productTypeName ? ` — النوع: ${r.productTypeName}` : ''}`;
    },
    execute: async (args, ctx) => {
      // Human-name alias: suppliers/customers tools take plain `name`, so the
      // model naturally passes `name` here too — map it instead of failing.
      const nameAr = str(args.nameAr) ?? str(args.name);
      const salePrice = num(args.salePrice);
      if (!nameAr) return { error: 'اسم المنتج مطلوب (nameAr أو name)' };
      if (salePrice < 0) return { error: 'سعر البيع لا يمكن أن يكون سالباً' };

      // Unit alias + catalog validation: the model passes `unitName`
      // ("شدة") while the row stores `unit` — and free text used to land
      // silently on the 'piece' default. Unknown names fail loudly.
      const unitResolved = await resolveUnitName(ctx.companyId, str(args.unit) ?? str(args.unitName));
      if ('error' in unitResolved) return { error: unitResolved.error };

      // Resolve product type if mentioned by name. Matches Arabic name,
      // English name AND code (FG/RAW…) — the model may pass any of them
      // (e.g. productType "finished"/"raw" from a batch payload).
      let productTypeId = str(args.productTypeId);
      const productTypeName = str(args.productTypeName) ?? str(args.productType);
      if (!productTypeId && productTypeName) {
        try {
          const typesRes = await getDbAdapter().then(adapter => adapter.query(`SELECT id, name_ar, name_en, code FROM product_types WHERE company_id = $1 AND is_active = true`, [ctx.companyId]));
          if (typesRes.success && typesRes.rows) {
            const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/[ةه]/g, 'ه').toLowerCase().trim();
            const target = norm(productTypeName);
            const hit = (v: unknown) => {
              const n = norm(String(v || ''));
              return !!n && (n === target || n.includes(target) || target.includes(n));
            };
            const found = (typesRes.rows as Record<string, unknown>[]).find(r =>
              hit(r.name_ar) || hit(r.name_en) || String(r.code || '').trim().toLowerCase() === target,
            );
            if (found) productTypeId = String(found.id);
          }
        } catch {}
      }

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'product');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد كود المنتج' };
      const code = docNumber.number;

      // Opening stock needs a warehouse — honor an explicit warehouseId,
      // auto-pick the first one only when the caller didn't specify (mirrors
      // manufacturing completion behaviour).
      const openingQty = num(args.openingStockQty) || num(args.initialStockQuantity);
      let openingWarehouseId: string | undefined = str(args.warehouseId);
      if (openingQty > 0 && !openingWarehouseId) {
        const wh = await inventoryApi.getWarehouses(ctx.companyId);
        openingWarehouseId = wh.success && wh.data && wh.data.length > 0 ? wh.data[0].id : undefined;
        if (!openingWarehouseId) {
          return { error: 'لا يوجد مستودع — أنشئ مستودعاً أولاً لتسجيل المخزون الافتتاحي' };
        }
      }

      const costPrice = num(args.costPrice) || num(args.purchasePrice);
      const minStockRaw = args.minStock ?? args.minStockLevel;
      const res = await inventoryApi.createProduct({
        companyId: ctx.companyId,
        code,
        nameAr,
        ...(str(args.nameEn) ? { nameEn: str(args.nameEn) } : {}),
        unit: unitResolved.unit,
        barcode: str(args.barcode),
        ...(str(args.sku) ? { sku: str(args.sku) } : {}),
        costPrice,
        salePrice,
        ...(minStockRaw !== undefined ? { minStock: num(minStockRaw) } : {}),
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
              openingValue: round2(openingQty * costPrice),
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
        systemQty: { type: 'number', description: 'الكمية في النظام (بالوحدة المذكورة أو الأساسية)' },
        actualQty: { type: 'number', description: 'الكمية الفعلية — الجرد (بالوحدة المذكورة أو الأساسية)' },
        unitId: { type: 'string', description: 'معرف وحدة المنتج (من search.product_units) — اختياري؛ بدونه الكميات بالأساسية' },
        unitName: { type: 'string', description: 'اسم الوحدة نصاً (كرتون…) — بديل لـ unitId' },
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
      // M4: stock_adjustments carries NO unit columns — quantities are BASE.
      // Resolve any named unit here so "جرد 3 كراتين" doesn't book 3 pieces.
      const unitId = str(args.unitId);
      const unitName = str(args.unitName);
      let systemQty = num(args.systemQty);
      let actualQty = num(args.actualQty);
      let unitNote: string | undefined;
      if (unitId || unitName) {
        const rSys = await resolveBaseQty(ctx.companyId, productId, systemQty, { unitId, unitName });
        if ('error' in rSys) return { error: rSys.error };
        const rAct = await resolveBaseQty(ctx.companyId, productId, actualQty, { unitId, unitName });
        if ('error' in rAct) return { error: rAct.error };
        systemQty = rSys.baseQuantity;
        actualQty = rAct.baseQuantity;
        if (rSys.factor !== 1) unitNote = `الكميات حُوّلت من ${rSys.unitName || ''} (×${rSys.factor}) للأساسية`;
      }
      const difference = round2(actualQty - systemQty);

      const adjNum = await getNextDocumentNumber(ctx.companyId, 'stock_adjustment');
      if (!adjNum.success || !adjNum.number) return { error: adjNum.error || 'فشل توليد رقم التسوية' };

      // P0-5 fix: the bare INSERT with status:'posted' bypassed the entire
      // posting pipeline — zero stock_movements, zero journal entry, zero
      // stock update, and the row could never be properly posted later
      // (postStockAdjustment accepts draft/approved only). Create as DRAFT
      // then run the real atomic posting (movements + JE + stock set).
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
        status: 'draft',
        adjustmentNumber: adjNum.number,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء التسوية' };
      const postRes = await inventoryApi.postStockAdjustment(res.id!, ctx.companyId);
      if (!postRes.success) {
        return {
          error: `أُنشئت التسوية كمسودة (${adjNum.number}) لكن فشل الترحيل: ${postRes.error || 'سبب غير معروف'} — يمكنك معاودة الترحيل بـ inventory.post_stock_adjustment بعد معالجة السبب`,
          adjustmentId: res.id,
          status: 'draft',
        };
      }
      return {
        created: true,
        posted: true,
        adjustmentId: res.id,
        adjustmentNumber: adjNum.number,
        productId,
        difference,
        status: 'posted',
        ...(unitNote ? { unitConversion: unitNote } : {}),
        note: 'التسوية مرحّلة — حركة المخزون والقيد المحاسبي أُنشئا ذرّياً',
      };
    },
  },

  // ─── ─── Inventory Update Product ────────────────────────────────────────── ───
  {
    name: 'inventory.update_product',
    labelAr: 'تعديل منتج',
    descriptionAr: 'يُحدّث بيانات منتج موجود — الاسم، السعر، الوحدة، الباركود، إلخ. استخدم inventory.get_products أولاً.',
    permission: 'inventory.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (من inventory.get_products)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية (يقبل name كبديل)' },
        name: { type: 'string', description: 'بديل لـ nameAr' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        unit: { type: 'string', description: 'الوحدة من الكتالوج (تُتحقق — ابحث بـ search.units أولاً)' },
        unitName: { type: 'string', description: 'بديل لـ unit' },
        barcode: { type: 'string' },
        sku: { type: 'string' },
        salePrice: { type: 'number', description: 'سعر البيع' },
        costPrice: { type: 'number', description: 'سعر التكلفة' },
        isActive: { type: 'boolean' },
      },
      required: ['productId'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      const nm = r.nameAr ?? r.name;
      return `تعديل منتج: ${String(r.productId || '').slice(0, 8)}…${nm ? ` — الاسم: ${nm}` : ''}`;
    },
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      if (!productId) return { error: 'productId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      else if (args.name !== undefined) data.nameAr = str(args.name);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.unit !== undefined || args.unitName !== undefined) {
        const resolved = await resolveUnitName(ctx.companyId, str(args.unit) ?? str(args.unitName));
        if ('error' in resolved) return { error: resolved.error };
        data.unit = resolved.unit;
      }
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
    permission: 'inventory.delete',
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
    permission: 'inventory.edit',
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
    permission: 'inventory.delete',
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
    permission: 'inventory.delete',
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
    permission: 'inventory.edit',
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
    permission: 'inventory.edit',
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
          description: 'الأصناف المنقولة مع الكميات (الكميات بالوحدة الأساسية ما لم تُذكر وحدة — مرر unitName مثل كرتون وسيُحوَّل تلقائياً)',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'معرف المنتج (من inventory.get_products)' },
              quantity: { type: 'number', description: 'الكمية المنقولة (بالوحدة المذكورة أو الأساسية)' },
              unitId: { type: 'string', description: 'معرف وحدة المنتج (من search.product_units) — اختياري' },
              unitName: { type: 'string', description: 'اسم الوحدة نصاً (كرتون…) — بديل لـ unitId' },
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
      // M4: transfer_lines carries NO unit columns (quantities are implicitly
      // BASE). Resolve any named unit to base here — the model must never
      // hand-convert (2 كرتون → 24) with no tooling and no error.
      const lines: { productId: string; quantity: number }[] = [];
      const unitNotes: string[] = [];
      for (const item of rawLines) {
        const productId = str((item as Record<string, unknown>).productId);
        const quantity = num((item as Record<string, unknown>).quantity);
        if (!productId) return { error: 'كل صنف يحتاج productId — استخدم inventory.get_products أولاً' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        const r = item as Record<string, unknown>;
        const unitId = str(r.unitId);
        const unitName = str(r.unitName);
        if (unitId || unitName) {
          const resolved = await resolveBaseQty(ctx.companyId, productId, quantity, { unitId, unitName });
          if ('error' in resolved) return { error: resolved.error };
          lines.push({ productId, quantity: resolved.baseQuantity });
          if (resolved.factor !== 1) {
            unitNotes.push(`${quantity} ${resolved.unitName || ''} ≈ ${resolved.baseQuantity} بالأساسية`);
          }
        } else {
          lines.push({ productId, quantity });
        }
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
      return {
        created: true,
        transferId: res.id,
        fromWarehouseId,
        toWarehouseId,
        linesCount: lines.length,
        ...(unitNotes.length > 0 ? { unitConversions: unitNotes } : {}),
      };
    },
  },

  // ─── ─── Inventory: Delete Stock Transfer ──────────────────────────────── ───
  {
    name: 'inventory.delete_stock_transfer',
    labelAr: 'حذف تحويل مخزون',
    descriptionAr: 'يحذف تحويل مخزون. الـ API يرفض حذف التحويلات المرحلة. استخدم inventory.get_stock_transfers أولاً.',
    permission: 'inventory.delete',
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
    permission: 'inventory.edit',
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
    permission: 'inventory.delete',
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

  // ─── ─── Inventory: Product Units (multi-unit) ─────────────────────────────
  // Each product owns its base unit plus extra units (carton/dozen…) with
  // their own factor + sale/purchase prices. Stock is always kept in the
  // base unit; documents snapshot the factor at creation time.
  {
    name: 'inventory.create_product_unit',
    labelAr: 'إضافة وحدة لمنتج',
    descriptionAr: 'يضيف وحدة جديدة لمنتج (كرتون/درزن/شدة…) بعامل تحويل وسعري بيع وشراء خاصين. اذكر اسم الوحدة نصاً (كرتون) وسيُطابق مع كتالوج الوحدات تلقائياً — استخدم search.products أولاً لمعرف المنتج.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
        unitName: { type: 'string', description: 'اسم الوحدة نصاً كما في الإعدادات (كرتون، درزن، شدة، علبة…)' },
        factor: { type: 'number', description: 'عامل التحويل: كم وحدة أساسية = 1 من هذه الوحدة (كرتون 12 حبة ← 12)' },
        salePrice: { type: 'number', description: 'سعر بيع الوحدة (اختياري — يُقترح من الأساسية × العامل)' },
        purchasePrice: { type: 'number', description: 'سعر شراء الوحدة (اختياري)' },
        barcode: { type: 'string', description: 'باركود الوحدة (اختياري — باركود الكرتون يختلف عن الحبة)' },
        isDefaultSale: { type: 'boolean', description: 'اجعلها الوحدة الافتراضية للبيع' },
        isDefaultPurchase: { type: 'boolean', description: 'اجعلها الوحدة الافتراضية للشراء' },
      },
      required: ['productId', 'unitName', 'factor'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `إضافة وحدة "${r.unitName}" للمنتج (${String(r.productId || '').slice(0, 8)}…) — العامل: ${r.factor}`;
    },
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      const unitName = str(args.unitName);
      const factor = num(args.factor);
      if (!productId) return { error: 'productId مطلوب — استخدم search.products أولاً' };
      if (!unitName) return { error: 'unitName مطلوب (مثال: كرتون، درزن، شدة)' };
      if (!(factor > 0)) return { error: 'factor يجب أن يكون أكبر من صفر (كرتون 12 حبة ← 12)' };
      const unitId = await resolveCatalogUnitId(ctx.companyId, unitName);
      if (!unitId) return { error: `الوحدة "${unitName}" غير موجودة في الإعدادات — أنشئها أولاً من صفحة الوحدات ثم أعد المحاولة` };
      // U6: omitted prices used to land on 0 (poisoning later quotes/checks).
      // Suggest from the product's BASE unit-row price × factor — the base row
      // mirrors the card prices (same math as the UI's ProductUnitsSection).
      let salePrice = args.salePrice !== undefined ? num(args.salePrice) : 0;
      let purchasePrice = args.purchasePrice !== undefined ? num(args.purchasePrice) : 0;
      if (args.salePrice === undefined || args.purchasePrice === undefined) {
        const unitsRes = await inventoryApi.getProductUnits(productId, ctx.companyId);
        if (unitsRes.success && unitsRes.data) {
          const { baseUnit, suggestUnitPrice } = await import('@/core/utils/unitConversion');
          const base = baseUnit(unitsRes.data);
          if (base) {
            if (args.salePrice === undefined) salePrice = round2(suggestUnitPrice(base.salePrice, factor));
            if (args.purchasePrice === undefined) purchasePrice = round2(suggestUnitPrice(base.purchasePrice, factor));
          }
        }
      }
      const res = await inventoryApi.createProductUnit({
        companyId: ctx.companyId,
        productId,
        unitId,
        factor,
        salePrice,
        purchasePrice,
        barcode: str(args.barcode),
        isBase: false,
        isDefaultSale: Boolean(args.isDefaultSale),
        isDefaultPurchase: Boolean(args.isDefaultPurchase),
      });
      if (!res.success) return { error: res.error || 'فشل إضافة الوحدة' };
      return {
        created: true,
        unitRowId: res.id,
        productId,
        unitName,
        factor,
        salePrice,
        purchasePrice,
        ...(args.salePrice === undefined || args.purchasePrice === undefined
          ? { priceNote: 'الأسعار غير المحددة اقْتُرِحت من سعر الوحدة الأساسية × العامل' }
          : {}),
      };
    },
  },
  {
    name: 'inventory.update_product_unit',
    labelAr: 'تعديل وحدة منتج',
    descriptionAr: 'يُعدّل وحدة منتج موجودة: العامل، أسعار البيع/الشراء، الباركود، أو الافتراضيات. استخدم search.product_units أولاً لمعرف صف الوحدة (unitId).',
    permission: 'inventory.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        unitRowId: { type: 'string', description: 'معرف صف وحدة المنتج (unitId من search.product_units — ليس معرف الكتالوج)' },
        factor: { type: 'number', description: 'عامل التحويل الجديد (يؤثر على المستندات الجديدة فقط — القديمة مجمّدة)' },
        salePrice: { type: 'number', description: 'سعر البيع الجديد' },
        purchasePrice: { type: 'number', description: 'سعر الشراء الجديد' },
        barcode: { type: 'string', description: 'باركود الوحدة' },
        isDefaultSale: { type: 'boolean', description: 'اجعلها الافتراضية للبيع' },
        isDefaultPurchase: { type: 'boolean', description: 'اجعلها الافتراضية للشراء' },
      },
      required: ['unitRowId'],
    },
    summarizeArgs: (a) => `تعديل وحدة منتج: ${String((a as Record<string, unknown>).unitRowId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const unitRowId = str(args.unitRowId);
      if (!unitRowId) return { error: 'unitRowId مطلوب — استخدم search.product_units أولاً' };
      const data: Record<string, unknown> = {};
      if (args.factor !== undefined) {
        if (!(num(args.factor) > 0)) return { error: 'factor يجب أن يكون أكبر من صفر' };
        data.factor = num(args.factor);
      }
      if (args.salePrice !== undefined) data.salePrice = num(args.salePrice);
      if (args.purchasePrice !== undefined) data.purchasePrice = num(args.purchasePrice);
      if (args.barcode !== undefined) data.barcode = str(args.barcode);
      if (args.isDefaultSale !== undefined) data.isDefaultSale = Boolean(args.isDefaultSale);
      if (args.isDefaultPurchase !== undefined) data.isDefaultPurchase = Boolean(args.isDefaultPurchase);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await inventoryApi.updateProductUnit(unitRowId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الوحدة' };
      return { updated: true, unitRowId };
    },
  },
  {
    name: 'inventory.delete_product_unit',
    labelAr: 'حذف وحدة منتج',
    descriptionAr: 'يحذف وحدة إضافية من منتج. الـ API يرفض حذف الوحدة الوحيدة المتبقية. المستندات القديمة لا تتأثر (عاملها مجمّد فيها).',
    permission: 'inventory.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        unitRowId: { type: 'string', description: 'معرف صف وحدة المنتج (unitId من search.product_units)' },
      },
      required: ['unitRowId'],
    },
    summarizeArgs: (a) => `حذف وحدة منتج: ${String((a as Record<string, unknown>).unitRowId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const unitRowId = str(args.unitRowId);
      if (!unitRowId) return { error: 'unitRowId مطلوب — استخدم search.product_units أولاً' };
      const res = await inventoryApi.deleteProductUnit(unitRowId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الوحدة' };
      return { deleted: true, unitRowId };
    },
  },
];
