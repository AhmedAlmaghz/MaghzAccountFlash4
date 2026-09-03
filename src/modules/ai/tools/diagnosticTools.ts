import type { ToolDefinition } from '../types';
import { getDbAdapter } from '@/core/database/adapters';
import { guardSqlQuery } from '../security/sqlGuard';
import { localToday, localMonthStart } from '../engine/dateUtils';

/**
 * Diagnostic tools (read) — answer the accountant's real follow-up question:
 * "لماذا فشل الترحيل؟" / "أين الخلل في الدفاتر؟".
 *
 * These are the "guided diagnosis" companion to the write tools: when a post
 * fails or a report shows an imbalance, the assistant can PROVE the cause
 * with data instead of guessing — the accounting-agent behaviour the product
 * promises (اكتشاف الخطأ وإرشاد المستخدم).
 */

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateRange(from?: string, to?: string): { from: string; to: string } {
  return {
    from: typeof from === 'string' && from ? from : localMonthStart(),
    to: typeof to === 'string' && to ? to : localToday(),
  };
}

async function guardedQuery(sql: string, params: unknown[]) {
  const check = guardSqlQuery(sql);
  if (!check.ok) return { success: false, error: check.error, rows: [] };
  const adapter = await getDbAdapter();
  return adapter.query(check.sql, params);
}

