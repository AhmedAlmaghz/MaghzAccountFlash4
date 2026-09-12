import type { ToolDefinition } from '../types';
import { localToday, localMonthStart } from '../engine/dateUtils';
import { guardSqlQuery } from '../security/sqlGuard';
import { getDbAdapter } from '@/core/database/adapters';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { accountingApi } from '@/modules/accounting/api';
import { inventoryApi } from '@/modules/inventory/api';
import { crmApi } from '@/modules/crm/api';
import { hrApi } from '@/modules/hr/api';
import { useAppStore } from '@/core/store';

/** SELECT-only guarded query (same guard the report tools use). */
async function guardedQuery(sql: string, params: unknown[]): Promise<{ success: boolean; rows?: Array<Record<string, unknown>>; error?: string }> {
  const verdict = guardSqlQuery(sql);
  if (!verdict.ok) return { success: false, error: verdict.error };
  const adapter = await getDbAdapter();
  return adapter.query(sql, params as []) as unknown as { success: boolean; rows?: Array<Record<string, unknown>>; error?: string };
}

/**
 * Read-only tools (dangerLevel: 'read') â€” execute immediately without
 * confirmation. Results are intentionally compact (field-picked, row-capped)
 * to keep LLM context small.
 */

const EMPTY_PARAMS: Record<string, unknown> = { type: 'object', properties: {} };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const readTools: ToolDefinition[] = [
  // â”€â”€â”€ Company â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'core.get_company_info',
    labelAr: 'ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط´ط±ظƒط©',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط´ط±ظƒط© ط§ظ„ط­ط§ظ„ظٹط©: ط§ظ„ط§ط³ظ…طŒ ط§ظ„ط¹ظ…ظ„ط© ط§ظ„ط§ظپطھط±ط§ط¶ظٹط©طŒ ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ. ط§ط³طھط®ط¯ظ…ظ‡ ظ„ظ„ط¥ط¬ط§ط¨ط© ط¹ظ† ط£ط³ط¦ظ„ط© ط¨ظٹط§ظ†ط§طھ ط§ظ„ط´ط±ظƒط©.',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async () => {
      const company = useAppStore.getState().activeCompany;
      if (!company) return { error: 'ظ„ط§ طھظˆط¬ط¯ ط´ط±ظƒط© ظ†ط´ط·ط©' };
      return {
        name: company.name,
        nameEn: company.nameEn,
        currency: company.currency,
        taxNumber: company.taxNumber,
        phone: company.phone,
        email: company.email,
      };
    },
  },

  // â”€â”€â”€ Sales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'sales.get_sales_summary',
    labelAr: 'ظ…ظ„ط®طµ ط§ظ„ظ…ط¨ظٹط¹ط§طھ',
    descriptionAr: 'ظٹط¹ط·ظٹ ظ…ظ„ط®طµ ط§ظ„ظ…ط¨ظٹط¹ط§طھ ظ„ظپطھط±ط© ط²ظ…ظ†ظٹط©: ط¹ط¯ط¯ ط§ظ„ظپظˆط§طھظٹط±طŒ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط¨ظٹط¹ط§طھطŒ ط§ظ„ظ…ط¯ظپظˆط¹طŒ ط§ظ„ظ…ط³طھط­ظ‚. ط§ظ„طھظˆط§ط±ظٹط® ط§ط®طھظٹط§ط±ظٹط© ط¨طµظٹط؛ط© YYYY-MM-DD â€” ط§ظ„ظˆط¶ط¹ ط§ظ„ط§ظپطھط±ط§ط¶ظٹ: ط§ظ„ط´ظ‡ط± ط§ظ„ط­ط§ظ„ظٹ.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'طھط§ط±ظٹط® ط§ظ„ط¨ط¯ط§ظٹط© YYYY-MM-DD (ط§ط®طھظٹط§ط±ظٹ â€” ط§ظپطھط±ط§ط¶ظٹط§ظ‹ ط¨ط¯ط§ظٹط© ط§ظ„ط´ظ‡ط± ط§ظ„ط­ط§ظ„ظٹ)' },
        toDate: { type: 'string', description: 'طھط§ط±ظٹط® ط§ظ„ظ†ظ‡ط§ظٹط© YYYY-MM-DD (ط§ط®طھظٹط§ط±ظٹ â€” ط§ظپطھط±ط§ط¶ظٹط§ظ‹ ط§ظ„ظٹظˆظ…)' },
      },
    },
    execute: async (args, ctx) => {
      const from = typeof args.fromDate === 'string' ? args.fromDate : localMonthStart();
      const to = typeof args.toDate === 'string' ? args.toDate : localToday();

      // DB-side aggregate. The old client-side filter (500 newest invoices â†’
      // filter in JS) silently returned WRONG totals for any range older
      // than the newest 500 invoices.
      const res = await guardedQuery(
        `SELECT COUNT(*)::int AS invoice_count,
                COALESCE(SUM(total_amount), 0) AS total_sales,
                COALESCE(SUM(paid_amount), 0) AS total_paid
         FROM sales_invoices
         WHERE company_id = $1::uuid AND status != 'cancelled'
           AND date BETWEEN $2 AND $3`,
        [ctx.companyId, from, to],
      );
      if (!res.success || !res.rows) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ظ…ظ„ط®طµ ط§ظ„ظ…ط¨ظٹط¹ط§طھ' };
      const row = res.rows[0] || {};
      const total = num(row.total_sales);
      const paid = num(row.total_paid);
      return {
        period: { from, to },
        invoiceCount: num(row.invoice_count),
        totalSales: Math.round(total * 100) / 100,
        totalPaid: Math.round(paid * 100) / 100,
        totalOutstanding: Math.round((total - paid) * 100) / 100,
      };
    },
  },
  {
    name: 'sales.get_invoices',
    labelAr: 'ظپظˆط§طھظٹط± ط§ظ„ظ…ط¨ظٹط¹ط§طھ',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ظپظˆط§طھظٹط± ط§ظ„ظ…ط¨ظٹط¹ط§طھ (ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط©طŒ ط§ظ„ط¹ظ…ظٹظ„طŒ ط§ظ„طھط§ط±ظٹط®طŒ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹطŒ ط§ظ„ظ…ط¯ظپظˆط¹طŒ ط§ظ„ط­ط§ظ„ط©). ظٹظ…ظƒظ† ط§ظ„طھطµظپظٹط© ط­ط³ط¨ ط§ظ„ط­ط§ظ„ط©.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'posted', 'paid', 'partially_paid', 'cancelled'], description: 'طھطµظپظٹط© ط­ط³ط¨ ط§ظ„ط­ط§ظ„ط© (ط§ط®طھظٹط§ط±ظٹ)' },
        limit: { type: 'number', description: 'ط¹ط¯ط¯ ط§ظ„ظ†طھط§ط¦ط¬ (ط§ظپطھط±ط§ط¶ظٹ 10طŒ ط£ظ‚طµظ‰ 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const res = await salesApi.getInvoicesPaginated(ctx.companyId, 1, limit, { status });
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظپظˆط§طھظٹط±' };
      return {
        total: res.data.total,
        invoices: res.data.items.map((i) => ({
          id: i.id,
          number: i.invoiceNumber,
          customer: i.customer?.name,
          date: i.date,
          total: i.totalAmount,
          paid: i.paidAmount,
          status: i.status,
        })),
      };
    },
  },
  {
    name: 'sales.get_ar_aging',
    labelAr: 'ط£ط¹ظ…ط§ط± ط°ظ…ظ… ط§ظ„ط¹ظ…ظ„ط§ط،',
    descriptionAr: 'ظٹط¹ط±ط¶ ط§ظ„ظ…ط¨ط§ظ„ط؛ ط§ظ„ظ…ط³طھط­ظ‚ط© ط¹ظ„ظ‰ ط§ظ„ط¹ظ…ظ„ط§ط، ظ…ظ‚ط³ظ…ط© ط­ط³ط¨ ظپطھط±ط§طھ ط§ظ„طھط£ط®ظٹط± (0-30طŒ 31-60طŒ 61-90طŒ +90 ظٹظˆظ…).',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await salesApi.getCustomerArAging(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ط°ظ…ظ…' };
      const customers = res.data.slice(0, 20).map((c) => ({
        customer: c.customerName,
        totalDue: c.totalDue,
        buckets: Object.fromEntries(c.buckets.map((b) => [b.period, b.amount])),
      }));
      return {
        totalOutstanding: Math.round(res.data.reduce((s, c) => s + num(c.totalDue), 0) * 100) / 100,
        customersCount: res.data.length,
        topCustomers: customers,
      };
    },
  },
  {
    name: 'sales.get_customer_statement',
    labelAr: 'ظƒط´ظپ ط­ط³ط§ط¨ ط¹ظ…ظٹظ„',
    descriptionAr: 'ظٹط¹ط±ط¶ ظƒط´ظپ ط­ط³ط§ط¨ ط¹ظ…ظٹظ„ ظ…ط­ط¯ط¯ (ط§ظ„ظپظˆط§طھظٹط± ظˆط§ظ„ط³ظ†ط¯ط§طھ ظˆط§ظ„ط±طµظٹط¯). ظٹطھط·ظ„ط¨ ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„ customerId â€” ط§ط³طھط®ط¯ظ… ط£ط¯ط§ط© search.customers ظ„ط¥ظٹط¬ط§ط¯ظ‡ ظ…ظ† ط§ظ„ط§ط³ظ….',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'ظ…ط¹ط±ظپ ط§ظ„ط¹ظ…ظٹظ„ (UUID)' },
      },
      required: ['customerId'],
    },
    execute: async (args, ctx) => {
      const customerId = String(args.customerId || '');
      if (!customerId) return { error: 'customerId ظ…ط·ظ„ظˆط¨' };
      const res = await salesApi.getCustomerStatement(customerId, ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظƒط´ظپ' };
      const rows = res.data;
      return {
        rowsCount: rows.length,
        finalBalance: rows.length > 0 ? rows[rows.length - 1].balance : 0,
        statement: rows.slice(-30).map((r) => ({
          date: r.date,
          type: r.documentType,
          number: r.documentNumber,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        })),
      };
    },
  },

  // â”€â”€â”€ Purchases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'purchases.get_invoices',
    labelAr: 'ظپظˆط§طھظٹط± ط§ظ„ظ…ط´طھط±ظٹط§طھ',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ظپظˆط§طھظٹط± ط§ظ„ظ…ط´طھط±ظٹط§طھ (ط§ظ„ط±ظ‚ظ…طŒ ط§ظ„ظ…ظˆط±ط¯طŒ ط§ظ„طھط§ط±ظٹط®طŒ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹطŒ ط§ظ„ط­ط§ظ„ط©). ظٹظ…ظƒظ† ط§ظ„طھطµظپظٹط© ط­ط³ط¨ ط§ظ„ط­ط§ظ„ط©.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'posted', 'paid', 'partially_paid', 'cancelled'] },
        limit: { type: 'number', description: 'ط¹ط¯ط¯ ط§ظ„ظ†طھط§ط¦ط¬ (ط§ظپطھط±ط§ط¶ظٹ 10طŒ ط£ظ‚طµظ‰ 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const res = await purchasesApi.getInvoicesPaginated(ctx.companyId, 1, limit, { status });
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظپظˆط§طھظٹط±' };
      return {
        total: res.data.total,
        invoices: res.data.items.map((i) => ({
          id: i.id,
          number: i.invoiceNumber,
          supplier: i.supplier?.name,
          date: i.date,
          total: i.totalAmount,
          paid: i.paidAmount,
          status: i.status,
        })),
      };
    },
  },
  {
    name: 'purchases.get_ap_aging_total',
    labelAr: 'ط¥ط¬ظ…ط§ظ„ظٹ ظ…ط³طھط­ظ‚ط§طھ ط§ظ„ظ…ظˆط±ط¯ظٹظ†',
    descriptionAr: 'ظٹط¹ط·ظٹ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط¨ط§ظ„ط؛ ط§ظ„ظ…ط³طھط­ظ‚ط© ظ„ظ„ظ…ظˆط±ط¯ظٹظ† (ط°ظ…ظ… ط§ظ„ظ…ط´طھط±ظٹط§طھ ط؛ظٹط± ط§ظ„ظ…ط³ط¯ط¯ط©).',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await purchasesApi.getApAgingTotal(ctx.companyId);
      if (!res.success) return { error: res.error || 'ظپط´ظ„ ط§ظ„ط¬ظ„ط¨' };
      return { totalOutstandingToSuppliers: res.total ?? 0 };
    },
  },

  // â”€â”€â”€ Accounting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'accounting.get_trial_balance',
    labelAr: 'ظ…ظٹط²ط§ظ† ط§ظ„ظ…ط±ط§ط¬ط¹ط©',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ…ظٹط²ط§ظ† ط§ظ„ظ…ط±ط§ط¬ط¹ط©: ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط¯ظٹظ† ظˆط§ظ„ط¯ط§ط¦ظ† ظˆط£ظƒط¨ط± ط§ظ„ط­ط³ط§ط¨ط§طھ ط±طµظٹط¯ط§ظ‹. ط§ط³طھط®ط¯ظ…ظ‡ ظ„ظ„ط£ط³ط¦ظ„ط© ط§ظ„ظ…ط§ظ„ظٹط© ط§ظ„ط¹ط§ظ…ط©.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await accountingApi.getTrialBalance(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظ…ظٹط²ط§ظ†' };
      const rows = res.data.map((r) => ({
        code: r.accountCode,
        name: r.accountName,
        debit: num(r.debit),
        credit: num(r.credit),
        balance: num(r.balance),
      }));
      const top = [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 15);
      return {
        totalDebit: Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100,
        totalCredit: Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100,
        accountsCount: rows.length,
        topAccounts: top,
      };
    },
  },
  {
    name: 'accounting.get_profit_loss',
    labelAr: 'ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„ (ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ ظˆط§ظ„ظ…طµط±ظˆظپط§طھ ظˆطµط§ظپظٹ ط§ظ„ط±ط¨ط­) ظ„ظپطھط±ط© ط²ظ…ظ†ظٹط©. ط§ظ„طھظˆط§ط±ظٹط® ط§ط®طھظٹط§ط±ظٹط© ط¨طµظٹط؛ط© YYYY-MM-DD.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'YYYY-MM-DD (ط§ط®طھظٹط§ط±ظٹ)' },
        toDate: { type: 'string', description: 'YYYY-MM-DD (ط§ط®طھظٹط§ط±ظٹ)' },
      },
    },
    execute: async (args, ctx) => {
      const from = typeof args.fromDate === 'string' ? args.fromDate : undefined;
      const to = typeof args.toDate === 'string' ? args.toDate : undefined;
      const res = await accountingApi.getProfitLoss(ctx.companyId, from, to);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„' };
      const rows = res.data.map((a) => ({
        code: a.code,
        name: a.nameAr || a.nameEn || '',
        type: a.type,
        balance: num(a.balance),
      }));
      const revenue = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.balance, 0);
      const expenses = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
      return {
        period: { from, to },
        totalRevenue: Math.round(revenue * 100) / 100,
        totalExpenses: Math.round(expenses * 100) / 100,
        netProfit: Math.round((revenue - expenses) * 100) / 100,
        topAccounts: [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 12),
      };
    },
  },

  // â”€â”€â”€ Inventory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'inventory.get_products',
    labelAr: 'ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ظ†طھط¬ط§طھ',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ظ†طھط¬ط§طھ (ط§ظ„ظƒظˆط¯طŒ ط§ظ„ط§ط³ظ…طŒ ط³ط¹ط± ط§ظ„ط¨ظٹط¹طŒ ط³ط¹ط± ط§ظ„طھظƒظ„ظپط©طŒ ط§ظ„ظƒظ…ظٹط©). ظٹظ…ظƒظ† ط§ظ„ط¨ط­ط« ط¨ط§ظ„ط§ط³ظ… ط£ظˆ ط§ظ„ظƒظˆط¯.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'ظ†طµ ط§ظ„ط¨ط­ط« (ط§ط®طھظٹط§ط±ظٹ)' },
        limit: { type: 'number', description: 'ط¹ط¯ط¯ ط§ظ„ظ†طھط§ط¦ط¬ (ط§ظپطھط±ط§ط¶ظٹ 10طŒ ط£ظ‚طµظ‰ 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const search = typeof args.search === 'string' && args.search ? args.search : undefined;
      const res = await inventoryApi.getProductsPaginated(ctx.companyId, 1, limit, { search });
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظ…ظ†طھط¬ط§طھ' };
      return {
        total: res.data.total,
        products: res.data.items.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.nameAr,
          salePrice: p.salePrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          unit: p.unitName || p.unit,
        })),
      };
    },
  },

  // â”€â”€â”€ CRM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'crm.get_leads',
    labelAr: 'ط§ظ„ط¹ظ…ظ„ط§ط، ط§ظ„ظ…ط­طھظ…ظ„ظٹظ†',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ط¹ظ…ظ„ط§ط، ط§ظ„ظ…ط­طھظ…ظ„ظٹظ† (ط§ظ„ط§ط³ظ…طŒ ط§ظ„ظ‡ط§طھظپطŒ ط§ظ„ط­ط§ظ„ط©طŒ ط§ظ„طھظ‚ظٹظٹظ…طŒ ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…طھظˆظ‚ط¹ط©).',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'converted', 'lost'] },
      },
    },
    execute: async (args, ctx) => {
      const res = await crmApi.getLeads(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ط¹ظ…ظ„ط§ط،' };
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const filtered = status ? res.data.filter((l) => l.status === status) : res.data;
      return {
        total: filtered.length,
        leads: filtered.slice(0, 20).map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          status: l.status,
          rating: l.rating,
          estimatedValue: l.estimatedValue,
          assignedTo: l.assignedName,
        })),
      };
    },
  },
  {
    name: 'crm.get_opportunities',
    labelAr: 'ط§ظ„ظپط±طµ ط§ظ„ط¨ظٹط¹ظٹط©',
    descriptionAr: 'ظٹط¹ط±ط¶ ط§ظ„ظپط±طµ ط§ظ„ط¨ظٹط¹ظٹط© ظˆظ‚ظٹظ…ط© ط®ط· ط§ظ„ط£ظ†ط§ط¨ظٹط¨ (pipeline) ط­ط³ط¨ ط§ظ„ظ…ط±ط­ظ„ط©.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await crmApi.getOpportunities(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظپط±طµ' };
      const open = res.data.filter((o) => o.stage !== 'won' && o.stage !== 'lost');
      const pipelineValue = open.reduce((s, o) => s + num(o.value), 0);
      const weighted = open.reduce((s, o) => s + num(o.value) * (num(o.probability) / 100), 0);
      return {
        openCount: open.length,
        pipelineValue: Math.round(pipelineValue * 100) / 100,
        weightedValue: Math.round(weighted * 100) / 100,
        opportunities: res.data.slice(0, 20).map((o) => ({
          id: o.id,
          name: o.name,
          value: o.value,
          stage: o.stage,
          probability: o.probability,
        })),
      };
    },
  },
  {
    name: 'crm.get_tasks',
    labelAr: 'ظ…ظ‡ط§ظ… ط§ظ„ظ…طھط§ط¨ط¹ط©',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ظ…ظ‡ط§ظ… ط§ظ„ظ…طھط§ط¨ط¹ط© (ط§ظ„ط¹ظ†ظˆط§ظ†طŒ ط§ظ„ط£ظˆظ„ظˆظٹط©طŒ ط§ظ„ط­ط§ظ„ط©طŒ طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚طŒ ظ‡ظ„ ظ…طھط£ط®ط±ط©). ظٹظ…ظƒظ† ط§ظ„ظپظ„طھط±ط© ط¨ط§ظ„ط­ط§ظ„ط© ظˆط§ظ„ط£ظˆظ„ظˆظٹط©.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'completed', 'cancelled'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
    },
    execute: async (args, ctx) => {
      const res = await crmApi.getTasks(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظ…ظ‡ط§ظ…' };
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const priority = typeof args.priority === 'string' && args.priority ? args.priority : undefined;
      let filtered = res.data;
      if (status) filtered = filtered.filter((t) => t.status === status);
      if (priority) filtered = filtered.filter((t) => t.priority === priority);
      // Lexicographic YYYY-MM-DD compare â€” no Date parsing, no UTC shift.
      const todayStr = localToday();
      const isOverdue = (t: { status?: string; dueDate?: string | null }) =>
        t.status === 'pending' && typeof t.dueDate === 'string' && !!t.dueDate && t.dueDate < todayStr;
      return {
        total: filtered.length,
        overdue: filtered.filter(isOverdue).length,
        tasks: filtered.slice(0, 20).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          overdue: isOverdue(t),
          assignedTo: t.assignedName,
          leadId: t.leadId,
          opportunityId: t.opportunityId,
          customerId: t.customerId,
        })),
      };
    },
  },
  {
    name: 'crm.get_activities',
    labelAr: 'ط³ط¬ظ„ ط§ظ„ط£ظ†ط´ط·ط©',
    descriptionAr: 'ظٹط¹ط±ط¶ ط³ط¬ظ„ ط£ظ†ط´ط·ط© ط§ظ„طھظˆط§طµظ„ (ط§طھطµط§ظ„ط§طھطŒ ط§ط¬طھظ…ط§ط¹ط§طھطŒ ط²ظٹط§ط±ط§طھ). ظٹظ…ظƒظ† ط§ظ„ظپظ„طھط±ط© ط¨ط§ظ„ظ†ظˆط¹.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['call', 'meeting', 'email', 'visit', 'note'] },
      },
    },
    execute: async (args, ctx) => {
      const res = await crmApi.getActivities(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ط£ظ†ط´ط·ط©' };
      const type = typeof args.type === 'string' && args.type ? args.type : undefined;
      const filtered = type ? res.data.filter((a) => a.type === type) : res.data;
      return {
        total: filtered.length,
        activities: filtered.slice(0, 20).map((a) => ({
          id: a.id,
          type: a.type,
          subject: a.subject,
          activityDate: a.activityDate,
          durationMinutes: a.durationMinutes,
          assignedTo: a.assignedName,
          leadId: a.leadId,
          opportunityId: a.opportunityId,
          customerId: a.customerId,
        })),
      };
    },
  },

  // â”€â”€â”€ HR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'hr.get_employees',
    labelAr: 'ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ظˆط¸ظپظٹظ†',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ظˆط¸ظپظٹظ† (ط§ظ„ط±ظ‚ظ…طŒ ط§ظ„ط§ط³ظ…طŒ ط§ظ„ظ‚ط³ظ…طŒ ط§ظ„ظ…ظ†طµط¨طŒ ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹطŒ ط§ظ„ط­ط§ظ„ط©).',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await hrApi.getEmployees(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظ…ظˆط¸ظپظٹظ†' };
      const active = res.data.filter((e) => e.isActive);
      return {
        totalEmployees: res.data.length,
        activeEmployees: active.length,
        employees: res.data.slice(0, 25).map((e) => ({
          id: e.id,
          number: e.employeeNumber,
          name: e.fullName,
          department: e.departmentName,
          position: e.position,
          baseSalary: e.baseSalary,
          isActive: e.isActive,
        })),
      };
    },
  },

  // â”€â”€â”€ AI Analytics Read Tools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'read.inventory_valuation',
    labelAr: 'طھظ‚ظٹظٹظ… ط§ظ„ظ…ط®ط²ظˆظ†',
    descriptionAr: 'ظٹط¹ط±ط¶ طھظ‚ظٹظٹظ… ط§ظ„ظ…ط®ط²ظˆظ†: ط¥ط¬ظ…ط§ظ„ظٹ ظ‚ظٹظ…ط© ط§ظ„ظ…ط®ط²ظˆظ† ط­ط³ط¨ ط§ظ„ظ…ظ†طھط¬ ظ…ط¹ ط³ط¹ط± ط§ظ„طھظƒظ„ظپط© ظˆط§ظ„ظƒظ…ظٹط© ظˆط§ظ„ظ‚ظٹظ…ط© ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹط© ظ„ظƒظ„ ظ…ظ†طھط¬.',
    // P0-6 fix: this tool reads module data gated by inventory.view — ai.use alone
    // leaked it to every AI user (e.g. sales_rep without hr.view).
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await inventoryApi.getProducts(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ظ…ط®ط²ظˆظ†' };
      const withStock = res.data.filter((p) => num(p.quantity) > 0 || num(p.costPrice) > 0);
      const totalValue = withStock.reduce((s, p) => s + num(p.quantity) * num(p.costPrice), 0);
      return {
        totalValue: Math.round(totalValue * 100) / 100,
        productCount: withStock.length,
        products: withStock.slice(0, 25).map((p) => ({
          code: p.code,
          name: p.nameAr || p.nameEn,
          quantity: p.quantity,
          costPrice: p.costPrice,
          lineValue: Math.round(num(p.quantity) * num(p.costPrice) * 100) / 100,
        })),
      };
    },
  },
  {
    name: 'read.employee_payroll_history',
    labelAr: 'ط³ط¬ظ„ ط±ظˆط§طھط¨ ط§ظ„ظ…ظˆط¸ظپ',
    descriptionAr: 'ظٹط¹ط±ط¶ ط³ط¬ظ„ ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨ ظ„ظ…ظˆط¸ظپ ظ…ط¹ظٹظ† ظ…ط¹ ط§ظ„طھظپط§طµظٹظ„ (ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹطŒ ط§ظ„ط¨ط¯ظ„ط§طھطŒ ط§ظ„ط®طµظˆظ…ط§طھطŒ طµط§ظپظٹ ط§ظ„ط±ط§طھط¨). ظٹظ…ظƒظ† طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپ ط£ظˆ ط¹ط±ط¶ ط¢ط®ط± ط§ظ„ظ…ط³ظٹط±ط§طھ.',
    // P0-6 fix: this tool reads module data gated by hr.view — ai.use alone
    // leaked it to every AI user (e.g. sales_rep without hr.view).
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'ظ…ط¹ط±ظپ ط§ظ„ظ…ظˆط¸ظپ (UUIDطŒ ط§ط®طھظٹط§ط±ظٹ â€” ط¥ط°ط§ ظ„ظ… ظٹظڈط­ط¯ط¯ ظٹط¹ط±ط¶ ط¢ط®ط± 6 ظ…ط³ظٹط±ط§طھ)' },
        limit: { type: 'number', description: 'ط¹ط¯ط¯ ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨ (ط§ظپطھط±ط§ط¶ظٹ 6طŒ ط£ظ‚طµظ‰ 12)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 6, 1), 12);
      const employeeId = args.employeeId ? String(args.employeeId) : undefined;
      const res = await hrApi.getPayrollRuns(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨' };
      const runs = res.data
        .sort((a, b) => b.year - a.year || b.month - a.month)
        .slice(0, limit);
      const all = runs.map((r) => {
        const empLines = employeeId ? r.lines.filter((l) => l.employeeId === employeeId) : r.lines;
        return {
          runLabel: `${r.month}/${r.year}`,
          status: r.status,
          totalAmount: r.totalAmount,
          lines: empLines.slice(0, 10).map((l) => ({
            employee: l.employeeName,
            baseSalary: l.baseSalary,
            allowances: l.allowances,
            deductions: l.deductions,
            overtime: l.overtime,
            netSalary: l.netSalary,
          })),
        };
      });
      return { runs: all };
    },
  },
  {
    name: 'read.attendance_summary',
    labelAr: 'ظ…ظ„ط®طµ ط§ظ„ط­ط¶ظˆط±',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ…ظ„ط®طµ ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط§ظ†طµط±ط§ظپ ظ„ظپطھط±ط© ظ…ط­ط¯ط¯ط© (ط¹ط¯ط¯ ط§ظ„ط­ط§ط¶ط±ظٹظ†طŒ ط§ظ„ط؛ط§ط¦ط¨ظٹظ†طŒ ط§ظ„ظ…طھط£ط®ط±ظٹظ†طŒ ظپظٹ ط¥ط¬ط§ط²ط© ظˆظ†ط³ط¨ط© ط§ظ„ط­ط¶ظˆط±). ظٹظ…ظƒظ† طھط­ط¯ظٹط¯ ط§ظ„ط´ظ‡ط± ظˆط§ظ„ط³ظ†ط©.',
    // P0-6 fix: this tool reads module data gated by hr.view — ai.use alone
    // leaked it to every AI user (e.g. sales_rep without hr.view).
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'ط±ظ‚ظ… ط§ظ„ط´ظ‡ط± (1-12طŒ ط§ظپطھط±ط§ط¶ظٹ ط§ظ„ط´ظ‡ط± ط§ظ„ط­ط§ظ„ظٹ)' },
        year: { type: 'number', description: 'ط§ظ„ط³ظ†ط© (ط§ظپطھط±ط§ط¶ظٹ ط§ظ„ط³ظ†ط© ط§ظ„ط­ط§ظ„ظٹط©)' },
      },
    },
    execute: async (args, ctx) => {
      const now = new Date();
      const month = num(args.month) || (now.getMonth() + 1);
      const year = num(args.year) || now.getFullYear();
      const res = await hrApi.getAttendance(ctx.companyId, month, year);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ط­ط¶ظˆط±' };
      const records = res.data;
      const present = records.filter((r) => r.status === 'present').length;
      const absent = records.filter((r) => r.status === 'absent').length;
      const late = records.filter((r) => r.status === 'late').length;
      const onLeave = records.filter((r) => r.status === 'on_leave').length;
      return {
        period: `${month}/${year}`,
        totalRecords: records.length,
        present,
        absent,
        late,
        onLeave,
        attendanceRate: records.length ? Math.round((present / records.length) * 10000) / 100 : 0,
        details: records.slice(0, 20).map((r) => ({
          employee: r.employeeName,
          date: r.date,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          status: r.status,
        })),
      };
    },
  },
  {
    name: 'read.end_of_service',
    labelAr: 'ظ…ظƒط§ظپط£ط© ظ†ظ‡ط§ظٹط© ط§ظ„ط®ط¯ظ…ط©',
    descriptionAr: 'ظٹط¹ط±ط¶ طھظپط§طµظٹظ„ ظ…ظƒط§ظپط£ط© ظ†ظ‡ط§ظٹط© ط§ظ„ط®ط¯ظ…ط© ظ„ظ„ظ…ظˆط¸ظپظٹظ† (ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط®ظٹط±طŒ ط³ظ†ظˆط§طھ ط§ظ„ط®ط¯ظ…ط©طŒ ظ‚ظٹظ…ط© ط§ظ„ظ…ظƒط§ظپط£ط©طŒ ط³ط¨ط¨ ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚طŒ ط§ظ„ط­ط§ظ„ط©). ظٹظ…ظƒظ† ط§ظ„طھطµظپظٹط© ط¨ظ…ط¹ط±ظپ ط§ظ„ظ…ظˆط¸ظپ.',
    // P0-6 fix: this tool reads module data gated by hr.view — ai.use alone
    // leaked it to every AI user (e.g. sales_rep without hr.view).
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'ظ…ط¹ط±ظپ ط§ظ„ظ…ظˆط¸ظپ (UUIDطŒ ط§ط®طھظٹط§ط±ظٹ)' },
      },
    },
    execute: async (args, ctx) => {
      const employeeId = args.employeeId ? String(args.employeeId) : undefined;
      const res = await hrApi.getEndOfServices(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ظ†ظ‡ط§ظٹط© ط§ظ„ط®ط¯ظ…ط©' };
      let filtered = res.data;
      if (employeeId) filtered = filtered.filter((e) => e.employeeId === employeeId);
      // P3 fix: total only approved/paid rows (real liabilities). The old
      // sum swept drafts (estimates) and cancelled rows into totalEosAmount.
      const totalEos = filtered
        .filter((e) => e.status === 'approved' || e.status === 'paid')
        .reduce((s, e) => s + num(e.eosAmount), 0);
      return {
        totalCalculations: filtered.length,
        totalEosAmount: Math.round(totalEos * 100) / 100,
        items: filtered.slice(0, 20).map((e) => ({
          employee: e.employeeName,
          terminationDate: e.terminationDate,
          serviceYears: e.serviceYears,
          lastSalary: e.lastSalary,
          eosAmount: e.eosAmount,
          reason: e.reason,
          status: e.status,
        })),
      };
    },
  },
  // â”€â”€â”€ HR: KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'read.hr_kpis',
    labelAr: 'ظ…ط¤ط´ط±ط§طھ ط§ظ„ظ…ظˆط§ط±ط¯ ط§ظ„ط¨ط´ط±ظٹط©',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ…ط¤ط´ط±ط§طھ HR ط§ظ„ط±ط¦ظٹط³ظٹط©: ط¹ط¯ط¯ ط§ظ„ظ…ظˆط¸ظپظٹظ†طŒ ظ†ط³ط¨ط© ط§ظ„ط­ط¶ظˆط±طŒ ط¥ط¬ظ…ط§ظ„ظٹ ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨طŒ ط¥ظ„ط®.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const res = await hrApi.getHrKpis(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ظ…ط¤ط´ط±ط§طھ HR' };
      return {
        totalEmployees: res.data.totalEmployees,
        activeEmployees: res.data.activeEmployees,
        pendingLeaves: res.data.pendingLeaves,
        totalPayrollAmount: res.data.totalPayrollAmount,
      };
    },
  },
  // â”€â”€â”€ Inventory: KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    name: 'read.inventory_kpis',
    labelAr: 'ظ…ط¤ط´ط±ط§طھ ط§ظ„ظ…ط®ط²ظˆظ†',
    descriptionAr: 'ظٹط¹ط±ط¶ ظ…ط¤ط´ط±ط§طھ ط§ظ„ظ…ط®ط²ظˆظ† ط§ظ„ط±ط¦ظٹط³ظٹط©: ظ‚ظٹظ…ط© ط§ظ„ظ…ط®ط²ظˆظ†طŒ ط¹ط¯ط¯ ط§ظ„ظ…ظ†طھط¬ط§طھ ظ…ظ†ط®ظپط¶ط© ط§ظ„ظ…ط®ط²ظˆظ†طŒ ط¹ط¯ط¯ ط§ظ„ظ…ط³طھظˆط¯ط¹ط§طھطŒ ط¹ط¯ط¯ ط­ط±ظƒط§طھ ط§ظ„ظ…ط®ط²ظˆظ†.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const res = await inventoryApi.getInventoryKpis(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'ظپط´ظ„ ط¬ظ„ط¨ ظ…ط¤ط´ط±ط§طھ ط§ظ„ظ…ط®ط²ظˆظ†' };
      return res.data;
    },
  },
];
