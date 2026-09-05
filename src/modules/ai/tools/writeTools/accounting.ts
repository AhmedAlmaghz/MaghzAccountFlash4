import type { ToolDefinition } from '../../types';
import { getNextDocumentNumber } from '@/core/api';
import { accountingApi } from '@/modules/accounting/api';
import type { Account } from '@/modules/accounting/types';
import {
  num,
  str,
  round2,
} from './shared';
import { localToday } from '../../engine/dateUtils';

/**
 * WRITE tools — الحسابات والسندات (15 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */

function today(): string {
  // LOCAL calendar day — UTC "today" is yesterday for GMT+3 between 00:00-03:00
  return localToday();
}
export const accountingWriteTools: ToolDefinition[] = [
  // ─── ─── Accounting (vouchers) ─────────────────────────────────────────────── ───
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

  // ─── ─── Accounting Journal Entry ────────────────────────────────────────── ───
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

  // ─── ─── Accounting: Account Management ──────────────────────────────────── ───
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
    permission: 'accounting.edit',
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
    permission: 'accounting.delete',
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

  // ─── ─── Accounting: Post / Delete Journal Entry ─────────────────────────── ───
  {
    name: 'accounting.post_journal_entry',
    labelAr: 'ترحيل قيد يومي',
    descriptionAr: 'يرحّل قيداً يومياً (يغير حالته إلى posted) ليصبح نافذاً في الدفاتر.',
    permission: 'accounting.post',
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
    permission: 'accounting.delete',
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

  // ─── ─── Accounting Voucher Updates / Deletes / Posts ──────────────────── ───
  {
    name: 'accounting.update_receipt_voucher',
    labelAr: 'تعديل سند قبض',
    descriptionAr: 'يعدّل حقول سند قبض موجود (ملاحظات، المبلغ، الفاتورة المرتبطة، المبلغ المطبق، الحالة). الحالة يمكن تغييرها إلى draft أو cancelled فقط — لترحيل السند استخدم accounting.post_receipt_voucher.',
    permission: 'accounting.edit',
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
    permission: 'accounting.delete',
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
    permission: 'accounting.edit',
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
    permission: 'accounting.delete',
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
    permission: 'accounting.post',
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
    permission: 'accounting.post',
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
];
