import type { ToolDefinition } from '../../types';
import { getNextDocumentNumber } from '@/core/api';
import { purchasesApi } from '@/modules/purchases/api';
import {
  num,
  str,
  round2,
  summarizeDocLines,
  getInvoiceTaxConfig,
  parseLines,
  LINES_SCHEMA,
} from './shared';
import { localToday } from '../../engine/dateUtils';

/**
 * WRITE tools — المشتريات (14 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */

function today(): string {
  // LOCAL calendar day — UTC "today" is yesterday for GMT+3 between 00:00-03:00
  return localToday();
}
export const purchasesWriteTools: ToolDefinition[] = [
  // ─── ─── Purchases ─────────────────────────────────────────────────────────── ───
  {
    name: 'purchases.create_supplier',
    labelAr: 'إنشاء مورد',
    descriptionAr: 'ينشئ مورداً جديداً بالاسم وبيانات اختيارية (هاتف، بريد، عنوان) مع رصيد افتتاحي اختياري يُرحّل تلقائياً محاسبياً.',
    permission: 'purchases.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم المورد (إلزامي)' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        openingBalance: { type: 'number', description: 'الرصيد الافتتاحي المستحق للمورد (يُرحّل تلقائياً عبر حساب الأرصدة الافتتاحية)' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء مورد جديد: ${a.name}${a.openingBalance ? ` — رصيد افتتاحي: ${a.openingBalance}` : ''}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم المورد مطلوب' };
      const openingBalance = num(args.openingBalance);
      const res = await purchasesApi.createSupplier({
        companyId: ctx.companyId,
        name,
        phone: str(args.phone),
        email: str(args.email),
        address: str(args.address),
        balance: 0,
        openingBalance: openingBalance > 0 ? openingBalance : undefined,
        isActive: true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء المورد' };
      return {
        created: true,
        supplierId: res.id,
        name,
        ...(openingBalance > 0 ? { openingBalance, openingPosted: true, note: 'الرصيد الافتتاحي رُحّل تلقائياً (مدين الأرصدة الافتتاحية / دائن الدائنين)' } : {}),
      };
    },
  },

  {
    name: 'purchases.create_invoice',
    labelAr: 'إنشاء فاتورة مشتريات',
    descriptionAr: 'ينشئ فاتورة مشتريات مسودة لمورد مع أصناف. استخدم search.suppliers و search.products أولاً (سعر التكلفة costPrice). إذا قال المستخدم "نقدي/دفعت نقداً من الخزنة" مرّر paymentType="cash" + cashBoxId (من search.cash_boxes).',
    permission: 'purchases.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (من search.suppliers)' },
        date: { type: 'string', description: 'تاريخ الفاتورة YYYY-MM-DD (افتراضي اليوم)' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD (اختياري — للآجل)' },
        paymentType: { type: 'string', enum: ['cash', 'credit'], description: 'نوع الدفع: cash = نقدي (يُخصم من الخزنة عند الترحيل ولا يُسجَّل دين للمورد)، credit = آجل (افتراضي — يُقيَّد على الدائنين)' },
        cashBoxId: { type: 'string', description: 'معرف الخزنة (من search.cash_boxes) — مطلوب عملياً عند paymentType=cash' },
        notes: { type: 'string' },
        lines: LINES_SCHEMA,
      },
      required: ['supplierId', 'lines'],
    },
    summarizeArgs: (a) => {
      const base = summarizeDocLines('إنشاء فاتورة مشتريات (مسودة)', a.lines);
      return a.paymentType === 'cash' ? `${base} — نقدي` : base;
    },
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      if (!supplierId) return { error: 'supplierId مطلوب — استخدم search.suppliers أولاً' };
      const parsed = parseLines(args.lines);
      if ('error' in parsed) return { error: parsed.error };
      const paymentType = str(args.paymentType) === 'cash' ? 'cash' : 'credit';
      const cashBoxId = str(args.cashBoxId);
      if (paymentType === 'cash' && !cashBoxId) {
        return { error: 'cashBoxId مطلوب للفواتير النقدية — استخدم search.cash_boxes أولاً' };
      }

      // Company invoice settings win: VAT/discount the company switched off
      // are booked as zero (same flags the invoice forms obey).
      const tax = await getInvoiceTaxConfig(ctx.companyId);
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'purchase_invoice');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الفاتورة' };

      const lines = parsed.map((l) => {
        const discountPercent = tax.showDiscount ? l.discountPercent : 0;
        const lineTotal = round2(l.quantity * l.unitPrice * (1 - discountPercent / 100));
        return { ...l, discountPercent, vatPercent: tax.vatRate, lineTotal };
      });
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(lines.reduce((s, l) => s + (l.lineTotal * l.vatPercent) / 100, 0));
      const totalAmount = round2(subtotal + vatAmount);

      const res = await purchasesApi.createInvoice({
        companyId: ctx.companyId,
        invoiceNumber: docNumber.number,
        supplierId,
        date: str(args.date) || today(),
        dueDate: str(args.dueDate),
        subtotal,
        discountAmount: 0,
        vatAmount,
        totalAmount,
        paidAmount: 0,
        status: 'draft',
        // CASH purchase: paid at purchase time — Cr treasury at posting,
        // the supplier is never owed.
        paymentType,
        cashBoxId: paymentType === 'cash' ? cashBoxId : undefined,
        notes: str(args.notes),
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء الفاتورة' };
      return {
        created: true,
        invoiceId: res.id,
        invoiceNumber: docNumber.number,
        paymentType,
        totalAmount,
        ...(tax.showVat
          ? {}
          : { vatSkipped: true, vatNote: 'الضريبة معطلة في إعدادات الشركة (invoice.showVat) — سُجلت الفاتورة بدون ضريبة' }),
        note: paymentType === 'cash'
          ? 'فاتورة مشتريات نقدية (مسودة) — استخدم purchases.post_invoice لترحيلها؛ سيُخصم المبلغ من الخزنة لا من ذمة المورد'
          : undefined,
      };
    },
  },

  // ─── ─── Purchase Orders ──────────────────────────────────────────────────── ───
  {
    name: 'purchases.create_purchase_order',
    labelAr: 'إنشاء أمر شراء',
    descriptionAr: 'ينشئ أمر شراء مسودّة لمورد مع أصناف. استخدم search.suppliers و search.products أولاً.',
    permission: 'purchases.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (من search.suppliers)' },
        expectedDate: { type: 'string', description: 'تاريخ التوقع YYYY-MM-DD (اختياري)' },
        notes: { type: 'string' },
        lines: {
          type: 'array', description: 'أصناف الأمر',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
              quantity: { type: 'number', description: 'الكمية' },
              unitPrice: { type: 'number', description: 'سعر الوحدة التقديري (سعر التكلفة)' },
            },
            required: ['productId', 'quantity', 'unitPrice'],
          },
        },
      },
      required: ['supplierId', 'lines'],
    },
    summarizeArgs: (a) => `إنشاء أمر شراء بعدد أصناف: ${Array.isArray(a.lines) ? a.lines.length : 0}`,
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      if (!supplierId) return { error: 'supplierId مطلوب — استخدم search.suppliers أولاً' };
      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
      const lines: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[] = [];
      for (const item of rawLines) {
        const productId = str((item as Record<string, unknown>).productId);
        const quantity = num((item as Record<string, unknown>).quantity);
        const unitPrice = num((item as Record<string, unknown>).unitPrice);
        if (!productId) return { error: 'كل صنف يحتاج productId' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        lines.push({ productId, quantity, unitPrice, lineTotal: round2(quantity * unitPrice) });
      }

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'purchase_order');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الأمر' };

      const totalAmount = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

      const res = await purchasesApi.createOrder({
        companyId: ctx.companyId,
        orderNumber: docNumber.number,
        supplierId,
        date: today(),
        expectedDate: str(args.expectedDate),
        totalAmount,
        status: 'draft',
        notes: str(args.notes),
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء الأمر' };
      return { created: true, orderId: res.id, orderNumber: docNumber.number, totalAmount };
    },
  },

  // ─── ─── Purchase Returns ─────────────────────────────────────────────────── ───
  {
    name: 'purchases.create_purchase_return',
    labelAr: 'إنشاء مردود مشتريات',
    descriptionAr: 'ينشئ مردود مشتريات (مرتجع) لمورد. استخدم search.suppliers و search.products أولاً.',
    permission: 'purchases.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (من search.suppliers)' },
        invoiceId: { type: 'string', description: 'معرف فاتورة الشراء الأصلية (اختياري)' },
        reason: { type: 'string', description: 'سبب المرتجع' },
        notes: { type: 'string' },
        lines: {
          type: 'array', description: 'الأصناف المرتجعة',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
              quantity: { type: 'number', description: 'الكمية المرتجعة' },
              unitPrice: { type: 'number', description: 'سعر الوحدة (سعر التكلفة)' },
            },
            required: ['productId', 'quantity', 'unitPrice'],
          },
        },
      },
      required: ['supplierId', 'lines'],
    },
    summarizeArgs: (a) => `إنشاء مردود مشتريات بعدد أصناف: ${Array.isArray(a.lines) ? a.lines.length : 0}${a.reason ? ` — سبب: ${a.reason}` : ''}`,
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      if (!supplierId) return { error: 'supplierId مطلوب' };
      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل' };
      const lines: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[] = [];
      for (const item of rawLines) {
        const productId = str((item as Record<string, unknown>).productId);
        const quantity = num((item as Record<string, unknown>).quantity);
        const unitPrice = num((item as Record<string, unknown>).unitPrice);
        if (!productId) return { error: 'كل صنف يحتاج productId' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        lines.push({ productId, quantity, unitPrice, lineTotal: round2(quantity * unitPrice) });
      }

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'purchase_return');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم المردود' };

      const tax = await getInvoiceTaxConfig(ctx.companyId);
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(subtotal * tax.vatRate / 100);
      const totalAmount = round2(subtotal + vatAmount);

      const res = await purchasesApi.createReturn({
        companyId: ctx.companyId,
        returnNumber: docNumber.number,
        supplierId,
        invoiceId: str(args.invoiceId),
        date: today(),
        subtotal,
        vatAmount,
        totalAmount,
        reason: str(args.reason),
        status: 'draft',
        notes: str(args.notes),
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء المردود' };
      return {
        created: true,
        returnId: res.id,
        returnNumber: docNumber.number,
        totalAmount,
        ...(tax.showVat
          ? {}
          : { vatSkipped: true, vatNote: 'الضريبة معطلة في إعدادات الشركة (invoice.showVat) — سُجل المردود بدون ضريبة' }),
      };
    },
  },

  // ─── ─── Purchases: Post Invoice ──────────────────────────────────────── ───
  {
    name: 'purchases.post_invoice',
    labelAr: 'ترحيل فاتورة مشتريات',
    descriptionAr: 'يُرحّل فاتورة مشتريات من حالة draft إلى posted. يُنشئ القيد المحاسبي تلقائياً.',
    permission: 'purchases.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف فاتورة المشتريات (UUID)' },
      },
      required: ['invoiceId'],
    },
    summarizeArgs: (a) => `ترحيل فاتورة مشتريات: ${a.invoiceId}`,
    execute: async (args, ctx) => {
      const invoiceId = str(args.invoiceId);
      if (!invoiceId) return { error: 'invoiceId مطلوب' };
      const res = await purchasesApi.postInvoice(invoiceId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل ترحيل الفاتورة' };
      return { posted: true, invoiceId };
    },
  },

  // ─── ─── Purchases: Post Return ───────────────────────────────────────── ───
  {
    name: 'purchases.post_return',
    labelAr: 'ترحيل مردود مشتريات',
    descriptionAr: 'يُرحّل مردود مشتريات من حالة draft إلى posted. يُحدّث رصيد المورد والمخزون تلقائياً.',
    permission: 'purchases.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        returnId: { type: 'string', description: 'معرف مردود المشتريات (UUID)' },
      },
      required: ['returnId'],
    },
    summarizeArgs: (a) => `ترحيل مردود مشتريات: ${a.returnId}`,
    execute: async (args, ctx) => {
      const returnId = str(args.returnId);
      if (!returnId) return { error: 'returnId مطلوب' };
      const res = await purchasesApi.postReturn(returnId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل ترحيل المردود' };
      return { posted: true, returnId };
    },
  },

  // ─── ─── Purchases: Update Supplier ───────────────────────────────────── ───
  {
    name: 'purchases.update_supplier',
    labelAr: 'تعديل مورد',
    descriptionAr: 'يُعدّل بيانات مورد موجود (الاسم، الهاتف، البريد، العنوان، الرقم الضريبي، الحالة). استخدم search.suppliers أولاً لإيجاد supplierId.',
    permission: 'purchases.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (UUID)' },
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        taxNumber: { type: 'string' },
        isActive: { type: 'boolean' },
      },
      required: ['supplierId'],
    },
    summarizeArgs: (a) => `تعديل المورد ${a.supplierId}`,
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      if (!supplierId) return { error: 'supplierId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.taxNumber !== undefined) data.taxNumber = str(args.taxNumber);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await purchasesApi.updateSupplier(supplierId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المورد' };
      return { updated: true, supplierId, ...data };
    },
  },

  // ─── ─── Purchases: Update Invoice ─────────────────────────────────────── ───
  {
    name: 'purchases.update_invoice',
    labelAr: 'تعديل فاتورة مشتريات',
    descriptionAr: 'يُعدّل بيانات فاتورة مشتريات موجودة (ملاحظات، الحالة، الخصم، المبلغ المدفوع). استخدم purchases.get_invoices أولاً لإيجاد invoiceId.',
    permission: 'purchases.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف فاتورة المشتريات (UUID)' },
        notes: { type: 'string', description: 'ملاحظات (اختياري)' },
        status: { type: 'string', enum: ['draft', 'cancelled'], description: 'الحالة (اختياري)' },
        discountAmount: { type: 'number', description: 'قيمة الخصم (اختياري)' },
        paidAmount: { type: 'number', description: 'المبلغ المدفوع (اختياري)' },
      },
      required: ['invoiceId'],
    },
    summarizeArgs: (a) => `تعديل فاتورة مشتريات ${a.invoiceId}`,
    execute: async (args, ctx) => {
      const invoiceId = str(args.invoiceId);
      if (!invoiceId) return { error: 'invoiceId مطلوب — استخدم purchases.get_invoices أولاً' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['draft', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو cancelled' };
        data.status = s;
      }
      if (args.discountAmount !== undefined) data.discountAmount = num(args.discountAmount);
      if (args.paidAmount !== undefined) data.paidAmount = num(args.paidAmount);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await purchasesApi.updateInvoice(invoiceId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الفاتورة' };
      return { updated: true, invoiceId, ...data };
    },
  },

  // ─── ─── Purchases: Delete Invoice ────────────────────────────────────── ───
  {
    name: 'purchases.delete_invoice',
    labelAr: 'حذف فاتورة مشتريات',
    descriptionAr: 'يحذف فاتورة مشتريات في حالة draft. لا يمكن حذف فاتورة مرحلة أو مدفوعة.',
    permission: 'purchases.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف فاتورة المشتريات (UUID)' },
      },
      required: ['invoiceId'],
    },
    summarizeArgs: (a) => `حذف فاتورة مشتريات ${a.invoiceId}`,
    execute: async (args, ctx) => {
      const invoiceId = str(args.invoiceId);
      if (!invoiceId) return { error: 'invoiceId مطلوب' };
      const res = await purchasesApi.deleteInvoice(invoiceId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الفاتورة' };
      return { deleted: true, invoiceId };
    },
  },

  // ─── ─── Purchases: Update Order ───────────────────────────────────────── ───
  {
    name: 'purchases.update_order',
    labelAr: 'تعديل أمر شراء',
    descriptionAr: 'يُعدّل بيانات أمر شراء موجود (ملاحظات، الحالة). استخدم purchases.get_purchase_orders أولاً لإيجاد orderId.',
    permission: 'purchases.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'معرف أمر الشراء (UUID)' },
        notes: { type: 'string', description: 'ملاحظات (اختياري)' },
        status: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'], description: 'الحالة (اختياري)' },
      },
      required: ['orderId'],
    },
    summarizeArgs: (a) => `تعديل أمر شراء ${a.orderId}`,
    execute: async (args, ctx) => {
      const orderId = str(args.orderId);
      if (!orderId) return { error: 'orderId مطلوب — استخدم purchases.get_purchase_orders أولاً' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['draft', 'confirmed', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو confirmed أو cancelled' };
        data.status = s;
      }
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await purchasesApi.updateOrder(orderId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الأمر' };
      return { updated: true, orderId, ...data };
    },
  },

  // ─── ─── Purchases: Delete Order ───────────────────────────────────────── ───
  {
    name: 'purchases.delete_order',
    labelAr: 'حذف أمر شراء',
    descriptionAr: 'يحذف أمر شراء في حالة draft.',
    permission: 'purchases.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'معرف أمر الشراء (UUID)' },
      },
      required: ['orderId'],
    },
    summarizeArgs: (a) => `حذف أمر شراء ${a.orderId}`,
    execute: async (args, ctx) => {
      const orderId = str(args.orderId);
      if (!orderId) return { error: 'orderId مطلوب' };
      const res = await purchasesApi.deleteOrder(orderId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الأمر' };
      return { deleted: true, orderId };
    },
  },

  // ─── ─── Purchases: Update Return ──────────────────────────────────────── ───
  {
    name: 'purchases.update_return',
    labelAr: 'تعديل مردود مشتريات',
    descriptionAr: 'يُعدّل بيانات مردود مشتريات موجود (ملاحظات، الحالة). استخدم purchases.get_returns أولاً لإيجاد returnId.',
    permission: 'purchases.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        returnId: { type: 'string', description: 'معرف مردود المشتريات (UUID)' },
        notes: { type: 'string', description: 'ملاحظات (اختياري)' },
        status: { type: 'string', enum: ['draft', 'cancelled'], description: 'الحالة (اختياري)' },
      },
      required: ['returnId'],
    },
    summarizeArgs: (a) => `تعديل مردود مشتريات ${a.returnId}`,
    execute: async (args, ctx) => {
      const returnId = str(args.returnId);
      if (!returnId) return { error: 'returnId مطلوب — استخدم purchases.get_returns أولاً' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['draft', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو cancelled' };
        data.status = s;
      }
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await purchasesApi.updateReturn(returnId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المردود' };
      return { updated: true, returnId, ...data };
    },
  },

  // ─── ─── Purchases: Delete Return ──────────────────────────────────────── ───
  {
    name: 'purchases.delete_return',
    labelAr: 'حذف مردود مشتريات',
    descriptionAr: 'يحذف مردود مشتريات في حالة draft.',
    permission: 'purchases.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        returnId: { type: 'string', description: 'معرف مردود المشتريات (UUID)' },
      },
      required: ['returnId'],
    },
    summarizeArgs: (a) => `حذف مردود مشتريات ${a.returnId}`,
    execute: async (args, ctx) => {
      const returnId = str(args.returnId);
      if (!returnId) return { error: 'returnId مطلوب' };
      const res = await purchasesApi.deleteReturn(returnId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المردود' };
      return { deleted: true, returnId };
    },
  },

  // ─── ─── Purchases: Delete Supplier ────────────────────────────────────── ───
  {
    name: 'purchases.delete_supplier',
    labelAr: 'حذف مورد',
    descriptionAr: 'يحذف مورداً من النظام. إذا كان للمورد فواتير مرتبطة، الـ API يُرجع خطأ FK.',
    permission: 'purchases.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (UUID)' },
      },
      required: ['supplierId'],
    },
    summarizeArgs: (a) => `حذف مورد ${a.supplierId}`,
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      if (!supplierId) return { error: 'supplierId مطلوب' };
      const res = await purchasesApi.deleteSupplier(supplierId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المورد' };
      return { deleted: true, supplierId };
    },
  },
];
