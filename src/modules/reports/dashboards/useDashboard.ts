import { useState, useEffect } from 'react';
import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { aggregateCustomerAging, parseOutstandingRows, type CustomerAging } from '@/core/utils/aging';

export type PeriodFilter = 'today' | 'week' | 'month' | 'year' | 'custom';

export interface DateRange {
  from?: string;
  to?: string;
}

export interface DashboardData {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  invoicesCount: number;
  productsCount: number;
  customersCount: number;
  suppliersCount: number;
  employeesCount: number;
  lowStockCount: number;
  overdueInvoicesCount: number;
  crmLeadsCount: number;
  crmOpportunitiesCount: number;
  crmPipelineValue: number;
  crmConversionRate: number;
  crmWonDealsCount: number;
  crmLostDealsCount: number;
  crmAvgDealValue: number;
  pipelineByStage: Array<{ stage: string; value: number; count: number }>;
  monthlyRevenue: Array<{ month: string; revenue: number; expenses: number }>;
  topProducts: Array<{ name: string; value: number }>;
  arAging: Array<{ range: string; amount: number }>;
  cashFlow: Array<{ month: string; inflow: number; outflow: number }>;
  salesTrend: Array<{ date: string; sales: number; purchases: number }>;
  profitTrend: Array<{ date: string; profit: number }>;
  categoryShare: Array<{ name: string; value: number }>;
}

export interface DashboardFilters {
  period: PeriodFilter;
  dateRange?: DateRange;
  comparePrevious: boolean;
}

function getPeriodDates(period: PeriodFilter, customRange?: DateRange): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();

  switch (period) {
    case 'today':
      from.setHours(0, 0, 0, 0);
      break;
    case 'week':
      from.setDate(to.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      break;
    case 'month':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
    case 'year':
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      break;
    case 'custom':
      if (customRange?.from && customRange?.to) {
        return { from: new Date(customRange.from), to: new Date(customRange.to) };
      }
      from.setMonth(to.getMonth() - 1);
      break;
  }

  return { from, to };
}

function getPreviousPeriodDates(period: PeriodFilter, customRange?: DateRange): { from: Date; to: Date } {
  const current = getPeriodDates(period, customRange);
  const duration = current.to.getTime() - current.from.getTime();
  const from = new Date(current.from.getTime() - duration);
  const to = new Date(current.to.getTime() - duration);
  return { from, to };
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface ComparisonData {
  current: DashboardData;
  previous?: DashboardData;
}

export function useDashboard(companyId: string, filters: DashboardFilters) {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();
        const currentRange = getPeriodDates(filters.period, filters.dateRange);
        const prevRange = filters.comparePrevious ? getPreviousPeriodDates(filters.period, filters.dateRange) : null;

        const currentData = await fetchDashboardData(adapter, companyId, currentRange);
        let previousData: DashboardData | undefined;

        if (prevRange) {
          previousData = await fetchDashboardData(adapter, companyId, prevRange);
        }

        if (!cancelled) {
          setData({ current: currentData, previous: previousData });
        }
      } catch (_err) {
        // Error handled silently — setState retains previous data
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [companyId, filters]);

  return { data, isLoading };
}

const AR_BUCKET_SQL = `SELECT customer_id, date::text AS date, due_date::text AS due_date,
                              (total_amount - paid_amount) AS outstanding,
                              invoice_number
                         FROM sales_invoices
                        WHERE company_id = $1
                          AND status NOT IN ('paid', 'cancelled')
                          AND (total_amount - paid_amount) > 0`;

const AR_AGGREGATE_SQL = `SELECT id, name, phone, balance
                            FROM customers
                           WHERE company_id = $1`;

