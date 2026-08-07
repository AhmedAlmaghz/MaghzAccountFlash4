import React, { useState, useEffect, useMemo } from 'react';
import { Package, AlertTriangle, FileDown, Filter, RotateCcw, TrendingDown } from 'lucide-react';
import { Card, Button, Table } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { usePermission } from '@/modules/auth/hooks/usePermission';

interface StockItem {
  product: string;
  sku: string;
  warehouse: string;
  quantity: number;
  minStock: number;
  status: 'good' | 'low' | 'out';
  value: number;
  cost: number;
  price: number;
  stockValue: number;
  turnoverDays: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export const InventoryAnalysisReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const [items, setItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'good' | 'low' | 'out'>('all');
  const [view, setView] = useState<'all' | 'lowStock' | 'slowMoving' | 'abc'>('all');

  useEffect(() => {
    if (!activeCompany?.id) return;
    const companyId = activeCompany.id;
    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();
      const stockResult = await adapter.query(
        `SELECT s.id AS stock_id,
                s.product_id,
                s.warehouse_id,
                s.quantity,
                s.min_stock_alert,
                p.name_ar AS product_name,
                p.name_en AS product_name_en,
                p.sku,
                p.cost_price,
                p.sale_price,
                w.name AS warehouse_name,
                COALESCE(mov.total_out, 0) AS total_out,
                mov.first_out,
                mov.last_out
           FROM stock s
           JOIN products p ON p.id = s.product_id
           JOIN warehouses w ON w.id = s.warehouse_id
           LEFT JOIN (
             SELECT product_id,
                    SUM(quantity) AS total_out,
                    MIN(created_at) AS first_out,
                    MAX(created_at) AS last_out
               FROM stock_movements
              WHERE company_id = $1 AND type = 'out'
              GROUP BY product_id
           ) mov ON mov.product_id = s.product_id
          WHERE s.company_id = $1`,
        [companyId],
      );
      const stockRows = (stockResult.rows || []) as Record<string, unknown>[];

      const rows: StockItem[] = stockRows.map((r) => {
        const qty = Number(r.quantity || 0);
        const min = Number(r.min_stock_alert || 0);
        const cost = Number(r.cost_price || 0);
        const price = Number(r.sale_price || 0);
        let status: 'good' | 'low' | 'out' = 'good';
        if (qty === 0) status = 'out';
        else if (qty <= min) status = 'low';

        let turnoverDays = 999;
        const totalOut = Number(r.total_out || 0);
        if (totalOut > 0) {
          const firstDate = r.first_out ? new Date(String(r.first_out)) : null;
          const lastDate = r.last_out ? new Date(String(r.last_out)) : null;
          if (firstDate && lastDate) {
            const daysDiff = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / 86400000));
            const avgDaily = totalOut / daysDiff;
            turnoverDays = avgDaily > 0 ? Math.floor(qty / avgDaily) : 999;
          }
        }

        return {
          product: String(r.product_name || r.product_name_en || ''),
          sku: String(r.sku || ''),
          warehouse: String(r.warehouse_name || ''),
          quantity: qty,
          minStock: min,
          status,
          value: qty * cost,
          cost,
          price,
          stockValue: qty * cost,
          turnoverDays,
        };
      });
      setItems(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load inventory analysis');
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [activeCompany?.id]);

  const filteredItems = useMemo(() => {
    let data = [...items];
    if (statusFilter !== 'all') data = data.filter((i) => i.status === statusFilter);
    if (view === 'lowStock') data = data.filter((i) => i.status === 'low' || i.status === 'out');
    if (view === 'slowMoving') data = data.filter((i) => i.turnoverDays > 90);
    if (view === 'abc') {
      data.sort((a, b) => b.stockValue - a.stockValue);
    }
    return data;
  }, [items, statusFilter, view]);

  const abcData = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.stockValue - a.stockValue);
    const totalValue = sorted.reduce((s, i) => s + i.stockValue, 0);
    const rows = sorted.reduce<{ cum: number; data: (StockItem & { grade: string; cumPct: number })[] }>(
      (acc, item) => {
        acc.cum += item.stockValue;
        const cumPct = totalValue > 0 ? (acc.cum / totalValue) * 100 : 0;
        const grade = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
        acc.data.push({ ...item, grade, cumPct: Math.round(cumPct) });
        return acc;
      },
      { cum: 0, data: [] }
    );
    return rows.data;
  }, [items]);

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const lowStockCount = items.filter((i) => i.status === 'low').length;
  const outOfStock = items.filter((i) => i.status === 'out').length;
  const slowMovingCount = items.filter((i) => i.turnoverDays > 90).length;

  const statusChart = [
    { name: t('reports.good'), value: items.filter((i) => i.status === 'good').length },
    { name: t('reports.low'), value: lowStockCount },
    { name: t('reports.out'), value: outOfStock },
  ];

  const handleExportExcel = async () => {
    const cols = [
      { key: 'product', header: t('reports.product') },
      { key: 'sku', header: t('reports.sku') },
      { key: 'warehouse', header: t('reports.warehouse') },
      { key: 'quantity', header: t('reports.quantity') },
      { key: 'minStock', header: t('reports.minStock') },
      { key: 'status', header: t('reports.status') },
      { key: 'value', header: t('reports.amount') },
    ];
    await exportToExcel(view === 'abc' ? abcData : filteredItems, cols, 'Inventory_Analysis');
  };

  const handleExportPDF = async () => {
    const cols = [
      { key: 'product', header: t('reports.product'), width: 25 },
      { key: 'sku', header: t('reports.sku'), width: 15 },
      { key: 'quantity', header: t('reports.quantity'), width: 12 },
      { key: 'value', header: t('reports.amount'), width: 15 },
    ];
    await exportToPDF(view === 'abc' ? abcData : filteredItems, cols, 'Inventory_Analysis', {
      title: t('reports.inventoryAnalysis'),
      subtitle: activeCompany?.name,
      rtl: true,
    });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('reports.inventoryAnalysis')}</h1>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" leftIcon={<Filter size={16} />} onClick={() => setShowFilters((s) => !s)}>
            {t('reports.filter')}
          </Button>
          <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={!canExport}>
            {t('reports.exportExcel')}
          </Button>
          <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF} disabled={!canExport}>
            {t('reports.exportPdf')}
          </Button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'all', label: t('reports.all') },
          { key: 'lowStock', label: t('reports.lowStockItems') },
          { key: 'slowMoving', label: t('reports.slowMoving') },
          { key: 'abc', label: t('reports.abcAnalysis') },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              view === tab.key
                ? 'bg-primary-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <div className="p-4 flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('reports.status')}</label>
              <select className="px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="all">{t('reports.all')}</option>
                <option value="good">{t('reports.good')}</option>
                <option value="low">{t('reports.low')}</option>
                <option value="out">{t('reports.out')}</option>
              </select>
            </div>
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => setStatusFilter('all')}>
              {t('reports.clearFilter')}
            </Button>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.total')}</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(totalValue)}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.lowStock')}</p>
            <div className="flex items-center justify-center gap-2">
              <AlertTriangle size={20} className="text-amber-500" />
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{lowStockCount}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.slowMoving')}</p>
            <div className="flex items-center justify-center gap-2">
              <TrendingDown size={20} className="text-rose-500" />
              <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{slowMovingCount}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.out')}</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{outOfStock}</p>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.inventoryAnalysis.statusDistribution')}</h3>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusChart} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" nameKey="name">
                    {statusChart.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.topProductsByValue')}</h3>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={items.sort((a, b) => b.value - a.value).slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <YAxis dataKey="product" type="category" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">
            {view === 'abc' ? t('reports.abcAnalysis') : t('reports.inventoryAnalysis.details')}
          </h3>
          {view === 'abc' ? (
            <Table
              data={abcData}
              columns={[
                { key: 'product', header: t('reports.product') },
                { key: 'sku', header: t('reports.sku') },
                { key: 'quantity', header: t('reports.quantity'), align: 'right' },
                { key: 'stockValue', header: t('reports.amount'), align: 'right', render: (row) => formatCurrency(row.stockValue) },
                { key: 'cumPct', header: t('reports.abcAnalysis.cumulativePercent'), align: 'right', render: (row) => `${row.cumPct}%` },
                { key: 'grade', header: t('reports.abcAnalysis.grade'), align: 'center', render: (row) => (
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold ${
                    row.grade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                    row.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-700'
                  }`}>{row.grade}</span>
                )},
              ]}
              keyExtractor={(row, i) => `${row.sku}-${i}`}
            />
          ) : (
            <Table
              data={filteredItems}
              columns={[
                { key: 'product', header: t('reports.product') },
                { key: 'sku', header: t('reports.sku') },
                { key: 'warehouse', header: t('reports.warehouse') },
                { key: 'quantity', header: t('reports.quantity'), align: 'right' },
                { key: 'minStock', header: t('reports.minStock'), align: 'right' },
                { key: 'status', header: t('reports.status'), render: (row) => (
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                    row.status === 'good' ? 'bg-emerald-100 text-emerald-700' :
                    row.status === 'low' ? 'bg-amber-100 text-amber-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    {row.status === 'good' ? t('reports.good') : row.status === 'low' ? t('reports.low') : t('reports.out')}
                  </span>
                )},
                { key: 'value', header: t('reports.amount'), align: 'right', render: (row) => formatCurrency(row.value) },
                { key: 'turnoverDays', header: t('reports.turnoverDays'), align: 'right' },
              ]}
              keyExtractor={(row, i) => `${row.sku}-${i}`}
            />
          )}
        </div>
      </Card>
    </div>
  );
};

export default InventoryAnalysisReport;
