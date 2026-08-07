import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Package, ArrowUp, ArrowDown, ArrowLeftRight, FileDown, RefreshCw } from 'lucide-react';
import { Card, Button } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel } from '@/core/utils/exportEngine';
import { useTranslation } from '@/core/i18n/useTranslation';
import { formatNumber } from '@/core/utils/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import KpiCardPro from './components/KpiCardPro';

interface MonthlyRow {
  month: string;
  type: string;
  totalQty: number;
  transactionCount: number;
}

interface MonthBucket {
  month: string;
  monthLabel: string;
  inQty: number;
  outQty: number;
  adjQty: number;
}

interface TopProduct {
  nameAr: string;
  sku: string;
  type: string;
  totalQty: number;
}

interface ProductOption {
  id: string;
  nameAr: string;
}

const CHART_COLORS: Record<string, string> = {
  in: '#10b981',
  out: '#f59e0b',
  adjustment: '#6366f1',
};

const PIE_COLORS = ['#10b981', '#f59e0b', '#6366f1'];

function monthDateToLabel(monthStr: string, months: string[]): string {
  const d = new Date(monthStr);
  return months[d.getMonth()] + ' ' + d.getFullYear();
}

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const StockMovementReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';
  const months = useMemo(() => [t('reports.months.jan'), t('reports.months.feb'), t('reports.months.mar'), t('reports.months.apr'), t('reports.months.may'), t('reports.months.jun'), t('reports.months.jul'), t('reports.months.aug'), t('reports.months.sep'), t('reports.months.oct'), t('reports.months.nov'), t('reports.months.dec')], [t]);

  const [isLoading, setIsLoading] = useState(false);
  const [monthlyData, setMonthlyData] = useState<MonthlyRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productFilter, setProductFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const [dateFrom, setDateFrom] = useState(formatDateInput(sixMonthsAgo));
  const [dateTo, setDateTo] = useState(formatDateInput(today));

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    setError(null);
    try {
      const adapter = await getDbAdapter();
      const productId = productFilter || null;

      const monthlyParams: unknown[] = [companyId, dateFrom, dateTo];
      let monthlyWhere = `sm.company_id = $1
            AND sm.created_at >= $2::date
            AND sm.created_at < ($3::date + INTERVAL '1 day')`;
      if (productId) {
        monthlyParams.push(productId);
        monthlyWhere += `
            AND sm.product_id = $${monthlyParams.length}`;
      }

      const monthlyResult = await adapter.query(
        `SELECT date_trunc('month', sm.created_at)::date as month,
                sm.type,
                SUM(sm.quantity) as total_qty,
                COUNT(*) as transaction_count
           FROM stock_movements sm
          WHERE ${monthlyWhere}
          GROUP BY month, sm.type
          ORDER BY month, sm.type`,
        monthlyParams,
      );

      const topParams: unknown[] = [companyId];
      let topWhere = `sm.company_id = $1`;
      if (productId) {
        topParams.push(productId);
        topWhere += ` AND sm.product_id = $${topParams.length}`;
      }

      const topResult = await adapter.query(
        `SELECT p.name_ar, p.sku, sm.type, SUM(sm.quantity) as total_qty
           FROM stock_movements sm
           JOIN products p ON sm.product_id = p.id AND p.company_id = $1
          WHERE ${topWhere}
            AND sm.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY p.id, p.name_ar, p.sku, sm.type
          ORDER BY SUM(sm.quantity) DESC
          LIMIT 10`,
        topParams,
      );

      const productsResult = await adapter.query(
        `SELECT id, name_ar FROM products WHERE company_id = $1 AND is_active = true ORDER BY name_ar`,
        [companyId],
      );

      setMonthlyData((monthlyResult.rows || []) as MonthlyRow[]);
      setTopProducts((topResult.rows || []) as TopProduct[]);
      setProducts((productsResult.rows || []) as ProductOption[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [companyId, dateFrom, dateTo, productFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const monthBuckets = useMemo<MonthBucket[]>(() => {
    const map = new Map<string, MonthBucket>();
    for (const row of monthlyData) {
      if (!map.has(row.month)) {
        map.set(row.month, {
          month: row.month,
          monthLabel: monthDateToLabel(row.month, months),
          inQty: 0,
          outQty: 0,
          adjQty: 0,
        });
      }
      const b = map.get(row.month)!;
      if (row.type === 'in') b.inQty += row.totalQty;
      else if (row.type === 'out') b.outQty += row.totalQty;
      else b.adjQty += row.totalQty;
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyData, months]);

  const totalIn = useMemo(() => monthlyData.filter((r) => r.type === 'in').reduce((s, r) => s + r.totalQty, 0), [monthlyData]);
  const totalOut = useMemo(() => monthlyData.filter((r) => r.type === 'out').reduce((s, r) => s + r.totalQty, 0), [monthlyData]);
  const netChange = totalIn - totalOut;

  const typePieData = useMemo(() => {
    const inCount = monthlyData.filter((r) => r.type === 'in').reduce((s, r) => s + r.transactionCount, 0);
    const outCount = monthlyData.filter((r) => r.type === 'out').reduce((s, r) => s + r.transactionCount, 0);
    const adjCount = monthlyData.filter((r) => r.type !== 'in' && r.type !== 'out').reduce((s, r) => s + r.transactionCount, 0);
    return [
      { name: t('reports.stockIn'), value: inCount },
      { name: t('reports.stockOut'), value: outCount },
      { name: t('reports.stockAdjustment'), value: adjCount },
    ].filter((d) => d.value > 0);
  }, [monthlyData, t]);

  const filteredDetail = useMemo(() => {
    return monthlyData;
  }, [monthlyData]);

  const handleExportExcel = async () => {
    const cols = [
       { key: 'month', header: t('reports.month') },
       { key: 'type', header: t('reports.type') },
       { key: 'totalQty', header: t('reports.quantity') },
       { key: 'transactionCount', header: t('reports.transactionCount') },
    ];
    await exportToExcel(monthlyData, cols, 'Stock_Movement_Analysis');
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Package size={48} className="mx-auto mb-4 text-slate-400" />
          <p className="text-lg font-medium text-slate-700 dark:text-slate-200">{t('reports.noPermission')}</p>
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-500 dark:text-slate-400">{t('reports.noCompany')}</p>
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

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-rose-600 dark:text-rose-400 mb-2">{t('reports.error')}: {error}</p>
          <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={loadData}>
            {t('reports.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Package size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('reports.stockMovement')}</h1>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={!canExport}>
            {t('reports.exportExcel')}
          </Button>
          <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={loadData}>
            {t('reports.refresh')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('reports.from')}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-slate-900 dark:border-slate-600 text-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('reports.to')}</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-slate-900 dark:border-slate-600 text-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('reports.product')}</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-md bg-white dark:bg-slate-900 dark:border-slate-600 text-slate-900 dark:text-slate-50"
            >
              <option value="">{t('reports.all')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.nameAr}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCardPro
          title={t('reports.totalIn')}
          value={formatNumber(totalIn)}
          icon={ArrowDown}
          color="blue"
        />
        <KpiCardPro
          title={t('reports.totalOut')}
          value={formatNumber(totalOut)}
          icon={ArrowUp}
          color="amber"
        />
        <KpiCardPro
          title={t('reports.netChange')}
          value={formatNumber(Math.abs(netChange))}
          icon={ArrowLeftRight}
          color={netChange >= 0 ? 'emerald' : 'rose'}
          trend={netChange > 0 ? 'up' : netChange < 0 ? 'down' : 'neutral'}
          change={netChange >= 0 ? '+' + String(netChange) : String(netChange)}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.monthlyMovement')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthBuckets}>
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="inQty" name={t('reports.stockIn')} fill={CHART_COLORS.in} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="outQty" name={t('reports.stockOut')} fill={CHART_COLORS.out} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="adjQty" name={t('reports.stockAdjustment')} fill={CHART_COLORS.adjustment} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.typeDistribution')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {typePieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>

      {/* Top Products (last 30 days) */}
      {topProducts.length > 0 && (
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.topMovingProducts')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.product')}</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">SKU</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.type')}</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.quantity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 text-slate-900 dark:text-slate-50">{p.nameAr}</td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{p.sku}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.type === 'in' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          p.type === 'out' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                        }`}>
                           {p.type === 'in' ? t('reports.stockIn') :
                            p.type === 'out' ? t('reports.stockOut') :
                            t('reports.stockAdjustment')}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-50">{formatNumber(p.totalQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* Detail Table */}
      <Card>
        <div className="p-4">
           <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.details')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.month')}</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.type')}</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.quantity')}</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-500 dark:text-slate-400">{t('reports.transactionCount')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetail.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      {t('reports.noData')}
                    </td>
                  </tr>
                ) : (
                  filteredDetail.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 text-slate-900 dark:text-slate-50">{monthDateToLabel(row.month, months)}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.type === 'in' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          row.type === 'out' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                        }`}>
                           {row.type === 'in' ? t('reports.stockIn') :
                            row.type === 'out' ? t('reports.stockOut') :
                            row.type}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-50">{formatNumber(row.totalQty)}</td>
                      <td className="py-2 px-3 text-right text-slate-900 dark:text-slate-50">{formatNumber(row.transactionCount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default StockMovementReport;
