import type { ToolDefinition } from '../types';
import { parseFlexibleNumber } from '../engine/argNormalizers';
import { localToday } from '../engine/dateUtils';
import { getDbAdapter } from '@/core/database/adapters';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { accountingApi } from '@/modules/accounting/api';
import type { Account } from '@/modules/accounting/types';
import { inventoryApi } from '@/modules/inventory/api';
import { crmApi } from '@/modules/crm/api';
import { hrApi } from '@/modules/hr/api';
import { manufacturingApi } from '@/modules/manufacturing/api';
import { coreApi } from '@/modules/core/api';
import {
  getNextDocumentNumber,
  getDocumentSequences,
  updateDocumentSequence,
  createProductType,
  updateProductType,
  deleteProductType,
  createUnit,
  updateUnit,
  deleteUnit,
  createCashBox,
  updateCashBox,
  deleteCashBox,
  createCostCenter,
  updateCostCenter,
  deleteCostCenter,
  updateDefaultAccount,
  applyDefaultTemplate,
} from '@/core/api';

/**
 * Write tools (dangerLevel: 'write') — every one of them is gated behind an
 * explicit user confirmation card in the chat before execution.
 * Document numbers are generated atomically via document_sequences; monetary
 * totals are computed here (single source of truth), not by the LLM.
 */

function num(v: unknown): number {
  // Flexible parsing: Arabic-Indic digits, thousands separators, currency words
  return parseFlexibleNumber(v) ?? 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function today(): string {
  // LOCAL calendar day — UTC "today" is yesterday for GMT+3 between 00:00-03:00
  return localToday();
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Rich confirmation summary for document tools: line count + estimated
 * pre-VAT total, so the approval card shows real substance the user can
 * verify before consenting.
 */
function summarizeDocLines(label: string, lines: unknown): string {
  const arr = Array.isArray(lines) ? (lines as Array<Record<string, unknown>>) : [];
  const total = round2(
    arr.reduce(
      (s, l) => s + (Number(l?.quantity) || 0) * (Number(l?.unitPrice) || 0) * (1 - (Number(l?.discountPercent) || 0) / 100),
      0,
    ),
  );
  const totalStr = new Intl.NumberFormat('ar-YE', { maximumFractionDigits: 2 }).format(total);
  return `${label} — ${arr.length} أصناف — الإجمالي قبل الضريبة ≈ ${totalStr} ر.ي`;
}

/** Fetch the company VAT rate (falls back to 15%). */
async function getVatRate(companyId: string): Promise<number> {
  const res = await coreApi.getVatSettings(companyId);
  const rate = res.success && res.data ? num(res.data.vatRate) : 0;
  return rate > 0 ? rate : 15;
}

interface RawLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

function parseLines(raw: unknown): RawLine[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
  const lines: RawLine[] = [];
  for (const item of raw) {
    const productId = str((item as Record<string, unknown>).productId);
    const quantity = num((item as Record<string, unknown>).quantity);
    const unitPrice = num((item as Record<string, unknown>).unitPrice);
    const discountPercent = num((item as Record<string, unknown>).discountPercent);
    if (!productId) return { error: 'كل صنف يحتاج productId — استخدم search.products لإيجاد المنتج' };
    if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
    if (unitPrice < 0) return { error: 'السعر لا يمكن أن يكون سالباً' };
    lines.push({ productId, quantity, unitPrice, discountPercent });
  }
  return lines;
}

const LINES_SCHEMA = {
  type: 'array',
  description: 'أصناف الفاتورة. احصل على productId وسعر البيع من search.products',
  items: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
      quantity: { type: 'number', description: 'الكمية' },
      unitPrice: { type: 'number', description: 'سعر الوحدة (سعر البيع من search.products)' },
      discountPercent: { type: 'number', description: 'نسبة الخصم 0-100 (اختياري)' },
    },
    required: ['productId', 'quantity', 'unitPrice'],
  },
};

