import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Factory, FileDown, Filter, X } from 'lucide-react';
import { Card, Button, Table, Input, Can } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { formatDateValue } from '@/core/utils/locale';

interface WorkOrderVarianceRow {
  id: string;
  orderNumber: string;
  productName: string;
  status: string;
  plannedCost: number;
  actualCost: number;
  variance: number;
  variancePct: number;
}

interface MaterialVarianceRow {
  materialName: string;
  plannedCost: number;
  actualCost: number;
  costVariance: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

type StatusFilter = '' | 'planned' | 'in_progress' | 'completed' | 'cancelled';

export const VarianceAnalysisReport: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const [rows, setRows] = useState<WorkOrderVarianceRow[]>([]);
  const [materials, setMaterials] = useState<MaterialVarianceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  const applyPreset = useCallback((days: number | null) => {
    if (days === null) {
      setFromDate('');
      setToDate('');
      return;
    }
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    setFromDate(formatDateValue(from));
    setToDate(formatDateValue(now));
  }, []);

  const clearFilters = useCallback(() => {
    setFromDate('');
    setToDate('');
    setStatusFilter('');
  }, []);

  const hasActiveFilters = useMemo(() => fromDate || toDate || statusFilter, [fromDate, toDate, statusFilter]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const adapter = await getDbAdapter();
      const params: unknown[] = [companyId];

      const conditions: string[] = [];
      conditions.push(`w.company_id = $1`);

      if (fromDate) {
        conditions.push(`w.created_at >= $${params.length + 1}::date`);
        params.push(fromDate);
      }
      if (toDate) {
        conditions.push(`w.created_at <= $${params.length + 1}::date`);
        params.push(toDate);
      }
      if (statusFilter) {
        conditions.push(`w.status = $${params.length + 1}`);
        params.push(statusFilter);
      }

      const where = conditions.join(' AND ');

      const woResult = await adapter.query(
        `SELECT w.id, w.order_number, w.status,
                COALESCE(SUM(c.planned_quantity * c.unit_cost), 0) AS planned_cost,
                COALESCE(SUM(c.actual_quantity * c.actual_unit_cost), 0) AS actual_cost,
                p.name_ar AS product_name
           FROM work_orders w
           LEFT JOIN products p ON p.id = w.product_id
           LEFT JOIN work_order_consumptions c ON c.work_order_id = w.id
          WHERE ${where}
          GROUP BY w.id, w.order_number, w.status, p.name_ar
          ORDER BY ABS(COALESCE(SUM(c.actual_quantity * c.actual_unit_cost), 0) - COALESCE(SUM(c.planned_quantity * c.unit_cost), 0)) DESC`,
        params,
      );

      if (cancelled) return;

      const woRows: WorkOrderVarianceRow[] = (woResult.rows || []).map((r: Record<string, unknown>) => {
        const planned = Number(r.planned_cost || 0);
        const actual = Number(r.actual_cost || 0);
        const variance = actual - planned;
        return {
          id: String(r.id),
          orderNumber: String(r.order_number),
          productName: r.product_name ? String(r.product_name) : '—',
          status: String(r.status),
          plannedCost: planned,
          actualCost: actual,
          variance,
          variancePct: planned > 0 ? Math.round((variance / planned) * 100) : 0,
        };
      });
      setRows(woRows);

      const matResult = await adapter.query(
        `SELECT p.name_ar AS material_name,
                SUM(c.planned_quantity * c.unit_cost) AS planned_cost,
                SUM(COALESCE(c.actual_quantity, 0) * COALESCE(c.actual_unit_cost, c.unit_cost)) AS actual_cost
           FROM work_order_consumptions c
           JOIN work_orders w ON w.id = c.work_order_id
           LEFT JOIN products p ON p.id = c.material_id
          WHERE ${where.replace(/w\./g, 'w.')}
          GROUP BY p.name_ar
          ORDER BY ABS(SUM(COALESCE(c.actual_quantity, 0) * COALESCE(c.actual_unit_cost, c.unit_cost)) - SUM(c.planned_quantity * c.unit_cost)) DESC
          LIMIT 10`,
        params,
      );

      if (cancelled) return;

      const matRows: MaterialVarianceRow[] = (matResult.rows || []).map((r: Record<string, unknown>) => {
        const pc = Number(r.planned_cost || 0);
        const ac = Number(r.actual_cost || 0);
        return {
          materialName: r.material_name ? String(r.material_name) : '—',
          plannedCost: pc,
          actualCost: ac,
          costVariance: ac - pc,
        };
      });
      setMaterials(matRows);
      setIsLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [companyId, fromDate, toDate, statusFilter]);

