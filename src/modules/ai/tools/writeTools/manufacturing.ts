import type { ToolDefinition } from '../../types';
import { inventoryApi } from '@/modules/inventory/api';
import { getNextDocumentNumber } from '@/core/api';
import { manufacturingApi } from '@/modules/manufacturing/api';
import {
  num,
  str,
  round2,
  resolveBaseQty,
} from './shared';

/**
 * WRITE tools — التصنيع (7 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */
export const manufacturingWriteTools: ToolDefinition[] = [
  // ─── ─── Manufacturing BOM ────────────────────────────────────────────────── ───
  {
    name: 'manufacturing.create_bom',
    labelAr: 'إنشاء تركيبة منتج (BOM)',
    descriptionAr: 'ينشئ تركيبة منتج (Bill of Materials) تحدد المواد المكوّنة للمنتج وتكاليفها وتُحسب التكلفة تلقائياً. outputQuantity = كمية المنتج النهائي التي تنتجها دفعة واحدة من هذه التركيبة (افتراضي 1). استخدم search.products أولاً؛ تكلفة الوحدة تُجلب تلقائياُ من سعر تكلفة المنتج إذا لم تُحدد.',
    permission: 'manufacturing.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج النهائي (من search.products — يجب أن يكون نوعه منتج نهائي/تام الإنتاج)' },
        version: { type: 'string', description: 'إصدار التركيبة (افتراضي "1.0")' },
        outputQuantity: { type: 'number', description: 'كمية المنتج النهائي المنتجة من دفعة واحدة بهذه المواد (افتراضي 1)' },
        notes: { type: 'string' },
        lines: {
          type: 'array',
          description: 'المواد المكوّنة للتركيبة مع كمياتها وتكاليفها (يجب أن تكون أنواعها مواد أولية/خام — يقبل items كبديل لـ lines). الكميات بالوحدة الأساسية ما لم تُذكر وحدة.',
          items: {
            type: 'object',
            properties: {
              materialId: { type: 'string', description: 'معرف المادة الخام (من search.products — يقبل productId كبديل)' },
              productId: { type: 'string', description: 'بديل لـ materialId' },
              quantity: { type: 'number', description: 'الكمية اللازمة لدفعة واحدة (بالوحدة المذكورة أو الأساسية)' },
              unitId: { type: 'string', description: 'معرف وحدة المادة (من search.product_units) — اختياري' },
              unitName: { type: 'string', description: 'اسم الوحدة نصاً (كرتون…) — بديل لـ unitId' },
              unitCost: { type: 'number', description: 'تكلفة الوحدة المذكورة (اختياري — تُجلب تلقائياُ من سعر تكلفة المنتج)' },
            },
            required: ['materialId', 'quantity'],
          },
        },
      },
      required: ['productId', 'lines'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      const arr = (Array.isArray(r.lines) ? r.lines : Array.isArray(r.items) ? r.items : []) as unknown[];
      return `إنشاء تركيبة لمنتج: ${String(r.productId || '').slice(0, 8)}… بعدد مواد: ${arr.length}`;
    },
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      if (!productId) return { error: 'productId مطلوب' };
      const rawInput = args.lines ?? args.items;
      const rawLines = Array.isArray(rawInput) ? rawInput : [];
      if (rawLines.length === 0) return { error: 'يجب تمرير مادة واحدة على الأقل في lines' };
      const lines: { materialId: string; quantity: number; unitCost: number }[] = [];
      // Cache product costs to auto-fill missing unitCost
      let productCache: Map<string, number> | null = null;
      async function getProductCost(pid: string): Promise<number> {
        if (productCache === null) {
          productCache = new Map();
          try {
            const all = await inventoryApi.getProducts(ctx.companyId);
            if (all.success && all.data) for (const pr of all.data) productCache.set(pr.id, Number(pr.costPrice) || 0);
          } catch {}
        }
        return productCache.get(pid) ?? 0;
      }
      for (const item of rawLines) {
        const rec = item as Record<string, unknown>;
        // Same human-key alias as invoice lines: the model passes productId.
        const materialId = str(rec.materialId) ?? str(rec.productId);
        const quantity = num(rec.quantity);
        let unitCost = (item as Record<string, unknown>).unitCost !== undefined ? num((item as Record<string, unknown>).unitCost) : undefined;
        if (!materialId) return { error: 'كل مادة تحتاج materialId — استخدم search.products للحصول عليه' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        if (unitCost === undefined || unitCost < 0) unitCost = await getProductCost(materialId);
        // M4: bom_lines carries NO unit columns — quantities are BASE. A
        // named unit is resolved + converted here (qty × factor); a named
        // unitCost is the price OF THAT UNIT, so it is converted back to
        // base (÷ factor) to keep the invariant cost_base × qty_base.
        const lineUnitId = str(rec.unitId);
        const lineUnitName = str(rec.unitName);
        let baseQty = quantity;
        let baseCost = unitCost;
        if (lineUnitId || lineUnitName) {
          const resolved = await resolveBaseQty(ctx.companyId, materialId, quantity, { unitId: lineUnitId, unitName: lineUnitName });
          if ('error' in resolved) return { error: resolved.error };
          baseQty = resolved.baseQuantity;
          if (resolved.factor !== 1 && (item as Record<string, unknown>).unitCost !== undefined) {
            baseCost = round2(unitCost / resolved.factor);
          }
        }
        lines.push({ materialId, quantity: baseQty, unitCost: baseCost });
      }
      const totalCost = round2(lines.reduce((s, l) => s + l.quantity * l.unitCost, 0));
      const outputQuantity = num(args.outputQuantity) > 0 ? num(args.outputQuantity) : 1;

      const res = await manufacturingApi.createBom({
        companyId: ctx.companyId,
        productId,
        version: str(args.version) || '1.0',
        isActive: true,
        outputQuantity,
        totalCost,
        notes: str(args.notes),
        lines,
      }, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إنشاء التركيبة' };
      return { created: true, bomId: res.id, productId, outputQuantity, totalCost };
    },
  },

  // ─── ─── Manufacturing Work Orders ────────────────────────────────────────── ───
  {
    name: 'manufacturing.create_work_order',
    labelAr: 'إنشاء أمر تشغيل',
    descriptionAr: 'ينشئ أمر تشغيل إنتاجي لتصنيع منتج. quantity = عدد دفعات الـ BOM (الإنتاج المتوقع = quantity × outputQuantity للتركيبة). إذا مررت bomId دون lines، تٌشتق المواد تلقائياُ من الشجرة مضروبة في عدد الدفعات. رقم الدفعة يُولَّد تلقائياُ بصيغة YYYYMMDD-NNN. استخدم search.products و search.boms أولاُ.',
    permission: 'manufacturing.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج المراد تصنيعه (من search.products — يُشتق تلقائياً من bomId عند غيابه)' },
        bomId: { type: 'string', description: 'معرف شجرة المنتج (اختياري — إن تٌرك فارغاُ يجب تمرير lines يدوياُ)' },
        quantity: { type: 'number', description: 'عدد دفعات الـ BOM المطلوب إنتاجها (افتراضي 1 — يقبل plannedQuantity كبديل)' },
        plannedQuantity: { type: 'number', description: 'بديل لـ quantity' },
        supervisorId: { type: 'string', description: 'معرف مسؤول الإنتاج من الموظفين (اختياري — من search.employees)' },
        batchNumber: { type: 'string', description: 'رقم الدفعة (اختياري — يٌولَّد تلقائياُ بصيغة YYYYMMDD-NNN إن لم يٌمرر)' },
        productionCosts: {
          type: 'array',
          description: 'تكاليف الإنتاج الإضافية (أجور/طاقة/تغليف/أخرى) — تُضاف لتكلفة المنتج وتُرحَّل للحسابات عند الإكمال',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: ['labor', 'energy', 'packaging', 'other'], description: 'labor=أجور العمال، energy=الطاقة، packaging=التغليف، other=أخرى' },
              description: { type: 'string', description: 'وصف التكلفة (اختياري)' },
              amount: { type: 'number', description: 'المبلغ' },
            },
            required: ['category', 'amount'],
          },
        },
        plannedStartDate: { type: 'string', description: 'تاريخ البدء المخطط YYYY-MM-DD (اختياري — يقبل startDate كبديل)' },
        plannedEndDate: { type: 'string', description: 'تاريخ الانتهاء المخطط YYYY-MM-DD (اختياري — يقبل endDate كبديل)' },
        startDate: { type: 'string', description: 'بديل لـ plannedStartDate' },
        endDate: { type: 'string', description: 'بديل لـ plannedEndDate' },
        notes: { type: 'string' },
        lines: {
          type: 'array',
          description: 'المواد المستهلكة (اختياري إذا مررت bomId — تٌشتق تلقائياُ من الشجرة). الكميات بالوحدة الأساسية ما لم تُذكر وحدة.',
          items: {
            type: 'object',
            properties: {
              materialId: { type: 'string', description: 'معرف المادة (من search.products)' },
              plannedQuantity: { type: 'number', description: 'الكمية المخطط استهلاكها (بالوحدة المذكورة أو الأساسية)' },
              unitId: { type: 'string', description: 'معرف وحدة المادة (من search.product_units) — اختياري' },
              unitName: { type: 'string', description: 'اسم الوحدة نصاً (كرتون…) — بديل لـ unitId' },
              unitCost: { type: 'number', description: 'تكلفة الوحدة المذكورة (اختياري — تٌجلب من الشجرة/سعر التكلفة)' },
            },
            required: ['materialId', 'plannedQuantity'],
          },
        },
      },
      required: ['productId', 'quantity'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `إنشاء أمر تشغيل لإنتاج ${r.quantity ?? r.plannedQuantity ?? ''} دفعة من ${String(r.productId || '').slice(0, 8)}…`;
    },

    execute: async (args, ctx) => {
      // Human-key aliases: the model says plannedQuantity/startDate/endDate.
      const quantity = num(args.quantity) || num(args.plannedQuantity);
      if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر (quantity أو plannedQuantity)' };

      const bomId = str(args.bomId);
      let productId = str(args.productId);
      // Derive the product (and missing lines) from the BOM — the caller
      // often names only the tree, as in "أنتج بالشجرة رقم كذا".
      let rawLines = args.lines as unknown[] | undefined;
      if (bomId && (!productId || !rawLines || rawLines.length === 0)) {
        const bomRes = await manufacturingApi.getBomById(bomId, ctx.companyId);
        if (!bomRes.success || !bomRes.data) return { error: bomRes.error || 'تعذر جلب الشجرة المحددة — تحقق من bomId' };
        if (!productId) productId = str((bomRes.data.bom as unknown as Record<string, unknown>).productId);
        if (!rawLines || rawLines.length === 0) {
          rawLines = bomRes.data.lines.map((l) => ({ materialId: l.materialId, plannedQuantity: l.quantity * quantity, unitCost: l.unitCost ?? 0 }));
          if (rawLines.length === 0) return { error: 'الشجرة المختارة بلا مواد — لا يمكن إنشاء أمر تشغيل' };
        }
      }
      if (!productId) return { error: 'productId مطلوب — أو مرر bomId لاشتقاق المنتج والمواد معاً' };
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير lines أو bomId صالح لاشتقاق المواد' };
      const lines: { materialId: string; plannedQuantity: number; unitCost: number }[] = [];
      for (const item of rawLines) {
        const rec = item as Record<string, unknown>;
        const materialId = str(rec.materialId) ?? str(rec.productId);
        const pq = num(rec.plannedQuantity);
        const uc = (item as Record<string, unknown>).unitCost !== undefined ? num((item as Record<string, unknown>).unitCost) : 0;
        if (!materialId) return { error: 'كل مادة تحتاج materialId — استخدم search.products' };
        if (pq <= 0) return { error: 'plannedQuantity يجب أن تكون أكبر من صفر' };
        // M4: consumptions carry NO unit columns — a named unit resolves +
        // converts here (cost ÷ factor keeps the base invariant, as in BOMs).
        const lineUnitId = str(rec.unitId);
        const lineUnitName = str(rec.unitName);
        let basePq = pq;
        let baseUc = uc;
        if (lineUnitId || lineUnitName) {
          const resolved = await resolveBaseQty(ctx.companyId, materialId, pq, { unitId: lineUnitId, unitName: lineUnitName });
          if ('error' in resolved) return { error: resolved.error };
          basePq = resolved.baseQuantity;
          if (resolved.factor !== 1 && (item as Record<string, unknown>).unitCost !== undefined) {
            baseUc = round2(uc / resolved.factor);
          }
        }
        lines.push({ materialId, plannedQuantity: basePq, unitCost: baseUc });
      }

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'work_order');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الأمر' };

      const totalCost = round2(lines.reduce((s, l) => s + l.plannedQuantity * l.unitCost, 0));

      // Production costs (labor/energy/packaging/other) — validated & sanitized.
      const productionCosts: { category: 'labor' | 'energy' | 'packaging' | 'other'; description?: string; amount: number }[] = [];
      const rawCosts = args.productionCosts as unknown[] | undefined;
      if (Array.isArray(rawCosts)) {
        for (const item of rawCosts) {
          const rec = item as Record<string, unknown>;
          const category = str(rec.category);
          if (category !== 'labor' && category !== 'energy' && category !== 'packaging' && category !== 'other') continue;
          const amount = num(rec.amount);
          if (amount <= 0) continue;
          productionCosts.push({ category, description: str(rec.description), amount });
        }
      }

      const res = await manufacturingApi.createWorkOrder({
        companyId: ctx.companyId,
        orderNumber: docNumber.number,
        productId,
        bomId,
        quantity,
        status: 'planned',
        supervisorId: str(args.supervisorId),
        batchNumber: str(args.batchNumber),
        plannedStartDate: str(args.plannedStartDate) ?? str(args.startDate),
        plannedEndDate: str(args.plannedEndDate) ?? str(args.endDate),
        totalCost,
        productionCosts,
        notes: str(args.notes),
        lines,
      }, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إنشاء أمر التشغيل' };
      return { created: true, workOrderId: res.id, orderNumber: docNumber.number, quantity, totalCost, productionCostsTotal: round2(productionCosts.reduce((sum, c) => sum + c.amount, 0)), status: 'planned' };
    },
  },

  {
    name: 'manufacturing.update_work_order_status',
    labelAr: 'تحديث حالة أمر تشغيل',
    descriptionAr: 'يُحدّث حالة أمر تشغيل: in_progress يصرف الخامات من المخزون فوراً (يفشل إن لم يكفِ المخزون)، و completed يسلّم المنتج التام إلى المستودع المختار ويُسوّي الفروق. استخدم search.work_orders أولاً.',
    permission: 'manufacturing.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        workOrderId: { type: 'string', description: 'معرف أمر التشغيل (من search.work_orders)' },
        status: { type: 'string', enum: ['planned', 'in_progress', 'completed', 'cancelled'], description: 'الحالة الجديدة' },
        producedQuantity: { type: 'number', description: 'الكمية المنتجة فعلياً (اختياري عند completed — افتراضي كمية الأمر)' },
        outputWarehouseId: { type: 'string', description: 'مستودع استلام المنتج التام عند الإكمال (من search.warehouses — اختياري)' },
        returnMaterials: { type: 'boolean', description: 'عند الإلغاء: هل ترجع الخامات المصروفة للمخزون؟ (افتراضي true)' },
      },
      required: ['workOrderId', 'status'],
    },
    summarizeArgs: (a) => `تحديث حالة أمر تشغيل إلى: ${a.status}${a.producedQuantity ? ` — المنتج: ${a.producedQuantity}` : ''}`,
    execute: async (args, ctx) => {
      const workOrderId = str(args.workOrderId);
      const status = str(args.status) as 'planned' | 'in_progress' | 'completed' | 'cancelled' | undefined;
      if (!workOrderId) return { error: 'workOrderId مطلوب' };
      if (!status || !['planned', 'in_progress', 'completed', 'cancelled'].includes(status)) return { error: 'حالة غير صحيحة' };

      const outputWarehouseId = str(args.outputWarehouseId);
      const res = await manufacturingApi.updateWorkOrderStatus(
        workOrderId, ctx.companyId, status, ctx.userId,
        status === 'completed' ? num(args.producedQuantity) : undefined,
        status === 'completed' ? outputWarehouseId : undefined,
        status === 'cancelled' ? { returnMaterials: args.returnMaterials !== false } : undefined
      );
      if (!res.success) return { error: res.error || 'فشل تحديث الحالة' };
      return { updated: true, workOrderId, status };
    },
  },

  // ─── ─── Manufacturing: Update BOM ────────────────────────────────────── ───
  {
    name: 'manufacturing.update_bom',
    labelAr: 'تعديل تركيبة منتج (BOM)',
    descriptionAr: 'يُحدّث بيانات تركيبة منتج — الاسم، الملاحظات، الحالة. استخدم manufacturing.get_boms أولاً.',
    permission: 'manufacturing.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        bomId: { type: 'string', description: 'معرف التركيبة (من manufacturing.get_boms)' },
        status: { type: 'string', enum: ['active', 'inactive'], description: 'الحالة الجديدة (تُربط بـ isActive — لا عمود status)' },
        notes: { type: 'string', description: 'ملاحظات جديدة' },
      },
      required: ['bomId'],
    },
    summarizeArgs: (a) => `تعديل تركيبة ${String((a as Record<string, unknown>).bomId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const bomId = str(args.bomId);
      if (!bomId) return { error: 'bomId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.status !== undefined) {
        // P1 fix: BOMs have NO status column (only is_active) — the old code
        // forwarded data.status which updateBom never reads: disabling a BOM
        // via the agent was a silent no-op returning { updated: true }.
        const s = str(args.status);
        if (s && !['active', 'inactive'].includes(s)) return { error: 'الحالة يجب أن تكون active أو inactive (التعطيل عبر isActive)' };
        data.isActive = s === 'active';
      }
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await manufacturingApi.updateBom(bomId, ctx.companyId, undefined, data);
      if (!res.success) return { error: res.error || 'فشل تعديل التركيبة' };
      return { updated: true, bomId };
    },
  },

  // ─── ─── Manufacturing: Delete BOM ────────────────────────────────────── ───
  {
    name: 'manufacturing.delete_bom',
    labelAr: 'حذف تركيبة منتج (BOM)',
    descriptionAr: 'يحذف تركيبة منتج. الـ API يرفض حذف التركيبات المرتبطة بأوامر تشغيل. استخدم manufacturing.get_boms أولاً.',
    permission: 'manufacturing.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        bomId: { type: 'string', description: 'معرف التركيبة (UUID)' },
      },
      required: ['bomId'],
    },
    summarizeArgs: (a) => `حذف تركيبة: ${a.bomId}`,
    execute: async (args, ctx) => {
      const bomId = str(args.bomId);
      if (!bomId) return { error: 'bomId مطلوب — استخدم manufacturing.get_boms أولاً' };
      const res = await manufacturingApi.deleteBom(bomId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف التركيبة' };
      return { deleted: true, bomId };
    },
  },

  // ─── ─── Manufacturing: Update Work Order ─────────────────────────────── ───
  {
    name: 'manufacturing.update_work_order',
    labelAr: 'تعديل أمر تشغيل',
    descriptionAr: 'يُحدّث بيانات أمر تشغيل — الكمية، الحالة، الملاحظات، تاريخ الاستحقاق. استخدم manufacturing.get_work_orders أولاً.',
    permission: 'manufacturing.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        workOrderId: { type: 'string', description: 'معرف أمر التشغيل (من manufacturing.get_work_orders)' },
        quantity: { type: 'number', description: 'الكمية الجديدة (عدد الدفعات — تُعاد تحجيم سطور المواد تناسبياً تلقائياً)' },
        status: { type: 'string', enum: ['planned', 'in_progress', 'completed', 'cancelled'], description: 'الحالة الجديدة' },
        notes: { type: 'string', description: 'ملاحظات جديدة' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (يُربط بـ plannedEndDate — لا عمود dueDate)' },
      },
      required: ['workOrderId'],
    },
    summarizeArgs: (a) => `تعديل أمر تشغيل ${String((a as Record<string, unknown>).workOrderId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const workOrderId = str(args.workOrderId);
      if (!workOrderId) return { error: 'workOrderId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.quantity !== undefined) {
        const q = num(args.quantity);
        if (!(q > 0)) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        data.quantity = q;
      }
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['planned', 'in_progress', 'completed', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون planned أو in_progress أو completed أو cancelled' };
        data.status = s;
      }
      if (args.notes !== undefined) data.notes = str(args.notes);
      // P1 fix: work_orders has NO dueDate column (it is plannedEndDate) —
      // the old data.dueDate vanished silently.
      if (args.dueDate !== undefined) data.plannedEndDate = String(args.dueDate);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      // P2 fix: quantity is the BOM batch count — the material lines scale
      // with it. Editing quantity alone desynced materials from batches
      // (10 batches with materials for 5) and skipped the total_cost
      // recompute. Rescale the CURRENT lines proportionally and send them
      // together (mirrors the UI, which always sends lines). Orders past
      // planned freeze their lines — the API rejects honestly then.
      if (data.quantity !== undefined) {
        const cur = await manufacturingApi.getWorkOrderById(workOrderId, ctx.companyId);
        if (!cur.success || !cur.data) return { error: cur.error || 'تعذّر جلب أمر التشغيل الحالي' };
        const oldQty = Number(cur.data.workOrder.quantity) || 0;
        if (!(oldQty > 0)) return { error: 'تعذّر تحديد الكمية الحالية لأمر التشغيل' };
        const ratio = Number(data.quantity) / oldQty;
        const currentLines = cur.data.lines || [];
        if (currentLines.length === 0) {
          return { error: 'أمر التشغيل بلا سطور مواد — احذفه وأنشئ أمراً جديداً بالكمية المطلوبة' };
        }
        data.lines = currentLines.map((l) => ({
          ...l,
          plannedQuantity: Math.round(((Number(l.plannedQuantity) || 0) * ratio) * 10000) / 10000,
        }));
      }
      const res = await manufacturingApi.updateWorkOrder(workOrderId, ctx.companyId, ctx.userId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل أمر التشغيل' };
      return {
        updated: true,
        workOrderId,
        ...(data.quantity !== undefined ? { quantityRescaled: true, note: 'أُعيد تحجيم سطور المواد تناسبياً مع الكمية الجديدة' } : {}),
      };
    },
  },

  // ─── ─── Manufacturing: Delete Work Order ─────────────────────────────── ───
  {
    name: 'manufacturing.delete_work_order',
    labelAr: 'حذف أمر تشغيل',
    descriptionAr: 'يحذف أمر تشغيل. الـ API يرفض حذف أوامر التشغيل المرحلة (completed/in_progress). استخدم manufacturing.get_work_orders أولاً.',
    permission: 'manufacturing.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        workOrderId: { type: 'string', description: 'معرف أمر التشغيل (UUID)' },
      },
      required: ['workOrderId'],
    },
    summarizeArgs: (a) => `حذف أمر تشغيل: ${a.workOrderId}`,
    execute: async (args, ctx) => {
      const workOrderId = str(args.workOrderId);
      if (!workOrderId) return { error: 'workOrderId مطلوب — استخدم manufacturing.get_work_orders أولاً' };
      const res = await manufacturingApi.deleteWorkOrder(workOrderId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف أمر التشغيل' };
      return { deleted: true, workOrderId };
    },
  },
];
