import type { ToolDefinition } from '../../types';
import { inventoryApi } from '@/modules/inventory/api';
import { getNextDocumentNumber } from '@/core/api';
import { manufacturingApi } from '@/modules/manufacturing/api';
import {
  num,
  str,
  round2,
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
          description: 'المواد المكوّنة للتركيبة مع كمياتها وتكاليفها (يجب أن تكون أنواعها مواد أولية/خام)',
          items: {
            type: 'object',
            properties: {
              materialId: { type: 'string', description: 'معرف المادة الخام (من search.products)' },
              quantity: { type: 'number', description: 'الكمية اللازمة لدفعة واحدة' },
              unitCost: { type: 'number', description: 'تكلفة الوحدة (اختياري — تُجلب تلقائياُ من سعر تكلفة المنتج)' },
            },
            required: ['materialId', 'quantity'],
          },
        },
      },
      required: ['productId', 'lines'],
    },
    summarizeArgs: (a) => `إنشاء تركيبة لمنتج: ${String((a as Record<string, unknown>).productId || '').slice(0, 8)}… بعدد مواد: ${Array.isArray((a as Record<string, unknown>).lines) ? ((a as Record<string, unknown>).lines as unknown[]).length : 0}`,
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      if (!productId) return { error: 'productId مطلوب' };
      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير مادة واحدة على الأقل في lines' };
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
        const materialId = str((item as Record<string, unknown>).materialId);
        const quantity = num((item as Record<string, unknown>).quantity);
        let unitCost = (item as Record<string, unknown>).unitCost !== undefined ? num((item as Record<string, unknown>).unitCost) : undefined;
        if (!materialId) return { error: 'كل مادة تحتاج materialId — استخدم search.products للحصول عليه' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        if (unitCost === undefined || unitCost < 0) unitCost = await getProductCost(materialId);
        lines.push({ materialId, quantity, unitCost });
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
        productId: { type: 'string', description: 'معرف المنتج المراد تصنيعه (من search.products)' },
        bomId: { type: 'string', description: 'معرف شجرة المنتج (اختياري — إن تٌرك فارغاُ يجب تمرير lines يدوياُ)' },
        quantity: { type: 'number', description: 'عدد دفعات الـ BOM المطلوب إنتاجها (افتراضي 1)' },
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
        plannedStartDate: { type: 'string', description: 'تاريخ البدء المخطط YYYY-MM-DD (اختياري)' },
        plannedEndDate: { type: 'string', description: 'تاريخ الانتهاء المخطط YYYY-MM-DD (اختياري)' },
        notes: { type: 'string' },
        lines: {
          type: 'array',
          description: 'المواد المستهلكة (اختياري إذا مررت bomId — تٌشتق تلقائياُ من الشجرة)',
          items: {
            type: 'object',
            properties: {
              materialId: { type: 'string', description: 'معرف المادة (من search.products)' },
              plannedQuantity: { type: 'number', description: 'الكمية المخطط استهلاكها' },
              unitCost: { type: 'number', description: 'تكلفة الوحدة (اختياري — تٌجلب من الشجرة/سعر التكلفة)' },
            },
            required: ['materialId', 'plannedQuantity'],
          },
        },
      },
      required: ['productId', 'quantity'],
    },
    summarizeArgs: (a) => `إنشاء أمر تشغيل لإنتاج ${(a as Record<string, unknown>).quantity ?? ''} دفعة من ${String((a as Record<string, unknown>).productId || '').slice(0, 8)}…`,

    execute: async (args, ctx) => {
      const productId = str(args.productId);
      if (!productId) return { error: 'productId مطلوب' };
      const quantity = num(args.quantity);
      if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };

      let rawLines = args.lines as unknown[] | undefined;
      // Auto-derive lines from BOM when not supplied
      if ((!rawLines || rawLines.length === 0) && str(args.bomId)) {
        const bomRes = await manufacturingApi.getBomById(str(args.bomId)!, ctx.companyId);
        if (!bomRes.success || !bomRes.data) return { error: bomRes.error || 'تعذر جلب الشجرة المحددة — تحقق من bomId' };
        rawLines = bomRes.data.lines.map((l) => ({ materialId: l.materialId, plannedQuantity: l.quantity * quantity, unitCost: l.unitCost ?? 0 }));
        if (rawLines.length === 0) return { error: 'الشجرة المختارة بلا مواد — لا يمكن إنشاء أمر تشغيل' };
      }
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير lines أو bomId صالح لاشتقاق المواد' };
      const lines: { materialId: string; plannedQuantity: number; unitCost: number }[] = [];
      for (const item of rawLines) {
        const materialId = str((item as Record<string, unknown>).materialId);
        const pq = num((item as Record<string, unknown>).plannedQuantity);
        const uc = (item as Record<string, unknown>).unitCost !== undefined ? num((item as Record<string, unknown>).unitCost) : 0;
        if (!materialId) return { error: 'كل مادة تحتاج materialId — استخدم search.products' };
        if (pq <= 0) return { error: 'plannedQuantity يجب أن تكون أكبر من صفر' };
        lines.push({ materialId, plannedQuantity: pq, unitCost: uc });
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
        bomId: str(args.bomId),
        quantity,
        status: 'planned',
        supervisorId: str(args.supervisorId),
        batchNumber: str(args.batchNumber),
        plannedStartDate: str(args.plannedStartDate),
        plannedEndDate: str(args.plannedEndDate),
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
    permission: 'manufacturing.create',
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
    permission: 'manufacturing.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        bomId: { type: 'string', description: 'معرف التركيبة (من manufacturing.get_boms)' },
        status: { type: 'string', enum: ['active', 'inactive', 'draft'], description: 'الحالة الجديدة' },
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
        const s = str(args.status);
        if (s && !['active', 'inactive', 'draft'].includes(s)) return { error: 'الحالة يجب أن تكون active أو inactive أو draft' };
        data.status = s;
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
    permission: 'manufacturing.create',
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
    permission: 'manufacturing.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        workOrderId: { type: 'string', description: 'معرف أمر التشغيل (من manufacturing.get_work_orders)' },
        quantity: { type: 'number', description: 'الكمية الجديدة' },
        status: { type: 'string', enum: ['planned', 'in_progress', 'completed', 'cancelled'], description: 'الحالة الجديدة' },
        notes: { type: 'string', description: 'ملاحظات جديدة' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (اختياري)' },
      },
      required: ['workOrderId'],
    },
    summarizeArgs: (a) => `تعديل أمر تشغيل ${String((a as Record<string, unknown>).workOrderId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const workOrderId = str(args.workOrderId);
      if (!workOrderId) return { error: 'workOrderId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.quantity !== undefined) data.quantity = num(args.quantity);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['planned', 'in_progress', 'completed', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون planned أو in_progress أو completed أو cancelled' };
        data.status = s;
      }
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.dueDate !== undefined) data.dueDate = String(args.dueDate);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await manufacturingApi.updateWorkOrder(workOrderId, ctx.companyId, undefined, data);
      if (!res.success) return { error: res.error || 'فشل تعديل أمر التشغيل' };
      return { updated: true, workOrderId };
    },
  },

  // ─── ─── Manufacturing: Delete Work Order ─────────────────────────────── ───
  {
    name: 'manufacturing.delete_work_order',
    labelAr: 'حذف أمر تشغيل',
    descriptionAr: 'يحذف أمر تشغيل. الـ API يرفض حذف أوامر التشغيل المرحلة (completed/in_progress). استخدم manufacturing.get_work_orders أولاً.',
    permission: 'manufacturing.create',
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