export const writeTools: ToolDefinition[] = [
  // ─── Sales ───────────────────────────────────────────────────────────────
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

  // ─── Purchases ───────────────────────────────────────────────────────────
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

      const vatRate = await getVatRate(ctx.companyId);
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'purchase_invoice');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الفاتورة' };

      const lines = parsed.map((l) => {
        const lineTotal = round2(l.quantity * l.unitPrice * (1 - l.discountPercent / 100));
        return { ...l, vatPercent: vatRate, lineTotal };
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
        note: paymentType === 'cash'
          ? 'فاتورة مشتريات نقدية (مسودة) — استخدم purchases.post_invoice لترحيلها؛ سيُخصم المبلغ من الخزنة لا من ذمة المورد'
          : undefined,
      };
    },
  },

  // ─── Accounting (vouchers) ───────────────────────────────────────────────
  {
    name: 'accounting.create_receipt_voucher',
    labelAr: 'إنشاء سند قبض',
    descriptionAr: 'ينشئ سند قبض مرحّل لقبض مبلغ من عميل — يُنشأ القيد المحاسبي ويُخفَّض رصيد العميل تلقائياً. استخدم search.customers أولاً.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (من search.customers)' },
        amount: { type: 'number', description: 'المبلغ المقبوض' },
        cashBoxId: { type: 'string', description: 'معرف الخزنة (من search.cash_boxes) — يحدد حساب الخزنة التي يُرحل عليها القيد' },
        date: { type: 'string', description: 'تاريخ السند YYYY-MM-DD (افتراضي اليوم)' },
        paymentMethod: { type: 'string', enum: ['cash', 'bank', 'check'], description: 'طريقة الدفع (افتراضي cash)' },
        reference: { type: 'string', description: 'رقم السند/الحوالة الورقية إن وُجد — يُسجَّل في الملاحظات' },
        notes: { type: 'string' },
      },
      required: ['customerId', 'amount'],
    },
    summarizeArgs: (a) => `إنشاء سند قبض مرحّل بمبلغ ${a.amount} (${a.paymentMethod === 'bank' ? 'بنك' : a.paymentMethod === 'check' ? 'شيك' : 'نقداً'})`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      const amount = num(args.amount);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      if (amount <= 0) return { error: 'المبلغ يجب أن يكون أكبر من صفر' };
      const method = str(args.paymentMethod);
      if (method && !['cash', 'bank', 'check'].includes(method)) return { error: 'طريقة دفع غير صحيحة' };
      const reference = str(args.reference);
      const notesCombined = [str(args.notes), reference ? `مرجع ورقي: ${reference}` : undefined].filter(Boolean).join(' | ');

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'receipt_voucher');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم السند' };

      const cashBoxId = str(args.cashBoxId);
      const res = await accountingApi.createReceiptVoucher(
        {
          companyId: ctx.companyId,
          voucherNumber: docNumber.number,
          date: str(args.date) || today(),
          customerId,
          customerName: '',
          amount,
          amountApplied: 0,
          paymentMethod: (method as 'cash' | 'bank' | 'check') || 'cash',
          cashBoxId: cashBoxId || undefined,
          notes: notesCombined || undefined,
          status: 'posted',
        },
        ctx.userId
      );
      if (!res.success) return { error: res.error || 'فشل إنشاء السند' };
      return {
        created: true, voucherId: res.id, voucherNumber: docNumber.number, amount, status: 'posted',
        journalPosted: true, note: 'القيد المزدوج أُنشئ ورصيد العميل خُفِّض تلقائياً', ...(reference ? { reference } : {}),
      };
    },
  },
  {
    name: 'accounting.create_payment_voucher',
    labelAr: 'إنشاء سند صرف',
    descriptionAr: 'ينشئ سند صرف مرحّل لدفع مبلغ لمورد — يُنشأ القيد المحاسبي ويُحدَّث رصيد المورد تلقائياً. استخدم search.suppliers أولاً.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (من search.suppliers)' },
        amount: { type: 'number', description: 'المبلغ المدفوع' },
        cashBoxId: { type: 'string', description: 'معرف الخزنة (من search.cash_boxes) — يحدد حساب الخزنة' },
        date: { type: 'string', description: 'تاريخ السند YYYY-MM-DD (افتراضي اليوم)' },
        paymentMethod: { type: 'string', enum: ['cash', 'bank', 'check'], description: 'طريقة الدفع (افتراضي cash)' },
        reference: { type: 'string', description: 'رقم الشيك/الحوالة الورقية إن وُجد — يُسجَّل في الملاحظات' },
        notes: { type: 'string' },
      },
      required: ['supplierId', 'amount'],
    },
    summarizeArgs: (a) => `إنشاء سند صرف مرحّل بمبلغ ${a.amount} (${a.paymentMethod === 'bank' ? 'بنك' : a.paymentMethod === 'check' ? 'شيك' : 'نقداً'})`,
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      const amount = num(args.amount);
      if (!supplierId) return { error: 'supplierId مطلوب — استخدم search.suppliers أولاً' };
      if (amount <= 0) return { error: 'المبلغ يجب أن يكون أكبر من صفر' };
      const method = str(args.paymentMethod);
      if (method && !['cash', 'bank', 'check'].includes(method)) return { error: 'طريقة دفع غير صحيحة' };
      const reference = str(args.reference);
      const notesCombined = [str(args.notes), reference ? `مرجع ورقي: ${reference}` : undefined].filter(Boolean).join(' | ');

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'payment_voucher');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم السند' };

      const cashBoxId2 = str(args.cashBoxId);
      const res = await accountingApi.createPaymentVoucher(
        {
          companyId: ctx.companyId,
          voucherNumber: docNumber.number,
          date: str(args.date) || today(),
          supplierId,
          amount,
          amountApplied: 0,
          paymentMethod: (method as 'cash' | 'bank' | 'check') || 'cash',
          cashBoxId: cashBoxId2 || undefined,
          notes: notesCombined || undefined,
          status: 'posted',
        },
        ctx.userId
      );
      if (!res.success) return { error: res.error || 'فشل إنشاء السند' };
      return {
        created: true, voucherId: res.id, voucherNumber: docNumber.number, amount, status: 'posted',
        journalPosted: true, note: 'القيد المزدوج أُنشئ ورصيد المورد زاد تلقائياً', ...(reference ? { reference } : {}),
      };
    },
  },

  {
    name: 'accounting.create_expense_voucher',
    labelAr: 'سند مصروف عام',
    descriptionAr: 'ينشئ سند صرف لمصروف عام غير مرتبط بمورد — يُرحّل تلقائياً ويُنشأ القيد (مدين حساب المصروف / دائن الخزنة). استخدم search.accounts (ابحث عن مصروف) و search.cash_boxes أولاً.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        expenseAccountId: { type: 'string', description: 'معرف حساب المصروف (من search.accounts — نوع مصروف، ورقة)' },
        amount: { type: 'number', description: 'مبلغ المصروف' },
        cashBoxId: { type: 'string', description: 'معرف الخزنة (من search.cash_boxes) — تحدد الخزنة التي يُخصم منها' },
        paymentMethod: { type: 'string', enum: ['cash', 'bank', 'check'], description: 'طريقة الدفع (افتراضي cash — bank تعني حوالة/محفظة)' },
        date: { type: 'string', description: 'تاريخ السند YYYY-MM-DD (افتراضي اليوم)' },
        reference: { type: 'string', description: 'رقم المرجع الورقي إن وُجد' },
        notes: { type: 'string', description: 'بيان/ملاحظات' },
      },
      required: ['expenseAccountId', 'amount'],
    },
    summarizeArgs: (a) => `سند مصروف عام بمبلغ ${(a as Record<string, unknown>).amount} على حساب ${String((a as Record<string, unknown>).expenseAccountId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const expenseAccountId = str(args.expenseAccountId);
      const amount = num(args.amount);
      if (!expenseAccountId) return { error: 'expenseAccountId مطلوب — استخدم search.accounts (ابحث عن حساب مصروف) أولاً' };
      if (amount <= 0) return { error: 'المبلغ يجب أن يكون أكبر من صفر' };
      const method = str(args.paymentMethod);
      if (method && !['cash', 'bank', 'check'].includes(method)) return { error: 'طريقة دفع غير صحيحة' };
      const cashBoxId = str(args.cashBoxId);
      const reference = str(args.reference);
      const notesCombined = [str(args.notes), reference ? `مرجع ورقي: ${reference}` : undefined].filter(Boolean).join(' | ');

      const docNumber = await getNextDocumentNumber(ctx.companyId, 'payment_voucher');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم السند' };

      const res = await accountingApi.createPaymentVoucher(
        {
          companyId: ctx.companyId,
          voucherNumber: docNumber.number,
          date: str(args.date) || today(),
          supplierId: undefined,
          expenseAccountId,
          amount,
          amountApplied: 0,
          paymentMethod: (method as 'cash' | 'bank' | 'check') || 'cash',
          cashBoxId: cashBoxId || undefined,
          notes: notesCombined || undefined,
          status: 'posted',
        },
        ctx.userId
      );
      if (!res.success) return { error: res.error || 'فشل إنشاء سند المصروف' };
      return {
        created: true, voucherId: res.id, voucherNumber: docNumber.number, amount, expenseAccountId, status: 'posted',
        journalPosted: true, note: 'القيد أُنشئ: مدين حساب المصروف / دائن الخزنة', ...(reference ? { reference } : {}),
      };
    },
  },

  // ─── Inventory ───────────────────────────────────────────────────────────
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

  // ─── CRM ─────────────────────────────────────────────────────────────────
  {
    name: 'crm.create_lead',
    labelAr: 'إنشاء عميل محتمل',
    descriptionAr: 'ينشئ عميلاً محتملاً (lead) جديداً بالاسم وبيانات اختيارية.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل المحتمل (إلزامي)' },
        phone: { type: 'string' },
        company: { type: 'string', description: 'اسم الشركة' },
        source: { type: 'string', description: 'مصدر العميل' },
        estimatedValue: { type: 'number', description: 'القيمة المتوقعة' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء عميل محتمل: ${a.name}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'الاسم مطلوب' };
      const res = await crmApi.createLead({
        companyId: ctx.companyId,
        name,
        phone: str(args.phone),
        company: str(args.company),
        source: str(args.source),
        estimatedValue: args.estimatedValue !== undefined ? num(args.estimatedValue) : undefined,
        status: 'new',
        rating: 'warm',
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء العميل المحتمل' };
      return { created: true, leadId: res.id, name };
    },
  },
  {
    name: 'crm.create_opportunity',
    labelAr: 'إنشاء فرصة بيعية',
    descriptionAr: 'ينشئ فرصة بيعية جديدة بالاسم والقيمة، ويمكن ربطها بعميل محتمل أو عميل.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم الفرصة (إلزامي)' },
        value: { type: 'number', description: 'قيمة الفرصة' },
        leadId: { type: 'string', description: 'معرف عميل محتمل (اختياري)' },
        customerId: { type: 'string', description: 'معرف عميل (اختياري)' },
        probability: { type: 'number', description: 'نسبة النجاح 0-100 (اختياري)' },
      },
      required: ['name', 'value'],
    },
    summarizeArgs: (a) => `إنشاء فرصة بيعية: ${a.name} — القيمة: ${a.value}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم الفرصة مطلوب' };
      const res = await crmApi.createOpportunity({
        companyId: ctx.companyId,
        name,
        value: num(args.value),
        stage: 'new',
        probability: args.probability !== undefined ? num(args.probability) : undefined,
        leadId: str(args.leadId) || undefined,
        customerId: str(args.customerId) || undefined,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء الفرصة' };
      return { created: true, opportunityId: res.id, name };
    },
  },
  {
    name: 'crm.create_task',
    labelAr: 'إنشاء مهمة',
    descriptionAr: 'ينشئ مهمة جديدة بعنوان وتاريخ استحقاق وأولوية اختيارية.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان المهمة (إلزامي)' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (اختياري)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'الأولوية (افتراضي medium)' },
        description: { type: 'string' },
      },
      required: ['title'],
    },
    summarizeArgs: (a) => `إنشاء مهمة: ${a.title}${a.dueDate ? ` — تستحق ${a.dueDate}` : ''}`,
    execute: async (args, ctx) => {
      const title = str(args.title);
      if (!title) return { error: 'عنوان المهمة مطلوب' };
      const priority = str(args.priority);
      if (priority && !['low', 'medium', 'high'].includes(priority)) return { error: 'أولوية غير صحيحة' };
      const res = await crmApi.createTask({
        companyId: ctx.companyId,
        title,
        description: str(args.description),
        dueDate: str(args.dueDate),
        priority: (priority as 'low' | 'medium' | 'high') || 'medium',
        status: 'pending',
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء المهمة' };
      return { created: true, taskId: res.id, title };
    },
  },

  // ─── Sales Returns ───────────────────────────────────────────────────────
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

  // ─── Purchase Orders ────────────────────────────────────────────────────
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

  // ─── Purchase Returns ───────────────────────────────────────────────────
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

      const vatRate = await getVatRate(ctx.companyId);
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(subtotal * vatRate / 100);
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
      return { created: true, returnId: res.id, returnNumber: docNumber.number, totalAmount };
    },
  },

  // ─── Inventory Stock Adjustment ─────────────────────────────────────────
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

  // ─── Inventory Update Product ──────────────────────────────────────────
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

  // ─── Manufacturing BOM ──────────────────────────────────────────────────
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

  // ─── Manufacturing Work Orders ──────────────────────────────────────────
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

  // ─── HR Employee ────────────────────────────────────────────────────────
  {
    name: 'hr.create_employee',
    labelAr: 'إنشاء موظف',
    descriptionAr: 'ينشئ موظفاً جديداً بالاسم والراتب الأساسي وتاريخ التوظيف. استخدم search.employees أولاً للتأكد من عدم التكرار.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'الاسم الكامل (إلزامي)' },
        employeeNumber: { type: 'string', description: 'رقم الموظف (اختياري — يُولّد تلقائياً)' },
        nationalId: { type: 'string', description: 'الرقم الوطني' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string', description: 'العنوان' },
        position: { type: 'string', description: 'المسمى الوظيفي' },
        departmentId: { type: 'string', description: 'معرف القسم (اختياري — من search.departments)' },
        hireDate: { type: 'string', description: 'تاريخ التوظيف YYYY-MM-DD (إلزامي)' },
        baseSalary: { type: 'number', description: 'الراتب الأساسي (إلزامي)' },
      },
      required: ['fullName', 'hireDate', 'baseSalary'],
    },
    summarizeArgs: (a) => `إنشاء موظف: ${a.fullName} — راتب: ${a.baseSalary}`,
    execute: async (args, ctx) => {
      const fullName = str(args.fullName);
      if (!fullName) return { error: 'الاسم الكامل مطلوب' };
      const hireDate = str(args.hireDate);
      if (!hireDate) return { error: 'تاريخ التوظيف مطلوب' };
      const baseSalary = num(args.baseSalary);
      if (baseSalary <= 0) return { error: 'الراتب يجب أن يكون أكبر من صفر' };

      let empNumber = str(args.employeeNumber);
      if (!empNumber) {
        const seq = await getNextDocumentNumber(ctx.companyId, 'employee');
        if (!seq.success || !seq.number) return { error: seq.error || 'فشل توليد رقم الموظف' };
        empNumber = seq.number;
      }

      const res = await hrApi.createEmployee({
        companyId: ctx.companyId,
        employeeNumber: empNumber,
        fullName,
        nationalId: str(args.nationalId),
        phone: str(args.phone),
        email: str(args.email),
        address: str(args.address),
        departmentId: str(args.departmentId),
        position: str(args.position),
        grade: undefined,
        hireDate,
        terminationDate: undefined,
        baseSalary,
        isActive: true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء الموظف' };
      return { created: true, employeeId: res.id, fullName, employeeNumber: empNumber };
    },
  },

  // ─── Accounting Journal Entry ──────────────────────────────────────────
  {
    name: 'accounting.create_journal_entry',
    labelAr: 'إنشاء قيد يومي',
    descriptionAr: 'ينشئ قيداً يومياً محاسبياً مع أطراف مدينة ودائنة. يجب أن يتساوى مجموع المدين مع مجموع الدائن. استخدم search.accounts أولاً.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'تاريخ القيد YYYY-MM-DD (افتراضي اليوم)' },
        description: { type: 'string', description: 'وصف القيد (إلزامي)' },
        reference: { type: 'string', description: 'رقم المرجع (اختياري)' },
        entries: {
          type: 'array',
          description: 'أطراف القيد — يجب أن يتساوى مجموع الديون مع مجموع الأرصدة',
          items: {
            type: 'object',
            properties: {
              accountId: { type: 'string', description: 'معرف الحساب (من search.accounts)' },
              debit: { type: 'number', description: 'مبلغ مدين (اختياري إذا credit موجود)' },
              credit: { type: 'number', description: 'مبلغ دائن (اختياري إذا debit موجود)' },
              memo: { type: 'string', description: 'بيان (اختياري)' },
            },
            required: ['accountId'],
          },
        },
      },
      required: ['description', 'entries'],
    },
    summarizeArgs: (a) => `إنشاء قيد يومي: ${a.description} — ${Array.isArray(a.entries) ? a.entries.length : 0} أطراف`,
    execute: async (args, ctx) => {
      const description = str(args.description);
      if (!description) return { error: 'وصف القيد مطلوب' };

      const rawEntries = args.entries;
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) return { error: 'يجب تمرير طرف واحد على الأقل في entries' };

      interface Entry { accountId: string; debit: number; credit: number; memo?: string }
      const entries: Entry[] = [];
      let totalDebit = 0;
      let totalCredit = 0;

      for (const item of rawEntries) {
        const accountId = str((item as Record<string, unknown>).accountId);
        if (!accountId) return { error: 'كل entry يحتاج accountId — استخدم search.accounts أولاً' };
        const debit = num((item as Record<string, unknown>).debit);
        const credit = num((item as Record<string, unknown>).credit);
        if (debit <= 0 && credit <= 0) return { error: 'كل entry يحتاج debit أو credit أكبر من صفر' };
        totalDebit += debit;
        totalCredit += credit;
        entries.push({ accountId, debit, credit, memo: str((item as Record<string, unknown>).memo) });
      }

      if (Math.abs(totalDebit - totalCredit) > 0.01) return { error: `مجموع المدين (${round2(totalDebit)}) لا يساوي مجموع الدائن (${round2(totalCredit)})` };

      const totalAmount = round2(Math.max(totalDebit, totalCredit));

      let reference = str(args.reference);
      if (!reference) {
        const seq = await getNextDocumentNumber(ctx.companyId, 'journal_voucher');
        if (!seq.success || !seq.number) return { error: seq.error || 'فشل توليد رقم القيد' };
        reference = seq.number;
      }

      const res = await accountingApi.createTransaction({
        companyId: ctx.companyId,
        date: str(args.date) || today(),
        reference,
        description,
        totalAmount,
        status: 'posted',
        entries: entries.map((e) => ({
          id: crypto.randomUUID(),
          transactionId: '',
          accountId: e.accountId,
          debit: e.debit,
          credit: e.credit,
          memo: e.memo,
        })),
      }, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إنشاء القيد' };
      return { created: true, transactionId: res.id, description, totalAmount, entriesCount: entries.length };
    },
  },

  // ─── Accounting: Account Management ────────────────────────────────────
  {
    name: 'accounting.create_account',
    labelAr: 'إنشاء حساب',
    descriptionAr: 'ينشئ حساباً جديداً في شجرة الحسابات. استخدم search.accounts للتحقق من الكود أولاً.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'كود الحساب (إلزامي)' },
        nameAr: { type: 'string', description: 'اسم الحساب بالعربية (إلزامي)' },
        nameEn: { type: 'string', description: 'اسم الحساب بالإنجليزية' },
        parentId: { type: 'string', description: 'معرف الحساب الأب' },
        type: { type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'], description: 'نوع الحساب (افتراضي expense)' },
        nature: { type: 'string', enum: ['debit', 'credit'], description: 'طبيعة الحساب (افتراضي debit)' },
        isGroup: { type: 'boolean', description: 'هل هو حساب مجموعي؟' },
        balance: { type: 'number', description: 'الرصيد الافتتاحي' },
        isActive: { type: 'boolean', description: 'هل الحساب نشط؟ (افتراضي true)' },
      },
      required: ['code', 'nameAr'],
    },
    summarizeArgs: (a) => `إنشاء حساب ${String((a as Record<string, unknown>).code || '').slice(0, 20)}`,
    execute: async (args, ctx) => {
      const code = str(args.code);
      const nameAr = str(args.nameAr);
      if (!code || !nameAr) return { error: 'كود الحساب والاسم بالعربية إلزاميان' };
      const data: Omit<Account, 'id'> = {
        code,
        nameAr,
        nameEn: str(args.nameEn),
        parentId: str(args.parentId),
        type: str(args.type) as Account['type'] || 'expense',
        nature: str(args.nature) as Account['nature'] || 'debit',
        isGroup: Boolean(args.isGroup),
        balance: num(args.balance),
        isActive: args.isActive !== undefined ? Boolean(args.isActive) : true,
        companyId: ctx.companyId,
      };
      const res = await accountingApi.createAccount(data, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إنشاء الحساب' };
      return { created: true, accountId: res.id, code, nameAr };
    },
  },

  {
    name: 'accounting.update_account',
    labelAr: 'تعديل حساب',
    descriptionAr: 'يعدّل بيانات حساب موجود في شجرة الحسابات. الخانات الفارغة لن تُعدّل.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'معرف الحساب (إلزامي)' },
        nameAr: { type: 'string', description: 'اسم الحساب بالعربية' },
        nameEn: { type: 'string', description: 'اسم الحساب بالإنجليزية' },
        code: { type: 'string', description: 'كود الحساب' },
        parentId: { type: 'string', description: 'معرف الحساب الأب' },
        type: { type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'], description: 'نوع الحساب' },
        nature: { type: 'string', enum: ['debit', 'credit'], description: 'طبيعة الحساب' },
        isGroup: { type: 'boolean', description: 'هل هو حساب مجموعي؟' },
        isActive: { type: 'boolean', description: 'هل الحساب نشط؟' },
      },
      required: ['accountId'],
    },
    summarizeArgs: (a) => `تعديل حساب ${String((a as Record<string, unknown>).accountId || '').slice(0, 8)}`,
    execute: async (args, ctx) => {
      const accountId = str(args.accountId);
      if (!accountId) return { error: 'معرف الحساب مطلوب' };
      const data: Partial<Account> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      if (args.type !== undefined) data.type = str(args.type) as Account['type'];
      if (args.nature !== undefined) data.nature = str(args.nature) as Account['nature'];
      if (args.isGroup !== undefined) data.isGroup = Boolean(args.isGroup);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      const res = await accountingApi.updateAccount(accountId, ctx.companyId, ctx.userId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الحساب' };
      return { updated: true, accountId };
    },
  },

  {
    name: 'accounting.delete_account',
    labelAr: 'حذف حساب',
    descriptionAr: 'يحذف حساباً من شجرة الحسابات. لا يمكن حذف حساب له حركات أو أرصدة.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'معرف الحساب (إلزامي)' },
      },
      required: ['accountId'],
    },
    summarizeArgs: (a) => `حذف حساب ${String((a as Record<string, unknown>).accountId || '').slice(0, 8)}`,
    execute: async (args, ctx) => {
      const accountId = str(args.accountId);
      if (!accountId) return { error: 'معرف الحساب مطلوب' };
      const res = await accountingApi.deleteAccount(accountId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الحساب — قد يكون مرتبطاً بحركات محاسبية' };
      return { deleted: true, accountId };
    },
  },

  // ─── Accounting: Post / Delete Journal Entry ───────────────────────────
  {
    name: 'accounting.post_journal_entry',
    labelAr: 'ترحيل قيد يومي',
    descriptionAr: 'يرحّل قيداً يومياً (يغير حالته إلى posted) ليصبح نافذاً في الدفاتر.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        transactionId: { type: 'string', description: 'معرف القيد (من accounting.create_journal_entry)' },
      },
      required: ['transactionId'],
    },
    summarizeArgs: (a) => `ترحيل قيد ${String((a as Record<string, unknown>).transactionId || '').slice(0, 8)}`,
    execute: async (args, ctx) => {
      const transactionId = str(args.transactionId);
      if (!transactionId) return { error: 'معرف القيد مطلوب' };
      const res = await accountingApi.postTransaction(transactionId, ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل ترحيل القيد' };
      return { posted: true, transactionId };
    },
  },

  {
    name: 'accounting.delete_journal_entry',
    labelAr: 'حذف قيد يومي',
    descriptionAr: 'يحذف قيداً يومياً. يبحث عن معرف القيد تلقائياً إذا لم يكن متاحاً.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        transactionId: { type: 'string', description: 'معرف القيد (إلزامي)' },
      },
      required: ['transactionId'],
    },
    summarizeArgs: (a) => `حذف قيد ${String((a as Record<string, unknown>).transactionId || '').slice(0, 8)}`,
    execute: async (args, ctx) => {
      const transactionId = str(args.transactionId);
      if (!transactionId) return { error: 'معرف القيد مطلوب' };
      const res = await accountingApi.deleteTransaction(transactionId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف القيد' };
      return { deleted: true, transactionId };
    },
  },

  // ─── CRM Activity ──────────────────────────────────────────────────────
  {
    name: 'crm.create_activity',
    labelAr: 'تسجيل نشاط',
    descriptionAr: 'يسجّل نشاطاً جديداً (اتصال، بريد، اجتماع) ويمكن ربطه بعميل محتمل أو عميل.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['call', 'meeting', 'email', 'visit', 'note'], description: 'نوع النشاط (افتراضي note)' },
        subject: { type: 'string', description: 'عنوان النشاط (إلزامي)' },
        description: { type: 'string', description: 'وصف النشاط' },
        activityDate: { type: 'string', description: 'تاريخ النشاط YYYY-MM-DD (افتراضي اليوم)' },
        durationMinutes: { type: 'number', description: 'المدة بالدقائق' },
        leadId: { type: 'string', description: 'معرف العميل المحتمل (اختياري — من crm.get_leads)' },
        opportunityId: { type: 'string', description: 'معرف الفرصة البيعية (اختياري)' },
        customerId: { type: 'string', description: 'معرف العميل (اختياري — من search.customers)' },
      },
      required: ['subject'],
    },
    summarizeArgs: (a) => `تسجيل نشاط: ${a.subject} (${a.type || 'note'})${a.leadId ? ' — مرتبط بعميل محتمل' : ''}`,
    execute: async (args, ctx) => {
      const subject = str(args.subject);
      if (!subject) return { error: 'عنوان النشاط مطلوب' };
      const activityType = str(args.type) || 'note';
      if (!['call', 'meeting', 'email', 'visit', 'note'].includes(activityType)) return { error: 'نوع نشاط غير صحيح' };

      const res = await crmApi.createActivity({
        companyId: ctx.companyId,
        type: activityType as 'call' | 'meeting' | 'email' | 'visit' | 'note',
        subject,
        description: str(args.description),
        activityDate: str(args.activityDate) || today(),
        durationMinutes: args.durationMinutes !== undefined ? num(args.durationMinutes) : undefined,
        leadId: str(args.leadId),
        opportunityId: str(args.opportunityId),
        customerId: str(args.customerId),
      });
      if (!res.success) return { error: res.error || 'فشل تسجيل النشاط' };
      return { created: true, activityId: res.id, subject, type: activityType };
    },
  },

  // ─── CRM Lead Status Update ────────────────────────────────────────────
  {
    name: 'crm.update_lead_status',
    labelAr: 'تحديث حالة عميل محتمل',
    descriptionAr: 'يُحدّث حالة عميل محتمل (مثلاً إلى contacted/qualified/lost). استخدم crm.get_leads أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (من crm.get_leads)' },
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'converted', 'lost'], description: 'الحالة الجديدة' },
        rating: { type: 'string', enum: ['hot', 'warm', 'cold'], description: 'التقييم (اختياري)' },
        notes: { type: 'string', description: 'ملاحظات' },
      },
      required: ['leadId', 'status'],
    },
    summarizeArgs: (a) => `تحديث حالة عميل محتمل إلى: ${a.status}`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      const status = str(args.status);
      if (!leadId) return { error: 'leadId مطلوب' };
      if (!status || !['new', 'contacted', 'qualified', 'converted', 'lost'].includes(status)) return { error: 'حالة غير صحيحة' };
      const data: Record<string, unknown> = { status };
      const rating = str(args.rating);
      if (rating && ['hot', 'warm', 'cold'].includes(rating)) data.rating = rating;
      if (args.notes !== undefined) data.notes = str(args.notes);

      const res = await crmApi.updateLead(leadId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تحديث الحالة' };
      return { updated: true, leadId, status };
    },
  },

  // ─── CRM Opportunity Stage Update ──────────────────────────────────────
  {
    name: 'crm.update_opportunity_stage',
    labelAr: 'تحديث مرحلة فرصة بيعية',
    descriptionAr: 'يُحدّث مرحلة فرصة بيعية (مثلاً إلى won/lost/proposal). استخدم crm.get_opportunities أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (من crm.get_opportunities)' },
        stage: { type: 'string', enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], description: 'المرحلة الجديدة' },
        probability: { type: 'number', description: 'نسبة النجاح 0-100 (اختياري)' },
        notes: { type: 'string', description: 'ملاحظات' },
      },
      required: ['opportunityId', 'stage'],
    },
    summarizeArgs: (a) => `تحديث مرحلة فرصة بيعية إلى: ${a.stage}`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      const stage = str(args.stage);
      if (!opportunityId) return { error: 'opportunityId مطلوب' };
      if (!stage || !['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'].includes(stage)) return { error: 'مرحلة غير صحيحة' };
      const data: Record<string, unknown> = { stage };
      if (args.probability !== undefined) {
        const prob = num(args.probability);
        if (prob < 0 || prob > 100) return { error: 'نسبة النجاح يجب أن تكون بين 0 و 100' };
        data.probability = prob;
      }
      if (args.notes !== undefined) data.notes = str(args.notes);

      const res = await crmApi.updateOpportunity(opportunityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تحديث المرحلة' };
      return { updated: true, opportunityId, stage };
    },
  },

  // ─── CRM: Update Activity (Phase C2 — completes the CRUD triad) ────────
  {
    name: 'crm.update_activity',
    labelAr: 'تعديل نشاط',
    descriptionAr: 'يُعدّل نشاطاً مسجلاً (النوع، العنوان، الوصف، التاريخ، المدة). استخدم search.activities أولاً لإيجاد activityId.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        activityId: { type: 'string', description: 'معرف النشاط (من search.activities)' },
        type: { type: 'string', enum: ['call', 'meeting', 'email', 'visit', 'note'], description: 'نوع النشاط' },
        subject: { type: 'string', description: 'عنوان النشاط' },
        description: { type: 'string', description: 'وصف النشاط' },
        activityDate: { type: 'string', description: 'تاريخ النشاط YYYY-MM-DD' },
        durationMinutes: { type: 'number', description: 'المدة بالدقائق' },
      },
      required: ['activityId'],
    },
    summarizeArgs: (a) => `تعديل نشاط ${a.activityId}${a.subject ? `: ${a.subject}` : ''}`,
    execute: async (args, ctx) => {
      const activityId = str(args.activityId);
      if (!activityId) return { error: 'activityId مطلوب' };
      const data: Record<string, unknown> = {};
      const type = str(args.type);
      if (type) {
        if (!['call', 'meeting', 'email', 'visit', 'note'].includes(type)) return { error: 'نوع نشاط غير صحيح' };
        data.type = type;
      }
      if (args.subject !== undefined) {
        const subject = str(args.subject);
        if (!subject) return { error: 'عنوان النشاط لا يمكن أن يكون فارغاً' };
        data.subject = subject;
      }
      if (args.description !== undefined) data.description = str(args.description);
      if (args.activityDate !== undefined) data.activityDate = str(args.activityDate);
      if (args.durationMinutes !== undefined) data.durationMinutes = num(args.durationMinutes);
      if (Object.keys(data).length === 0) return { error: 'لا توجد حقول للتعديل' };

      const res = await crmApi.updateActivity(activityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل النشاط' };
      return { updated: true, activityId };
    },
  },

  // ─── CRM: Complete Task (Phase C2 — ergonomic shortcut) ────────────────
  {
    name: 'crm.complete_task',
    labelAr: 'إكمال مهمة',
    descriptionAr: 'يضع مهمة كمنجزة (status=completed). اختصار مهني لإنجاز مهام المتابعة. استخدم search.tasks أولاً لإيجاد taskId.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'معرف المهمة (من search.tasks)' },
        notes: { type: 'string', description: 'ملاحظات الإنجاز (اختياري)' },
      },
      required: ['taskId'],
    },
    summarizeArgs: (a) => `إكمال المهمة ${a.taskId}`,
    execute: async (args, ctx) => {
      const taskId = str(args.taskId);
      if (!taskId) return { error: 'taskId مطلوب' };
      const data: Record<string, unknown> = { status: 'completed' };
      if (args.notes !== undefined) data.description = str(args.notes);

      const res = await crmApi.updateTask(taskId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل إكمال المهمة' };
      return { updated: true, taskId, status: 'completed' };
    },
  },

  // ─── CRM: Win Opportunity (Phase C2 — guided close, no auto-invoice) ────
  {
    name: 'crm.win_opportunity',
    labelAr: 'الفوز بفرصة بيعية',
    descriptionAr: 'يقفل فرصة كـ won (يختم close_date واحتمالية 100%) ثم يرشد لخطوة الفاتورة. لا ينشئ فاتورة تلقائياً — اسأل المستخدم أولاً. استخدم crm.get_opportunities أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (من crm.get_opportunities)' },
        notes: { type: 'string', description: 'ملاحظات الإغلاق (اختياري)' },
      },
      required: ['opportunityId'],
    },
    summarizeArgs: (a) => `الفوز بالفرصة ${a.opportunityId} (قفل won)`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      if (!opportunityId) return { error: 'opportunityId مطلوب' };

      const data: Record<string, unknown> = { stage: 'won' };
      if (args.notes !== undefined) data.notes = str(args.notes);
      const res = await crmApi.updateOpportunity(opportunityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل إقفال الفرصة' };

      // Guidance, not automation — the invoice decision belongs to the user.
      const oppRes = await crmApi.getOpportunityById(opportunityId, ctx.companyId);
      const opp = oppRes.success ? oppRes.data : undefined;
      return {
        updated: true,
        opportunityId,
        stage: 'won',
        closeDate: opp?.closeDate,
        value: opp?.value,
        customerId: opp?.customerId,
        nextStep: 'تم الفوز بالفرصة. اسأل المستخدم: "هل تريد إنشاء فاتورة مبيعات لهذه الفرصة؟" — عند الموافقة استخدم sales.create_invoice مع customerId وقيمة الفرصة.',
      };
    },
  },

  // ─── Sales: Update Customer ─────────────────────────────────────────
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

  // ─── Sales: Post Return ─────────────────────────────────────────────
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

  // ─── Purchases: Post Invoice ────────────────────────────────────────
  {
    name: 'purchases.post_invoice',
    labelAr: 'ترحيل فاتورة مشتريات',
    descriptionAr: 'يُرحّل فاتورة مشتريات من حالة draft إلى posted. يُنشئ القيد المحاسبي تلقائياً.',
    permission: 'purchases.create',
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

  // ─── Purchases: Post Return ─────────────────────────────────────────
  {
    name: 'purchases.post_return',
    labelAr: 'ترحيل مردود مشتريات',
    descriptionAr: 'يُرحّل مردود مشتريات من حالة draft إلى posted. يُحدّث رصيد المورد والمخزون تلقائياً.',
    permission: 'purchases.create',
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

  // ─── Purchases: Update Supplier ─────────────────────────────────────
  {
    name: 'purchases.update_supplier',
    labelAr: 'تعديل مورد',
    descriptionAr: 'يُعدّل بيانات مورد موجود (الاسم، الهاتف، البريد، العنوان، الرقم الضريبي، الحالة). استخدم search.suppliers أولاً لإيجاد supplierId.',
    permission: 'purchases.create',
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

  // ─── HR: Create Payroll Run ─────────────────────────────────────────
  {
    name: 'hr.create_payroll_run',
    labelAr: 'إنشاء مسير رواتب',
    descriptionAr: 'ينشئ مسير رواتب كمسودة لشهر وسنة — النظام يحسب الأساسي والبدلات والاستقطاعات والأوفر تايم تلقائياً من بطاقات الموظفين ومكونات الرواتب وحضور الشهر، فلا ترسل قيم رواتب يدوية. فضّل hr.preview_payroll للمعاينة و hr.generate_payroll_run للإنشاء الذكي. استخدم search.employees أولاً لمعرفة الموظفين.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'الشهر (1-12)' },
        year: { type: 'number', description: 'السنة (مثال: 2026)' },
        employeeIds: {
          type: 'array',
          description: 'معرفات الموظفين (اختياري — عند حذفه يُضم كل الموظفين النشطين). احصل عليها من search.employees',
          items: { type: 'string', description: 'معرف الموظف (من search.employees)' },
        },
      },
      required: ['month', 'year'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.employeeIds) ? a.employeeIds.length : null;
      return `إنشاء مسير رواتب لشهر ${a.month}/${a.year}${count !== null ? ` — ${count} موظف` : ' — كل الموظفين النشطين'}`;
    },
    execute: async (args, ctx) => {
      const month = num(args.month);
      const year = num(args.year);
      if (month < 1 || month > 12) return { error: 'الشهر يجب أن يكون بين 1 و 12' };
      if (year < 2000 || year > 2100) return { error: 'سنة غير صحيحة' };

      // Server recomputes every line from employee cards + components +
      // attendance — only employeeId matters per line.
      const rawIds = Array.isArray(args.employeeIds) ? args.employeeIds : [];
      const employeeIds = rawIds.map((v) => str(v)).filter((v): v is string => Boolean(v));

      let lines: Array<{ employeeId: string }>;
      if (employeeIds.length > 0) {
        lines = employeeIds.map((employeeId) => ({ employeeId }));
      } else {
        // No explicit list → all active employees (mirror of previewPayrollRun scope)
        const preview = await hrApi.previewPayrollRun(ctx.companyId, month, year);
        if (!preview.success || !preview.data) return { error: preview.error || 'فشل جلب الموظفين النشطين للمسير' };
        if (preview.data.lines.length === 0) return { error: 'لا يوجد موظفون نشطون لهذه الفترة' };
        lines = preview.data.lines.map((l) => ({ employeeId: l.employeeId }));
      }
      if (lines.length === 0) return { error: 'يجب تمرير موظف واحد على الأقل في employeeIds' };

      const res = await hrApi.createPayrollRun({
        companyId: ctx.companyId,
        month,
        year,
        status: 'draft',
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء مسير الرواتب' };
      return {
        created: true,
        payrollRunId: res.id,
        month,
        year,
        employeeCount: lines.length,
        status: 'draft',
        note: 'المسير مسودة بخطوط محسوبة تلقائياً — استخدم hr.post_payroll_run للترحيل',
      };
    },
  },

  // ─── CRM: Update Lead (General) ─────────────────────────────────────
  {
    name: 'crm.update_lead',
    labelAr: 'تعديل عميل محتمل',
    descriptionAr: 'يُعدّل بيانات عميل محتمل (lead): الاسم، الهاتف، البريد، القيمة المتوقعة، الملاحظات، التقييم، الحالة، المسؤول. استخدم search.leads أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (UUID)' },
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        estimatedValue: { type: 'number' },
        notes: { type: 'string' },
        rating: { type: 'string', enum: ['hot', 'warm', 'cold'] },
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'converted', 'lost'] },
      },
      required: ['leadId'],
    },
    summarizeArgs: (a) => `تعديل عميل محتمل: ${a.leadId}`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      if (!leadId) return { error: 'leadId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.estimatedValue !== undefined) data.estimatedValue = num(args.estimatedValue);
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.rating !== undefined) data.rating = str(args.rating);
      if (args.status !== undefined) data.status = str(args.status);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await crmApi.updateLead(leadId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل العميل المحتمل' };
      return { updated: true, leadId, ...data };
    },
  },

  // ─── CRM: Update Opportunity (General) ──────────────────────────────
  {
    name: 'crm.update_opportunity',
    labelAr: 'تعديل فرصة بيعية',
    descriptionAr: 'يُعدّل بيانات فرصة بيعية (الاسم، القيمة، المرحلة، نسبة النجاح، الملاحظات، المسؤول). استخدم search.opportunities أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (UUID)' },
        name: { type: 'string' },
        value: { type: 'number' },
        stage: { type: 'string', enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] },
        probability: { type: 'number', description: 'نسبة النجاح 0-100' },
        notes: { type: 'string' },
      },
      required: ['opportunityId'],
    },
    summarizeArgs: (a) => `تعديل فرصة بيعية: ${a.opportunityId}`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      if (!opportunityId) return { error: 'opportunityId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.value !== undefined) data.value = num(args.value);
      if (args.stage !== undefined) data.stage = str(args.stage);
      if (args.probability !== undefined) {
        const prob = num(args.probability);
        if (prob < 0 || prob > 100) return { error: 'نسبة النجاح بين 0 و 100' };
        data.probability = prob;
      }
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await crmApi.updateOpportunity(opportunityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الفرصة' };
      return { updated: true, opportunityId, ...data };
    },
  },

  // ─── CRM: Update Task ───────────────────────────────────────────────
  {
    name: 'crm.update_task',
    labelAr: 'تعديل مهمة',
    descriptionAr: 'يُعدّل بيانات مهمة (title, dueDate, priority, status, assignedTo).',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'معرف المهمة (UUID)' },
        title: { type: 'string' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
        notes: { type: 'string' },
      },
      required: ['taskId'],
    },
    summarizeArgs: (a) => `تعديل مهمة: ${a.title || a.taskId}`,
    execute: async (args, ctx) => {
      const taskId = str(args.taskId);
      if (!taskId) return { error: 'taskId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.title !== undefined) data.title = str(args.title);
      if (args.dueDate !== undefined) data.dueDate = String(args.dueDate);
      if (args.priority !== undefined) data.priority = str(args.priority);
      if (args.status !== undefined) data.status = str(args.status);
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await crmApi.updateTask(taskId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المهمة' };
      return { updated: true, taskId, ...data };
    },
  },

  // ─── CRM: Delete Task ───────────────────────────────────────────────
  {
    name: 'crm.delete_task',
    labelAr: 'حذف مهمة',
    descriptionAr: 'يحذف مهمة من نظام CRM.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'معرف المهمة (UUID)' },
      },
      required: ['taskId'],
    },
    summarizeArgs: (a) => `حذف مهمة: ${a.taskId}`,
    execute: async (args, ctx) => {
      const taskId = str(args.taskId);
      if (!taskId) return { error: 'taskId مطلوب' };
      const res = await crmApi.deleteTask(taskId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المهمة' };
      return { deleted: true, taskId };
    },
  },

  // ─── Sales: Update Invoice ────────────────────────────────────────
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

  // ─── Sales: Delete Invoice ────────────────────────────────────────
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

  // ─── Sales: Update Quotation ──────────────────────────────────────
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

  // ─── Sales: Delete Quotation ──────────────────────────────────────
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

  // ─── Sales: Update Return ─────────────────────────────────────────
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

  // ─── Sales: Delete Return ─────────────────────────────────────────
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

  // ─── Inventory: Delete Product ──────────────────────────────────────
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

  // ─── Inventory: Create Warehouse ────────────────────────────────────
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

  // ─── Inventory: Update Warehouse ────────────────────────────────────
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

  // ─── Inventory: Delete Warehouse ────────────────────────────────────
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

  // ─── Inventory: Delete Stock Adjustment ─────────────────────────────
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

  // ─── Inventory: Update Stock Adjustment ──────────────────────────────
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

  // ─── Inventory: Post Stock Adjustment ────────────────────────────────
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

  // ─── Inventory: Create Stock Transfer ────────────────────────────────
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

  // ─── Inventory: Delete Stock Transfer ────────────────────────────────
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

  // ─── Inventory: Create Category ──────────────────────────────────────
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

  // ─── Inventory: Update Category ──────────────────────────────────────
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

  // ─── Inventory: Delete Category ──────────────────────────────────────
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

  // ─── Manufacturing: Update BOM ──────────────────────────────────────
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

  // ─── Manufacturing: Delete BOM ──────────────────────────────────────
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

  // ─── Manufacturing: Update Work Order ───────────────────────────────
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

  // ─── Manufacturing: Delete Work Order ───────────────────────────────
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

  // ─── Settings: Update Company ───────────────────────────────────────
  {
    name: 'settings.update_company',
    labelAr: 'تعديل بيانات الشركة',
    descriptionAr: 'يُحدّث معلومات الشركة — الاسم، الرقم الضريبي، العنوان، الهاتف، البريد الإلكتروني.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم الشركة' },
        taxId: { type: 'string', description: 'الرقم الضريبي' },
        address: { type: 'string', description: 'العنوان' },
        phone: { type: 'string', description: 'رقم الهاتف' },
        email: { type: 'string', description: 'البريد الإلكتروني' },
      },
    },
    summarizeArgs: (a) => `تعديل بيانات الشركة: ${String((a as Record<string, unknown>).name || '').slice(0, 30)}`,
    execute: async (args) => {
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.taxId !== undefined) data.taxId = str(args.taxId);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await coreApi.updateCompany(data);
      if (!res.success) return { error: res.error || 'فشل تعديل بيانات الشركة' };
      return { updated: true, ...data };
    },
  },

  // ─── Settings: Update Branch ────────────────────────────────────────
  {
    name: 'settings.update_branch',
    labelAr: 'تعديل فرع',
    descriptionAr: 'يُحدّث بيانات فرع — الاسم، العنوان، الهاتف، حالة التفعيل. استخدم settings.get_branches أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        branchId: { type: 'string', description: 'معرف الفرع (من settings.get_branches)' },
        name: { type: 'string', description: 'الاسم الجديد' },
        address: { type: 'string', description: 'العنوان الجديد' },
        phone: { type: 'string', description: 'رقم الهاتف الجديد' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['branchId'],
    },
    summarizeArgs: (a) => `تعديل فرع: ${String((a as Record<string, unknown>).branchId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const branchId = str(args.branchId);
      if (!branchId) return { error: 'branchId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await coreApi.updateBranch(branchId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الفرع' };
      return { updated: true, branchId };
    },
  },

  // ─── Settings: Get Document Sequences ────────────────────────────────
  {
    name: 'settings.get_document_sequences',
    labelAr: 'عرض تسلسلات المستندات',
    descriptionAr: 'يعرض قائمة تسلسلات المستندات (فواتير، أوامر، سندات) مع الأرقام الحالية والبادئات.',
    permission: 'settings.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    summarizeArgs: () => 'عرض تسلسلات المستندات',
    execute: async (_args, ctx) => {
      const res = await getDocumentSequences(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب تسلسلات المستندات' };
      return { sequences: res.data };
    },
  },

  // ─── Settings: Update Document Sequence ──────────────────────────────
  {
    name: 'settings.update_document_sequence',
    labelAr: 'تعديل تسلسل مستند',
    descriptionAr: 'يُحدّث تسلسل مستند — البادئة، الرقم الحالي، خطوة الترقيم، التفعيل. استخدم settings.get_document_sequences أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string', description: 'معرف التسلسل (UUID)' },
        prefix: { type: 'string', description: 'البادئة الجديدة (مثل INV-)' },
        currentNumber: { type: 'number', description: 'الرقم الحالي' },
        incrementStep: { type: 'number', description: 'خطوة الترقيم' },
        isActive: { type: 'boolean', description: 'تفعيل التسلسل' },
      },
      required: ['sequenceId'],
    },
    summarizeArgs: (a) => `تعديل تسلسل مستند: ${String((a as Record<string, unknown>).sequenceId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const sequenceId = str(args.sequenceId);
      if (!sequenceId) return { error: 'sequenceId مطلوب — استخدم settings.get_document_sequences أولاً' };
      const data: Record<string, unknown> = {};
      if (args.prefix !== undefined) data.prefix = str(args.prefix);
      if (args.currentNumber !== undefined) data.currentNumber = num(args.currentNumber);
      if (args.incrementStep !== undefined) data.incrementStep = num(args.incrementStep);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateDocumentSequence(sequenceId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل تسلسل المستند' };
      return { updated: true, sequenceId };
    },
  },

  // ─── Settings: Create Product Type ───────────────────────────────────
  {
    name: 'settings.create_product_type',
    labelAr: 'إضافة نوع منتج',
    descriptionAr: 'يُضيف نوع منتج جديد — الاسم (عربي/إنجليزي) وحالة التفعيل.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم النوع بالعربية' },
        nameEn: { type: 'string', description: 'اسم النوع بالإنجليزية' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة نوع منتج: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createProductType(data as Parameters<typeof createProductType>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة نوع المنتج' };
      return { created: true, id: res.id };
    },
  },

  // ─── Settings: Update Product Type ───────────────────────────────────
  {
    name: 'settings.update_product_type',
    labelAr: 'تعديل نوع منتج',
    descriptionAr: 'يُحدّث نوع منتج — الاسم (عربي/إنجليزي)، حالة التفعيل. استخدم settings.get_product_types أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productTypeId: { type: 'string', description: 'معرف نوع المنتج (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['productTypeId'],
    },
    summarizeArgs: (a) => `تعديل نوع منتج: ${String((a as Record<string, unknown>).productTypeId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const productTypeId = str(args.productTypeId);
      if (!productTypeId) return { error: 'productTypeId مطلوب — استخدم settings.get_product_types أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateProductType(productTypeId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل نوع المنتج' };
      return { updated: true, productTypeId };
    },
  },

  // ─── Settings: Delete Product Type ───────────────────────────────────
  {
    name: 'settings.delete_product_type',
    labelAr: 'حذف نوع منتج',
    descriptionAr: 'يحذف نوع منتج. استخدم settings.get_product_types أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productTypeId: { type: 'string', description: 'معرف نوع المنتج (UUID)' },
      },
      required: ['productTypeId'],
    },
    summarizeArgs: (a) => `حذف نوع منتج: ${a.productTypeId}`,
    execute: async (args, ctx) => {
      const productTypeId = str(args.productTypeId);
      if (!productTypeId) return { error: 'productTypeId مطلوب — استخدم settings.get_product_types أولاً' };
      const res = await deleteProductType(productTypeId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف نوع المنتج' };
      return { deleted: true, productTypeId };
    },
  },

  // ─── Settings: Create Unit ───────────────────────────────────────────
  {
    name: 'settings.create_unit',
    labelAr: 'إضافة وحدة قياس',
    descriptionAr: 'يُضيف وحدة قياس جديدة — الاسم (عربي/إنجليزي)، معامل التحويل، رمز الوحدة، وحدة أساسية.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم الوحدة بالعربية (مثل: كيلوغرام)' },
        nameEn: { type: 'string', description: 'اسم الوحدة بالإنجليزية (مثل: kg)' },
        code: { type: 'string', description: 'رمز الوحدة (مثل: كجم)' },
        conversionFactor: { type: 'number', description: 'معامل التحويل إلى الوحدة الأساسية' },
        baseUnitId: { type: 'string', description: 'معرف الوحدة الأساسية (UUID)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة وحدة قياس: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.conversionFactor !== undefined) data.conversionFactor = num(args.conversionFactor);
      if (args.baseUnitId !== undefined) data.baseUnitId = str(args.baseUnitId);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createUnit(data as Parameters<typeof createUnit>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة وحدة القياس' };
      return { created: true, id: res.id };
    },
  },

  // ─── Settings: Update Unit ───────────────────────────────────────────
  {
    name: 'settings.update_unit',
    labelAr: 'تعديل وحدة قياس',
    descriptionAr: 'يُحدّث وحدة قياس — الاسم، الرمز، معامل التحويل، التفعيل. استخدم settings.get_units أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        unitId: { type: 'string', description: 'معرف الوحدة (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        code: { type: 'string', description: 'رمز الوحدة' },
        conversionFactor: { type: 'number', description: 'معامل التحويل' },
        baseUnitId: { type: 'string', description: 'معرف الوحدة الأساسية' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['unitId'],
    },
    summarizeArgs: (a) => `تعديل وحدة قياس: ${String((a as Record<string, unknown>).unitId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const unitId = str(args.unitId);
      if (!unitId) return { error: 'unitId مطلوب — استخدم settings.get_units أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.conversionFactor !== undefined) data.conversionFactor = num(args.conversionFactor);
      if (args.baseUnitId !== undefined) data.baseUnitId = str(args.baseUnitId);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateUnit(unitId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل وحدة القياس' };
      return { updated: true, unitId };
    },
  },

  // ─── Settings: Delete Unit ───────────────────────────────────────────
  {
    name: 'settings.delete_unit',
    labelAr: 'حذف وحدة قياس',
    descriptionAr: 'يحذف وحدة قياس. استخدم settings.get_units أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        unitId: { type: 'string', description: 'معرف الوحدة (UUID)' },
      },
      required: ['unitId'],
    },
    summarizeArgs: (a) => `حذف وحدة قياس: ${a.unitId}`,
    execute: async (args, ctx) => {
      const unitId = str(args.unitId);
      if (!unitId) return { error: 'unitId مطلوب — استخدم settings.get_units أولاً' };
      const res = await deleteUnit(unitId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف وحدة القياس' };
      return { deleted: true, unitId };
    },
  },

  // ─── Settings: Create Cash Box ───────────────────────────────────────
  {
    name: 'settings.create_cash_box',
    labelAr: 'إضافة صندوق نقدي',
    descriptionAr: 'يُضيف صندوق نقدي جديد — الاسم (عربي/إنجليزي)، الرصيد الافتتاحي، وصف، حالة التفعيل.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم الصندوق بالعربية' },
        nameEn: { type: 'string', description: 'اسم الصندوق بالإنجليزية' },
        openingBalance: { type: 'number', description: 'الرصيد الافتتاحي', default: 0 },
        description: { type: 'string', description: 'وصف الصندوق' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة صندوق نقدي: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      data.openingBalance = args.openingBalance !== undefined ? num(args.openingBalance) : 0;
      if (args.description !== undefined) data.description = str(args.description);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createCashBox(data as Parameters<typeof createCashBox>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة الصندوق النقدي' };
      return { created: true, id: res.id };
    },
  },

  // ─── Settings: Update Cash Box ───────────────────────────────────────
  {
    name: 'settings.update_cash_box',
    labelAr: 'تعديل صندوق نقدي',
    descriptionAr: 'يُحدّث صندوق نقدي — الاسم، الرصيد، الوصف، التفعيل. استخدم settings.get_cash_boxes أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        cashBoxId: { type: 'string', description: 'معرف الصندوق (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        openingBalance: { type: 'number', description: 'الرصيد الافتتاحي' },
        description: { type: 'string', description: 'الوصف' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['cashBoxId'],
    },
    summarizeArgs: (a) => `تعديل صندوق نقدي: ${String((a as Record<string, unknown>).cashBoxId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const cashBoxId = str(args.cashBoxId);
      if (!cashBoxId) return { error: 'cashBoxId مطلوب — استخدم settings.get_cash_boxes أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.openingBalance !== undefined) data.openingBalance = num(args.openingBalance);
      if (args.description !== undefined) data.description = str(args.description);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateCashBox(cashBoxId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل الصندوق النقدي' };
      return { updated: true, cashBoxId };
    },
  },

  // ─── Settings: Delete Cash Box ───────────────────────────────────────
  {
    name: 'settings.delete_cash_box',
    labelAr: 'حذف صندوق نقدي',
    descriptionAr: 'يحذف صندوق نقدي. استخدم settings.get_cash_boxes أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        cashBoxId: { type: 'string', description: 'معرف الصندوق (UUID)' },
      },
      required: ['cashBoxId'],
    },
    summarizeArgs: (a) => `حذف صندوق نقدي: ${a.cashBoxId}`,
    execute: async (args, ctx) => {
      const cashBoxId = str(args.cashBoxId);
      if (!cashBoxId) return { error: 'cashBoxId مطلوب — استخدم settings.get_cash_boxes أولاً' };
      const res = await deleteCashBox(cashBoxId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الصندوق النقدي' };
      return { deleted: true, cashBoxId };
    },
  },

  // ─── Settings: Create Cost Center ────────────────────────────────────
  {
    name: 'settings.create_cost_center',
    labelAr: 'إضافة مركز تكلفة',
    descriptionAr: 'يُضيف مركز تكلفة جديد — الاسم (عربي/إنجليزي)، الكود، الوصف، مركز تكلفة أب.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم المركز بالعربية' },
        nameEn: { type: 'string', description: 'اسم المركز بالإنجليزية' },
        code: { type: 'string', description: 'كود المركز' },
        description: { type: 'string', description: 'وصف المركز' },
        parentId: { type: 'string', description: 'معرف المركز الأب (UUID — اختياري)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة مركز تكلفة: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.description !== undefined) data.description = str(args.description);
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createCostCenter(data as Parameters<typeof createCostCenter>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة مركز التكلفة' };
      return { created: true, id: res.id };
    },
  },

  // ─── Settings: Update Cost Center ────────────────────────────────────
  {
    name: 'settings.update_cost_center',
    labelAr: 'تعديل مركز تكلفة',
    descriptionAr: 'يُحدّث مركز تكلفة — الاسم، الكود، الوصف، المركز الأب، التفعيل. استخدم settings.get_cost_centers أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        costCenterId: { type: 'string', description: 'معرف المركز (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        code: { type: 'string', description: 'الكود' },
        description: { type: 'string', description: 'الوصف' },
        parentId: { type: 'string', description: 'معرف المركز الأب' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['costCenterId'],
    },
    summarizeArgs: (a) => `تعديل مركز تكلفة: ${String((a as Record<string, unknown>).costCenterId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const costCenterId = str(args.costCenterId);
      if (!costCenterId) return { error: 'costCenterId مطلوب — استخدم settings.get_cost_centers أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.description !== undefined) data.description = str(args.description);
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateCostCenter(costCenterId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل مركز التكلفة' };
      return { updated: true, costCenterId };
    },
  },

  // ─── Settings: Delete Cost Center ────────────────────────────────────
  {
    name: 'settings.delete_cost_center',
    labelAr: 'حذف مركز تكلفة',
    descriptionAr: 'يحذف مركز تكلفة. استخدم settings.get_cost_centers أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        costCenterId: { type: 'string', description: 'معرف المركز (UUID)' },
      },
      required: ['costCenterId'],
    },
    summarizeArgs: (a) => `حذف مركز تكلفة: ${a.costCenterId}`,
    execute: async (args, ctx) => {
      const costCenterId = str(args.costCenterId);
      if (!costCenterId) return { error: 'costCenterId مطلوب — استخدم settings.get_cost_centers أولاً' };
      const res = await deleteCostCenter(costCenterId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف مركز التكلفة' };
      return { deleted: true, costCenterId };
    },
  },

  // ─── Settings: Create Payroll Component ──────────────────────────────
  {
    name: 'settings.create_payroll_component',
    labelAr: 'إضافة عنصر راتب',
    descriptionAr: 'يُضيف عنصر راتب جديد — الاسم، النوع (إضافة/خصم)، طريقة الحساب، القيمة.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم العنصر بالعربية' },
        nameEn: { type: 'string', description: 'اسم العنصر بالإنجليزية' },
        type: { type: 'string', enum: ['allowance', 'deduction'], description: 'النوع: إضافة (allowance) أو خصم (deduction)' },
        calculationMethod: { type: 'string', enum: ['fixed', 'percentage'], description: 'طريقة الحساب: ثابت (fixed) أو نسبة (percentage)' },
        value: { type: 'number', description: 'القيمة (المبلغ الثابت أو النسبة المئوية)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr', 'type'],
    },
    summarizeArgs: (a) => `إضافة عنصر راتب: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const rawType = str(args.type);
      if (!rawType) return { error: 'type مطلوب — allowance أو deduction' };
      // Map legacy tool vocabulary to the payroll_components enum
      const type = rawType === 'deduction' ? 'deduction' as const : 'earning' as const;
      const res = await hrApi.createPayrollComponent({
        companyId: ctx.companyId,
        nameAr,
        nameEn: str(args.nameEn),
        type,
        calculationMethod: str(args.calculationMethod) as 'fixed' | 'percentage' | undefined,
        defaultAmount: args.value !== undefined ? num(args.value) : 0,
        isActive: args.isActive !== undefined ? Boolean(args.isActive) : true,
      }, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إضافة عنصر الراتب' };
      return { created: true, id: res.id };
    },
  },

  // ─── Settings: Update Payroll Component ──────────────────────────────
  {
    name: 'settings.update_payroll_component',
    labelAr: 'تعديل عنصر راتب',
    descriptionAr: 'يُحدّث عنصر راتب — الاسم، النوع، طريقة الحساب، القيمة، التفعيل. استخدم settings.get_payroll_components أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        componentId: { type: 'string', description: 'معرف العنصر (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        type: { type: 'string', enum: ['allowance', 'deduction'], description: 'النوع' },
        calculationMethod: { type: 'string', enum: ['fixed', 'percentage'], description: 'طريقة الحساب' },
        value: { type: 'number', description: 'القيمة' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['componentId'],
    },
    summarizeArgs: (a) => `تعديل عنصر راتب: ${String((a as Record<string, unknown>).componentId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const componentId = str(args.componentId);
      if (!componentId) return { error: 'componentId مطلوب — استخدم settings.get_payroll_components أولاً' };
      const data: Parameters<typeof hrApi.updatePayrollComponent>[2] = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.type !== undefined) {
        const rawType = str(args.type);
        data.type = rawType === 'deduction' ? 'deduction' : 'earning';
      }
      if (args.calculationMethod !== undefined) data.calculationMethod = str(args.calculationMethod) as 'fixed' | 'percentage' | 'formula';
      if (args.value !== undefined) data.defaultAmount = num(args.value);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await hrApi.updatePayrollComponent(componentId, ctx.companyId, data, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تعديل عنصر الراتب' };
      return { updated: true, componentId };
    },
  },

  // ─── Settings: Deactivate Payroll Component ──────────────────────────
  {
    name: 'settings.deactivate_payroll_component',
    labelAr: 'تعطيل عنصر راتب',
    descriptionAr: 'يعطّل عنصر راتب (بدون حذف — العناصر المرتبطة بمسيرات سابقة تبقى سليمة). لن يستخدمه محرك الرواتب في الحسابات القادمة. استخدم settings.get_payroll_components أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        componentId: { type: 'string', description: 'معرف العنصر (UUID)' },
      },
      required: ['componentId'],
    },
    summarizeArgs: (a) => `تعطيل عنصر راتب: ${String((a as Record<string, unknown>).componentId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const componentId = str(args.componentId);
      if (!componentId) return { error: 'componentId مطلوب — استخدم settings.get_payroll_components أولاً' };
      const res = await hrApi.deactivatePayrollComponent(componentId, ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تعطيل عنصر الراتب' };
      return { deactivated: true, componentId, note: 'لن يستخدمه محرك الرواتب في الحسابات القادمة — المسيرات السابقة كما هي' };
    },
  },

  // ─── Settings: Update Default Account ────────────────────────────────
  {
    name: 'settings.update_default_account',
    labelAr: 'تعديل حساب افتراضي',
    descriptionAr: 'يُحدّث الحساب الافتراضي لنوع معين — يربط حساباً أو يفصل الحساب (بإرسال null). استخدم settings.get_default_accounts أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        defaultAccountId: { type: 'string', description: 'معرف الحساب الافتراضي (UUID من settings.get_default_accounts)' },
        accountId: { type: 'string', description: 'معرف الحساب من شجرة الحسابات (UUID — أرسل null لفصل الحساب)' },
      },
      required: ['defaultAccountId', 'accountId'],
    },
    summarizeArgs: (a) => `تعديل حساب افتراضي: ${String((a as Record<string, unknown>).defaultAccountId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const defaultAccountId = str(args.defaultAccountId);
      if (!defaultAccountId) return { error: 'defaultAccountId مطلوب — استخدم settings.get_default_accounts أولاً' };
      const accountId = args.accountId && typeof args.accountId === 'string' && args.accountId.trim() ? args.accountId.trim() : null;
      const res = await updateDefaultAccount(defaultAccountId, accountId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل الحساب الافتراضي' };
      return { updated: true, defaultAccountId };
    },
  },

  // ─── Settings: Apply Default Template ──────────────────────────────────
  {
    name: 'settings.apply_default_template',
    labelAr: 'تطبيق نموذج حسابات افتراضي',
    descriptionAr: 'يطبق نموذج حسابات افتراضي على الحسابات الافتراضية للنظام. الخيارات: trading (تجاري)، manufacturing (تصنيعي)، services (خدمي). يحذّر: هذا يستبدل الحسابات الافتراضية الحالية.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          enum: ['trading', 'manufacturing', 'services'],
          description: 'نموذج الحسابات: trading (تجاري)، manufacturing (تصنيعي)، services (خدمي)',
        },
      },
      required: ['template'],
    },
    summarizeArgs: (a) => `تطبيق نموذج ${(a as Record<string, unknown>).template}`,
    execute: async (args, ctx) => {
      const template = str(args.template);
      if (!template || !['trading', 'manufacturing', 'services'].includes(template)) {
        return { error: 'template يجب أن يكون واحداً من: trading، manufacturing، services' };
      }
      const res = await applyDefaultTemplate(ctx.companyId, template as 'trading' | 'manufacturing' | 'services');
      if (!res.success) return { error: res.error || 'فشل تطبيق نموذج الحسابات' };
      return { applied: true, template };
    },
  },

  // ─── Purchases: Update Invoice ───────────────────────────────────────
  {
    name: 'purchases.update_invoice',
    labelAr: 'تعديل فاتورة مشتريات',
    descriptionAr: 'يُعدّل بيانات فاتورة مشتريات موجودة (ملاحظات، الحالة، الخصم، المبلغ المدفوع). استخدم purchases.get_invoices أولاً لإيجاد invoiceId.',
    permission: 'purchases.create',
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

  // ─── Purchases: Delete Invoice ──────────────────────────────────────
  {
    name: 'purchases.delete_invoice',
    labelAr: 'حذف فاتورة مشتريات',
    descriptionAr: 'يحذف فاتورة مشتريات في حالة draft. لا يمكن حذف فاتورة مرحلة أو مدفوعة.',
    permission: 'purchases.create',
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

  // ─── Purchases: Update Order ─────────────────────────────────────────
  {
    name: 'purchases.update_order',
    labelAr: 'تعديل أمر شراء',
    descriptionAr: 'يُعدّل بيانات أمر شراء موجود (ملاحظات، الحالة). استخدم purchases.get_purchase_orders أولاً لإيجاد orderId.',
    permission: 'purchases.create',
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

  // ─── Purchases: Delete Order ─────────────────────────────────────────
  {
    name: 'purchases.delete_order',
    labelAr: 'حذف أمر شراء',
    descriptionAr: 'يحذف أمر شراء في حالة draft.',
    permission: 'purchases.create',
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

  // ─── Purchases: Update Return ────────────────────────────────────────
  {
    name: 'purchases.update_return',
    labelAr: 'تعديل مردود مشتريات',
    descriptionAr: 'يُعدّل بيانات مردود مشتريات موجود (ملاحظات، الحالة). استخدم purchases.get_returns أولاً لإيجاد returnId.',
    permission: 'purchases.create',
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

  // ─── Purchases: Delete Return ────────────────────────────────────────
  {
    name: 'purchases.delete_return',
    labelAr: 'حذف مردود مشتريات',
    descriptionAr: 'يحذف مردود مشتريات في حالة draft.',
    permission: 'purchases.create',
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

  // ─── Purchases: Delete Supplier ──────────────────────────────────────
  {
    name: 'purchases.delete_supplier',
    labelAr: 'حذف مورد',
    descriptionAr: 'يحذف مورداً من النظام. إذا كان للمورد فواتير مرتبطة، الـ API يُرجع خطأ FK.',
    permission: 'purchases.create',
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

  // ─── Accounting Voucher Updates / Deletes / Posts ────────────────────
  {
    name: 'accounting.update_receipt_voucher',
    labelAr: 'تعديل سند قبض',
    descriptionAr: 'يعدّل حقول سند قبض موجود (ملاحظات، المبلغ، الفاتورة المرتبطة، المبلغ المطبق، الحالة). الحالة يمكن تغييرها إلى draft أو cancelled فقط — لترحيل السند استخدم accounting.post_receipt_voucher.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        voucherId: { type: 'string', description: 'معرف سند القبض (UUID)' },
        notes: { type: 'string', description: 'ملاحظات جديدة' },
        amount: { type: 'number', description: 'المبلغ الجديد' },
        status: { type: 'string', enum: ['draft', 'cancelled'], description: 'الحالة الجديدة (draft أو cancelled فقط — استخدم post للترحيل)' },
        invoiceId: { type: 'string', description: 'معرف الفاتورة المرتبطة (ربط/إلغاء ربط)' },
        amountApplied: { type: 'number', description: 'المبلغ المطبق على الفاتورة' },
      },
      required: ['voucherId'],
    },
    summarizeArgs: (a) => `تعديل سند قبض ${a.voucherId}`,
    execute: async (args, ctx) => {
      const voucherId = str(args.voucherId);
      if (!voucherId) return { error: 'voucherId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.amount !== undefined) data.amount = num(args.amount);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (!s || !['draft', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو cancelled' };
        data.status = s;
      }
      if (args.invoiceId !== undefined) data.invoiceId = str(args.invoiceId) || null;
      if (args.amountApplied !== undefined) data.amountApplied = num(args.amountApplied);
      const res = await accountingApi.updateReceiptVoucher(voucherId, ctx.companyId, ctx.userId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل سند القبض' };
      return { updated: true, voucherId };
    },
  },
  {
    name: 'accounting.delete_receipt_voucher',
    labelAr: 'حذف سند قبض',
    descriptionAr: 'يحذف سند قبض مسودة (draft). الـ API يرفض حذف السندات التي لها مبالغ مطبقة (amount_applied > 0).',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        voucherId: { type: 'string', description: 'معرف سند القبض (UUID)' },
      },
      required: ['voucherId'],
    },
    summarizeArgs: (a) => `حذف سند قبض ${a.voucherId}`,
    execute: async (args, ctx) => {
      const voucherId = str(args.voucherId);
      if (!voucherId) return { error: 'voucherId مطلوب' };
      const res = await accountingApi.deleteReceiptVoucher(voucherId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف سند القبض' };
      return { deleted: true, voucherId };
    },
  },
  {
    name: 'accounting.update_payment_voucher',
    labelAr: 'تعديل سند صرف',
    descriptionAr: 'يعدّل حقول سند صرف موجود (ملاحظات، المبلغ، الفاتورة المرتبطة، المبلغ المطبق، الحالة). الحالة يمكن تغييرها إلى draft أو cancelled فقط — لترحيل السند استخدم accounting.post_payment_voucher.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        voucherId: { type: 'string', description: 'معرف سند الصرف (UUID)' },
        notes: { type: 'string', description: 'ملاحظات جديدة' },
        amount: { type: 'number', description: 'المبلغ الجديد' },
        status: { type: 'string', enum: ['draft', 'cancelled'], description: 'الحالة الجديدة (draft أو cancelled فقط — استخدم post للترحيل)' },
        invoiceId: { type: 'string', description: 'معرف الفاتورة المرتبطة (ربط/إلغاء ربط)' },
        amountApplied: { type: 'number', description: 'المبلغ المطبق على الفاتورة' },
      },
      required: ['voucherId'],
    },
    summarizeArgs: (a) => `تعديل سند صرف ${a.voucherId}`,
    execute: async (args, ctx) => {
      const voucherId = str(args.voucherId);
      if (!voucherId) return { error: 'voucherId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.amount !== undefined) data.amount = num(args.amount);
      if (args.status !== undefined) {
        const s = str(args.status);
        if (!s || !['draft', 'cancelled'].includes(s)) return { error: 'الحالة يجب أن تكون draft أو cancelled' };
        data.status = s;
      }
      if (args.invoiceId !== undefined) data.invoiceId = str(args.invoiceId) || null;
      if (args.amountApplied !== undefined) data.amountApplied = num(args.amountApplied);
      const res = await accountingApi.updatePaymentVoucher(voucherId, ctx.companyId, ctx.userId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل سند الصرف' };
      return { updated: true, voucherId };
    },
  },
  {
    name: 'accounting.delete_payment_voucher',
    labelAr: 'حذف سند صرف',
    descriptionAr: 'يحذف سند صرف مسودة (draft). الـ API يرفض حذف السندات التي لها مبالغ مطبقة (amount_applied > 0).',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        voucherId: { type: 'string', description: 'معرف سند الصرف (UUID)' },
      },
      required: ['voucherId'],
    },
    summarizeArgs: (a) => `حذف سند صرف ${a.voucherId}`,
    execute: async (args, ctx) => {
      const voucherId = str(args.voucherId);
      if (!voucherId) return { error: 'voucherId مطلوب' };
      const res = await accountingApi.deletePaymentVoucher(voucherId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف سند الصرف' };
      return { deleted: true, voucherId };
    },
  },
  {
    name: 'accounting.post_receipt_voucher',
    labelAr: 'ترحيل سند قبض',
    descriptionAr: 'يرحّل سند قبض من حالة draft إلى posted. لا يمكن تعديل السند بعد الترحيل.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        voucherId: { type: 'string', description: 'معرف سند القبض (UUID)' },
      },
      required: ['voucherId'],
    },
    summarizeArgs: (a) => `ترحيل سند قبض ${a.voucherId}`,
    execute: async (args, ctx) => {
      const voucherId = str(args.voucherId);
      if (!voucherId) return { error: 'voucherId مطلوب' };
      const res = await accountingApi.updateReceiptVoucher(voucherId, ctx.companyId, ctx.userId, { status: 'posted' });
      if (!res.success) return { error: res.error || 'فشل ترحيل سند القبض' };
      return { posted: true, voucherId, status: 'posted' };
    },
  },
  {
    name: 'accounting.post_payment_voucher',
    labelAr: 'ترحيل سند صرف',
    descriptionAr: 'يرحّل سند صرف من حالة draft إلى posted. لا يمكن تعديل السند بعد الترحيل.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        voucherId: { type: 'string', description: 'معرف سند الصرف (UUID)' },
      },
      required: ['voucherId'],
    },
    summarizeArgs: (a) => `ترحيل سند صرف ${a.voucherId}`,
    execute: async (args, ctx) => {
      const voucherId = str(args.voucherId);
      if (!voucherId) return { error: 'voucherId مطلوب' };
      const res = await accountingApi.updatePaymentVoucher(voucherId, ctx.companyId, ctx.userId, { status: 'posted' });
      if (!res.success) return { error: res.error || 'فشل ترحيل سند الصرف' };
      return { posted: true, voucherId, status: 'posted' };
    },
  },

  // ─── CRM: Delete Lead ─────────────────────────────────────────────
  {
    name: 'crm.delete_lead',
    labelAr: 'حذف عميل محتمل',
    descriptionAr: 'يحذف عميلاً محتملاً (lead) من نظام CRM. استخدم crm.get_leads أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (من crm.get_leads)' },
      },
      required: ['leadId'],
    },
    summarizeArgs: (a) => `حذف عميل محتمل: ${String(a.leadId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      if (!leadId) return { error: 'leadId مطلوب — استخدم crm.get_leads أولاً' };
      const res = await crmApi.deleteLead(leadId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف العميل المحتمل' };
      return { deleted: true, leadId };
    },
  },

  // ─── CRM: Delete Opportunity ──────────────────────────────────────
  {
    name: 'crm.delete_opportunity',
    labelAr: 'حذف فرصة بيعية',
    descriptionAr: 'يحذف فرصة بيعية من نظام CRM. استخدم crm.get_opportunities أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (من crm.get_opportunities)' },
      },
      required: ['opportunityId'],
    },
    summarizeArgs: (a) => `حذف فرصة بيعية: ${String(a.opportunityId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      if (!opportunityId) return { error: 'opportunityId مطلوب — استخدم crm.get_opportunities أولاً' };
      const res = await crmApi.deleteOpportunity(opportunityId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الفرصة' };
      return { deleted: true, opportunityId };
    },
  },

  // ─── CRM: Delete Activity ─────────────────────────────────────────
  {
    name: 'crm.delete_activity',
    labelAr: 'حذف نشاط',
    descriptionAr: 'يحذف نشاطاً من نظام CRM. استخدم crm.get_activities أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        activityId: { type: 'string', description: 'معرف النشاط (من crm.get_activities)' },
      },
      required: ['activityId'],
    },
    summarizeArgs: (a) => `حذف نشاط: ${String(a.activityId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const activityId = str(args.activityId);
      if (!activityId) return { error: 'activityId مطلوب — استخدم crm.get_activities أولاً' };
      const res = await crmApi.deleteActivity(activityId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف النشاط' };
      return { deleted: true, activityId };
    },
  },

  // ─── CRM: Create Customer ─────────────────────────────────────────
  {
    name: 'crm.create_customer',
    labelAr: 'إنشاء عميل',
    descriptionAr: 'ينشئ عميلاً جديداً بالاسم وبيانات اختيارية (هاتف، بريد، عنوان، رقم ضريبي).',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل (إلزامي)' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        taxNumber: { type: 'string', description: 'الرقم الضريبي' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء عميل جديد: ${a.name}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم العميل مطلوب' };
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'customer');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد كود العميل' };
      const code = docNumber.number;
      const res = await salesApi.createCustomer({
        companyId: ctx.companyId,
        name,
        code,
        phone: str(args.phone),
        email: str(args.email),
        address: str(args.address),
        taxNumber: str(args.taxNumber),
        balance: 0,
        isActive: true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء العميل' };
      return { created: true, customerId: res.id, name, code };
    },
  },

  // ─── CRM: Update Customer ─────────────────────────────────────────
  {
    name: 'crm.update_customer',
    labelAr: 'تعديل عميل',
    descriptionAr: 'يُعدّل بيانات عميل موجود تحت وحدة CRM. استخدم search.customers أولاً.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        isActive: { type: 'boolean' },
      },
      required: ['customerId'],
    },
    summarizeArgs: (a) => `تعديل عميل: ${a.name || String(a.customerId).slice(0, 8)}`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await salesApi.updateCustomer(customerId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل العميل' };
      return { updated: true, customerId, ...data };
    },
  },

  // ─── CRM: Delete Customer ─────────────────────────────────────────
  {
    name: 'crm.delete_customer',
    labelAr: 'حذف عميل',
    descriptionAr: 'يحذف عميلاً (نفس sales.delete_customer). استخدم search.customers أولاً.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
      },
      required: ['customerId'],
    },
    summarizeArgs: (a) => `حذف عميل: ${String(a.customerId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const res = await salesApi.deleteCustomer(customerId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف العميل (قد يكون له فواتير مرتبطة)' };
      return { deleted: true, customerId };
    },
  },

  // ─── HR: Update Employee ──────────────────────────────────────────
  {
    name:     'hr.update_employee',
    labelAr: 'تعديل موظف',
    descriptionAr: 'يُعدّل بيانات موظف موجود (الاسم، الهاتف، البريد، القسم، المسمى الوظيفي، الراتب الأساسي، الحالة). لربط القسم استخدم departmentId من search.departments. استخدم search.employees أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees)' },
        fullName: { type: 'string', description: 'الاسم الكامل' },
        phone: { type: 'string' },
        email: { type: 'string' },
        position: { type: 'string', description: 'المسمى الوظيفي' },
        departmentId: { type: 'string', description: 'معرف القسم (من search.departments)' },
        baseSalary: { type: 'number', description: 'الراتب الأساسي الشهري' },
        isActive: { type: 'boolean', description: 'نشط/معطّل — التعطيل هو البديل الآمن للحذف' },
      },
      required: ['employeeId'],
    },
    summarizeArgs: (a) => `تعديل موظف: ${String(a.employeeId).slice(0, 8)}…${a.fullName ? ` — ${a.fullName}` : ''}${a.departmentId ? ' (ربط بقسم)' : ''}`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      const data: Record<string, unknown> = {};
      if (args.fullName !== undefined) data.fullName = str(args.fullName);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.position !== undefined) data.position = str(args.position);
      if (args.departmentId !== undefined) data.departmentId = str(args.departmentId) || undefined;
      if (args.baseSalary !== undefined) {
        const salary = num(args.baseSalary);
        if (salary <= 0) return { error: 'الراتب يجب أن يكون أكبر من صفر' };
        data.baseSalary = salary;
      }
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await hrApi.updateEmployee(employeeId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الموظف' };
      return { updated: true, employeeId, ...data };
    },
  },

  // ─── HR: Delete Employee ──────────────────────────────────────────
  {
    name: 'hr.delete_employee',
    labelAr: 'حذف موظف',
    descriptionAr: 'يحذف موظفاً من النظام — يرفض النظام حذف موظف له سجل (رواتب/إجازات/حضور) ويطلب تعطيله بدلاً من ذلك. استخدم search.employees أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees)' },
      },
      required: ['employeeId'],
    },
    summarizeArgs: (a) => `حذف موظف: ${String(a.employeeId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      const res = await hrApi.deleteEmployee(employeeId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الموظف (قد يكون له سجلات — عطّله بدلاً من ذلك)' };
      return { deleted: true, employeeId };
    },
  },

  // ─── HR: Create Leave ─────────────────────────────────────────────
  {
    name: 'hr.create_leave',
    labelAr: 'طلب إجازة',
    descriptionAr: 'ينشئ طلب إجازة لموظف بنوع الإجازة وتاريخي البداية والنهاية — النظام يحسب عدد الأيام ويرفض التداخل مع إجازة قائمة. استخدم search.employees أولاً.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
        leaveType: { type: 'string', enum: ['annual', 'sick', 'emergency', 'unpaid'], description: 'نوع الإجازة (إلزامي)' },
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (إلزامي)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (إلزامي)' },
        reason: { type: 'string', description: 'سبب الإجازة' },
      },
      required: ['employeeId', 'leaveType', 'startDate', 'endDate'],
    },
    summarizeArgs: (a) => `طلب إجازة ${a.leaveType} للموظف ${a.employeeId} من ${a.startDate} إلى ${a.endDate}`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      const leaveType = str(args.leaveType) as 'annual' | 'sick' | 'emergency' | 'unpaid' | undefined;
      const startDate = str(args.startDate);
      const endDate = str(args.endDate);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      if (!leaveType || !['annual', 'sick', 'emergency', 'unpaid'].includes(leaveType)) return { error: 'نوع إجازة غير صحيح' };
      if (!startDate) return { error: 'تاريخ البداية مطلوب' };
      if (!endDate) return { error: 'تاريخ النهاية مطلوب' };
      // Days are computed SERVER-side (overlap + reversed-range guards included)
      const res = await hrApi.createLeave({
        companyId: ctx.companyId,
        employeeId,
        leaveType,
        startDate,
        endDate,
        reason: str(args.reason),
        status: 'pending' as const,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء طلب الإجازة' };
      return { created: true, leaveId: res.id, employeeId, leaveType, startDate, endDate, days: res.days };
    },
  },

  // ─── HR: Update Leave ─────────────────────────────────────────────
  {
    name: 'hr.update_leave',
    labelAr: 'تحديث طلب إجازة',
    descriptionAr: 'يُحدّث حالة طلب إجازة (موافقة/رفض/إلغاء). قبل الموافقة تحقق من الرصيد بـ hr.get_leave_balances — النظام يرفض الاعتماد عند تجاوز الرصيد ويعرض المتبقي. استخدم search.leaves أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leaveId: { type: 'string', description: 'معرف طلب الإجازة (من search.leaves)' },
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'], description: 'الحالة الجديدة (اختياري)' },
        reason: { type: 'string', description: 'سبب التحديث (اختياري)' },
      },
      required: ['leaveId'],
    },
    summarizeArgs: (a) => `تحديث طلب إجازة: ${String(a.leaveId).slice(0, 8)}…${a.status ? ` ← ${a.status}` : ''}`,
    execute: async (args, ctx) => {
      const leaveId = str(args.leaveId);
      if (!leaveId) return { error: 'leaveId مطلوب — استخدم search.leaves أولاً' };
      const status = str(args.status) as 'pending' | 'approved' | 'rejected' | 'cancelled' | undefined;
      if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) return { error: 'حالة غير صحيحة' };
      if (!status && args.reason === undefined) return { error: 'يجب تمرير status أو reason على الأقل' };
      if (status) {
        const res = await hrApi.updateLeaveStatus(leaveId, ctx.companyId, status, ctx.userId);
        if (!res.success) return { error: res.error || 'فشل تحديث الإجازة' };
      }
      return { updated: true, leaveId, status: status || undefined };
    },
  },

  // ─── HR: Delete Leave ─────────────────────────────────────────────
  {
    name: 'hr.delete_leave',
    labelAr: 'حذف طلب إجازة',
    descriptionAr: 'يحذف طلب إجازة من النظام — الطلبات المعتمدة لا تُحذف (تُلغى عبر hr.update_leave بحالة cancelled). استخدم search.leaves أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leaveId: { type: 'string', description: 'معرف طلب الإجازة (من search.leaves)' },
      },
      required: ['leaveId'],
    },
    summarizeArgs: (a) => `حذف طلب إجازة: ${String(a.leaveId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const leaveId = str(args.leaveId);
      if (!leaveId) return { error: 'leaveId مطلوب — استخدم search.leaves أولاً' };
      const res = await hrApi.deleteLeave(leaveId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الإجازة (المعتمدة تُلغى ولا تُحذف)' };
      return { deleted: true, leaveId };
    },
  },

  // ─── HR: Post Payroll Run ─────────────────────────────────────────
  {
    name: 'hr.post_payroll_run',
    labelAr: 'ترحيل مسير رواتب',
    descriptionAr: 'يُرحّل مسير رواتب من حالة مسودة (draft) إلى مرحّلة (posted) ويُنشئ القيد المحاسبي إجمالياً تلقائياً. يرفض ترحيل غير المسودات. استخدم search.payroll_runs أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        payrollRunId: { type: 'string', description: 'معرف مسير الرواتب (من search.payroll_runs)' },
      },
      required: ['payrollRunId'],
    },
    summarizeArgs: (a) => `ترحيل مسير رواتب: ${String(a.payrollRunId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const payrollRunId = str(args.payrollRunId);
      if (!payrollRunId) return { error: 'payrollRunId مطلوب — استخدم search.payroll_runs أولاً' };
      const res = await hrApi.postPayrollRun(payrollRunId, ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل ترحيل مسير الرواتب' };
      return {
        posted: true,
        payrollRunId,
        runNumber: res.runNumber,
        note: res.runNumber ? `تم ترحيل المسير ورقمه ${res.runNumber} — حُجز القيد المحاسبي إجمالياً` : 'تم ترحيل المسير وحجز القيد المحاسبي إجمالياً',
      };
    },
  },

  // ─── HR: Create End of Service ────────────────────────────────────
  {
    name: 'hr.create_end_of_service',
    labelAr: 'إنشاء حساب نهاية خدمة',
    descriptionAr: 'ينشئ حساب نهاية خدمة لموظف بتاريخ انتهاء وسبب — النظام يحسب سنوات الخدمة والمبلغ من بطاقة الموظف تلقائياً، فلا ترسل قيماً محسوبة. استخدم search.employees أولاً و hr.preview_end_of_service للمعاينة.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
        terminationDate: { type: 'string', description: 'تاريخ الانتهاء YYYY-MM-DD (إلزامي)' },
        reason: { type: 'string', enum: ['resignation', 'termination', 'contract_end', 'retirement'], description: 'سبب إنهاء الخدمة (افتراضي resignation)' },
        notes: { type: 'string', description: 'ملاحظات (اختياري)' },
      },
      required: ['employeeId', 'terminationDate'],
    },
    summarizeArgs: (a) => `إنشاء حساب نهاية خدمة للموظف ${a.employeeId} — تاريخ: ${a.terminationDate}`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      const terminationDate = str(args.terminationDate);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      if (!terminationDate) return { error: 'تاريخ الانتهاء مطلوب' };
      const reason = (str(args.reason) || 'resignation') as 'resignation' | 'termination' | 'contract_end' | 'retirement';
      if (!['resignation', 'termination', 'contract_end', 'retirement'].includes(reason)) return { error: 'سبب إنهاء خدمة غير صحيح' };
      // Server computes serviceYears/lastSalary/eosAmount — send ONLY the raw inputs.
      const res = await hrApi.createEndOfService({
        companyId: ctx.companyId,
        employeeId,
        terminationDate,
        reason,
        status: 'draft',
        notes: str(args.notes),
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء حساب نهاية الخدمة' };
      return { created: true, endOfServiceId: res.id, employeeId, terminationDate, eosAmount: res.eosAmount, serviceYears: res.serviceYears };
    },
  },

  // ─── HR: Delete End of Service ────────────────────────────────────
  {
    name: 'hr.delete_end_of_service',
    labelAr: 'حذف حساب نهاية خدمة',
    descriptionAr: 'يحذف حساب نهاية خدمة (المسودات فقط). استخدم search.end_of_services أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        endOfServiceId: { type: 'string', description: 'معرف حساب نهاية الخدمة (من search.end_of_services)' },
      },
      required: ['endOfServiceId'],
    },
    summarizeArgs: (a) => `حذف حساب نهاية خدمة: ${String(a.endOfServiceId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const endOfServiceId = str(args.endOfServiceId);
      if (!endOfServiceId) return { error: 'endOfServiceId مطلوب — استخدم search.end_of_services أولاً' };
      const res = await hrApi.deleteEndOfService(endOfServiceId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف حساب نهاية الخدمة' };
      return { deleted: true, endOfServiceId };
    },
  },
  // ─── HR: Update End of Service Status ──────────────────────────────
  {
    name: 'hr.update_end_of_service_status',
    labelAr: 'تحديث حالة نهاية خدمة',
    descriptionAr: 'يغيّر حالة حساب نهاية خدمة (draft → approved يُنشئ قيد الاستحقاق، أو cancelled). الدفع لا يتم هنا — استخدم hr.pay_end_of_service مع خزنة من search.cash_boxes. استخدم search.end_of_services أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        endOfServiceId: { type: 'string', description: 'معرف حساب نهاية الخدمة (من search.end_of_services)' },
        status: { type: 'string', enum: ['draft', 'approved', 'cancelled'], description: 'الحالة الجديدة (الدفع عبر hr.pay_end_of_service)' },
      },
      required: ['endOfServiceId', 'status'],
    },
    summarizeArgs: (a) => `تحديث حالة نهاية خدمة إلى: ${a.status}`,
    execute: async (args, ctx) => {
      const endOfServiceId = str(args.endOfServiceId);
      const status = str(args.status) as 'draft' | 'approved' | 'cancelled';
      if (!endOfServiceId) return { error: 'endOfServiceId مطلوب — استخدم search.end_of_services أولاً' };
      if (!status || !['draft', 'approved', 'cancelled'].includes(status)) return { error: 'حالة غير صحيحة — الدفع يتم عبر hr.pay_end_of_service' };
      const res = await hrApi.updateEndOfServiceStatus(endOfServiceId, ctx.companyId, status, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تحديث الحالة' };
      return { updated: true, endOfServiceId, status };
    },
  },
];
