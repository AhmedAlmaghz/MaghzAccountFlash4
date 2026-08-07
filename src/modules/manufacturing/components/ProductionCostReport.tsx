import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Factory, FileDown } from 'lucide-react';
import { Card, Button, Table, Can } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';

interface WorkOrderCostRow {
  id: string;
  orderNumber: string;
  productName: string;
  status: string;
  quantity: number;
  producedQuantity: number;
  plannedCost: number;
  actualCost: number;
  variance: number;
  completionPct: number;
  plannedUnitCost: number;
  actualUnitCost: number;
}

interface MaterialVarianceRow {
  materialName: string;
  plannedQty: number;
  actualQty: number;
  qtyVariance: number;
  plannedCost: number;
  actualCost: number;
  costVariance: number;
}

interface MonthlyCostRow {
  month: string;
  planned: number;
  actual: number;
  count: number;
}

interface UnitCostRow {
  orderNumber: string;
  productName: string;
  plannedUnitCost: number;
  actualUnitCost: number;
  unitVariance: number;
  quantity: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function getDateRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  if (preset === '30d') {
    const s = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start: s.toISOString().slice(0, 10), end };
  }
  if (preset === '90d') {
    const s = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start: s.toISOString().slice(0, 10), end };
  }
  return { start: '', end: '' };
}

