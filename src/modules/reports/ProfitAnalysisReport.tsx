import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, FileDown, Filter, RotateCcw } from 'lucide-react';
import { Card, Button, Table } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CurrencyBreakdown } from '@/core/ui/components/CurrencyBreakdown';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useCurrencies } from '@/core/utils/useCurrencyDisplay';
import { buildCurrencyBreakdown, type CurrencyBreakdownResult } from '@/core/utils/currencyBreakdown';
import { YER_CODE } from '@/core/utils/currencyConverter';
import type { Currency } from '@/modules/core/types';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { useSettings } from '@/core/utils/useSettings';

interface ExpenseBreakdown {
  category: string;
  amount: number;
  percent: number;
  accountId?: string;
}

interface ProductProfit {
  product: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

interface PeriodData {
  expenses: ExpenseBreakdown[];
  products: ProductProfit[];
  totalRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  totalProfit: number;
  monthlyProfit: Array<{ month: string; profit: number }>;
  revenueBreakdown: CurrencyBreakdownResult;
  cogsBreakdown: CurrencyBreakdownResult;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
const MONTHS_AR_KEYS = ['reports.months.jan','reports.months.feb','reports.months.mar','reports.months.apr','reports.months.may','reports.months.jun','reports.months.jul','reports.months.aug','reports.months.sep','reports.months.oct','reports.months.nov','reports.months.dec'];

function defaultFromDate(fiscalYearStart?: string): string {
  if (fiscalYearStart) {
    const fy = new Date(fiscalYearStart);
    if (!isNaN(fy.getTime())) {
      const now = new Date();
      const fyMonth = fy.getMonth();
      const fyDay = fy.getDate();
      // If current month is before fiscal start, use previous year's fiscal start
      const year = now.getMonth() >= fyMonth ? now.getFullYear() : now.getFullYear() - 1;
      return `${year}-${String(fyMonth + 1).padStart(2, '0')}-${String(fyDay).padStart(2, '0')}`;
    }
  }
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function defaultToDate(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return 0;
}

function buildDateRange(from?: string, to?: string, fiscalYearStart?: string): { from: string; to: string } {
  return { from: from || defaultFromDate(fiscalYearStart), to: to || defaultToDate() };
}

export const ProfitAnalysisReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { currencies } = useCurrencies(activeCompany?.id || '');
  const { settings: appSettings } = useSettings(activeCompany?.id || '');
  const fiscalYearStart = appSettings?.fiscalYearStart;
  const [currentPeriod, setCurrentPeriod] = useState<PeriodData | null>(null);
  const [previousPeriod, setPreviousPeriod] = useState<PeriodData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    if (!activeCompany?.id) return;
    const companyId = activeCompany.id;
    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();
      const activeCurrencies: Currency[] = currencies.length > 0 ? currencies : [];

      const computePeriod = async (from?: string, to?: string): Promise<PeriodData> => {
        const range = buildDateRange(from, to, fiscalYearStart);
        const { from: fromD, to: toD } = range;

        const revResult = await adapter.query(
          `SELECT COALESCE(SUM(total_amount), 0) AS revenue,
                  COALESCE(SUM(vat_amount), 0) AS vat,
                  COUNT(*) AS invoice_count
             FROM sales_invoices
            WHERE company_id = $1 AND date >= $2 AND date <= $3`,
          [companyId, fromD, toD],
        );
        const revRow = (revResult.rows?.[0] || {}) as Record<string, unknown>;
        const totalRevenue = toNumber(revRow.revenue);

        const revByCurrencyResult = await adapter.query(
          `SELECT currency_code, COALESCE(SUM(total_amount), 0) AS amount, COUNT(*) AS inv_count
             FROM sales_invoices
            WHERE company_id = $1 AND date >= $2 AND date <= $3
            GROUP BY currency_code`,
          [companyId, fromD, toD],
        );
        const revBreakdown = buildCurrencyBreakdown(
          ((revByCurrencyResult.rows || []) as Record<string, unknown>[]).map((r) => ({
            code: String(r.currency_code || YER_CODE),
            amount: toNumber(r.amount),
          })),
          activeCurrencies,
        );

        const cogsResult = await adapter.query(
          `SELECT COALESCE(SUM(pil.line_total), 0) AS cogs,
                  COALESCE(SUM(pil.quantity * COALESCE(pil.unit_price, 0)), 0) AS cogs_qty_cost
             FROM purchase_invoice_lines pil
             JOIN purchase_invoices pi ON pi.id = pil.invoice_id
            WHERE pi.company_id = $1 AND pi.date >= $2 AND pi.date <= $3`,
          [companyId, fromD, toD],
        );
        const cogsRow = (cogsResult.rows?.[0] || {}) as Record<string, unknown>;
        const totalCogs = toNumber(cogsRow.cogs);

        const cogsByCurrencyResult = await adapter.query(
          `SELECT pi.currency_code, COALESCE(SUM(pil.line_total), 0) AS amount
             FROM purchase_invoice_lines pil
             JOIN purchase_invoices pi ON pi.id = pil.invoice_id
            WHERE pi.company_id = $1 AND pi.date >= $2 AND pi.date <= $3
            GROUP BY pi.currency_code`,
          [companyId, fromD, toD],
        );
        const cogsBreakdown = buildCurrencyBreakdown(
          ((cogsByCurrencyResult.rows || []) as Record<string, unknown>[]).map((r) => ({
            code: String(r.currency_code || YER_CODE),
            amount: toNumber(r.amount),
          })),
          activeCurrencies,
        );

        const accResult = await adapter.getAccounts(companyId);
        const accounts = (accResult.data || []) as Record<string, unknown>[];
        const expenseAccs = accounts.filter((a) => a.type === 'expense');
        const expenseMovementsResult = await adapter.query(
          `SELECT je.account_id, COALESCE(SUM(je.debit), 0) AS debits, COALESCE(SUM(je.credit), 0) AS credits
             FROM journal_entries je
             JOIN transactions t ON t.id = je.transaction_id
             JOIN accounts a ON a.id = je.account_id
            WHERE a.company_id = $1
              AND a.type = 'expense'
              AND t.date >= $2
              AND t.date <= $3
            GROUP BY je.account_id`,
          [companyId, fromD, toD],
        );
        const movementByAccount = new Map<string, { debits: number; credits: number }>();
        for (const r of (expenseMovementsResult.rows || []) as Record<string, unknown>[]) {
          movementByAccount.set(String(r.account_id), {
            debits: toNumber(r.debits),
            credits: toNumber(r.credits),
          });
        }
        const expenses: ExpenseBreakdown[] = expenseAccs
          .map((a) => {
            const id = String(a.id || '');
            const mov = movementByAccount.get(id) || { debits: 0, credits: 0 };
            const amount = mov.debits - mov.credits;
            return {
              category: String(a.name_ar || a.name || ''),
              amount: Math.max(0, amount),
              percent: 0,
              accountId: id,
            };
          })
          .filter((e) => e.amount > 0)
          .sort((a, b) => b.amount - a.amount);
        const totalExp = expenses.reduce((s, e) => s + e.amount, 0);
        expenses.forEach((e) => {
          e.percent = totalExp > 0 ? Math.round((e.amount / totalExp) * 100) : 0;
        });

        const prodResult = await adapter.query(
          `SELECT p.id, p.name_ar,
                  COALESCE(SUM(sil.line_total), 0) AS revenue,
                  COALESCE(SUM(sil.quantity), 0) AS qty_sold
             FROM products p
             JOIN sales_invoice_lines sil ON sil.product_id = p.id
             JOIN sales_invoices si ON si.id = sil.invoice_id
            WHERE p.company_id = $1
              AND si.date >= $2
              AND si.date <= $3
            GROUP BY p.id, p.name_ar
            HAVING SUM(sil.line_total) > 0
            ORDER BY revenue DESC
            LIMIT 10`,
          [companyId, fromD, toD],
        );
        const prodsRaw = (prodResult.rows || []) as Record<string, unknown>[];
        const productIds = prodsRaw.map((p) => String(p.id));
        const costByProduct = new Map<string, number>();
        if (productIds.length > 0) {
          const placeholders = productIds.map((_, i) => `$${i + 3}`).join(', ');
          const costResult = await adapter.query(
            `SELECT pil.product_id, COALESCE(SUM(pil.line_total), 0) AS cost
               FROM purchase_invoice_lines pil
               JOIN purchase_invoices pi ON pi.id = pil.invoice_id
              WHERE pi.company_id = $1
                AND pi.date >= $2
                AND pil.product_id IN (${placeholders})
              GROUP BY pil.product_id`,
            [companyId, fromD, ...productIds],
          );
          for (const r of (costResult.rows || []) as Record<string, unknown>[]) {
            costByProduct.set(String(r.product_id), toNumber(r.cost));
          }
        }
        const products: ProductProfit[] = prodsRaw.map((p) => {
          const revenue = toNumber(p.revenue);
          const qty = toNumber(p.qty_sold);
          const productCost = costByProduct.get(String(p.id)) || 0;
          const cost = qty > 0 && productCost > 0 ? (productCost / Math.max(qty, 1)) * qty : productCost;
          const profit = revenue - cost;
          return {
            product: String(p.name_ar || ''),
            revenue,
            cost,
            profit,
            margin: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
          };
        });

        const monthlyResult = await adapter.query(
          `WITH months AS (
             SELECT EXTRACT(MONTH FROM d)::int AS m
               FROM generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), '1 month'::interval) AS d
           ),
           rev AS (
             SELECT EXTRACT(MONTH FROM date)::int AS m,
                    COALESCE(SUM(total_amount), 0) AS revenue
               FROM sales_invoices
              WHERE company_id = $1 AND date >= $2 AND date <= $3
              GROUP BY 1
           ),
           cogs AS (
             SELECT EXTRACT(MONTH FROM pi.date)::int AS m,
                    COALESCE(SUM(pil.line_total), 0) AS cogs
               FROM purchase_invoice_lines pil
               JOIN purchase_invoices pi ON pi.id = pil.invoice_id
              WHERE pi.company_id = $1 AND pi.date >= $2 AND pi.date <= $3
              GROUP BY 1
           ),
           exp AS (
             SELECT EXTRACT(MONTH FROM t.date)::int AS m,
                    COALESCE(SUM(je.debit - je.credit), 0) AS exp
               FROM journal_entries je
               JOIN transactions t ON t.id = je.transaction_id
               JOIN accounts a ON a.id = je.account_id
              WHERE a.company_id = $1
                AND a.type = 'expense'
                AND t.date >= $2
                AND t.date <= $3
              GROUP BY 1
           )
           SELECT months.m,
                  COALESCE(rev.revenue, 0) AS revenue,
                  COALESCE(cogs.cogs, 0) AS cogs,
                  COALESCE(exp.exp, 0) AS exp
             FROM months
             LEFT JOIN rev ON rev.m = months.m
             LEFT JOIN cogs ON cogs.m = months.m
             LEFT JOIN exp ON exp.m = months.m
            ORDER BY months.m`,
          [companyId, fromD, toD],
        );
        const monthlyRows = (monthlyResult.rows || []) as Record<string, unknown>[];
        const monthlyProfit = monthlyRows.map((r) => {
          const revenue = toNumber(r.revenue);
          const cogs = toNumber(r.cogs);
          const exp = toNumber(r.exp);
          const monthIdx = Math.max(0, Math.min(11, toNumber(r.m) - 1));
          return {
            month: t(MONTHS_AR_KEYS[monthIdx]) || String(toNumber(r.m)),
            profit: revenue - cogs - exp,
          };
        });

        const totalExpenses = totalCogs + totalExp;

        return {
          expenses,
          products,
          totalRevenue,
          totalCogs,
          totalExpenses,
          totalProfit: totalRevenue - totalExpenses,
          monthlyProfit,
          revenueBreakdown: revBreakdown,
          cogsBreakdown,
        };
      };

      const current = await computePeriod(fromDate || undefined, toDate || undefined);
      setCurrentPeriod(current);

      if (compareMode) {
        const range = buildDateRange(fromDate || undefined, toDate || undefined);
        const fromMs = new Date(range.from).getTime();
        const toMs = new Date(range.to).getTime();
        const duration = Math.max(toMs - fromMs, 24 * 60 * 60 * 1000);
        const prevTo = new Date(fromMs - 24 * 60 * 60 * 1000);
        const prevFrom = new Date(prevTo.getTime() - duration);
        const prev = await computePeriod(prevFrom.toISOString().split('T')[0], prevTo.toISOString().split('T')[0]);
        setPreviousPeriod(prev);
      } else {
        setPreviousPeriod(null);
      }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
        setCurrentPeriod(null);
        setPreviousPeriod(null);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [activeCompany?.id, fromDate, toDate, compareMode, currencies, t, fiscalYearStart]);