  const totalVariance = rows.reduce((s, r) => s + r.variance, 0);
  const unfavorableCount = rows.filter((r) => r.variance > 0).length;
  const favorableCount = rows.filter((r) => r.variance < 0).length;
  const avgVariance = rows.length > 0 ? totalVariance / rows.length : 0;

  const chartData = useMemo(() => {
    const sorted = [...rows].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    return sorted.slice(0, 10).map((r) => ({
      name: r.orderNumber,
      planned: r.plannedCost,
      actual: r.actualCost,
    }));
  }, [rows]);

  const variancePieData = useMemo(() => {
    const items: { name: string; value: number }[] = [];
    const unfavorable = rows.filter((r) => r.variance > 0).reduce((s, r) => s + r.variance, 0);
    const favorable = Math.abs(rows.filter((r) => r.variance < 0).reduce((s, r) => s + r.variance, 0));
    const zero = rows.filter((r) => r.variance === 0).length;
    if (unfavorable > 0) items.push({ name: t('manufacturing.variance.unfavorable'), value: Math.round(unfavorable) });
    if (favorable > 0) items.push({ name: t('manufacturing.variance.favorable'), value: Math.round(favorable) });
    if (zero > 0) items.push({ name: t('manufacturing.variance.noVariance'), value: zero });
    return items;
  }, [rows, t]);

  const woColumns = [
    { key: 'orderNumber', header: t('manufacturing.orderNumber') },
    { key: 'productName', header: t('manufacturing.product') },
    {
      key: 'status', header: t('manufacturing.table.status'),
      render: (row: WorkOrderVarianceRow) => {
        const colors: Record<string, string> = {
          planned: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
          in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
          completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
          cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
        };
        const statusKey = row.status === 'in_progress' ? 'inProgress' : row.status;
        return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[row.status] || ''}`}>{t(`manufacturing.status.${statusKey}`)}</span>;
      },
    },
    { key: 'plannedCost', header: t('manufacturing.plannedCost'), align: 'right' as const, render: (row: WorkOrderVarianceRow) => formatCurrency(row.plannedCost) },
    { key: 'actualCost', header: t('manufacturing.actualCost'), align: 'right' as const, render: (row: WorkOrderVarianceRow) => formatCurrency(row.actualCost) },
    {
      key: 'variance', header: t('manufacturing.variance.title'), align: 'right' as const,
      render: (row: WorkOrderVarianceRow) => (
        <span className={`tabular-nums ${row.variance > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : row.variance < 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}`}>
          {row.variance > 0 ? '+' : ''}{formatCurrency(row.variance)}
        </span>
      ),
    },
    {
      key: 'variancePct', header: '%', align: 'right' as const,
      render: (row: WorkOrderVarianceRow) => (
        <span className={`tabular-nums ${row.variancePct > 0 ? 'text-rose-600 dark:text-rose-400' : row.variancePct < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
          {row.variancePct > 0 ? '+' : ''}{row.variancePct}%
        </span>
      ),
    },
  ];

  const matColumns = [
    { key: 'materialName', header: t('manufacturing.material') },
    { key: 'plannedCost', header: t('manufacturing.plannedCost'), align: 'right' as const, render: (row: MaterialVarianceRow) => formatCurrency(row.plannedCost) },
    { key: 'actualCost', header: t('manufacturing.actualCost'), align: 'right' as const, render: (row: MaterialVarianceRow) => formatCurrency(row.actualCost) },
    {
      key: 'costVariance', header: t('manufacturing.costVarianceLabel'), align: 'right' as const,
      render: (row: MaterialVarianceRow) => (
        <span className={`tabular-nums ${row.costVariance > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : row.costVariance < 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}`}>
          {row.costVariance > 0 ? '+' : ''}{formatCurrency(row.costVariance)}
        </span>
      ),
    },
  ];

  const handleExportExcel = async () => {
    await exportToExcel(rows, [
      { key: 'orderNumber', header: t('manufacturing.orderNumber'), width: 15 },
      { key: 'productName', header: t('manufacturing.product'), width: 20 },
      { key: 'status', header: t('manufacturing.table.status'), width: 12 },
      { key: 'plannedCost', header: t('manufacturing.plannedCost'), width: 15 },
      { key: 'actualCost', header: t('manufacturing.actualCost'), width: 15 },
      { key: 'variance', header: t('manufacturing.variance.title'), width: 15 },
    ], `variance-analysis-${new Date().toISOString().slice(0, 10)}`);
  };

