import type { ToolDefinition } from '../types';
import { posApi } from '@/modules/pos/api';
import { num, str, round2 } from './writeTools/shared';

/**
 * POS tools — shifts, Z-report, atomic checkout (4 أدوات).
 *
 * Reads stay behind pos.view; the single write (checkout_sale) is gated by
 * pos.create with a confirmation-card summary. Totals are recomputed
 * tool-side from lines (never trusted from the model) so the API's
 * server-side subtotal/payment guards see consistent numbers.
 */

function summarizeCheckout(a: Record<string, unknown>): string {
  const lines = Array.isArray(a.lines) ? a.lines.length : 0;
  const total = num(a.totalAmount ?? a.cashAmount);
  const cash = num(a.cashAmount);
  const credit = num(a.creditAmount);
  const split = credit > 0 ? ` — نقدي ${cash} + آجل ${credit}` : ' — نقدي بالكامل';
  return `بيع نقطة بيع — ${lines} أصناف — الإجمالي ${total}${split}`;
}

export const posTools: ToolDefinition[] = [
  {
    name: 'pos.get_active_shift',
    labelAr: 'الوردية المفتوحة',
    descriptionAr: 'يعيد الوردية المفتوحة حالياً للمستخدم الحالي (الكاشير) — استخدمها قبل البيع لمعرفة shiftId والصندوق.',
    permission: 'pos.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args, ctx) => {
      const res = await posApi.getActiveShift(ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل جلب الوردية المفتوحة' };
      if (!res.data) return { active: false, shift: null, note: 'لا توجد وردية مفتوحة — افتح وردية أولاً' };
      return { active: true, shift: res.data };
    },
  },

  {
    name: 'pos.get_shift_summary',
    labelAr: 'ملخص الوردية (Z)',
    descriptionAr: 'يعيد إجماليات الوردية (عدد الفواتير، الإجمالي، النقدي، الآجل، المتوقع) — أساس تقرير Z. مرر shiftId أو اتركه فارغاً لاستخدام الوردية المفتوحة.',
    permission: 'pos.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        shiftId: { type: 'string', description: 'معرف الوردية (اختياري — الافتراضي الوردية المفتوحة)' },
      },
    },
    execute: async (args, ctx) => {
      let shiftId = str(args.shiftId);
      if (!shiftId) {
        const active = await posApi.getActiveShift(ctx.companyId, ctx.userId);
        if (!active.success) return { error: active.error || 'فشل جلب الوردية المفتوحة' };
        if (!active.data) return { error: 'لا توجد وردية مفتوحة — مرر shiftId صريحاً' };
        shiftId = active.data.id;
      }
      const res = await posApi.getShiftSummary(ctx.companyId, shiftId);
      if (!res.success) return { error: res.error || 'فشل جلب ملخص الوردية' };
      return { shiftId, summary: res.data };
    },
  },

  {
    name: 'pos.list_shifts',
    labelAr: 'قائمة الورديات',
    descriptionAr: 'يسرد ورديات نقاط البيع (الأحدث أولاً) مع ترقيم صفحات.',
    permission: 'pos.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'رقم الصفحة (افتراضي 1)' },
        pageSize: { type: 'number', description: 'حجم الصفحة 1-100 (افتراضي 25)' },
      },
    },
    execute: async (args, ctx) => {
      const rawPage = args.page === undefined ? 1 : num(args.page);
      const rawSize = args.pageSize === undefined ? 25 : num(args.pageSize);
      if (!Number.isFinite(rawPage) || rawPage < 1) return { error: 'رقم الصفحة يجب أن يكون 1 أو أكثر' };
      if (!Number.isFinite(rawSize) || rawSize < 1 || rawSize > 100) return { error: 'حجم الصفحة يجب أن يكون بين 1 و 100' };
      const res = await posApi.getShiftsPaginated(ctx.companyId, Math.floor(rawPage), Math.floor(rawSize));
      if (!res.success) return { error: res.error || 'فشل جلب الورديات' };
      return { shifts: res.data?.items ?? [], total: res.data?.total ?? 0, page: res.data?.page ?? 1 };
    },
  },

  {
    name: 'pos.checkout_sale',
    labelAr: 'بيع نقطة بيع',
    descriptionAr: 'ينفذ بيع نقطة بيع ذرياً على وردية مفتوحة: فاتورة + دفعات + قيد (نقدي/آجل + COGS دائم) + مخزون. الإجماليات تُحسب من الأصناف — مرر productId (من search.products) والكمية وسعر الوحدة لكل صنف. البيع الآجل يتطلب customerId (من search.customers).',
    permission: 'pos.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        shiftId: { type: 'string', description: 'معرف الوردية المفتوحة (من pos.get_active_shift)' },
        cashBoxId: { type: 'string', description: 'معرف صندوق الكاشير (من search.cash_boxes)' },
        lines: {
          type: 'array',
          description: 'أصناف السلة — productId وسعر البيع من search.products',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'معرف المنتج' },
              quantity: { type: 'number', description: 'الكمية' },
              unitPrice: { type: 'number', description: 'سعر الوحدة' },
              discountPercent: { type: 'number', description: 'نسبة الخصم 0-100 (اختياري)' },
              vatPercent: { type: 'number', description: 'نسبة الضريبة 0-100 (اختياري)' },
            },
            required: ['productId', 'quantity', 'unitPrice'],
          },
        },
        cashAmount: { type: 'number', description: 'الجزء النقدي المحصّل الآن' },
        creditAmount: { type: 'number', description: 'الجزء الآجل على حساب العميل (يتطلب customerId)' },
        customerId: { type: 'string', description: 'معرف العميل المسجل (إلزامي للبيع الآجل)' },
        currencyCode: { type: 'string', description: 'كود العملة (3 أحرف — اختياري)' },
        notes: { type: 'string', description: 'ملاحظات الإيصال' },
      },
      required: ['shiftId', 'cashBoxId', 'lines', 'cashAmount', 'creditAmount'],
    },
    summarizeArgs: (a) => summarizeCheckout(a as Record<string, unknown>),
    execute: async (args, ctx) => {
      const shiftId = str(args.shiftId);
      const cashBoxId = str(args.cashBoxId);
      if (!shiftId) return { error: 'shiftId مطلوب — استخدم pos.get_active_shift أولاً' };
      if (!cashBoxId) return { error: 'cashBoxId مطلوب — استخدم search.cash_boxes أولاً' };

      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
      }
      interface CheckoutLine {
        productId: string;
        quantity: number;
        unitPrice: number;
        discountPercent: number;
        vatPercent: number;
        lineTotal: number;
      }
      const lines: CheckoutLine[] = [];
      for (const item of rawLines) {
        const row = item as Record<string, unknown>;
        const productId = str(row.productId);
        const quantity = num(row.quantity);
        const unitPrice = num(row.unitPrice);
        const discountPercent = num(row.discountPercent);
        const vatPercent = num(row.vatPercent);
        if (!productId) return { error: 'كل صنف يحتاج productId — استخدم search.products أولاً' };
        if (!(quantity > 0)) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
        if (!(unitPrice >= 0)) return { error: 'سعر الوحدة لا يمكن أن يكون سالباً' };
        if (discountPercent < 0 || discountPercent > 100) return { error: 'نسبة الخصم يجب أن تكون بين 0 و 100' };
        if (vatPercent < 0 || vatPercent > 100) return { error: 'نسبة الضريبة يجب أن تكون بين 0 و 100' };
        lines.push({
          productId,
          quantity,
          unitPrice,
          discountPercent,
          vatPercent,
          lineTotal: round2(quantity * unitPrice * (1 - discountPercent / 100)),
        });
      }

      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(lines.reduce((s, l) => s + (l.lineTotal * l.vatPercent) / 100, 0));
      const totalAmount = round2(subtotal + vatAmount);

      const cashAmount = num(args.cashAmount);
      const creditAmount = num(args.creditAmount);
      if (cashAmount < 0 || creditAmount < 0) return { error: 'مبلغ الدفع لا يمكن أن يكون سالباً' };
      if (cashAmount <= 0 && creditAmount <= 0) return { error: 'مبلغ الدفع مطلوب (نقدي أو آجل)' };
      if (Math.abs(cashAmount + creditAmount - totalAmount) > 0.02) {
        return { error: `النقدي (${cashAmount}) + الآجل (${creditAmount}) لا يساوي الإجمالي (${totalAmount})` };
      }
      const customerId = str(args.customerId);
      if (creditAmount > 0 && !customerId) {
        return { error: 'البيع الآجل يتطلب customerId — استخدم search.customers أولاً' };
      }
      const currencyCode = str(args.currencyCode);
      if (currencyCode && currencyCode.length !== 3) return { error: 'كود العملة يجب أن يكون 3 أحرف' };

      const res = await posApi.checkout(
        {
          companyId: ctx.companyId,
          shiftId,
          customerId: customerId ?? '',
          cashBoxId,
          lines,
          subtotal,
          discountAmount: 0,
          vatAmount,
          totalAmount,
          cashAmount,
          creditAmount,
          ...(currencyCode ? { currencyCode } : {}),
          ...(str(args.notes) ? { notes: str(args.notes) as string } : {}),
        },
        ctx.userId
      );
      if (!res.success) return { error: res.error || 'فشل البيع' };
      return {
        sold: true,
        invoiceId: res.invoiceId,
        receiptNumber: res.receiptNumber,
        totalAmount,
        cashAmount,
        creditAmount,
      };
    },
  },
];