async function fetchDashboardData(adapter: DbAdapter, companyId: string, range: { from: Date; to: Date }): Promise<DashboardData> {
  const fromStr = formatDate(range.from);
  const toStr = formatDate(range.to);
  const durationMs = range.to.getTime() - range.from.getTime();
  const days = Math.max(1, Math.ceil(durationMs / (1000 * 60 * 60 * 24)));

  // 1. Period totals (revenue, expenses, profit)
  const [revResult, expResult, invResult] = await Promise.all([
    adapter.query<{ revenue: string | number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue
         FROM sales_invoices
        WHERE company_id = $1 AND date >= $2 AND date <= $3
          AND status != 'cancelled'`,
      [companyId, fromStr, toStr],
    ),
    adapter.query<{ expenses: string | number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS expenses
         FROM purchase_invoices
        WHERE company_id = $1 AND date >= $2 AND date <= $3
          AND status != 'cancelled'`,
      [companyId, fromStr, toStr],
    ),
    adapter.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::int AS cnt
         FROM sales_invoices
        WHERE company_id = $1 AND date >= $2 AND date <= $3`,
      [companyId, fromStr, toStr],
    ),
  ]);
  const totalRevenue = toNum(revResult.rows?.[0]?.revenue);
  const totalExpenses = toNum(expResult.rows?.[0]?.expenses);
  const netProfit = totalRevenue - totalExpenses;
  const invoicesCount = toNum(invResult.rows?.[0]?.cnt);

  // 2. Master counts (customers, suppliers, employees, products, low stock, overdue)
  const [custResult, suppResult, empResult, prodResult, overdueResult, lowStockResult] = await Promise.all([
    adapter.query<{ cnt: string | number }>(`SELECT COUNT(*)::int AS cnt FROM customers WHERE company_id = $1`, [companyId]),
    adapter.query<{ cnt: string | number }>(`SELECT COUNT(*)::int AS cnt FROM suppliers WHERE company_id = $1`, [companyId]),
    adapter.query<{ cnt: string | number }>(`SELECT COUNT(*)::int AS cnt FROM employees WHERE company_id = $1`, [companyId]),
    adapter.query<{ cnt: string | number }>(`SELECT COUNT(*)::int AS cnt FROM products WHERE company_id = $1 AND is_active = true`, [companyId]),
    adapter.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::int AS cnt
         FROM sales_invoices
        WHERE company_id = $1
          AND status NOT IN ('paid', 'cancelled')
          AND due_date < CURRENT_DATE
          AND paid_amount < total_amount`,
      [companyId],
    ),
    adapter.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::int AS cnt
         FROM stock s JOIN products p ON s.product_id = p.id
        WHERE p.company_id = $1 AND p.is_active = true
          AND s.min_stock_alert IS NOT NULL
          AND s.quantity <= s.min_stock_alert`,
      [companyId],
    ),
  ]);
  const customersCount = toNum(custResult.rows?.[0]?.cnt);
  const suppliersCount = toNum(suppResult.rows?.[0]?.cnt);
  const employeesCount = toNum(empResult.rows?.[0]?.cnt);
  const productsCount = toNum(prodResult.rows?.[0]?.cnt);
  const overdueInvoicesCount = toNum(overdueResult.rows?.[0]?.cnt);
  const lowStockCount = toNum(lowStockResult.rows?.[0]?.cnt);

  // CRM KPIs
  const crmLeadsResult = await adapter.query<{ cnt: string | number }>(
    `SELECT COUNT(*)::int AS cnt FROM leads WHERE company_id = $1`, [companyId]
  );
  const crmOppsResult = await adapter.query<{ total_value: string | number; cnt: string | number }>(
    `SELECT COALESCE(SUM(COALESCE(value, 0)), 0) AS total_value,
            COUNT(*)::int AS cnt
       FROM opportunities
      WHERE company_id = $1 AND stage NOT IN ('won', 'lost')`, [companyId]
  );
  const crmLeadsCount = toNum(crmLeadsResult.rows?.[0]?.cnt);
  const crmOpportunitiesCount = toNum(crmOppsResult.rows?.[0]?.cnt);
  const crmPipelineValue = toNum(crmOppsResult.rows?.[0]?.total_value);
  const crmConversionRate = crmLeadsCount > 0 ? Math.round((crmOpportunitiesCount / crmLeadsCount) * 100) : 0;

  const [crmWonResult, crmLostResult, crmAvgResult] = await Promise.all([
    adapter.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::int AS cnt FROM opportunities WHERE company_id = $1 AND stage = 'won'`, [companyId]
    ),
    adapter.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::int AS cnt FROM opportunities WHERE company_id = $1 AND stage = 'lost'`, [companyId]
    ),
    adapter.query<{ avg: string | number }>(
      `SELECT COALESCE(AVG(value), 0) AS avg FROM opportunities WHERE company_id = $1 AND stage = 'won'`, [companyId]
    ),
  ]);
  const crmWonDealsCount = toNum(crmWonResult.rows?.[0]?.cnt);
  const crmLostDealsCount = toNum(crmLostResult.rows?.[0]?.cnt);
  const crmAvgDealValue = toNum(crmAvgResult.rows?.[0]?.avg);

  const stageResult = await adapter.query<{ stage: string; value: string | number; cnt: string | number }>(
    `SELECT stage, COALESCE(SUM(value), 0) AS value, COUNT(*)::int AS cnt
       FROM opportunities
      WHERE company_id = $1
      GROUP BY stage
      ORDER BY MIN(CASE stage
        WHEN 'new' THEN 1 WHEN 'qualified' THEN 2
        WHEN 'proposal' THEN 3 WHEN 'negotiation' THEN 4
        WHEN 'won' THEN 5 WHEN 'lost' THEN 6 ELSE 7
      END)`,
    [companyId],
  );
  const pipelineByStage: DashboardData['pipelineByStage'] = (stageResult.rows || []).map((r) => ({
    stage: String(r.stage),
    value: toNum(r.value),
    count: toNum(r.cnt),
  }));

  // 3. Monthly revenue (only when period spans >60 days, otherwise daily)
  const showMonthly = days > 60;
  const monthlyRevenue: DashboardData['monthlyRevenue'] = [];
  if (showMonthly) {
    const monthRes = await adapter.query<{ month: string; revenue: string | number; expenses: string | number }>(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', $2::date),
           date_trunc('month', $3::date),
           '1 month'::interval
         ) AS m
       )
       SELECT TO_CHAR(months.m, 'YYYY-MM') AS month,
              COALESCE(SUM(CASE WHEN si.total_amount IS NOT NULL THEN si.total_amount ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN pi.total_amount IS NOT NULL THEN pi.total_amount ELSE 0 END), 0) AS expenses
         FROM months
         LEFT JOIN sales_invoices si ON si.company_id = $1
               AND si.date >= months.m AND si.date < months.m + INTERVAL '1 month'
               AND si.status != 'cancelled'
          LEFT JOIN purchase_invoices pi ON pi.company_id = $1
               AND pi.date >= months.m AND pi.date < months.m + INTERVAL '1 month'
               AND pi.status != 'cancelled'
        GROUP BY months.m
        ORDER BY months.m`,
      [companyId, fromStr, toStr],
    );
    for (const r of monthRes.rows || []) {
      monthlyRevenue.push({
        month: String(r.month),
        revenue: toNum(r.revenue),
        expenses: toNum(r.expenses),
      });
    }
  } else {
    const dayRes = await adapter.query<{ day: string; revenue: string | number; expenses: string | number }>(
      `WITH days AS (
         SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS d
       )
       SELECT TO_CHAR(days.d, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(CASE WHEN si.total_amount IS NOT NULL THEN si.total_amount ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN pi.total_amount IS NOT NULL THEN pi.total_amount ELSE 0 END), 0) AS expenses
         FROM days
         LEFT JOIN sales_invoices si ON si.company_id = $1 AND si.date = days.d AND si.status != 'cancelled'
         LEFT JOIN purchase_invoices pi ON pi.company_id = $1 AND pi.date = days.d AND pi.status != 'cancelled'
        GROUP BY days.d
        ORDER BY days.d`,
      [companyId, fromStr, toStr],
    );
    for (const r of dayRes.rows || []) {
      monthlyRevenue.push({
        month: String(r.day),
        revenue: toNum(r.revenue),
        expenses: toNum(r.expenses),
      });
    }
  }

  // 4. Top products (top 5 by sales)
  const topProdResult = await adapter.query<{ name: string; value: string | number }>(
    `SELECT p.name_ar AS name, COALESCE(SUM(sil.line_total), 0) AS value
       FROM products p
       JOIN sales_invoice_lines sil ON sil.product_id = p.id
       JOIN sales_invoices si ON sil.invoice_id = si.id
      WHERE p.company_id = $1
        AND si.date >= $2 AND si.date <= $3
        AND si.status != 'cancelled'
      GROUP BY p.id, p.name_ar
      ORDER BY value DESC
      LIMIT 5`,
    [companyId, fromStr, toStr],
  );
  const topProducts: DashboardData['topProducts'] = (topProdResult.rows || []).map((r) => ({
    name: String(r.name || ''),
    value: toNum(r.value),
  }));

  // 5. AR Aging (use real aging.ts logic)
  const arCustomersResult = await adapter.query<{ id: string; name: string; phone: string; balance: string | number }>(
    AR_AGGREGATE_SQL,
    [companyId],
  );
  const arInvoicesResult = await adapter.query<{
    customer_id: string;
    date: string;
    due_date: string | null;
    outstanding: string | number;
    invoice_number: string;
  }>(AR_BUCKET_SQL, [companyId]);
  const customerAgingList: CustomerAging[] = aggregateCustomerAging(
    parseOutstandingRows(arInvoicesResult),
    toStr,
    (arCustomersResult.rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone || '',
      balance: toNum(r.balance),
    })),
  );
  const arAging: DashboardData['arAging'] = [
    { range: '0-30', amount: customerAgingList.reduce((s, c) => s + c.bucket0to30, 0) },
    { range: '31-60', amount: customerAgingList.reduce((s, c) => s + c.bucket31to60, 0) },
    { range: '61-90', amount: customerAgingList.reduce((s, c) => s + c.bucket61to90, 0) },
    { range: '90+', amount: customerAgingList.reduce((s, c) => s + c.bucket90plus, 0) },
  ];

  // 6. Cash flow (cash accounts: codes 111* or 112*) — monthly or daily
  const cashFlow: DashboardData['cashFlow'] = [];
  if (showMonthly) {
    const cfRes = await adapter.query<{ month: string; inflow: string | number; outflow: string | number }>(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', $2::date),
           date_trunc('month', $3::date),
           '1 month'::interval
         ) AS m
       )
       SELECT TO_CHAR(months.m, 'YYYY-MM') AS month,
              COALESCE(SUM(je.credit) FILTER (WHERE je.credit > 0), 0) AS inflow,
              COALESCE(SUM(je.debit) FILTER (WHERE je.debit > 0), 0) AS outflow
         FROM months
         LEFT JOIN journal_entries je ON je.company_id = $1
              AND date_trunc('month', je.created_at) = months.m
         LEFT JOIN accounts a ON je.account_id = a.id
               AND (a.name_ar ILIKE '%صندوق%' OR a.name_ar ILIKE '%نقد%' OR a.name_ar ILIKE '%خزينة%' OR a.name_en ILIKE '%cash%' OR a.name_en ILIKE '%treasury%')
          WHERE je.id IS NULL OR a.id IS NOT NULL
         GROUP BY months.m
         ORDER BY months.m`,
       [companyId, fromStr, toStr],
     );
     for (const r of cfRes.rows || []) {
       cashFlow.push({ month: String(r.month), inflow: toNum(r.inflow), outflow: toNum(r.outflow) });
     }
   } else {
     const cfRes = await adapter.query<{ day: string; inflow: string | number; outflow: string | number }>(
       `WITH days AS (
          SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS d
        )
        SELECT TO_CHAR(days.d, 'YYYY-MM-DD') AS day,
               COALESCE(SUM(je.credit) FILTER (WHERE je.credit > 0), 0) AS inflow,
               COALESCE(SUM(je.debit) FILTER (WHERE je.debit > 0), 0) AS outflow
          FROM days
          LEFT JOIN journal_entries je ON je.company_id = $1
               AND je.created_at::date = days.d
          LEFT JOIN accounts a ON je.account_id = a.id
               AND (a.name_ar ILIKE '%صندوق%' OR a.name_ar ILIKE '%نقد%' OR a.name_ar ILIKE '%خزينة%' OR a.name_en ILIKE '%cash%' OR a.name_en ILIKE '%treasury%')
        GROUP BY days.d
        ORDER BY days.d`,
      [companyId, fromStr, toStr],
    );
    for (const r of cfRes.rows || []) {
      cashFlow.push({ month: String(r.day), inflow: toNum(r.inflow), outflow: toNum(r.outflow) });
    }
  }

  // 7. Sales trend (daily, last min(30, days) days)
  const trendDays = Math.min(30, days);
  const trendFrom = new Date(range.to);
  trendFrom.setDate(trendFrom.getDate() - trendDays + 1);
  const trendFromStr = formatDate(trendFrom);
  const trendResult = await adapter.query<{ day: string; sales: string | number; purchases: string | number }>(
    `WITH days AS (
       SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS d
     )
     SELECT TO_CHAR(days.d, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(CASE WHEN si.total_amount IS NOT NULL THEN si.total_amount ELSE 0 END), 0) AS sales,
            COALESCE(SUM(CASE WHEN pi.total_amount IS NOT NULL THEN pi.total_amount ELSE 0 END), 0) AS purchases
       FROM days
       LEFT JOIN sales_invoices si ON si.company_id = $1 AND si.date = days.d AND si.status != 'cancelled'
       LEFT JOIN purchase_invoices pi ON pi.company_id = $1 AND pi.date = days.d AND pi.status != 'cancelled'
      GROUP BY days.d
      ORDER BY days.d`,
    [companyId, trendFromStr, toStr],
  );
  const salesTrend: DashboardData['salesTrend'] = (trendResult.rows || []).map((r) => ({
    date: String(r.day),
    sales: toNum(r.sales),
    purchases: toNum(r.purchases),
  }));
  const profitTrend: DashboardData['profitTrend'] = salesTrend.map((t) => ({ date: t.date, profit: t.sales - t.purchases }));

  // 8. Category share (top 6 by stock value, joining product_categories)
  const catResult = await adapter.query<{ name: string; value: string | number }>(
    `SELECT COALESCE(pc.name, 'غير مصنف') AS name,
            COALESCE(SUM(s.quantity * p.cost_price), 0) AS value
       FROM stock s
       JOIN products p ON s.product_id = p.id
       LEFT JOIN product_product_categories ppc ON ppc.product_id = p.id
       LEFT JOIN product_categories pc ON ppc.category_id = pc.id
      WHERE p.company_id = $1
      GROUP BY pc.name
      ORDER BY value DESC
      LIMIT 6`,
    [companyId],
  );
  const categoryShare: DashboardData['categoryShare'] = (catResult.rows || []).map((r) => ({
    name: String(r.name || 'غير مصنف'),
    value: toNum(r.value),
  }));

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    invoicesCount,
    productsCount,
    customersCount,
    suppliersCount,
    employeesCount,
    lowStockCount,
    overdueInvoicesCount,
    crmLeadsCount,
    crmOpportunitiesCount,
    crmPipelineValue,
    crmConversionRate,
    crmWonDealsCount,
    crmLostDealsCount,
    crmAvgDealValue,
    pipelineByStage,
    monthlyRevenue,
    topProducts,
    arAging,
    cashFlow,
    salesTrend,
    profitTrend,
    categoryShare,
  };
}
