import type { ToolDefinition } from '../types';
import { getDbAdapter } from '@/core/database/adapters';
import { guardSqlQuery } from '../security/sqlGuard';
import { accountingApi } from '@/modules/accounting/api';
import { accountingService } from '@/modules/accounting/services';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { hrApi } from '@/modules/hr/api';
import { manufacturingApi } from '@/modules/manufacturing/api';

const EMPTY_PARAMS: Record<string, unknown> = { type: 'object', properties: {} };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
}

function dateRange(from?: string, to?: string): { from: string; to: string } {
  const now = new Date();
  return {
    from: typeof from === 'string' && from ? from : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
    to: typeof to === 'string' && to ? to : now.toISOString().split('T')[0],
  };
}

// Run every SQL statement through the allow-list guard before hitting the DB.
// Returns an object with `success/error`, plus `rows` on success, so it can
// drop in place of the existing `res = guardedQuery(...)` pattern.
async function guardedQuery(sql: string, params: unknown[]) {
  const check = guardSqlQuery(sql);
  if (!check.ok) return { success: false, error: check.error, rows: [] };
  const adapter = await getDbAdapter();
  return adapter.query(check.sql, params);
}

// ─── Helper: aggregate invoice/line data for revenue/analysis ──────────────
async function fetchInvoiceAnalysis(companyId: string, from: string, to: string) {
  
  const res = await guardedQuery(`
    SELECT
      i.id, i.invoice_number, i.date, i.total_amount, i.paid_amount, i.status,
      i.currency_code, i.exchange_rate, i.base_currency_amount,
      c.name AS customer_name, c.id AS customer_id,
      COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0) AS outstanding
    FROM sales_invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.company_id = $1::uuid
      AND i.date BETWEEN $2 AND $3
      AND i.status != 'cancelled'
    ORDER BY i.date DESC
  `, [companyId, from, to]);
  if (!res.success) return null;

  const rows = res.rows || [];
  const totalRevenue = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.total_amount), 0);
  const totalPaid = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.paid_amount), 0);
  const totalOutstanding = totalRevenue - totalPaid;
  const count = rows.length;
  const avgInvoice = count > 0 ? totalRevenue / count : 0;

  // Currency breakdown (base equivalent)
  const currencyMap = new Map<string, { amount: number; baseAmount: number; count: number }>();
  for (const r of rows) {
    const code = String(r.currency_code || 'YER');
    const entry = currencyMap.get(code) || { amount: 0, baseAmount: 0, count: 0 };
    entry.amount += num(r.total_amount);
    entry.baseAmount += num(r.base_currency_amount || r.total_amount);
    entry.count += 1;
    currencyMap.set(code, entry);
  }
  const currencies = Array.from(currencyMap.entries()).map(([code, d]) => ({
    currency: code, amount: Math.round(d.amount * 100) / 100,
    baseEquivalent: Math.round(d.baseAmount * 100) / 100, count: d.count,
  }));

  // Top customers by revenue
  const custMap = new Map<string, { name: string; revenue: number; count: number }>();
  for (const r of rows) {
    const cid = String(r.customer_id || '');
    if (!cid) continue;
    const entry = custMap.get(cid) || { name: String(r.customer_name || ''), revenue: 0, count: 0 };
    entry.revenue += num(r.total_amount);
    entry.count += 1;
    custMap.set(cid, entry);
  }
  const topCustomers = Array.from(custMap.entries())
    .map(([, d]) => d)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Monthly trend
  const monthMap = new Map<string, number>();
  for (const r of rows) {
    const m = String(r.date || '').substring(0, 7);
    if (m) monthMap.set(m, (monthMap.get(m) || 0) + num(r.total_amount));
  }
  const monthlyTrend = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }));

  return {
    count, totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    avgInvoice: Math.round(avgInvoice * 100) / 100,
    currencies, topCustomers, monthlyTrend,
  };
}