  const comparisonChart = useMemo(() => {
    if (!currentPeriod) return [];
    if (!previousPeriod) {
      return currentPeriod.monthlyProfit.map((m) => ({ name: m.month, current: m.profit, previous: 0 }));
    }
    return currentPeriod.monthlyProfit.map((m, i) => ({
      name: m.month,
      current: m.profit,
      previous: previousPeriod.monthlyProfit[i]?.profit || 0,
    }));
  }, [currentPeriod, previousPeriod]);

  const handleExportExcel = async () => {
    if (!currentPeriod) return;
    const cols = [
      { key: 'category', header: t('reports.category') },
      { key: 'amount', header: t('reports.amount') },
      { key: 'percent', header: t('reports.percentage') },
    ];
    await exportToExcel(currentPeriod.expenses, cols, 'Profit_Analysis');
  };

  const handleExportPDF = async () => {
    if (!currentPeriod) return;
    const cols = [
      { key: 'category', header: t('reports.category'), width: 25 },
      { key: 'amount', header: t('reports.amount'), width: 15 },
      { key: 'percent', header: t('reports.percentage'), width: 12 },
    ];
    await exportToPDF(currentPeriod.expenses, cols, 'Profit_Analysis', {
      title: t('reports.profitAnalysis'),
      subtitle: activeCompany?.name,
      rtl: true,
    });
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <PieChart size={48} className="mx-auto mb-4 text-slate-400" />
          <p className="text-lg font-medium text-slate-700 dark:text-slate-200">{t('reports.noPermission')}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!currentPeriod) {
    return (
      <EmptyState
        icon="inbox"
        title={t('reports.noData')}
        description={t('reports.profitAnalysis.noDataDesc')}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <PieChart size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('reports.profitAnalysis')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('reports.profitAnalysis.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" leftIcon={<Filter size={16} />} onClick={() => setShowFilters((s) => !s)}>
            {t('reports.filter')}
          </Button>
          <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={!canExport}>
            Excel
          </Button>
          <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF} disabled={!canExport}>
            PDF
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('reports.fromDate')}</label>
              <input type="date" className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('reports.toDate')}</label>
              <input type="date" className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
                {t('reports.comparePrevious')}
              </label>
            </div>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => { setFromDate(''); setToDate(''); }}>
                {t('reports.clearFilter')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.totalRevenue')}</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(currentPeriod.totalRevenue)}</p>
            {compareMode && previousPeriod && (
              <p className="text-xs text-slate-400 mt-1">{t('reports.previousPeriod')}: {formatCurrency(previousPeriod.totalRevenue)}</p>
            )}
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.costOfGoodsSold')}</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(currentPeriod.totalCogs)}</p>
            {compareMode && previousPeriod && (
              <p className="text-xs text-slate-400 mt-1">{t('reports.previousPeriod')}: {formatCurrency(previousPeriod.totalCogs)}</p>
            )}
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.totalExpenses')}</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{formatCurrency(currentPeriod.totalExpenses)}</p>
            {compareMode && previousPeriod && (
              <p className="text-xs text-slate-400 mt-1">{t('reports.previousPeriod')}: {formatCurrency(previousPeriod.totalExpenses)}</p>
            )}
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.netProfit')}</p>
            <p className={`text-2xl font-bold ${currentPeriod.totalProfit >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatCurrency(currentPeriod.totalProfit)}
            </p>
            {compareMode && previousPeriod && (
              <p className="text-xs text-slate-400 mt-1">{t('reports.previousPeriod')}: {formatCurrency(previousPeriod.totalProfit)}</p>
            )}
          </div>
        </Card>
      </div>

      {/* Comparison Chart */}
      {compareMode && (
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.periodComparison')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  <Legend />
                  <Bar dataKey="current" fill="#3b82f6" name={t('reports.currentPeriod')} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="previous" fill="#94a3b8" name={t('reports.previousPeriod')} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.expenseDistribution')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={currentPeriod.expenses} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="amount" nameKey="category">
                    {currentPeriod.expenses.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                </RePieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              {currentPeriod.expenses.map((e, i) => (
                <div key={e.category} className="flex items-center gap-1.5 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-slate-600 dark:text-slate-300">{e.category} ({e.percent}%)</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.expenseDetails')}</h3>
            <Table
              data={currentPeriod.expenses}
              columns={[
                { key: 'category', header: t('reports.expenseItem') },
                { key: 'amount', header: t('reports.amount'), align: 'right', render: (row) => formatCurrency(row.amount) },
                { key: 'percent', header: t('reports.percentage'), align: 'right', render: (row) => `${row.percent}%` },
              ]}
              keyExtractor={(row) => row.category}
            />
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.topSellingProducts')}</h3>
          <Table
            data={currentPeriod.products}
            columns={[
              { key: 'product', header: t('reports.product') },
              { key: 'revenue', header: t('reports.revenue'), align: 'right', render: (row) => formatCurrency(row.revenue) },
              { key: 'cost', header: t('reports.cost'), align: 'right', render: (row) => formatCurrency(row.cost) },
              { key: 'profit', header: t('reports.profit'), align: 'right', render: (row) => formatCurrency(row.profit) },
              { key: 'margin', header: t('reports.margin'), align: 'right', render: (row) => (
                <span className={`font-medium ${row.margin >= 30 ? 'text-emerald-600' : row.margin >= 15 ? 'text-amber-600' : 'text-rose-600'}`}>
                  {row.margin}%
                </span>
              )},
            ]}
            keyExtractor={(row) => row.product}
          />
        </div>
      </Card>

      {/* Currency Breakdown */}
      {(currentPeriod.revenueBreakdown.items.length > 0 || currentPeriod.cogsBreakdown.items.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CurrencyBreakdown result={currentPeriod.revenueBreakdown} title={t('reports.revenueByCurrency')} />
          <CurrencyBreakdown result={currentPeriod.cogsBreakdown} title={t('reports.costOfGoodsSoldByCurrency')} />
        </div>
      )}
    </div>
  );
};

export default ProfitAnalysisReport;
