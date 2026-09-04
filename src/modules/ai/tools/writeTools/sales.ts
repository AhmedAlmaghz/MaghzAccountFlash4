import type { ToolDefinition } from '../../types';
import { getNextDocumentNumber } from '@/core/api';
import { salesApi } from '@/modules/sales/api';
import {
  num,
  str,
  round2,
  summarizeDocLines,
  getVatRate,
  parseLines,
  LINES_SCHEMA,
} from './shared';
import { localToday } from '../../engine/dateUtils';

/**
 * WRITE tools — المبيعات (13 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */

function today(): string {
  // LOCAL calendar day — UTC "today" is yesterday for GMT+3 between 00:00-03:00
  return localToday();
}
export const salesWriteTools: ToolDefinition[] = [
  // ─── ─── Sales ─────────────────────────────────────────────────────────────── ───
  {
    name: 'sales.create_customer',
    labelAr: 'إنشاء عميل',
    descriptionAr: 'ينشئ عميلاً جديداً بالاسم وبيانات اختيارية (هاتف، بريد، عنوان، رقم ضريبي) مع رصيد افتتاحي وحد ائتماني اختياريين. الرصيد الافتتاحي يُرحّل تلقائياً محاسبياً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل (إلزامي)' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        taxNumber: { type: 'string', description: 'الرقم الضريبي' },
        openingBalance: { type: 'number', description: 'الرصيد الافتتاحي المستحق على العميل (يُرحّل تلقائياً عبر حساب الأرصدة الافتتاحية)' },
        creditLimit: { type: 'number', description: 'الحد الائتماني' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء عميل جديد: ${a.name}${a.openingBalance ? ` — رصيد افتتاحي: ${a.openingBalance}` : ''}${a.creditLimit ? ` — حد ائتماني: ${a.creditLimit}` : ''}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم العميل مطلوب' };
      const openingBalance = num(args.openingBalance);
      const res = await salesApi.createCustomer({
        companyId: ctx.companyId,
        name,
        phone: str(args.phone),
        email: str(args.email),
        address: str(args.address),
        taxNumber: str(args.taxNumber),
        creditLimit: args.creditLimit !== undefined ? num(args.creditLimit) : undefined,
        balance: 0,
        openingBalance: openingBalance > 0 ? openingBalance : undefined,
        isActive: true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء العميل' };
      return {
        created: true,
        customerId: res.id,
        name,
        ...(openingBalance > 0 ? { openingBalance, openingPosted: true, note: 'الرصيد الافتتاحي رُحّل تلقائياً (مدين المدينين / دائن الأرصدة الافتتاحية)' } : {}),
      };
    },
  },

  {
    name: 'sales.create_invoice',
    labelAr: 'إنشاء فاتورة مبيعات',
    descriptionAr: 'ينشئ فاتورة مبيعات مسودة لعميل مع أصناف. الإجمالي والضريبة تُحسب تلقائياً حسب إعدادات الشركة. استخدم search.customers و search.products أولاً للحصول على المعرفات والأسعار. إذا قال المستخدم "نقدي/فوري/دفعت نقداً" مرّر paymentType="cash" + cashBoxId (من search.cash_boxes).',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (من search.customers)' },
        date: { type: 'string', description: 'تاريخ الفاتورة YYYY-MM-DD (افتراضي اليوم)' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (اختياري — للآجل)' },
        paymentType: { type: 'string', enum: ['cash', 'credit'], description: 'نوع الدفع: cash = نقدي (يُقيَّد على الخزنة عند الترحيل ولا يُسجَّل دين على العميل)، credit = آجل (افتراضي — يُقيَّد على المدينين)' },
        cashBoxId: { type: 'string', description: 'معرف الخزنة (من search.cash_boxes) — مطلوب عملياً عند paymentType=cash لتحديد الخزنة المقبوض فيها' },
        notes: { type: 'string' },
        lines: LINES_SCHEMA,
      },
      required: ['customerId', 'lines'],
    },
    summarizeArgs: (a) => {
      const base = summarizeDocLines('إنشاء فاتورة مبيعات (مسودة)', a.lines);
      return a.paymentType === 'cash' ? `${base} — نقدي` : base;
    },
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const parsed = parseLines(args.lines);
      if ('error' in parsed) return { error: parsed.error };
      const paymentType = str(args.paymentType) === 'cash' ? 'cash' : 'credit';
      const cashBoxId = str(args.cashBoxId);
      if (paymentType === 'cash' && !cashBoxId) {
        return { error: 'cashBoxId مطلوب للفواتير النقدية — استخدم search.cash_boxes أولاً' };
      }

      const vatRate = await getVatRate(ctx.companyId);
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'sales_invoice');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الفاتورة' };

      const lines = parsed.map((l) => {
        const lineTotal = round2(l.quantity * l.unitPrice * (1 - l.discountPercent / 100));
        return { ...l, vatPercent: vatRate, lineTotal };
      });
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(lines.reduce((s, l) => s + (l.lineTotal * l.vatPercent) / 100, 0));
      const totalAmount = round2(subtotal + vatAmount);

      const res = await salesApi.createInvoice({
        companyId: ctx.companyId,
        invoiceNumber: docNumber.number,
        customerId,
        date: str(args.date) || today(),
        dueDate: str(args.dueDate),
        subtotal,
        discountAmount: 0,
        vatAmount,
        totalAmount,
        paidAmount: 0,
        status: 'draft',
        // CASH invoice: the invoice itself is the payment — paidAmount is set
        // at posting time (Dr treasury / Cr sales), the customer owes nothing.
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
        status: 'draft',
        paymentType,
        subtotal,
        vatAmount,
        totalAmount,
        note: paymentType === 'cash'
          ? 'فاتورة نقدية (مسودة) — استخدم sales.post_invoice لترحيلها؛ سيُقيَّد المبلغ على الخزنة لا على العميل'
          : 'الفاتورة مسودة — استخدم sales.post_invoice لترحيلها عند طلب المستخدم',
      };
    },
  },

  {
    name: 'sales.post_invoice',
    labelAr: 'ترحيل فاتورة مبيعات',
    descriptionAr: 'يرحّل فاتورة مبيعات مسودة (تصبح نافذة محاسبياً). الآجل: يُقيَّد على المدينين ويُحدَّث رصيد العميل. النقدية: يُقيَّد على خزنة الفاتورة ولا يُسجَّل أي دين على العميل. يتطلب معرف الفاتورة — من sales.get_invoices.',
    permission: 'sales.post',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف الفاتورة (من sales.get_invoices)' },
      },
      required: ['invoiceId'],
    },
    summarizeArgs: (a) => `ترحيل فاتورة مبيعات (المعرف: ${String(a.invoiceId).slice(0, 8)}…)`,
    execute: async (args, ctx) => {
      const invoiceId = str(args.invoiceId);
      if (!invoiceId) return { error: 'invoiceId مطلوب' };
      const res = await salesApi.postInvoice(invoiceId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل الترحيل' };
      return { posted: true, invoiceId };
    },
  },

  {
    name: 'sales.create_quotation',
    labelAr: 'إنشاء عرض سعر',
    descriptionAr: 'ينشئ عرض سعر جديد لعميل مع أصناف. استخدم search.customers و search.products أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (من search.customers)' },
        expiryDate: { type: 'string', description: 'تاريخ انتهاء العرض YYYY-MM-DD (اختياري)' },
        notes: { type: 'string' },
        lines: LINES_SCHEMA,
      },
      required: ['customerId', 'lines'],
    },
    summarizeArgs: (a) => `إنشاء عرض سعر بعدد أصناف: ${Array.isArray(a.lines) ? a.lines.length : 0}`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب' };
      const parsed = parseLines(args.lines);
      if ('error' in parsed) return { error: parsed.error };

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'quotation');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم العرض' };

      const lines = parsed.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        lineTotal: round2(l.quantity * l.unitPrice * (1 - l.discountPercent / 100)),
      }));
      const totalAmount = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

      const res = await salesApi.createQuotation({
        companyId: ctx.companyId,
        quotationNumber: docNumber.number,
        customerId,
        date: today(),
        expiryDate: str(args.expiryDate),
        totalAmount,
        status: 'draft',
        notes: str(args.notes),
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء العرض' };
      return { created: true, quotationId: res.id, quotationNumber: docNumber.number, totalAmount };
    },
  },

  // ─── ─── Sales Returns ─────────────────────────────────────────────────────── ───
  {
    name: 'sales.create_sales_return',
    labelAr: 'إنشاء مردود مبيعات',
    descriptionAr: 'ينشئ مردود مبيعات (مرتجع) لفاتورة مبيعات. استخدم sales.get_invoices و search.products أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (من search.customers)' },
        invoiceId: { type: 'string', description: 'معرف الفاتورة الأصلية (اختياري)' },
        reason: { type: 'string', description: 'سبب المرتجع' },
        notes: { type: 'string' },
        lines: {
          type: 'array',
          description: 'الأصناف المرتجعة. استخدم search.products للحصول على المعرفات.',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
              quantity: { type: 'number', description: 'الكمية المرتجعة' },
              unitPrice: { type: 'number', description: 'سعر الوحدة (سعر البيع)' },
            },
            required: ['productId', 'quantity', 'unitPrice'],
          },
        },
      },
      required: ['customerId', 'lines'],
    },
    summarizeArgs: (a) => `إنشاء مردود مبيعات بعدد أصناف: ${Array.isArray(a.lines) ? a.lines.length : 0}${a.reason ? ` — سبب: ${a.reason}` : ''}`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب' };
      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
      const lines: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[] = [];
      for (const item of rawLines) {
        const productId = str((item as Record<string, unknown>).productId);
        const quantity = num((item as Record<string, unknown>).quantity);
        const unitPrice = num((item as Record<string, unknown>).unitPrice);
        if (!productId) return { error: 'كل صنف يحتاج productId — استخدم search.products أولاً' };
        if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        lines.push({ productId, quantity, unitPrice, lineTotal: round2(quantity * unitPrice) });
      }

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'sales_return');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم المردود' };

      const vatRate = await getVatRate(ctx.companyId);
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(subtotal * vatRate / 100);
      const totalAmount = round2(subtotal + vatAmount);

      const res = await salesApi.createReturn({
        companyId: ctx.companyId,
        returnNumber: docNumber.number,
        customerId,
        invoiceId: str(args.invoiceId) || '',
        date: today(),
        subtotal,
        vatAmount,
        totalAmount,
        reason: str(args.reason) || '',
        status: 'draft',
        notes: str(args.notes),
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء المردود' };
      return { created: true, returnId: res.id, returnNumber: docNumber.number, totalAmount };
    },
  },

  // ─── ─── Sales: Update Customer ───────────────────────────────────────── ───
  {
    name: 'sales.update_customer',
    labelAr: 'تعديل عميل',
    descriptionAr: 'يُعدّل بيانات عميل موجود (الاسم، الهاتف، البريد، العنوان، الرقم الضريبي، الحد الائتماني، الرصيد، الحالة). استخدم search.customers أولاً لإيجاد customerId.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
        name: { type: 'string', description: 'الاسم الجديد (اختياري)' },
        phone: { type: 'string', description: 'الهاتف (اختياري)' },
        email: { type: 'string', description: 'البريد الإلكتروني (اختياري)' },
        address: { type: 'string', description: 'العنوان (اختياري)' },
        taxNumber: { type: 'string', description: 'الرقم الضريبي (اختياري)' },
        creditLimit: { type: 'number', description: 'الحد الائتماني (اختياري)' },
        balance: { type: 'number', description: 'الرصيد الافتتاحي (اختياري)' },
        isActive: { type: 'boolean', description: 'نشط/غير نشط (اختياري)' },
      },
      required: ['customerId'],
    },
    summarizeArgs: (a) => `تعديل بيانات العميل ${a.customerId}${a.name ? ` — ${a.name}` : ''}`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.taxNumber !== undefined) data.taxNumber = str(args.taxNumber);
      if (args.creditLimit !== undefined) data.creditLimit = num(args.creditLimit);
      if (args.balance !== undefined) data.balance = num(args.balance);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await salesApi.updateCustomer(customerId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل العميل' };
      return { updated: true, customerId, ...data };
    },
  },

  // ─── ─── Sales: Post Return ───────────────────────────────────────────── ───
  {
    name: 'sales.post_return',
    labelAr: 'ترحيل مردود مبيعات',
    descriptionAr: 'يُرحّل مردود مبيعات من حالة draft إلى posted. يُحدّث رصيد العميل والمخزون تلقائياً. استخدم search.sales_invoices أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        returnId: { type: 'string', description: 'معرف مردود المبيعات (UUID)' },
      },
      required: ['returnId'],
    },
    summarizeArgs: (a) => `ترحيل مردود مبيعات: ${a.returnId}`,
    execute: async (args, ctx) => {
      const returnId = str(args.returnId);
      if (!returnId) return { error: 'returnId مطلوب' };
      const res = await salesApi.postReturn(returnId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل ترحيل المردود' };
      return { posted: true, returnId };
    },
  },

  // ─── ─── Sales: Update Invoice ──────────────────────────────────────── ───
  {
    name: 'sales.update_invoice',
    labelAr: 'تعديل فاتورة مبيعات',
    descriptionAr: 'يُعدّل حقول فاتورة مبيعات موجودة (الملاحظات، الحالة، الخصم، المبلغ المدفوع). لا يُمكن تعديل الأصناف أو العميل. استخدم sales.get_invoices أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف الفاتورة (UUID)' },
        notes: { type: 'string', description: 'ملاحظات جديدة (اختياري)' },
        status: { type: 'string', enum: ['draft', 'cancelled'], description: 'الحالة الجديدة (draft أو cancelled فقط)' },
        discountAmount: { type: 'number', description: 'مبلغ الخصم الجديد (اختياري)' },
        paidAmount: { type: 'number', description: 'المبلغ المدفوع الجديد (اختياري)' },
      },
      required: ['invoiceId'],
    },
    summarizeArgs: (a) => `تعديل الفاتورة ${a.invoiceId}`,
    execute: async (args, ctx) => {
      const invoiceId = str(args.invoiceId);
      if (!invoiceId) return { error: 'invoiceId مطلوب — استخدم sales.get_invoices أولاً' };
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
      const res = await salesApi.updateInvoice(invoiceId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الفاتورة' };
      return { updated: true, invoiceId, ...data };
    },
  },

  // ─── ─── Sales: Delete Invoice ──────────────────────────────────────── ───
  {
    name: 'sales.delete_invoice',
    labelAr: 'حذف فاتورة مبيعات',
    descriptionAr: 'يحذف فاتورة مبيعات مسودة (draft). الـ API يرفض حذف الفواتير المرحلة. استخدم sales.get_invoices أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف الفاتورة (UUID)' },
      },
      required: ['invoiceId'],
    },
    summarizeArgs: (a) => `حذف فاتورة مبيعات: ${a.invoiceId}`,
    execute: async (args, ctx) => {
      const invoiceId = str(args.invoiceId);
      if (!invoiceId) return { error: 'invoiceId مطلوب — استخدم sales.get_invoices أولاً' };
      const res = await salesApi.deleteInvoice(invoiceId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الفاتورة' };
      return { deleted: true, invoiceId };
    },
  },

  // ─── ─── Sales: Update Quotation ────────────────────────────────────── ───
  {
    name: 'sales.update_quotation',
    labelAr: 'تعديل عرض سعر',
    descriptionAr: 'يُعدّل حقول عرض سعر موجود (الملاحظات، الحالة، تاريخ الانتهاء). استخدم sales.get_quotations أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        quotationId: { type: 'string', description: 'معرف عرض السعر (UUID)' },
        notes: { type: 'string', description: 'ملاحظات جديدة (اختياري)' },
        status: { type: 'string', enum: ['draft', 'accepted', 'rejected'], description: 'الحالة الجديدة (اختياري)' },
        validUntil: { type: 'string', description: 'تاريخ الانتهاء YYYY-MM-DD (اختياري)' },
      },
      required: ['quotationId'],
    },
    summarizeArgs: (a) => `تعديل عرض سعر ${a.quotationId}`,
    execute: async (args, ctx) => {
      const quotationId = str(args.quotationId);
      if (!quotationId) return { error: 'quotationId مطلوب — استخدم sales.get_quotations أولاً' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['draft', 'accepted', 'rejected'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو accepted أو rejected' };
        data.status = s;
      }
      if (args.validUntil !== undefined) data.validUntil = String(args.validUntil);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await salesApi.updateQuotation(quotationId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل عرض السعر' };
      return { updated: true, quotationId, ...data };
    },
  },

  // ─── ─── Sales: Delete Quotation ────────────────────────────────────── ───
  {
    name: 'sales.delete_quotation',
    labelAr: 'حذف عرض سعر',
    descriptionAr: 'يحذف عرض سعر. استخدم sales.get_quotations أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        quotationId: { type: 'string', description: 'معرف عرض السعر (UUID)' },
      },
      required: ['quotationId'],
    },
    summarizeArgs: (a) => `حذف عرض سعر: ${a.quotationId}`,
    execute: async (args, ctx) => {
      const quotationId = str(args.quotationId);
      if (!quotationId) return { error: 'quotationId مطلوب — استخدم sales.get_quotations أولاً' };
      const res = await salesApi.deleteQuotation(quotationId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف عرض السعر' };
      return { deleted: true, quotationId };
    },
  },

  // ─── ─── Sales: Update Return ───────────────────────────────────────── ───
  {
    name: 'sales.update_return',
    labelAr: 'تعديل مردود مبيعات',
    descriptionAr: 'يُعدّل حقول مردود مبيعات موجود (الملاحظات، الحالة). استخدم sales.get_returns أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        returnId: { type: 'string', description: 'معرف المردود (UUID)' },
        notes: { type: 'string', description: 'ملاحظات جديدة (اختياري)' },
        status: { type: 'string', enum: ['draft', 'cancelled'], description: 'الحالة الجديدة (draft أو cancelled)' },
      },
      required: ['returnId'],
    },
    summarizeArgs: (a) => `تعديل مردود مبيعات ${a.returnId}`,
    execute: async (args, ctx) => {
      const returnId = str(args.returnId);
      if (!returnId) return { error: 'returnId مطلوب — استخدم sales.get_returns أولاً' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (s && !['draft', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو cancelled' };
        data.status = s;
      }
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await salesApi.updateReturn(returnId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المردود' };
      return { updated: true, returnId, ...data };
    },
  },

  // ─── ─── Sales: Delete Return ───────────────────────────────────────── ───
  {
    name: 'sales.delete_return',
    labelAr: 'حذف مردود مبيعات',
    descriptionAr: 'يحذف مردود مبيعات مسودة (draft). الـ API يرفض حذف المردودات المرحلة. استخدم sales.get_returns أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        returnId: { type: 'string', description: 'معرف المردود (UUID)' },
      },
      required: ['returnId'],
    },
    summarizeArgs: (a) => `حذف مردود مبيعات: ${a.returnId}`,
    execute: async (args, ctx) => {
      const returnId = str(args.returnId);
      if (!returnId) return { error: 'returnId مطلوب — استخدم sales.get_returns أولاً' };
      const res = await salesApi.deleteReturn(returnId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المردود' };
      return { deleted: true, returnId };
    },
  },
];