export const reportTools: ToolDefinition[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // المحاسبة — Accounting Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'accounting.trial_balance',
    labelAr: 'ميزان المراجعة',
    descriptionAr: 'يعرض ميزان المراجعة لكافة الحسابات حتى تاريخ معين: دين، دائن، ورصيد لكل حساب.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        asOfDate: { type: 'string', description: 'تاريخ حتى (YYYY-MM-DD، اختياري — افتراضياً حتى اليوم)' },
      },
    },
    execute: async (args, _ctx) => {
      // Use service layer instead of direct API for better business logic enforcement
      const res = await accountingService.getTrialBalance(typeof args.asOfDate === 'string' ? args.asOfDate : undefined);
      if (!res.success || !res.data) return { error: 'فشل جلب ميزان المراجعة' };
      const totalDebit = res.data.reduce((s: number, r: Record<string, unknown>) => s + num(r.debit), 0);
      const totalCredit = res.data.reduce((s: number, r: Record<string, unknown>) => s + num(r.credit), 0);
      return {
        accountCount: res.data.length,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
        accounts: res.data.slice(0, 100).map((a: Record<string, unknown>) => ({
          code: String(a.code), name: String(a.account_name),
          debit: num(a.debit), credit: num(a.credit), balance: num(a.balance),
        })),
        note: res.data.length > 100 ? `أول 100 حساب من ${res.data.length}` : undefined,
      };
    },
  },

  {
    name: 'accounting.balance_sheet',
    labelAr: 'الميزانية العمومية',
    descriptionAr: 'يعرض الميزانية العمومية: الأصول، الخصوم، وحقوق الملكية حتى تاريخ معين مع إجمالي كل فئة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        asOfDate: { type: 'string', description: 'تاريخ حتى (YYYY-MM-DD، اختياري)' },
      },
    },
    execute: async (args, _ctx) => {
      // Use service layer instead of direct API for better business logic enforcement
      const res = await accountingService.getBalanceSheet(typeof args.asOfDate === 'string' ? args.asOfDate : undefined);
      if (!res.success || !res.data) return { error: 'فشل جلب الميزانية' };
      const assets = res.data.filter((a: Record<string, unknown>) => a.type === 'asset').map((a: Record<string, unknown>) => ({ code: String(a.code), name: String(a.name_ar), balance: num(a.balance) }));
      const liabilities = res.data.filter((a: Record<string, unknown>) => a.type === 'liability').map((a: Record<string, unknown>) => ({ code: String(a.code), name: String(a.name_ar), balance: num(a.balance) }));
      const equity = res.data.filter((a: Record<string, unknown>) => a.type === 'equity').map((a: Record<string, unknown>) => ({ code: String(a.code), name: String(a.name_ar), balance: num(a.balance) }));
      return {
        totalAssets: Math.round(assets.reduce((s, a) => s + a.balance, 0) * 100) / 100,
        totalLiabilities: Math.round(liabilities.reduce((s, a) => s + a.balance, 0) * 100) / 100,
        totalEquity: Math.round(equity.reduce((s, a) => s + a.balance, 0) * 100) / 100,
        isBalanced: Math.abs(assets.reduce((s, a) => s + a.balance, 0) - liabilities.reduce((s, a) => s + a.balance, 0) - equity.reduce((s, a) => s + a.balance, 0)) < 0.01,
        assetCount: assets.length, liabilityCount: liabilities.length, equityCount: equity.length,
        assets: assets.slice(0, 50), liabilities: liabilities.slice(0, 50), equity: equity.slice(0, 50),
      };
    },
  },

  {
    name: 'accounting.profit_loss',
    labelAr: 'قائمة الأرباح والخسائر',
    descriptionAr: 'يعرض قائمة الدخل (الأرباح والخسائر) لفترة محددة: الإيرادات، المصروفات، وصافي الربح مع المقارنة بالفترة السابقة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري)' },
      },
    },
    execute: async (args, _ctx) => {
      const { from, to } = dateRange(args.startDate as string | undefined, args.endDate as string | undefined);
      // Use service layer instead of direct API for better business logic enforcement
      const res = await accountingService.getProfitLoss(from, to);
      if (!res.success || !res.data) return { error: 'فشل جلب قائمة الدخل' };

      const revenues = res.data.filter((a: Record<string, unknown>) => a.type === 'revenue');
      const expenses = res.data.filter((a: Record<string, unknown>) => a.type === 'expense');
      const totalRevenue = revenues.reduce((s: number, a: Record<string, unknown>) => s + num(a.balance), 0);
      const totalExpenses = expenses.reduce((s: number, a: Record<string, unknown>) => s + num(a.balance), 0);

      // Previous period for comparison (same length, prior period)
      const daysDiff = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 86400);
      const prevTo = new Date(from);
      prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setDate(prevFrom.getDate() - Math.max(Math.round(daysDiff), 1));
      const prevRes = await accountingService.getProfitLoss(
        prevFrom.toISOString().split('T')[0], prevTo.toISOString().split('T')[0]);

      let prevRevenue = 0;
      let prevExpenses = 0;
      if (prevRes.success && prevRes.data) {
        prevRevenue = prevRes.data.filter((a: Record<string, unknown>) => a.type === 'revenue').reduce((s: number, a: Record<string, unknown>) => s + num(a.balance), 0);
        prevExpenses = prevRes.data.filter((a: Record<string, unknown>) => a.type === 'expense').reduce((s: number, a: Record<string, unknown>) => s + num(a.balance), 0);
      }

      return {
        period: { from, to },
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
        revenueChange: prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 10000) / 100 : undefined,
        expenseChange: prevExpenses > 0 ? Math.round(((totalExpenses - prevExpenses) / prevExpenses) * 10000) / 100 : undefined,
        revenueCount: revenues.length, expenseCount: expenses.length,
        revenues: revenues.slice(0, 50).map(a => ({ code: a.code, name: a.nameAr, amount: a.balance })),
        expenses: expenses.slice(0, 50).map(a => ({ code: a.code, name: a.nameAr, amount: a.balance })),
      };
    },
  },

  {
    name: 'accounting.account_ledger',
    labelAr: 'كشف حساب',
    descriptionAr: 'يعرض كشف حساب لحساب معين مع الرصيد الجاري — لكل حركة: التاريخ، البيان، دين، دائن، الرصيد.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'معرف الحساب (مطلوب)' },
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const accountId = typeof args.accountId === 'string' && args.accountId ? args.accountId : '';
      if (!accountId) return { error: 'معرف الحساب مطلوب' };
      const res = await accountingApi.getAccountLedger(accountId, ctx.companyId,
        typeof args.startDate === 'string' ? args.startDate : undefined,
        typeof args.endDate === 'string' ? args.endDate : undefined);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب كشف الحساب' };
      const totalDebit = res.data.reduce((s, r) => s + r.debit, 0);
      const totalCredit = res.data.reduce((s, r) => s + r.credit, 0);
      return {
        entryCount: res.data.length,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        closingBalance: res.data.length > 0 ? res.data[res.data.length - 1].balance : 0,
        entries: res.data.slice(0, 200).map(e => ({
          date: e.date, reference: e.reference, description: e.description,
          debit: e.debit, credit: e.credit, balance: e.balance,
        })),
        note: res.data.length > 200 ? `أول 200 حركة من ${res.data.length}` : undefined,
      };
    },
  },

  {
    name: 'accounting.journal_register',
    labelAr: 'سجل القيود اليومية',
    descriptionAr: 'يعرض سجل القيود اليومية (دفتر اليومية) لفترة زمنية مع تفاصيل الحسابات المدينة والدائنة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري)' },
        status: { type: 'string', enum: ['draft', 'posted', 'cancelled'], description: 'تصفية حسب الحالة (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.startDate as string | undefined, args.endDate as string | undefined);
      
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;

      let sql = `
        SELECT t.id, t.date, t.reference, t.description, t.total_amount, t.status,
               t.created_at, u.full_name AS created_by_name
        FROM transactions t
        LEFT JOIN users u ON t.created_by = u.id
        WHERE t.company_id = $1::uuid AND t.date BETWEEN $2 AND $3
      `;
      const params: unknown[] = [ctx.companyId, from, to];
      if (status) { params.push(status); sql += ` AND t.status = $${params.length}`; }
      sql += ' ORDER BY t.date ASC, t.created_at ASC LIMIT 200';

      const res = await guardedQuery(sql, params);
      if (!res.success) return { error: res.error || 'فشل جلب سجل القيود' };
      const rows = res.rows || [];

      // Fetch entries for all transactions
      const txIds = rows.map((r: Record<string, unknown>) => r.id).filter(Boolean);
      let entries: Record<string, unknown>[] = [];
      if (txIds.length > 0) {
        const placeholders = txIds.map((_, i) => `$${i + 1}::uuid`).join(',');
        const eRes = await guardedQuery(
          `SELECT je.transaction_id, a.code AS account_code, a.name_ar AS account_name,
                  je.debit, je.credit
           FROM journal_entries je
           LEFT JOIN accounts a ON je.account_id = a.id
           WHERE je.transaction_id IN (${placeholders})
           ORDER BY je.transaction_id`,
          txIds
        );
        if (eRes.success) entries = eRes.rows || [];
      }
      const entryMap = new Map<string, { code: string; name: string; debit: number; credit: number }[]>();
      for (const e of entries) {
        const tid = String(e.transaction_id || '');
        if (!tid) continue;
        const list = entryMap.get(tid) || [];
        list.push({
          code: String(e.account_code || ''), name: String(e.account_name || ''),
          debit: num(e.debit), credit: num(e.credit),
        });
        entryMap.set(tid, list);
      }

      const transactions = rows.map((r: Record<string, unknown>) => ({
        id: r.id, date: r.date, reference: r.reference, description: r.description,
        totalAmount: num(r.total_amount), status: r.status,
        createdBy: r.created_by_name || '',
        entries: entryMap.get(String(r.id || '')) || [],
      }));

      return {
        period: { from, to },
        count: transactions.length,
        totalAmount: Math.round(transactions.reduce((s, t) => s + t.totalAmount, 0) * 100) / 100,
        transactions,
      };
    },
  },

  {
    name: 'accounting.cash_flow',
    labelAr: 'قائمة التدفقات النقدية',
    descriptionAr: 'يعرض قائمة التدفقات النقدية لفترة: التدفقات الداخلة (المبيعات، سندات القبض) والخارجة (المشتريات، سندات الصرف).',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.startDate as string | undefined, args.endDate as string | undefined);
      

      const [salesRes, purchasesRes, receiptsRes, paymentsRes] = await Promise.all([
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS total FROM sales_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'`, [ctx.companyId, from, to]),
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS total FROM purchase_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'`, [ctx.companyId, from, to]),
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS total FROM receipt_vouchers WHERE company_id = $1::uuid AND created_at::date BETWEEN $2 AND $3 AND status = 'posted'`, [ctx.companyId, from, to]),
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS total FROM payment_vouchers WHERE company_id = $1::uuid AND created_at::date BETWEEN $2 AND $3 AND status = 'posted'`, [ctx.companyId, from, to]),
      ]);

      const salesIn = num(salesRes.rows?.[0]?.total || 0);
      const purchasesOut = num(purchasesRes.rows?.[0]?.total || 0);
      const receiptsIn = num(receiptsRes.rows?.[0]?.total || 0);
      const paymentsOut = num(paymentsRes.rows?.[0]?.total || 0);

      return {
        period: { from, to },
        cashInflows: {
          salesInvoices: Math.round(salesIn * 100) / 100,
          receiptVouchers: Math.round(receiptsIn * 100) / 100,
          total: Math.round((salesIn + receiptsIn) * 100) / 100,
        },
        cashOutflows: {
          purchaseInvoices: Math.round(purchasesOut * 100) / 100,
          paymentVouchers: Math.round(paymentsOut * 100) / 100,
          total: Math.round((purchasesOut + paymentsOut) * 100) / 100,
        },
        netCashFlow: Math.round((salesIn + receiptsIn - purchasesOut - paymentsOut) * 100) / 100,
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // المبيعات — Sales Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'sales.revenue_analysis',
    labelAr: 'تحليل الإيرادات',
    descriptionAr: 'تحليل مفصل للإيرادات لفترة زمنية: إجمالي المبيعات، المدفوع، المستحق، أفضل العملاء، الاتجاه الشهري، توزيع العملات.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      const data = await fetchInvoiceAnalysis(ctx.companyId, from, to);
      if (!data) return { error: 'فشل تحليل الإيرادات' };
      return data;
    },
  },

  {
    name: 'sales.customer_statement',
    labelAr: 'كشف حساب عميل',
    descriptionAr: 'يعرض كشف حساب مفصل لعميل معين: الفواتير، سندات القبض، والرصيد المستحق مع تفصيل الأعمار.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (مطلوب)' },
      },
    },
    execute: async (args, ctx) => {
      const customerId = typeof args.customerId === 'string' && args.customerId ? args.customerId : '';
      if (!customerId) return { error: 'معرف العميل مطلوب' };

      const [stmtRes, agingRes] = await Promise.all([
        salesApi.getCustomerStatement(customerId, ctx.companyId),
        salesApi.getCustomerArAging(ctx.companyId),
      ]);

      if (!stmtRes.success) return { error: stmtRes.error || 'فشل جلب كشف الحساب' };
      const stmt = stmtRes.data || [];

      const totalDebit = stmt.reduce((s, r) => s + num(r.debit), 0);
      const totalCredit = stmt.reduce((s, r) => s + num(r.credit), 0);

      const agingBuckets: { label: string; amount: number }[] = [];
      if (agingRes.success && agingRes.data) {
        // Aggregate buckets from all customers for the company
        for (const a of agingRes.data) {
          if (a.customerId === customerId) {
            for (const b of a.buckets) {
              agingBuckets.push({ label: b.period, amount: b.amount });
            }
          }
        }
      }

      return {
        customerId,
        statement: stmt.slice(0, 100).map(r => ({
          date: r.date,
          documentNumber: r.documentNumber,
          documentType: r.documentType,
          debit: num(r.debit),
          credit: num(r.credit),
          balance: num(r.balance),
        })),
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        outstanding: Math.round((totalDebit - totalCredit) * 100) / 100,
        aging: agingBuckets,
      };
    },
  },

  {
    name: 'sales.vat_summary',
    labelAr: 'ملخص ضريبة القيمة المضافة',
    descriptionAr: 'يعرض ملخص ضريبة القيمة المضافة لفترة: إجمالي المبيعات الخاضعة للضريبة، إجمالي الضريبة، صافي المستحق.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.startDate as string | undefined, args.endDate as string | undefined);
      

      // Sales VAT
      const salesRes = await guardedQuery(`
        SELECT COALESCE(SUM(subtotal), 0) AS taxable, COALESCE(SUM(vat_amount), 0) AS vat
        FROM sales_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'
      `, [ctx.companyId, from, to]);

      // Purchases VAT
      const purchasesRes = await guardedQuery(`
        SELECT COALESCE(SUM(subtotal), 0) AS taxable, COALESCE(SUM(vat_amount), 0) AS vat
        FROM purchase_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'
      `, [ctx.companyId, from, to]);

      const salesTaxable = num(salesRes.rows?.[0]?.taxable || 0);
      const salesVat = num(salesRes.rows?.[0]?.vat || 0);
      const purchTaxable = num(purchasesRes.rows?.[0]?.taxable || 0);
      const purchVat = num(purchasesRes.rows?.[0]?.vat || 0);

      return {
        period: { from, to },
        salesVat: {
          taxableAmount: Math.round(salesTaxable * 100) / 100,
          vatAmount: Math.round(salesVat * 100) / 100,
          effectiveRate: salesTaxable > 0 ? Math.round((salesVat / salesTaxable) * 10000) / 100 : 0,
        },
        inputVat: {
          taxableAmount: Math.round(purchTaxable * 100) / 100,
          vatAmount: Math.round(purchVat * 100) / 100,
          effectiveRate: purchTaxable > 0 ? Math.round((purchVat / purchTaxable) * 10000) / 100 : 0,
        },
        netVatPayable: Math.round((salesVat - purchVat) * 100) / 100,
      };
    },
  },

  {
    name: 'sales.invoice_register',
    labelAr: 'سجل فواتير المبيعات',
    descriptionAr: 'يعرض سجل تفصيلي لفواتير المبيعات مع إمكانية التصفية حسب الحالة أو العميل. يشمل بنود كل فاتورة.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'posted', 'paid', 'partially_paid', 'cancelled'], description: 'تصفية حسب الحالة' },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 20، أقصى 50)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 20, 1), 50);
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const res = await salesApi.getInvoicesPaginated(ctx.companyId, 1, limit, { status });
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الفواتير' };
      return {
        total: res.data.total,
        invoices: res.data.items.map(i => ({
          number: i.invoiceNumber, customer: i.customer?.name,
          date: i.date, total: i.totalAmount, paid: i.paidAmount,
          outstanding: (i.totalAmount || 0) - (i.paidAmount || 0),
          status: i.status, currency: i.currencyCode,
        })),
      };
    },
  },

  {
    name: 'sales.top_customers',
    labelAr: 'أفضل العملاء',
    descriptionAr: 'يعرض أفضل 10 عملاء حسب إجمالي المشتريات (الإيرادات) مع عدد الفواتير وآخر فاتورة.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
        limit: { type: 'number', description: 'عدد العملاء (افتراضي 10)' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      const topN = Math.min(Math.max(num(args.limit) || 10, 1), 50);
      

      const res = await guardedQuery(`
        SELECT c.name, c.code, c.phone,
               COUNT(i.id)::int AS invoice_count,
               COALESCE(SUM(i.total_amount), 0) AS total_revenue,
               COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS total_outstanding,
               MAX(i.date) AS last_invoice_date
        FROM customers c
        LEFT JOIN sales_invoices i ON c.id = i.customer_id AND i.company_id = c.company_id AND i.date BETWEEN $2 AND $3 AND i.status != 'cancelled'
        WHERE c.company_id = $1::uuid
        GROUP BY c.id, c.name, c.code, c.phone
        HAVING COUNT(i.id) > 0
        ORDER BY total_revenue DESC
        LIMIT $4
      `, [ctx.companyId, from, to, topN]);

      if (!res.success) return { error: res.error || 'فشل جلب العملاء' };
      const customers = (res.rows || []).map((r: Record<string, unknown>) => ({
        name: r.name_ar, code: r.code, phone: r.phone,
        invoiceCount: num(r.invoice_count), revenue: Math.round(num(r.total_revenue) * 100) / 100,
        outstanding: Math.round(num(r.total_outstanding) * 100) / 100,
        lastInvoice: r.last_invoice_date,
      }));
      return { period: { from, to }, count: customers.length, customers };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // المشتريات — Purchases Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'purchases.purchase_analysis',
    labelAr: 'تحليل المشتريات',
    descriptionAr: 'تحليل المشتريات لفترة زمنية: إجمالي المشتريات، عدد الفواتير، أفضل الموردين، التوزيع الشهري.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      

      const res = await guardedQuery(`
        SELECT
          i.id, i.invoice_number, i.date, i.total_amount, i.paid_amount, i.status,
          i.currency_code, i.base_currency_amount,
          s.name AS supplier_name, s.id AS supplier_id,
          COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0) AS outstanding
        FROM purchase_invoices i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        WHERE i.company_id = $1::uuid AND i.date BETWEEN $2 AND $3 AND i.status != 'cancelled'
        ORDER BY i.date DESC
      `, [ctx.companyId, from, to]);
      if (!res.success) return { error: res.error || 'فشل تحليل المشتريات' };
      const rows = res.rows || [];

      const totalPurchases = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.total_amount), 0);
      const totalPaid = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.paid_amount), 0);
      const count = rows.length;

      // Top suppliers
      const supMap = new Map<string, { name: string; amount: number; count: number }>();
      for (const r of rows) {
        const sid = String(r.supplier_id || '');
        if (!sid) continue;
        const e = supMap.get(sid) || { name: String(r.supplier_name || ''), amount: 0, count: 0 };
        e.amount += num(r.total_amount); e.count += 1;
        supMap.set(sid, e);
      }
      const topSuppliers = Array.from(supMap.entries()).map(([, d]) => d).sort((a, b) => b.amount - a.amount).slice(0, 10);

      return {
        period: { from, to }, count,
        totalPurchases: Math.round(totalPurchases * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalOutstanding: Math.round((totalPurchases - totalPaid) * 100) / 100,
        topSuppliers,
      };
    },
  },

  {
    name: 'purchases.supplier_statement',
    labelAr: 'كشف حساب مورد',
    descriptionAr: 'يعرض كشف حساب مورد مع تفصيل الأعمار (0-30، 31-60، 61-90، +90 يوم).',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (مطلوب)' },
      },
    },
    execute: async (args, ctx) => {
      const supplierId = typeof args.supplierId === 'string' && args.supplierId ? args.supplierId : '';
      if (!supplierId) return { error: 'معرف المورد مطلوب' };

      const [stmtRes, agingRes] = await Promise.all([
        purchasesApi.getSupplierStatement(supplierId, ctx.companyId),
        purchasesApi.getApAging(supplierId, ctx.companyId),
      ]);

      if (!stmtRes.success) return { error: stmtRes.error || 'فشل جلب كشف الحساب' };
      const stmt = stmtRes.data || [];

      const totalDebit = stmt.filter(r => r.type === 'invoice').reduce((s, r) => s + num(r.debit), 0);
      const totalCredit = stmt.filter(r => r.type === 'payment').reduce((s, r) => s + num(r.credit), 0);

      let agingBuckets: { label: string; amount: number }[] = [];
      if (agingRes.success && agingRes.data) {
        agingBuckets = agingRes.data.map(b => ({
          label: b.bucket,
          amount: num(b.amount),
        }));
      }

      return {
        supplierId,
        statement: stmt.slice(0, 100).map(r => ({
          date: r.date, documentNumber: r.documentNumber,
          type: r.type,
          description: r.description,
          debit: num(r.debit), credit: num(r.credit),
          balance: num(r.balance),
        })),
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        outstanding: Math.round((totalDebit - totalCredit) * 100) / 100,
        aging: agingBuckets,
      };
    },
  },

  {
    name: 'purchases.purchase_register',
    labelAr: 'سجل فواتير المشتريات',
    descriptionAr: 'يعرض سجل تفصيلي لفواتير المشتريات مع التصفية حسب الحالة أو المورد.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'posted', 'paid', 'partially_paid', 'cancelled'], description: 'تصفية حسب الحالة' },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 20)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 20, 1), 50);
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const res = await purchasesApi.getInvoicesPaginated(ctx.companyId, 1, limit, { status });
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الفواتير' };
      return {
        total: res.data.total,
        invoices: res.data.items.map(i => ({
          number: i.invoiceNumber, supplier: i.supplier?.name,
          date: i.date, total: i.totalAmount, paid: i.paidAmount,
          status: i.status,
        })),
      };
    },
  },

  {
    name: 'purchases.top_suppliers',
    labelAr: 'أفضل الموردين',
    descriptionAr: 'يعرض أفضل الموردين حسب إجمالي فواتير المشتريات.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
        limit: { type: 'number', description: 'عدد الموردين (افتراضي 10)' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      const topN = Math.min(Math.max(num(args.limit) || 10, 1), 50);
      

      const res = await guardedQuery(`
        SELECT s.name, s.code, s.phone,
               COUNT(i.id)::int AS invoice_count,
               COALESCE(SUM(i.total_amount), 0) AS total_purchases,
               COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS total_outstanding
        FROM suppliers s
        LEFT JOIN purchase_invoices i ON s.id = i.supplier_id AND i.company_id = s.company_id AND i.date BETWEEN $2 AND $3 AND i.status != 'cancelled'
        WHERE s.company_id = $1::uuid
        GROUP BY s.id, s.name, s.code, s.phone
        HAVING COUNT(i.id) > 0
        ORDER BY total_purchases DESC
        LIMIT $4
      `, [ctx.companyId, from, to, topN]);

      if (!res.success) return { error: res.error || 'فشل جلب الموردين' };
      return {
        period: { from, to },
        suppliers: (res.rows || []).map((r: Record<string, unknown>) => ({
          name: r.name_ar, code: r.code,
          invoiceCount: num(r.invoice_count),
          totalPurchases: Math.round(num(r.total_purchases) * 100) / 100,
          outstanding: Math.round(num(r.total_outstanding) * 100) / 100,
        })),
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // المخزون — Inventory Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'inventory.stock_valuation',
    labelAr: 'تقييم المخزون',
    descriptionAr: 'يعرض تقييم المخزون: إجمالي قيمة المخزون، عدد المنتجات، القيمة حسب التصنيف، المنتجات الأعلى قيمة.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      

      const res = await guardedQuery(`
        SELECT
          p.id, p.name_ar, p.code, p.sku, p.cost_price, p.sale_price,
          p.unit, p.barcode,
          COALESCE(s.quantity, 0) AS quantity,
          COALESCE(s.quantity, 0) * COALESCE(p.cost_price, 0) AS stock_value
        FROM products p
        LEFT JOIN stock s ON p.id = s.product_id AND s.company_id = p.company_id
        WHERE p.company_id = $1::uuid
        ORDER BY stock_value DESC
        LIMIT 100
      `, [ctx.companyId]);

      if (!res.success) return { error: res.error || 'فشل جلب تقييم المخزون' };
      const rows = res.rows || [];
      const totalValue = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.stock_value), 0);
      const totalQty = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.quantity), 0);
      const productCount = rows.length;

      return {
        totalValue: Math.round(totalValue * 100) / 100,
        totalQuantity: Math.round(totalQty * 100) / 100,
        productCount,
        products: rows.slice(0, 50).map((r: Record<string, unknown>) => ({
          name: r.name_ar, code: r.code, sku: r.sku,
          costPrice: num(r.cost_price), salePrice: num(r.sale_price),
          quantity: num(r.quantity), stockValue: Math.round(num(r.stock_value) * 100) / 100,
        })),
      };
    },
  },

  {
    name: 'inventory.stock_movement_report',
    labelAr: 'تقرير حركة المخزون',
    descriptionAr: 'يعرض حركة المخزون لفترة: الإدخالات، الإخراجات، التسويات، والتحويلات مع تحليل شهري.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      

      const res = await guardedQuery(`
        SELECT sm.id, sm.type, sm.quantity, sm.created_at,
               p.name_ar AS product_name, p.code AS product_code,
               w.name AS warehouse_name
        FROM stock_movements sm
        LEFT JOIN products p ON sm.product_id = p.id
        LEFT JOIN warehouses w ON sm.warehouse_id = w.id
        WHERE sm.company_id = $1::uuid AND sm.created_at::date BETWEEN $2 AND $3
        ORDER BY sm.created_at DESC
        LIMIT 200
      `, [ctx.companyId, from, to]);

      if (!res.success) return { error: res.error || 'فشل جلب حركة المخزون' };
      const rows = res.rows || [];

      const typeSummary: Record<string, { count: number; totalQty: number }> = {};
      for (const r of rows) {
        const t = String(r.type || 'unknown');
        const entry = typeSummary[t] || { count: 0, totalQty: 0 };
        entry.count += 1; entry.totalQty += num(r.quantity);
        typeSummary[t] = entry;
      }

      return {
        period: { from, to },
        totalMovements: rows.length,
        byType: Object.entries(typeSummary).map(([type, d]) => ({
          type, count: d.count, totalQuantity: Math.round(d.totalQty * 100) / 100,
          percentage: pct(d.count, rows.length),
        })),
        movements: rows.slice(0, 100).map((r: Record<string, unknown>) => ({
          date: r.created_at, type: r.type,
          product: r.product_name, code: r.product_code,
          warehouse: r.warehouse_name, quantity: num(r.quantity),
        })),
      };
    },
  },

  {
    name: 'inventory.low_stock_alert',
    labelAr: 'تنبيه المخزون المنخفض',
    descriptionAr: 'يعرض المنتجات التي انخفض مخزونها عن الحد الأدنى مع تصنيف الحالة: حرج، منخفض، وفائض.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        criticalOnly: { type: 'boolean', description: 'إظهار الحرج فقط (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      
      const criticalOnly = args.criticalOnly === true;

      const res = await guardedQuery(`
        SELECT p.name_ar, p.code, p.sku, p.sale_price, p.cost_price,
               s.quantity, s.min_stock_alert, w.name AS warehouse_name
        FROM stock s
        JOIN products p ON s.product_id = p.id
        LEFT JOIN warehouses w ON s.warehouse_id = w.id
        WHERE s.company_id = $1::uuid AND s.quantity <= s.min_stock_alert
        ORDER BY (s.quantity::float / NULLIF(s.min_stock_alert, 0)) ASC
      `, [ctx.companyId]);

      if (!res.success) return { error: res.error || 'فشل جلب التنبيهات' };
      const rows = res.rows || [];

      let items = rows.map((r: Record<string, unknown>) => {
        const qty = num(r.quantity);
        const min = num(r.min_stock_alert);
        return {
          name: r.name_ar, code: r.code, sku: r.sku,
          warehouse: r.warehouse_name || '',
          quantity: qty, minStockAlert: min,
          ratio: min > 0 ? Math.round((qty / min) * 100) : 0,
          status: qty === 0 ? 'critical' : qty <= min * 0.5 ? 'critical' : 'low',
        };
      });

      if (criticalOnly) items = items.filter(i => i.status === 'critical');

      const critical = items.filter(i => i.status === 'critical').length;
      const low = items.filter(i => i.status === 'low').length;

      return {
        total: items.length, critical, low,
        items: items.slice(0, 50),
      };
    },
  },

  {
    name: 'inventory.product_ledger',
    labelAr: 'كشف حركة منتج',
    descriptionAr: 'يعرض كشف حركة كامل لمنتج معين: الإدخالات، الإخراجات، والرصيد الجاري.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (مطلوب)' },
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const productId = typeof args.productId === 'string' && args.productId ? args.productId : '';
      if (!productId) return { error: 'معرف المنتج مطلوب' };
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);

      
      const res = await guardedQuery(`
        SELECT sm.type, sm.quantity, sm.created_at,
               w.name AS warehouse_name,
               p.name_ar AS product_name, p.code AS product_code
        FROM stock_movements sm
        LEFT JOIN warehouses w ON sm.warehouse_id = w.id
        JOIN products p ON sm.product_id = p.id
        WHERE sm.company_id = $1::uuid AND sm.product_id = $2::uuid AND sm.created_at::date BETWEEN $3 AND $4
        ORDER BY sm.created_at ASC
      `, [ctx.companyId, productId, from, to]);

      if (!res.success) return { error: res.error || 'فشل جلب حركة المنتج' };
      const rows = res.rows || [];

      let runningQty = 0;
      const movements = rows.map((r: Record<string, unknown>) => {
        const qty = r.type === 'in' || r.type === 'adjustment' ? num(r.quantity) : -num(r.quantity);
        runningQty += qty;
        return {
          date: r.created_at, type: r.type,
          warehouse: r.warehouse_name || '',
          quantityChange: qty, runningBalance: Math.round(runningQty * 100) / 100,
        };
      });

      return {
        productName: rows.length > 0 ? rows[0].product_name : '',
        productCode: rows.length > 0 ? rows[0].product_code : '',
        period: { from, to },
        totalMovements: movements.length,
        currentBalance: movements.length > 0 ? movements[movements.length - 1].runningBalance : 0,
        movements: movements.slice(0, 200),
      };
    },
  },

  {
    name: 'inventory.inventory_analysis',
    labelAr: 'تحليل المخزون الشامل',
    descriptionAr: 'تحليل شامل للمخزون: قيمة المخزون، عدد المنتجات، المنتجات منخفضة المخزون، توزيع المستودعات، وأفضل المنتجات.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      

      const [kpiRes, warehouseRes, prodRes, catRes] = await Promise.all([
        inventoryApi.getInventoryKpis(ctx.companyId),
        guardedQuery(`SELECT COUNT(*)::int AS count FROM warehouses WHERE company_id = $1::uuid`, [ctx.companyId]),
        guardedQuery(`
          SELECT p.name_ar, p.code, p.sale_price, p.cost_price,
                 COALESCE(s.quantity, 0) AS qty,
                 COALESCE(s.quantity, 0) * COALESCE(p.cost_price, 0) AS value
          FROM products p
          LEFT JOIN stock s ON p.id = s.product_id AND s.company_id = p.company_id
          WHERE p.company_id = $1::uuid
          ORDER BY value DESC LIMIT 20
        `, [ctx.companyId]),
        guardedQuery(`
          SELECT pc.name AS category,
                 COUNT(ppc.product_id)::int AS product_count
          FROM product_categories pc
          LEFT JOIN product_product_categories ppc ON pc.id = ppc.category_id
          WHERE pc.company_id = $1::uuid
          GROUP BY pc.id, pc.name
          ORDER BY product_count DESC
        `, [ctx.companyId]),
      ]);

      const kpi = kpiRes.data;
      return {
        stockValue: kpi ? Math.round(kpi.stockValue * 100) / 100 : 0,
        lowStockItems: kpi?.lowStockItems || 0,
        warehouseCount: num(warehouseRes.rows?.[0]?.count || 0),
        productCount: (prodRes.rows || []).length,
        topProducts: (prodRes.rows || []).slice(0, 10).map((r: Record<string, unknown>) => ({
          name: r.name_ar, code: r.code, qty: num(r.qty), value: Math.round(num(r.value) * 100) / 100,
        })),
        categoryDistribution: (catRes.rows || []).map((r: Record<string, unknown>) => ({
          category: r.category, count: num(r.product_count),
        })),
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // التصنيع — Manufacturing Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'manufacturing.production_cost',
    labelAr: 'تكاليف الإنتاج',
    descriptionAr: 'يعرض تحليل تكاليف الإنتاج: إجمالي التكاليف، التكاليف المخططة مقابل الفعلية، أوامر التشغيل حسب الحالة.',
    permission: 'manufacturing.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      

      const [kpiRes, costsRes] = await Promise.all([
        manufacturingApi.getManufacturingKpis(ctx.companyId),
        guardedQuery(`
          SELECT wo.id, wo.order_number, wo.status, wo.planned_qty, wo.produced_qty, wo.total_cost,
                 p.name_ar AS product_name, wo.created_at
          FROM work_orders wo
          LEFT JOIN products p ON wo.product_id = p.id
          WHERE wo.company_id = $1::uuid AND wo.created_at::date BETWEEN $2 AND $3
          ORDER BY wo.created_at DESC
          LIMIT 100
        `, [ctx.companyId, from, to]),
      ]);

      const orders = (costsRes.rows || []).map((r: Record<string, unknown>) => ({
        orderNumber: r.order_number, productName: r.product_name,
        status: r.status, plannedQty: num(r.planned_qty),
        producedQty: num(r.produced_qty), totalCost: num(r.total_cost),
        date: r.created_at,
      }));

      const totalCost = orders.reduce((s, o) => s + o.totalCost, 0);
      const avgCostPerOrder = orders.length > 0 ? totalCost / orders.length : 0;

      return {
        period: { from, to },
        kpis: kpiRes.data ? {
          totalWorkOrders: kpiRes.data.totalWorkOrders,
          activeOrders: kpiRes.data.activeOrders,
          completedOrders: kpiRes.data.completedOrders,
          totalProductionCost: Math.round(kpiRes.data.totalProductionCost * 100) / 100,
        } : undefined,
        orderCount: orders.length,
        totalCost: Math.round(totalCost * 100) / 100,
        avgCostPerOrder: Math.round(avgCostPerOrder * 100) / 100,
        orders: orders.slice(0, 50),
      };
    },
  },

  {
    name: 'manufacturing.variance_analysis',
    labelAr: 'تحليل الفروقات',
    descriptionAr: 'يحلل الفروقات بين الكميات والتكاليف المخططة والفعلية في أوامر التشغيل.',
    permission: 'manufacturing.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      

      const res = await guardedQuery(`
        SELECT wo.id, wo.order_number, wo.planned_qty, wo.produced_qty, wo.total_cost,
               p.name_ar AS product_name,
               COALESCE(wc.actual_qty, 0) AS actual_qty,
               COALESCE(wc.planned_quantity, 0) AS planned_qty_line,
               COALESCE(wc.unit_cost, 0) AS unit_cost,
               (COALESCE(wc.actual_qty, 0) - COALESCE(wc.planned_quantity, 0)) AS qty_variance,
               (COALESCE(wc.actual_qty, 0) * COALESCE(wc.unit_cost, 0))
               - (COALESCE(wc.planned_quantity, 0) * COALESCE(wc.unit_cost, 0)) AS cost_variance
        FROM work_orders wo
        LEFT JOIN products p ON wo.product_id = p.id
        LEFT JOIN work_order_consumptions wc ON wo.id = wc.work_order_id
        WHERE wo.company_id = $1::uuid AND wo.status IN ('in_progress', 'completed')
        ORDER BY wo.created_at DESC
        LIMIT 100
      `, [ctx.companyId]);

      if (!res.success) return { error: res.error || 'فشل تحليل الفروقات' };
      const rows = res.rows || [];

      const lineVariances = rows
        .filter((r: Record<string, unknown>) => r.qty_variance !== undefined)
        .map((r: Record<string, unknown>) => ({
          orderNumber: r.order_number, productName: r.product_name,
          plannedQty: num(r.planned_qty_line), actualQty: num(r.actual_qty),
          qtyVariance: num(r.qty_variance), qtyVariancePct: pct(num(r.qty_variance), num(r.planned_qty_line) || 1),
          unitCost: num(r.unit_cost),
          costVariance: Math.round(num(r.cost_variance) * 100) / 100,
        }));

      return {
        totalOrders: new Set(rows.map((r: Record<string, unknown>) => r.id)).size,
        lineVarianceCount: lineVariances.length,
        totalCostVariance: Math.round(lineVariances.reduce((s, l) => s + l.costVariance, 0) * 100) / 100,
        lines: lineVariances.slice(0, 50),
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // الموارد البشرية — HR Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'hr.payroll_report',
    labelAr: 'تقرير الرواتب',
    descriptionAr: 'يعرض تقرير الرواتب لفترة: إجمالي الرواتب، عدد الموظفين، تفاصيل مسيرات الرواتب.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'الشهر (1-12، اختياري — افتراضياً الشهر الحالي)' },
        year: { type: 'number', description: 'السنة (اختياري — افتراضياً السنة الحالية)' },
      },
    },
    execute: async (args, ctx) => {
      const now = new Date();
      const month = num(args.month) || (now.getMonth() + 1);
      const year = num(args.year) || now.getFullYear();

      const res = await hrApi.getPayrollRunsPaginated(ctx.companyId, 1, 50, {});
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب مسيرات الرواتب' };

      const filtered = res.data.items.filter(r => r.month === month && r.year === year);
      const totalAmount = filtered.reduce((s, r) => s + (r.totalAmount || 0), 0);

      return {
        month, year,
        count: filtered.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        runs: filtered.map(r => ({
          status: r.status, totalAmount: r.totalAmount,
          employeeCount: r.lines?.length || 0,
        })),
      };
    },
  },

  {
    name: 'hr.attendance_report',
    labelAr: 'تقرير الحضور والانصراف',
    descriptionAr: 'يعرض تقرير الحضور ليوم محدد: عدد الحاضرين، الغائبين، المتأخرين.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'التاريخ YYYY-MM-DD (اختياري — افتراضياً اليوم)' },
      },
    },
    execute: async (args, ctx) => {
      const dateStr = typeof args.date === 'string' && args.date ? args.date : new Date().toISOString().split('T')[0];
      const target = new Date(dateStr);
      const month = target.getMonth() + 1;
      const year = target.getFullYear();

      const res = await hrApi.getAttendance(ctx.companyId, month, year);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب تقرير الحضور' };

      const dayRecords = res.data.filter(a => a.date === dateStr);
      const present = dayRecords.filter(a => a.status === 'present').length;
      const late = dayRecords.filter(a => a.status === 'late').length;
      const absent = dayRecords.filter(a => a.status === 'absent').length;
      const onLeave = dayRecords.filter(a => a.status === 'on_leave').length;

      // Get total employees from KPIs
      const kpiRes = await hrApi.getHrKpis(ctx.companyId);
      const totalEmployees = kpiRes.data?.totalEmployees || dayRecords.length;

      return {
        date: dateStr,
        present, late, absent, onLeave,
        total: totalEmployees,
        recorded: dayRecords.length,
        attendanceRate: pct(present + late, totalEmployees),
      };
    },
  },

  {
    name: 'hr.leaves_report',
    labelAr: 'تقرير الإجازات',
    descriptionAr: 'يعرض ملخص الإجازات: الإجازات المعتمدة، المعلقة، المرفوضة حسب الفترة.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      

      const res = await guardedQuery(`
        SELECT l.status, COUNT(*)::int AS count, COALESCE(SUM(l.days), 0) AS total_days
        FROM leaves l
        WHERE l.company_id = $1::uuid AND l.created_at::date BETWEEN $2 AND $3
        GROUP BY l.status
      `, [ctx.companyId, from, to]);

      if (!res.success) return { error: res.error || 'فشل جلب الإجازات' };
      const rows = res.rows || [];

      return {
        period: { from, to },
        totalRequests: rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0),
        approved: num(rows.find((r: Record<string, unknown>) => r.status === 'approved')?.count || 0),
        pending: num(rows.find((r: Record<string, unknown>) => r.status === 'pending')?.count || 0),
        rejected: num(rows.find((r: Record<string, unknown>) => r.status === 'rejected')?.count || 0),
        totalDays: Math.round(rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.total_days), 0) * 100) / 100,
        breakdown: rows.map((r: Record<string, unknown>) => ({ status: r.status, count: num(r.count), totalDays: num(r.total_days) })),
      };
    },
  },

  {
    name: 'hr.employees_report',
    labelAr: 'تقرير الموظفين',
    descriptionAr: 'يعرض تقرير شامل عن الموظفين: إجمالي الموظفين، النشطين، حسب الأقسام مع ملخص الرواتب.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const [empRes, hrKpiRes] = await Promise.all([
        hrApi.getEmployeesPaginated(ctx.companyId, 1, 200, {}),
        hrApi.getHrKpis(ctx.companyId),
      ]);

      const employees = empRes.success && empRes.data ? empRes.data.items : [];
      const hrKpi = hrKpiRes.data;

      const deptMap = new Map<string, number>();
      for (const e of employees) {
        const d = String(e.departmentName || e.departmentId || 'بدون قسم');
        deptMap.set(d, (deptMap.get(d) || 0) + 1);
      }

      const activeCount = employees.filter(e => e.isActive !== false).length;
      const avgSalary = employees.length > 0
        ? employees.reduce((s, e) => s + (e.baseSalary || 0), 0) / employees.length
        : 0;

      return {
        totalEmployees: hrKpi?.totalEmployees || employees.length,
        activeEmployees: activeCount,
        departments: Array.from(deptMap.entries()).map(([name, count]) => ({ name, count })),
        averageBaseSalary: Math.round(avgSalary * 100) / 100,
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // علاقات العملاء — CRM Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'crm.lead_conversion',
    labelAr: 'تحويل العملاء المحتملين',
    descriptionAr: 'يعرض تحليل تحويل العملاء المحتملين: مراحل التحويل، معدل التحويل، حسب المصدر.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string | undefined, args.toDate as string | undefined);
      

      const res = await guardedQuery(`
        SELECT l.status, l.source, COUNT(*)::int AS count
        FROM leads l
        WHERE l.company_id = $1::uuid AND l.created_at::date BETWEEN $2 AND $3
        GROUP BY l.status, l.source
      `, [ctx.companyId, from, to]);

      if (!res.success) return { error: res.error || 'فشل جلب التحويلات' };
      const rows = res.rows || [];

      const totalLeads = rows.reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0);
      const converted = rows.filter((r: Record<string, unknown>) => r.status === 'converted').reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0);
      const lost = rows.filter((r: Record<string, unknown>) => r.status === 'lost').reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0);

      // Source breakdown
      const srcMap = new Map<string, number>();
      for (const r of rows) {
        const src = String((r as Record<string, unknown>).source || 'other');
        srcMap.set(src, (srcMap.get(src) || 0) + num(r.count));
      }

      return {
        period: { from, to },
        totalLeads, converted, lost,
        conversionRate: pct(converted, totalLeads),
        lossRate: pct(lost, totalLeads),
        bySource: Array.from(srcMap.entries()).map(([source, count]) => ({ source, count, percentage: pct(count, totalLeads) })),
        byStatus: rows
          .filter((r, i, a) => a.findIndex((x: Record<string, unknown>) => String(x.status) === String(r.status)) === i)
          .map((r: Record<string, unknown>) => ({
            status: r.status,
            count: rows.filter((x: Record<string, unknown>) => String(x.status) === String(r.status)).reduce((s: number, x: Record<string, unknown>) => s + num(x.count), 0),
          })),
      };
    },
  },

  {
    name: 'crm.opportunity_pipeline',
    labelAr: 'مسار الفرص',
    descriptionAr: 'يعرض تحليل مسار الفرص البيعية: الفرص حسب المرحلة، القيمة المتوقعة، القيمة الموزونة.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      

      const res = await guardedQuery(`
        SELECT o.stage, o.probability, o.value,
               c.name AS customer_name,
               u.full_name AS assigned_name
        FROM opportunities o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN users u ON o.assigned_to = u.id
        WHERE o.company_id = $1::uuid AND o.stage NOT IN ('won', 'lost')
        ORDER BY o.created_at DESC
      `, [ctx.companyId]);

      if (!res.success) return { error: res.error || 'فشل جلب مسار الفرص' };
      const rows = res.rows || [];

      const stageMap = new Map<string, { count: number; totalValue: number; weightedValue: number }>();
      for (const r of rows) {
        const stage = String(r.stage || 'new');
        const entry = stageMap.get(stage) || { count: 0, totalValue: 0, weightedValue: 0 };
        entry.count += 1;
        const val = num(r.value);
        entry.totalValue += val;
        entry.weightedValue += val * (num(r.probability) / 100);
        stageMap.set(stage, entry);
      }

      return {
        totalOpportunities: rows.length,
        pipelineValue: Math.round(Array.from(stageMap.values()).reduce((s, e) => s + e.totalValue, 0) * 100) / 100,
        weightedPipeline: Math.round(Array.from(stageMap.values()).reduce((s, e) => s + e.weightedValue, 0) * 100) / 100,
        stages: Array.from(stageMap.entries()).map(([stage, data]) => ({
          stage,
          count: data.count,
          totalValue: Math.round(data.totalValue * 100) / 100,
          weightedValue: Math.round(data.weightedValue * 100) / 100,
        })),
        opportunities: rows.slice(0, 50).map((r: Record<string, unknown>) => ({
          customer: r.customer_name, responsible: r.assigned_name,
          stage: r.stage, probability: num(r.probability), value: num(r.value),
          weighted: Math.round(num(r.value) * num(r.probability) / 100 * 100) / 100,
        })),
      };
    },
  },

  {
    name: 'crm.sales_funnel',
    labelAr: 'مسار المبيعات الكامل',
    descriptionAr: 'يعرض مسار المبيعات الكامل من العميل المحتمل إلى الفاتورة: مراحل التحويل، معدلات النجاح.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      

      const [leadsRes, oppsRes, invoicesRes] = await Promise.all([
        guardedQuery(`SELECT status, COUNT(*)::int AS count FROM leads WHERE company_id = $1::uuid GROUP BY status`, [ctx.companyId]),
        guardedQuery(`SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(value), 0) AS total_value FROM opportunities WHERE company_id = $1::uuid GROUP BY stage`, [ctx.companyId]),
        guardedQuery(`SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS total_revenue FROM sales_invoices WHERE company_id = $1::uuid AND status = 'posted'`, [ctx.companyId]),
      ]);

      const totalLeads = (leadsRes.rows || []).reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0);
      const convertedLeads = num((leadsRes.rows || []).find((r: Record<string, unknown>) => r.status === 'converted')?.count || 0);
      const wonOpps = num((oppsRes.rows || []).find((r: Record<string, unknown>) => r.stage === 'won')?.count || 0);
      const totalOppValue = (oppsRes.rows || []).reduce((s: number, r: Record<string, unknown>) => s + num(r.total_value), 0);

      return {
        funnel: {
          leads: { count: totalLeads },
          convertedToCustomer: { count: convertedLeads, rate: pct(convertedLeads, totalLeads) },
          opportunities: { count: (oppsRes.rows || []).reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0), totalValue: Math.round(totalOppValue * 100) / 100 },
          wonDeals: { count: wonOpps },
          invoices: {
            count: num(invoicesRes.rows?.[0]?.count || 0),
            totalRevenue: Math.round(num(invoicesRes.rows?.[0]?.total_revenue || 0) * 100) / 100,
          },
        },
        leadToCustomerRate: pct(convertedLeads, totalLeads),
        opportunityWinRate: (oppsRes.rows || []).reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0) > 0
          ? pct(wonOpps, (oppsRes.rows || []).reduce((s: number, r: Record<string, unknown>) => s + num(r.count), 0))
          : 0,
      };
    },
  },

  {
    name: 'crm.follow_ups',
    labelAr: 'المتابعات المطلوبة',
    descriptionAr: 'يجمع تلقائياً كل ما يحتاج متابعة الآن: مهام متأخرة، مهام تستحق اليوم، فرص تجاوزت تاريخ الإغلاق المتوقع، عملاء محتملون بلا تواصل منذ أكثر من 14 يوماً — مرتبة بالأولوية.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        staleDays: { type: 'number', description: 'عدد الأيام بلا تواصل ليُعد العميل المحتمل "متوقفاً" (افتراضي 14)' },
      },
    },
    execute: async (args, ctx) => {
      const staleDays = args.staleDays !== undefined ? Math.max(1, Math.round(num(args.staleDays))) : 14;

      const [overdueTasksRes, dueTodayRes, overdueOppsRes, staleLeadsRes] = await Promise.all([
        guardedQuery(
          `SELECT t.id, t.title, t.due_date::text AS due_date, t.priority, t.assigned_to,
                  u.full_name AS assigned_name, t.lead_id, t.opportunity_id
             FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
            WHERE t.company_id = $1::uuid AND t.status = 'pending' AND t.due_date < CURRENT_DATE
            ORDER BY t.due_date ASC LIMIT 20`,
          [ctx.companyId]
        ),
        guardedQuery(
          `SELECT t.id, t.title, t.due_date::text AS due_date, t.priority, t.assigned_to,
                  u.full_name AS assigned_name, t.lead_id, t.opportunity_id
             FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
            WHERE t.company_id = $1::uuid AND t.status = 'pending' AND t.due_date = CURRENT_DATE
            ORDER BY t.priority DESC LIMIT 20`,
          [ctx.companyId]
        ),
        guardedQuery(
          `SELECT o.id, o.name, o.stage, o.value, o.expected_close_date::text AS expected_close_date,
                  o.assigned_to, u.full_name AS assigned_name, o.customer_id
             FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id
            WHERE o.company_id = $1::uuid
              AND o.stage NOT IN ('won', 'lost')
              AND o.expected_close_date IS NOT NULL AND o.expected_close_date < CURRENT_DATE
            ORDER BY o.expected_close_date ASC LIMIT 20`,
          [ctx.companyId]
        ),
        guardedQuery(
          `SELECT l.id, l.name, l.phone, l.status, l.rating, l.estimated_value,
                  l.last_contacted_at::text AS last_contacted_at, l.assigned_to, u.full_name AS assigned_name
             FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
            WHERE l.company_id = $1::uuid
              AND l.status IN ('new', 'contacted', 'qualified')
              AND (l.last_contacted_at IS NULL OR l.last_contacted_at < CURRENT_DATE - ($2::int * INTERVAL '1 day'))
            ORDER BY l.rating = 'hot' DESC, l.estimated_value DESC NULLS LAST LIMIT 20`,
          [ctx.companyId, staleDays]
        ),
      ]);

      const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const overdueTasks = (overdueTasksRes.rows || []).map((r: Record<string, unknown>) => ({
        kind: 'overdue_task', id: String(r.id), title: String(r.title), dueDate: r.due_date,
        priority: String(r.priority), assignedTo: r.assigned_name,
        leadId: r.lead_id, opportunityId: r.opportunity_id,
      })).sort((a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0));
      const dueToday = (dueTodayRes.rows || []).map((r: Record<string, unknown>) => ({
        kind: 'due_today', id: String(r.id), title: String(r.title), dueDate: r.due_date,
        priority: String(r.priority), assignedTo: r.assigned_name,
        leadId: r.lead_id, opportunityId: r.opportunity_id,
      }));
      const overdueOpps = (overdueOppsRes.rows || []).map((r: Record<string, unknown>) => ({
        kind: 'overdue_opportunity', id: String(r.id), name: String(r.name), stage: String(r.stage),
        value: num(r.value), expectedCloseDate: r.expected_close_date, assignedTo: r.assigned_name,
        customerId: r.customer_id,
      }));
      const staleLeads = (staleLeadsRes.rows || []).map((r: Record<string, unknown>) => ({
        kind: 'stale_lead', id: String(r.id), name: String(r.name), phone: r.phone,
        status: String(r.status), rating: String(r.rating), estimatedValue: num(r.estimated_value),
        lastContactedAt: r.last_contacted_at, assignedTo: r.assigned_name,
      }));

      return {
        summary: {
          total: overdueTasks.length + dueToday.length + overdueOpps.length + staleLeads.length,
          overdueTasks: overdueTasks.length,
          dueToday: dueToday.length,
          overdueOpportunities: overdueOpps.length,
          staleLeads: staleLeads.length,
        },
        // Priority order: overdue tasks → overdue opportunities → due today → stale leads
        actions: [...overdueTasks, ...overdueOpps, ...dueToday, ...staleLeads].slice(0, 40),
        hints: [
          'للمهام المتأخرة: أنجزها عبر crm.complete_task أو عدّل تاريخها عبر crm.update_task.',
          'للفرص المتجاوزة: راجع المرحلة عبر crm.update_opportunity_stage (تقدّم للأمام فقط).',
          'للعملاء المتوقفين: سجّل نشاط تواصل عبر crm.create_activity (يحدّث last_contacted_at تلقائياً).',
        ],
      };
    },
  },

  {
    name: 'crm.rep_performance',
    labelAr: 'أداء مندوبي المبيعات',
    descriptionAr: 'يحسب أداء كل مندوب: العملاء المحتملون المسندون، المحولون، الفرص المفتوحة/المكسوبة/الخاسرة، معدل الفوز، قيمة المكسوب، الأنشطة المسجلة.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const repsRes = await guardedQuery(
        `SELECT u.id, u.full_name AS name,
                (SELECT COUNT(*)::int FROM leads l WHERE l.company_id = $1::uuid AND l.assigned_to = u.id) AS leads_assigned,
                (SELECT COUNT(*)::int FROM leads l WHERE l.company_id = $1::uuid AND l.assigned_to = u.id AND l.status = 'converted') AS leads_converted,
                (SELECT COUNT(*)::int FROM opportunities o WHERE o.company_id = $1::uuid AND o.assigned_to = u.id AND o.stage NOT IN ('won','lost')) AS open_opps,
                (SELECT COUNT(*)::int FROM opportunities o WHERE o.company_id = $1::uuid AND o.assigned_to = u.id AND o.stage = 'won') AS won_opps,
                (SELECT COUNT(*)::int FROM opportunities o WHERE o.company_id = $1::uuid AND o.assigned_to = u.id AND o.stage = 'lost') AS lost_opps,
                (SELECT COALESCE(SUM(o.value), 0) FROM opportunities o WHERE o.company_id = $1::uuid AND o.assigned_to = u.id AND o.stage = 'won') AS won_value,
                (SELECT COUNT(*)::int FROM activities a WHERE a.company_id = $1::uuid AND a.assigned_to = u.id) AS activities_logged
           FROM users u
          WHERE u.company_id = $1::uuid
          ORDER BY won_value DESC NULLS LAST`,
        [ctx.companyId]
      );

      const reps = (repsRes.rows || []).map((r: Record<string, unknown>) => {
        const won = num(r.won_opps);
        const lost = num(r.lost_opps);
        const closed = won + lost;
        return {
          id: String(r.id),
          name: String(r.name),
          leadsAssigned: num(r.leads_assigned),
          leadsConverted: num(r.leads_converted),
          openOpportunities: num(r.open_opps),
          won: won,
          lost: lost,
          winRate: closed > 0 ? Math.round((won / closed) * 1000) / 10 : 0,
          wonValue: Math.round(num(r.won_value) * 100) / 100,
          activitiesLogged: num(r.activities_logged),
        };
      });

      return {
        totalReps: reps.length,
        reps,
        note: 'معدل الفوز = won / (won + lost) للفرص المقفلة فقط.',
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // لوحة المؤشرات — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'reports.dashboard',
    labelAr: 'لوحة المؤشرات الرئيسية',
    descriptionAr: 'يعرض لوحة المؤشرات الرئيسية للشركة: إجمالي الإيرادات والمصروفات والأرباح، مؤشرات المخزون، العملاء، الموردين، الموظفين.',
    permission: 'reports.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year'], description: 'الفترة (اختياري — افتراضياً الشهر)' },
        comparePrevious: { type: 'boolean', description: 'مقارنة بالفترة السابقة (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const period = typeof args.period === 'string' ? args.period : 'month';
      const comparePrevious = args.comparePrevious === true;
      
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      let fromDate: string;
      let prevFromDate: string;
      let prevToDate: string;

      switch (period) {
        case 'today':
          fromDate = today;
          prevFromDate = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
          prevToDate = prevFromDate;
          break;
        case 'week':
          fromDate = new Date(now.getTime() - 6 * 86400000).toISOString().split('T')[0];
          prevFromDate = new Date(now.getTime() - 13 * 86400000).toISOString().split('T')[0];
          prevToDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
          break;
        case 'year':
          fromDate = `${now.getFullYear()}-01-01`;
          prevFromDate = `${now.getFullYear() - 1}-01-01`;
          prevToDate = `${now.getFullYear() - 1}-12-31`;
          break;
        default: // month
          fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          if (now.getMonth() === 0) {
            prevFromDate = `${now.getFullYear() - 1}-12-01`;
            prevToDate = `${now.getFullYear() - 1}-12-31`;
          } else {
            const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            prevFromDate = prevMonth.toISOString().split('T')[0];
            prevToDate = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
          }
          break;
      }

      // Current period queries
      const [salesRes, purchasesRes, receiptsRes, paymentsRes, productRes, customerRes, supplierRes, hrKpiRes, manufacturingRes, lowStockRes] = await Promise.all([
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS revenue, COUNT(*)::int AS count FROM sales_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'`, [ctx.companyId, fromDate, today]),
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS amount FROM purchase_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'`, [ctx.companyId, fromDate, today]),
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS amount FROM receipt_vouchers WHERE company_id = $1::uuid AND created_at::date BETWEEN $2 AND $3 AND status = 'posted'`, [ctx.companyId, fromDate, today]),
        guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS amount FROM payment_vouchers WHERE company_id = $1::uuid AND created_at::date BETWEEN $2 AND $3 AND status = 'posted'`, [ctx.companyId, fromDate, today]),
        guardedQuery(`SELECT COUNT(*)::int AS count FROM products WHERE company_id = $1::uuid`, [ctx.companyId]),
        guardedQuery(`SELECT COUNT(*)::int AS count FROM customers WHERE company_id = $1::uuid`, [ctx.companyId]),
        guardedQuery(`SELECT COUNT(*)::int AS count FROM suppliers WHERE company_id = $1::uuid`, [ctx.companyId]),
        hrApi.getHrKpis(ctx.companyId),
        manufacturingApi.getManufacturingKpis(ctx.companyId),
        guardedQuery(`SELECT COUNT(*)::int AS count FROM stock WHERE company_id = $1::uuid AND quantity <= min_stock_alert`, [ctx.companyId]),
      ]);

      const revenue = num(salesRes.rows?.[0]?.revenue || 0);
      const invoiceCount = num(salesRes.rows?.[0]?.count || 0);
      const purchases = num(purchasesRes.rows?.[0]?.amount || 0);
      const receipts = num(receiptsRes.rows?.[0]?.amount || 0);
      const payments = num(paymentsRes.rows?.[0]?.amount || 0);
      const expenses = purchases + payments;

      // Previous period comparison
      let prevRevenue = 0;
      let prevExpenses = 0;
      if (comparePrevious) {
        const [prevSalesRes, prevPurchRes] = await Promise.all([
          guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS revenue FROM sales_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'`, [ctx.companyId, prevFromDate, prevToDate]),
          guardedQuery(`SELECT COALESCE(SUM(base_currency_amount), 0) AS amount FROM purchase_invoices WHERE company_id = $1::uuid AND date BETWEEN $2 AND $3 AND status != 'cancelled'`, [ctx.companyId, prevFromDate, prevToDate]),
        ]);
        prevRevenue = num(prevSalesRes.rows?.[0]?.revenue || 0);
        prevExpenses = num(prevPurchRes.rows?.[0]?.amount || 0);
      }

      return {
        period,
        financial: {
          revenue: Math.round(revenue * 100) / 100,
          expenses: Math.round(expenses * 100) / 100,
          netProfit: Math.round((revenue - expenses) * 100) / 100,
          revenueChange: comparePrevious && prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 10000) / 100 : undefined,
          expenseChange: comparePrevious && prevExpenses > 0 ? Math.round(((expenses - prevExpenses) / prevExpenses) * 10000) / 100 : undefined,
        },
        sales: { invoiceCount, averageInvoice: invoiceCount > 0 ? Math.round(revenue / invoiceCount * 100) / 100 : 0 },
        cashFlow: {
          inflows: Math.round((revenue + receipts) * 100) / 100,
          outflows: Math.round(expenses * 100) / 100,
        },
        counts: {
          products: num(productRes.rows?.[0]?.count || 0),
          customers: num(customerRes.rows?.[0]?.count || 0),
          suppliers: num(supplierRes.rows?.[0]?.count || 0),
          employees: hrKpiRes.data?.totalEmployees || 0,
          lowStockItems: num(lowStockRes.rows?.[0]?.count || 0),
        },
        manufacturing: manufacturingRes.data ? {
          totalWorkOrders: manufacturingRes.data.totalWorkOrders,
          activeOrders: manufacturingRes.data.activeOrders,
          completedOrders: manufacturingRes.data.completedOrders,
          totalProductionCost: Math.round(manufacturingRes.data.totalProductionCost * 100) / 100,
        } : undefined,
      };
    },
  },
];