  const handleExportPDF = async () => {
    await exportToPDF(rows, [
      { key: 'orderNumber', header: t('manufacturing.orderNumber') },
      { key: 'productName', header: t('manufacturing.product') },
      { key: 'status', header: t('manufacturing.table.status') },
      { key: 'plannedCost', header: t('manufacturing.plannedCostShort') },
      { key: 'actualCost', header: t('manufacturing.actualCostShort') },
      { key: 'variance', header: t('manufacturing.varianceShort') },
    ], `variance-analysis-${new Date().toISOString().slice(0, 10)}`, {
      title: t('manufacturing.varianceReport'),
      rtl: true,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Factory size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('manufacturing.varianceReport')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('manufacturing.costComparisonDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" leftIcon={showFilters ? <X size={16} /> : <Filter size={16} />} onClick={() => setShowFilters((v) => !v)}>
            {t('reports.filter')}
          </Button>
          <Can action="export" module="reports">
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel}>{t('export.excel')}</Button>
          </Can>
          <Can action="export" module="reports">
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF}>{t('export.pdf')}</Button>
          </Can>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('reports.fromDate')}</label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('reports.toDate')}</label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex gap-1 pb-0.5">
              <Button variant="ghost" size="sm" onClick={() => applyPreset(30)}>{t('reports.preset.last30')}</Button>
              <Button variant="ghost" size="sm" onClick={() => applyPreset(90)}>{t('reports.preset.last90')}</Button>
              <Button variant="ghost" size="sm" onClick={() => applyPreset(null)}>{t('reports.preset.all')}</Button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('manufacturing.table.status')}</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-40"
              >
                <option value="">{t('common.all')}</option>
                <option value="planned">{t('manufacturing.status.planned')}</option>
                <option value="in_progress">{t('manufacturing.status.inProgress')}</option>
                <option value="completed">{t('manufacturing.status.completed')}</option>
                <option value="cancelled">{t('manufacturing.status.cancelled')}</option>
              </select>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="pb-0.5">
                {t('reports.clearFilter')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-slate-500">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <Card>
          <div className="py-12 text-center text-slate-500">
            <Factory size={48} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p>{t('manufacturing.variance.emptyTitle')}</p>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2">
                {t('reports.clearFilter')}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: t('manufacturing.costVariance'), value: `${totalVariance > 0 ? '+' : ''}${formatCurrency(totalVariance)}`, color: totalVariance > 0 ? 'text-rose-600 dark:text-rose-400' : totalVariance < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400' },
              { label: t('manufacturing.variance.unfavorable'), value: String(unfavorableCount), color: 'text-rose-600 dark:text-rose-400' },
              { label: t('manufacturing.variance.favorable'), value: String(favorableCount), color: 'text-emerald-600 dark:text-emerald-400' },
              { label: t('manufacturing.avgCostPerUnit'), value: formatCurrency(avgVariance), color: 'text-primary-600 dark:text-primary-400' },
              { label: t('manufacturing.workOrders'), value: String(rows.length), color: 'text-violet-600 dark:text-violet-400' },
            ].map((kpi, i) => (
              <Card key={i} className="p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</p>
                <p className={`text-xl font-bold mt-1 tabular-nums ${kpi.color}`}>{kpi.value}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('manufacturing.workOrderCosts')} — {t('reports.top10')}</h3>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
                    <Legend />
                    <Bar dataKey="planned" name={t('manufacturing.planned')} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual" name={t('manufacturing.actual')} fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-400">{t('common.noData')}</div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('manufacturing.varianceDistribution')}</h3>
              {variancePieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={variancePieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${formatCurrency(value)}`}>
                      {variancePieData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-400">{t('common.noData')}</div>
              )}
            </Card>
          </div>

          <Card>
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200">{t('manufacturing.varianceReport')}</h3>
            </div>
            <Table<WorkOrderVarianceRow> data={rows} columns={woColumns} keyExtractor={(r) => r.id} />
          </Card>

          {materials.length > 0 && (
            <Card>
              <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-semibold text-slate-700 dark:text-slate-200">{t('manufacturing.materialVariance')} — {t('reports.top10')}</h3>
              </div>
              <Table<MaterialVarianceRow> data={materials} columns={matColumns} keyExtractor={(r) => r.materialName} />
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default VarianceAnalysisReport;