export const ProductionCostReport: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);
  const [rows, setRows] = useState<WorkOrderCostRow[]>([]);
  const [materials, setMaterials] = useState<MaterialVarianceRow[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyCostRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [datePreset, setDatePreset] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const applyPreset = useCallback((preset: string) => {
    setDatePreset(preset);
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else {
      const { start, end } = getDateRange(preset);
      setStartDate(start);
      setEndDate(end);
    }
  }, []);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const adapter = await getDbAdapter();
      const hasDateFilter = startDate && endDate;

      const params: unknown[] = [companyId];
      let dateClause = '';
      if (hasDateFilter) {
        params.push(startDate, `${endDate}T23:59:59Z`);
        dateClause = ' AND w.created_at >= $2 AND w.created_at <= $3';
      }

      const woResult = await adapter.query(
        `SELECT w.id, w.order_number, w.status, w.quantity, w.produced_quantity, w.total_cost,
                p.name_ar AS product_name,
                COALESCE(SUM(c.planned_quantity * c.unit_cost), 0) AS planned_cost,
                COALESCE(SUM(c.actual_quantity * c.actual_unit_cost), 0) AS actual_cost
           FROM work_orders w
           LEFT JOIN products p ON p.id = w.product_id
           LEFT JOIN work_order_consumptions c ON c.work_order_id = w.id
          WHERE w.company_id = $1${dateClause}
          GROUP BY w.id, w.order_number, w.status, w.quantity, w.produced_quantity, w.total_cost, p.name_ar
          ORDER BY w.order_number DESC`,
        params,
      );

      const woRows: WorkOrderCostRow[] = (woResult.rows || []).map((r: Record<string, unknown>) => {
        const qty = Number(r.quantity || 0);
        const produced = Number(r.produced_quantity || 0);
        const planned = Number(r.planned_cost || 0);
        const actual = Number(r.actual_cost || r.total_cost || 0);
        return {
          id: String(r.id),
          orderNumber: String(r.order_number),
          productName: r.product_name ? String(r.product_name) : '—',
          status: String(r.status),
          quantity: qty,
          producedQuantity: produced,
          plannedCost: planned,
          actualCost: actual,
          variance: actual - planned,
          completionPct: qty > 0 ? Math.round((produced / qty) * 100) : 0,
          plannedUnitCost: qty > 0 ? planned / qty : 0,
          actualUnitCost: produced > 0 ? actual / produced : 0,
        };
      });
      setRows(woRows);

      const matParams = hasDateFilter ? [companyId, startDate, `${endDate}T23:59:59Z`] : [companyId];
      const matDateClause = hasDateFilter ? ' AND w.created_at >= $2 AND w.created_at <= $3' : '';

      const matResult = await adapter.query(
        `SELECT p.name_ar AS material_name,
                SUM(c.planned_quantity) AS planned_qty,
                SUM(COALESCE(c.actual_quantity, 0)) AS actual_qty,
                SUM(c.planned_quantity * c.unit_cost) AS planned_cost,
                SUM(COALESCE(c.actual_quantity, 0) * COALESCE(c.actual_unit_cost, c.unit_cost)) AS actual_cost
           FROM work_order_consumptions c
           JOIN work_orders w ON w.id = c.work_order_id
           LEFT JOIN products p ON p.id = c.material_id
          WHERE w.company_id = $1${matDateClause}
          GROUP BY p.name_ar
          ORDER BY ABS(SUM(COALESCE(c.actual_quantity, 0) * COALESCE(c.actual_unit_cost, c.unit_cost)) - SUM(c.planned_quantity * c.unit_cost)) DESC
          LIMIT 10`,
        matParams,
      );

      const matRows: MaterialVarianceRow[] = (matResult.rows || []).map((r: Record<string, unknown>) => {
        const pq = Number(r.planned_qty || 0);
        const aq = Number(r.actual_qty || 0);
        const pc = Number(r.planned_cost || 0);
        const ac = Number(r.actual_cost || 0);
        return {
          materialName: r.material_name ? String(r.material_name) : '—',
          plannedQty: pq,
          actualQty: aq,
          qtyVariance: aq - pq,
          plannedCost: pc,
          actualCost: ac,
          costVariance: ac - pc,
        };
      });
      setMaterials(matRows);

      const monthlyParams = hasDateFilter ? [companyId, startDate, `${endDate}T23:59:59Z`] : [companyId];
      const monthlyDateClause = hasDateFilter ? ' AND w.created_at >= $2 AND w.created_at <= $3' : '';

      const monthlyResult = await adapter.query(
        `SELECT TO_CHAR(w.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(c.planned_quantity * c.unit_cost), 0) AS planned,
                COALESCE(SUM(c.actual_quantity * COALESCE(c.actual_unit_cost, c.unit_cost)), 0) AS actual,
                COUNT(DISTINCT w.id) AS count
           FROM work_orders w
           LEFT JOIN work_order_consumptions c ON c.work_order_id = w.id
          WHERE w.company_id = $1${monthlyDateClause}
          GROUP BY TO_CHAR(w.created_at, 'YYYY-MM')
          ORDER BY month`,
        monthlyParams,
      );

      const monthlyRows: MonthlyCostRow[] = (monthlyResult.rows || []).map((r: Record<string, unknown>) => ({
        month: String(r.month),
        planned: Number(r.planned || 0),
        actual: Number(r.actual || 0),
        count: Number(r.count || 0),
      }));
      setMonthlyData(monthlyRows);

      setIsLoading(false);
    }
    load();
  }, [companyId, startDate, endDate]);

  const totalPlanned = rows.reduce((s, r) => s + r.plannedCost, 0);
  const totalActual = rows.reduce((s, r) => s + r.actualCost, 0);
  const totalVariance = totalActual - totalPlanned;
  const completedCount = rows.filter((r) => r.status === 'completed').length;
  const avgCost = rows.length > 0 ? totalActual / rows.length : 0;
  const efficiency = totalActual > 0 ? (totalPlanned / totalActual) * 100 : 0;

  const unitCostRows = useMemo<UnitCostRow[]>(() => {
    return rows
      .filter((r) => r.quantity > 0 && r.producedQuantity > 0)
      .map((r) => ({
        orderNumber: r.orderNumber,
        productName: r.productName,
        plannedUnitCost: r.plannedUnitCost,
        actualUnitCost: r.actualUnitCost,
        unitVariance: r.actualUnitCost - r.plannedUnitCost,
        quantity: r.producedQuantity,
      }));
  }, [rows]);

  const costChartData = rows.slice(0, 10).map((r) => ({
    name: r.orderNumber,
    planned: r.plannedCost,
    actual: r.actualCost,
  }));

  const statusData = [
    { name: t('manufacturing.completed'), value: rows.filter((r) => r.status === 'completed').length },
    { name: t('manufacturing.in_progress'), value: rows.filter((r) => r.status === 'in_progress').length },
    { name: t('manufacturing.planned'), value: rows.filter((r) => r.status === 'planned').length },
    { name: t('manufacturing.cancelled'), value: rows.filter((r) => r.status === 'cancelled').length },
  ].filter((d) => d.value > 0);

  const woColumns = [
    { key: 'orderNumber', header: t('manufacturing.orderNumber') },
    { key: 'productName', header: t('manufacturing.product') },
    { key: 'status', header: t('manufacturing.table.status'), render: (row: WorkOrderCostRow) => {
      const colors: Record<string, string> = {
        planned: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
        in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      };
      return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[row.status] || ''}`}>{t(`manufacturing.${row.status}`)}</span>;
    }},
    { key: 'quantity', header: t('manufacturing.plannedQuantity'), align: 'right' as const },
    { key: 'producedQuantity', header: t('manufacturing.actualQuantity'), align: 'right' as const },
    { key: 'completionPct', header: t('manufacturing.completion'), align: 'right' as const, render: (row: WorkOrderCostRow) => (
      <div className="flex items-center gap-2">
        <div className="w-16 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
          <div className="h-2 rounded-full bg-primary-500" style={{ width: `${Math.min(row.completionPct, 100)}%` }} />
        </div>
        <span className="text-xs">{row.completionPct}%</span>
      </div>
    )},
    { key: 'plannedCost', header: t('manufacturing.plannedCost'), align: 'right' as const, render: (row: WorkOrderCostRow) => formatCurrency(row.plannedCost) },
    { key: 'actualCost', header: t('manufacturing.actualCost'), align: 'right' as const, render: (row: WorkOrderCostRow) => formatCurrency(row.actualCost) },
    { key: 'variance', header: t('manufacturing.variance.title'), align: 'right' as const, render: (row: WorkOrderCostRow) => (
      <span className={row.variance > 0 ? 'text-rose-600 dark:text-rose-400' : row.variance < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
        {row.variance > 0 ? '+' : ''}{formatCurrency(row.variance)}
      </span>
    )},
  ];

  const matColumns = [
    { key: 'materialName', header: t('manufacturing.material') },
    { key: 'plannedQty', header: t('manufacturing.plannedQuantity'), align: 'right' as const },
    { key: 'actualQty', header: t('manufacturing.actualQuantity'), align: 'right' as const },
    { key: 'qtyVariance', header: t('manufacturing.qtyVariance'), align: 'right' as const, render: (row: MaterialVarianceRow) => (
      <span className={row.qtyVariance > 0 ? 'text-rose-600 dark:text-rose-400' : row.qtyVariance < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
        {row.qtyVariance > 0 ? '+' : ''}{row.qtyVariance.toFixed(2)}
      </span>
    )},
    { key: 'plannedCost', header: t('manufacturing.plannedCost'), align: 'right' as const, render: (row: MaterialVarianceRow) => formatCurrency(row.plannedCost) },
    { key: 'actualCost', header: t('manufacturing.actualCost'), align: 'right' as const, render: (row: MaterialVarianceRow) => formatCurrency(row.actualCost) },
    { key: 'costVariance', header: t('manufacturing.costVarianceLabel'), align: 'right' as const, render: (row: MaterialVarianceRow) => (
      <span className={row.costVariance > 0 ? 'text-rose-600 dark:text-rose-400' : row.costVariance < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
        {row.costVariance > 0 ? '+' : ''}{formatCurrency(row.costVariance)}
      </span>
    )},
  ];

  const unitCostColumns = [
    { key: 'orderNumber', header: t('manufacturing.orderNumber') },
    { key: 'productName', header: t('manufacturing.product') },
    { key: 'plannedUnitCost', header: t('manufacturing.plannedUnitCost'), align: 'right' as const, render: (row: UnitCostRow) => formatCurrency(row.plannedUnitCost) },
    { key: 'actualUnitCost', header: t('manufacturing.actualUnitCost'), align: 'right' as const, render: (row: UnitCostRow) => formatCurrency(row.actualUnitCost) },
    { key: 'unitVariance', header: t('manufacturing.variance.title'), align: 'right' as const, render: (row: UnitCostRow) => (
      <span className={row.unitVariance > 0 ? 'text-rose-600 dark:text-rose-400' : row.unitVariance < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
        {row.unitVariance > 0 ? '+' : ''}{formatCurrency(row.unitVariance)}
      </span>
    )},
    { key: 'quantity', header: t('manufacturing.actualQuantity'), align: 'right' as const },
  ];

  const handleExportExcel = async () => {
    await exportToExcel(rows, [
      { key: 'orderNumber', header: t('manufacturing.orderNumber'), width: 15 },
      { key: 'productName', header: t('manufacturing.product'), width: 20 },
      { key: 'status', header: t('manufacturing.table.status'), width: 12 },
      { key: 'quantity', header: t('manufacturing.plannedQuantity'), width: 12 },
      { key: 'producedQuantity', header: t('manufacturing.actualQuantity'), width: 12 },
      { key: 'completionPct', header: t('manufacturing.completionRate'), width: 12 },
      { key: 'plannedCost', header: t('manufacturing.plannedCost'), width: 15 },
      { key: 'actualCost', header: t('manufacturing.actualCost'), width: 15 },
      { key: 'variance', header: t('manufacturing.variance.title'), width: 15 },
      { key: 'plannedUnitCost', header: t('manufacturing.plannedUnitCost'), width: 15 },
      { key: 'actualUnitCost', header: t('manufacturing.actualUnitCost'), width: 15 },
    ], `production-cost-${new Date().toISOString().slice(0, 10)}`);
  };

  const handleExportPDF = async () => {
    await exportToPDF(rows, [
      { key: 'orderNumber', header: t('manufacturing.orderNumber') },
      { key: 'productName', header: t('manufacturing.product') },
      { key: 'status', header: t('manufacturing.status') },
      { key: 'quantity', header: t('manufacturing.plannedQuantityShort') },
      { key: 'producedQuantity', header: t('manufacturing.actualQuantityShort') },
      { key: 'plannedCost', header: t('manufacturing.plannedCostShort') },
      { key: 'actualCost', header: t('manufacturing.actualCostShort') },
      { key: 'variance', header: t('manufacturing.varianceShort') },
    ], `production-cost-${new Date().toISOString().slice(0, 10)}`, {
      title: t('manufacturing.productionCostReport'),
      rtl: true,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Factory size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('manufacturing.productionCostReport')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('manufacturing.costComparisonDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Can action="export" module="reports">
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel}>{t('export.excel')}</Button>
          </Can>
          <Can action="export" module="reports">
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF}>{t('export.pdf')}</Button>
          </Can>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('reports.period')}:</span>
          <div className="flex items-center gap-1">
            <Button variant={datePreset === '30d' ? 'primary' : 'secondary'} size="sm" onClick={() => applyPreset('30d')}>{t('reports.month')}</Button>
            <Button variant={datePreset === '90d' ? 'primary' : 'secondary'} size="sm" onClick={() => applyPreset('90d')}>{t('reports.quarter')}</Button>
            <Button variant={datePreset === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => applyPreset('all')}>{t('reports.all')}</Button>
          </div>
          <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
          <label className="text-xs text-slate-500 dark:text-slate-400">{t('reports.fromDate')}:</label>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDatePreset(''); }}
            className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded px-2 py-1 text-sm" />
          <label className="text-xs text-slate-500 dark:text-slate-400">{t('reports.toDate')}:</label>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setDatePreset(''); }}
            className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded px-2 py-1 text-sm" />
        </div>
      </Card>

      {isLoading ? (
        <div className="py-12 text-center text-slate-500">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <Card>
          <div className="py-12 text-center text-slate-500">
            <Factory size={48} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p>{t('manufacturing.noWorkOrders')}</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t('manufacturing.totalPlannedCost'), value: formatCurrency(totalPlanned), color: 'text-blue-600 dark:text-blue-400' },
              { label: t('manufacturing.totalActualCost'), value: formatCurrency(totalActual), color: 'text-emerald-600 dark:text-emerald-400' },
              { label: t('manufacturing.costVariance'), value: `${totalVariance > 0 ? '+' : ''}${formatCurrency(totalVariance)}`, color: totalVariance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400' },
              { label: t('manufacturing.avgCostPerUnit'), value: formatCurrency(avgCost), color: 'text-primary-600 dark:text-primary-400' },
            ].map((kpi, i) => (
              <Card key={i} className="p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</p>
                <p className={`text-xl font-bold mt-1 tabular-nums ${kpi.color}`}>{kpi.value}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t('manufacturing.completionRate'), value: `${rows.length > 0 ? Math.round((completedCount / rows.length) * 100) : 0}%`, color: 'text-violet-600 dark:text-violet-400' },
              { label: t('reports.costEfficiency'), value: `${efficiency > 0 ? efficiency.toFixed(1) : 0}%`, color: efficiency >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400' },
              { label: t('manufacturing.workOrders.title'), value: String(rows.length), color: 'text-sky-600 dark:text-sky-400' },
              { label: t('manufacturing.completed'), value: String(completedCount), color: 'text-emerald-600 dark:text-emerald-400' },
            ].map((kpi, i) => (
              <Card key={i + 4} className="p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</p>
                <p className={`text-xl font-bold mt-1 tabular-nums ${kpi.color}`}>{kpi.value}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('manufacturing.workOrderCosts')}</h3>
              {costChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costChartData}>
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
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('manufacturing.workOrderStatus')}</h3>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {statusData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-400">{t('common.noData')}</div>
              )}
            </Card>
          </div>

          {monthlyData.length > 0 && (
            <Card className="p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('reports.monthlyCostTrend')}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
                  <Legend />
                  <Bar dataKey="planned" name={t('manufacturing.planned')} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name={t('manufacturing.actual')} fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="text-xs text-slate-400 mt-2 text-center">
                {t('manufacturing.monthlyCostTitle')}
              </div>
            </Card>
          )}

          <Card>
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-700 dark:text-slate-200">{t('manufacturing.workOrderCosts')}</h3>
            </div>
            <Table<WorkOrderCostRow> data={rows} columns={woColumns} keyExtractor={(r) => r.id} />
          </Card>

          {unitCostRows.length > 0 && (
            <Card>
              <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-semibold text-slate-700 dark:text-slate-200">{t('reports.unitCostAnalysis')}</h3>
              </div>
              <Table<UnitCostRow> data={unitCostRows} columns={unitCostColumns} keyExtractor={(r) => r.orderNumber} />
            </Card>
          )}

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

export default ProductionCostReport;