export const diagnosticTools: ToolDefinition[] = [
  {
    name: 'diagnose.posting_blockers',
    labelAr: 'تشخيص معوّقات الترحيل',
    descriptionAr:
      'يفحص مستنداً معيناً (فاتورة مبيعات/مشتريات) ويحدد أسباب فشل الترحيل المحتملة: مسودة أصلًا، قائمة، رصيد خزنة غير متوفر، حساب افتراضي ناقص (المدينين/الدائنين/المبيعات/الخزنة)، أو ضريبة بلا حساب مخرجات. يعرض كل عائق مع إجراء التصحيح. استخدمه عندما يفشل ترحيل فاتورة أو قبل الترحيل للتأكد.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'معرف الفاتورة (من sales.invoices_detailed أو purchases.invoices_detailed أو أدوات البحث)' },
        invoiceType: { type: 'string', enum: ['sales', 'purchase'], description: 'نوع الفاتورة: sales (مبيعات — افتراضي) أو purchase (مشتريات)' },
      },
      required: ['invoiceId'],
    },
    execute: async (args, ctx) => {
      const invoiceId = typeof args.invoiceId === 'string' && args.invoiceId.trim() ? args.invoiceId.trim() : '';
      if (!invoiceId) return { error: 'invoiceId مطلوب — استخدم أدوات البحث أولاً للحصول على معرف الفاتورة' };
      const kind = args.invoiceType === 'purchase' ? 'purchase' : 'sales';

      const table = kind === 'sales' ? 'sales_invoices' : 'purchase_invoices';
      const partyCol = kind === 'sales' ? 'customer_id' : 'supplier_id';
      const partyTable = kind === 'sales' ? 'customers' : 'suppliers';
      const partyLabel = kind === 'sales' ? 'العميل' : 'المورد';

      const res = await guardedQuery(
        `SELECT i.id, i.invoice_number, i.status, i.total_amount, i.paid_amount,
                i.payment_type, i.cash_box_id, i.vat_amount, i.company_id,
                (SELECT ${partyTable}.name FROM ${partyTable} WHERE ${partyTable}.id = i.${partyCol}) AS party_name,
                (SELECT cb.name_ar FROM cash_boxes cb WHERE cb.id = i.cash_box_id) AS cash_box_name,
                (SELECT cb.account_id FROM cash_boxes cb WHERE cb.id = i.cash_box_id) AS cash_box_account
         FROM ${table} i
         WHERE i.id = $1::uuid AND i.company_id = $2::uuid`,
        [invoiceId, ctx.companyId],
      );
      if (!res.success) return { error: res.error || 'فشل فحص الفاتورة' };
      const inv = (res.rows || [])[0] as Record<string, unknown> | undefined;
      if (!inv) return { error: 'الفاتورة غير موجودة في هذه الشركة — تحقق من المعرف (استخدم البحث)' };

      const blockers: Array<{ issue: string; detail: string; fix: string; blocking: boolean }> = [];
      const status = String(inv.status ?? '');

      // 1. Status precondition — only drafts can post.
      if (status === 'posted') {
        blockers.push({
          issue: 'الفاتورة مرحّلة بالفعل',
          detail: `الفاتورة ${String(inv.invoice_number)} حالتها posted — لا ترحيل مزدوج في النظام.`,
          fix: 'لا شيء مطلوب. راجع القيد عبر accounting.journal_register إن أردت التأكد من الترحيل.',
          blocking: false,
        });
      } else if (status === 'cancelled') {
        blockers.push({
          issue: 'الفاتورة ملغاة',
          detail: 'المستندات الملغاة لا تُرحّل — أنشئ فاتورة بديلة بدلاً منها.',
          fix: 'أنشئ فاتورة جديدة بنفس البيانات (search + sales.create_invoice) بدل إعادة تفعيل الملغاة.',
          blocking: true,
        });
      } else if (status !== 'draft') {
        blockers.push({
          issue: `حالة غير قابلة للترحيل (${status})`,
          detail: 'الترحيل متاح من حالة draft فقط.',
          fix: 'راجع الفاتورة من الشاشة المخصصة لمعرفة سبب الحالة غير القياسية.',
          blocking: true,
        });
      }

      // 2. Cash invoice needs a cash box with a linked ledger account.
      if (String(inv.payment_type ?? 'credit') === 'cash') {
        if (!inv.cash_box_id) {
          blockers.push({
            issue: 'فاتورة نقدية بلا خزنة',
            detail: 'الفاتورة نقدية (تُقيَّد على الخزنة عند الترحيل) لكن لا cashBoxId مرتبطاً بها — الترحيل لا يعرف الحساب النقدي المقابل.',
            fix: 'عيّن خزنة للفاتورة: عدّلها من شاشة الفواتير واختر الخزنة، أو أنشئ فاتورة جديدة عبر الوكيل مع cashBoxId من search.cash_boxes.',
            blocking: true,
          });
        } else if (!inv.cash_box_account) {
          blockers.push({
            issue: 'الخزنة بلا حساب دفتري',
            detail: `الخزنة "${String(inv.cash_box_name ?? '')}" غير مرتبطة بحساب في شجرة الحسابات — لا يمكن إنشاء القيد النقدي.`,
            fix: 'اربط الخزنة بحساب (إعدادات ← النقدية والخزائن ← تعديل الخزنة ← الحساب) ثم أعد الترحيل.',
            blocking: true,
          });
        }
      }

      // 3. Company-level default accounts for the posting sides.
      const defaultsRes = await guardedQuery(
        `SELECT function_key FROM default_accounts WHERE company_id = $1::uuid`,
        [ctx.companyId],
      );
      const defaults = new Set(
        ((defaultsRes.rows || []) as Array<Record<string, unknown>>).map((r) => String(r.function_key)),
      );
      const arKey = kind === 'sales' ? 'default_ar' : 'default_ap';
      const revKey = kind === 'sales' ? 'default_sales' : 'default_inventory';
      const need: Array<[string, string]> = [
        [arKey, kind === 'sales' ? 'حساب المدينين التجاريين' : 'حساب الدائنين التجاريين'],
        [revKey, kind === 'sales' ? 'حساب المبيعات' : 'حساب المخزون'],
      ];
      if (kind === 'sales' && num(inv.vat_amount) > 0) {
        need.push(['default_vat_output', 'حساب ضريبة المخرجات']);
      }
      if (kind === 'purchase' && num(inv.vat_amount) > 0) {
        need.push(['default_vat_input', 'حساب ضريبة المدخلات']);
      }
      for (const [key, human] of need) {
        if (!defaults.has(key)) {
          blockers.push({
            issue: `${human} غير معيّن`,
            detail: `المفتاح ${key} غير موجود في الحسابات الافتراضية للشركة — قيد الترحيل يحتاجه.`,
            fix: `عيّن الحساب من شاشة الحسابات الافتراضية (أو settings.update_default_account)، ثم أعد الترحيل.`,
            blocking: true,
          });
        }
      }

      // 4. Over-payment precondition (posting computes outstanding; paid>total is data corruption).
      if (num(inv.paid_amount) > num(inv.total_amount)) {
        blockers.push({
          issue: 'المدفوع يتجاوز الإجمالي',
          detail: `paid_amount (${num(inv.paid_amount)}) أكبر من total_amount (${num(inv.total_amount)}) — بيانات غير متسقة تمنع احتساب المستحق.`,
          fix: 'راجع الفاتورة من الشاشة وصحّح المبلغ المدفوع (استخدم سندات القبض/الصرف لتسوية الفرق).',
          blocking: true,
        });
      }

      const blockingCount = blockers.filter((b) => b.blocking).length;
      return {
        invoice: {
          number: String(inv.invoice_number),
          status,
          paymentType: String(inv.payment_type ?? 'credit'),
          total: num(inv.total_amount),
          paid: num(inv.paid_amount),
          party: String(inv.party_name ?? '') || partyLabel,
        },
        canPost: status === 'draft' && blockingCount === 0,
        blockingCount,
        blockers,
        note: blockingCount === 0 && status === 'draft'
          ? 'لا توجد معوّقات — الفاتورة جاهزة للترحيل (sales.post_invoice / purchases.post_invoice).'
          : undefined,
      };
    },
  },

  {
    name: 'diagnose.unbalanced_entries',
    labelAr: 'فحص توازن القيود',
    descriptionAr:
      'يفحص توازن القيود اليومية لفترة: يجد القيود التي لا يتساوى فيها مجموع المدين مع الدائن، والقيد المرحّل بلا أطراف، ويقارن إجمالي الميزان. أداة التشخيص الأولى عند أي شك في سلامة الدفاتر أو فشل ترحيل.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري — افتراضياً بداية الشهر)' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري — افتراضياً اليوم)' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(
        typeof args.fromDate === 'string' ? args.fromDate : undefined,
        typeof args.toDate === 'string' ? args.toDate : undefined,
      );

      // Per-transaction debit/credit sums — a transaction is unbalanced when
      // the two sums differ by more than a cent.
      const res = await guardedQuery(
        `SELECT t.id, t.reference, t.description, t.date, t.status,
                COALESCE(SUM(je.debit), 0)  AS total_debit,
                COALESCE(SUM(je.credit), 0) AS total_credit,
                COUNT(je.id)::int           AS entry_count
         FROM transactions t
         LEFT JOIN journal_entries je ON je.transaction_id = t.id
         WHERE t.company_id = $1::uuid AND t.date BETWEEN $2 AND $3
         GROUP BY t.id, t.reference, t.description, t.date, t.status
         ORDER BY t.date DESC
         LIMIT 500`,
        [ctx.companyId, from, to],
      );
      if (!res.success) return { error: res.error || 'فشل فحص القيود' };

      const rows = (res.rows || []) as Array<Record<string, unknown>>;
      const unbalanced = rows
        .filter((r) => Math.abs(num(r.total_debit) - num(r.total_credit)) > 0.01)
        .map((r) => ({
          reference: String(r.reference ?? ''),
          description: String(r.description ?? ''),
          date: String(r.date ?? ''),
          status: String(r.status ?? ''),
          totalDebit: Math.round(num(r.total_debit) * 100) / 100,
          totalCredit: Math.round(num(r.total_credit) * 100) / 100,
          difference: Math.round((num(r.total_debit) - num(r.total_credit)) * 100) / 100,
        }));

      const emptyPosted = rows
        .filter((r) => String(r.status) === 'posted' && num(r.entry_count) === 0)
        .map((r) => ({
          reference: String(r.reference ?? ''),
          description: String(r.description ?? ''),
          date: String(r.date ?? ''),
        }));

      const grandDebit = Math.round(rows.reduce((s, r) => s + num(r.total_debit), 0) * 100) / 100;
      const grandCredit = Math.round(rows.reduce((s, r) => s + num(r.total_credit), 0) * 100) / 100;

      const isBalanced = unbalanced.length === 0 && emptyPosted.length === 0 && Math.abs(grandDebit - grandCredit) <= 0.01;

      return {
        period: { from, to },
        transactionCount: rows.length,
        isBalanced,
        grandDebit,
        grandCredit,
        unbalancedCount: unbalanced.length,
        unbalanced: unbalanced.slice(0, 20),
        emptyPostedCount: emptyPosted.length,
        emptyPosted: emptyPosted.slice(0, 10),
        note: isBalanced
          ? 'الدفاتر متوازنة للفترة — مجموع المدين يساوي الدائن ولا قيود مرحّلة فارغة.'
          : `وُجد ${unbalanced.length} قيداً غير متوازن و${emptyPosted.length} قيداً مرحّلاً بلا أطراف — راجع التفاصيل ثم صحّح بقيد عكسي أو معدّل.`,
      };
    },
  },
];
