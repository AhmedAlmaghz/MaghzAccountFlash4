import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TrendingUp, BarChart3, FileDown, Filter, RotateCcw, Calendar } from 'lucide-react';
import { Card, Button, Table, PageHeader } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CurrencyBreakdown } from '@/core/ui/components/CurrencyBreakdown';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useCurrencies } from '@/core/utils/useCurrencyDisplay';
import { buildCurrencyBreakdown, type CurrencyBreakdownResult } from '@/core/utils/currencyBreakdown';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { usePermission } from '@/modules/auth/hooks/usePermission';

interface SalesLine {
  month: string;
  date: string;
  customerName: string;
  productName: string;
  revenue: number;
  invoiceCount: number;
  avgValue: number;
  currencyCode: string;
}

interface PivotRow {
  dimension: string;
  revenue: number;
  invoiceCount: number;
  avgValue: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export const SalesAnalysisReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { currencies } = useCurrencies(activeCompany?.id || '');
  const [rawData, setRawData] = useState<SalesLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [pivotBy, setPivotBy] = useState<'none' | 'customer' | 'product' | 'month'>('none');
  const [showFilters, setShowFilters] = useState(false);

  const applyPreset = useCallback((preset: '30' | '90' | 'year' | 'all') => {
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    const now = new Date();
    setToDate(now.toISOString().split('T')[0]);
    if (preset === '30') {
      const d = new Date(now); d.setDate(d.getDate() - 30); setFromDate(d.toISOString().split('T')[0]);
    } else if (preset === '90') {
      const d = new Date(now); d.setDate(d.getDate() - 90); setFromDate(d.toISOString().split('T')[0]);
    } else if (preset === 'year') {
      const d = new Date(now.getFullYear(), 0, 1); setFromDate(d.toISOString().split('T')[0]);
    }
  }, []);

  useEffect(() => {
    if (!activeCompany?.id) return;
    const companyId = activeCompany.id;
    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();
        const result = await adapter.query(
          `SELECT i.id AS invoice_id,
                  i.date,
                  i.status,
                  i.total_amount,
                  i.paid_amount,
                  i.currency_code,
                  c.name AS customer_name,
                  l.id AS line_id,
                  l.product_id,
                  l.quantity,
                  l.unit_price,
                  l.line_total,
                  l.discount_percent,
                  l.vat_percent,
                  p.name_ar AS product_name,
                  p.name_en AS product_name_en
             FROM sales_invoices i
             LEFT JOIN customers c ON c.id = i.customer_id
             LEFT JOIN sales_invoice_lines l ON l.invoice_id = i.id
             LEFT JOIN products p ON p.id = l.product_id
            WHERE i.company_id = $1
              AND i.status != 'cancelled'
              AND ($2::date IS NULL OR i.date >= $2::date)
              AND ($3::date IS NULL OR i.date <= $3::date)
            ORDER BY i.date DESC, i.id DESC, l.id ASC`,
          [companyId, fromDate || null, toDate || null]
        );
      const dbRows = (result.rows || []) as Record<string, unknown>[];
      const months = [t('reports.months.jan'),t('reports.months.feb'),t('reports.months.mar'),t('reports.months.apr'),t('reports.months.may'),t('reports.months.jun'),t('reports.months.jul'),t('reports.months.aug'),t('reports.months.sep'),t('reports.months.oct'),t('reports.months.nov'),t('reports.months.dec')];

      // Group lines by invoice so invoices with no lines still appear with productName='-'.
      const invoiceMap = new Map<string, {
        invoiceId: string;
        date: string;
        customerName: string;
        currencyCode: string;
        lines: { productName: string; lineTotal: number; quantity: number; unitPrice: number }[];
      }>();
      for (const r of dbRows) {
        const invId = String(r.invoice_id || '');
        if (!invId) continue;
        let entry = invoiceMap.get(invId);
        if (!entry) {
          entry = {
            invoiceId: invId,
            date: String(r.date || ''),
            customerName: String(r.customer_name || t('reports.unknown')),
            currencyCode: String(r.currency_code || YER_CODE),
            lines: [],
          };
          invoiceMap.set(invId, entry);
        }
        if (r.line_id != null) {
          const lineTotal = Number(r.line_total ?? 0);
          entry.lines.push({
            productName: String(r.product_name || r.product_name_en || '-'),
            lineTotal,
            quantity: Number(r.quantity ?? 0),
            unitPrice: Number(r.unit_price ?? 0),
          });
        }
      }

      const rows: SalesLine[] = [];
      for (const entry of invoiceMap.values()) {
        const d = entry.date ? new Date(entry.date) : new Date();
        const month = Number.isFinite(d.getTime()) ? months[d.getMonth()] || months[0] : months[0];
        if (entry.lines.length === 0) {
          rows.push({
            month,
            date: entry.date,
            customerName: entry.customerName,
            productName: '-',
            revenue: 0,
            invoiceCount: 1,
            avgValue: 0,
            currencyCode: entry.currencyCode,
          });
        } else {
          for (const l of entry.lines) {
            rows.push({
              month,
              date: entry.date,
              customerName: entry.customerName,
              productName: l.productName,
              revenue: l.lineTotal,
              invoiceCount: 1,
              avgValue: l.lineTotal,
              currencyCode: entry.currencyCode,
            });
          }
        }
      }
      setRawData(rows);
      } catch (_err) {
        setRawData([]);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [activeCompany?.id, currencies, fromDate, toDate, t]);

  const filteredData = useMemo(() => {
    return rawData.filter((row) => {
      if (customerFilter && !(row.customerName?.toLowerCase() || '').includes(customerFilter.toLowerCase())) return false;
      if (productFilter && !(row.productName?.toLowerCase() || '').includes(productFilter.toLowerCase())) return false;
      return true;
    });
  }, [rawData, customerFilter, productFilter]);

  const pivotData = useMemo((): PivotRow[] => {
    if (pivotBy === 'none') return [];
    const map: Record<string, { revenue: number; invoiceCount: number; count: number }> = {};
    for (const row of filteredData) {
      const key = row[pivotBy === 'customer' ? 'customerName' : pivotBy === 'product' ? 'productName' : 'month'];
      if (!map[key]) map[key] = { revenue: 0, invoiceCount: 0, count: 0 };
      map[key].revenue += row.revenue;
      map[key].invoiceCount += row.invoiceCount;
      map[key].count += 1;
    }
    return Object.entries(map).map(([dimension, v]) => ({
      dimension,
      revenue: v.revenue,
      invoiceCount: v.invoiceCount,
      avgValue: v.count > 0 ? Math.floor(v.revenue / v.count) : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredData, pivotBy]);

  const totalRevenue = filteredData.reduce((s, d) => s + d.revenue, 0);
  const totalInvoices = filteredData.reduce((s, d) => s + d.invoiceCount, 0);
  const avgInvoice = totalInvoices > 0 ? Math.floor(totalRevenue / totalInvoices) : 0;

  const currencyBreakdown: CurrencyBreakdownResult = useMemo(
    () => buildCurrencyBreakdown(
      filteredData.map((r) => ({ code: r.currencyCode, amount: r.revenue })),
      currencies,
    ),
    [filteredData, currencies],
  );

  const chartData = useMemo(() => {
    if (pivotBy !== 'none') return pivotData.map((p) => ({ name: p.dimension, revenue: p.revenue }));
    const monthMap: Record<string, number> = {};
    for (const row of filteredData) {
      monthMap[row.month] = (monthMap[row.month] || 0) + row.revenue;
    }
    return Object.entries(monthMap).map(([name, revenue]) => ({ name, revenue }));
  }, [filteredData, pivotData, pivotBy]);

  const handleExportExcel = async () => {
    const cols = [
      { key: 'month', header: t('reports.month') },
      { key: 'customerName', header: t('reports.customer') },
      { key: 'productName', header: t('reports.product') },
      { key: 'revenue', header: t('reports.revenue') },
      { key: 'invoiceCount', header: t('reports.invoicesCount') },
    ];
    await exportToExcel(filteredData, cols, 'Sales_Analysis');
  };

  const handleExportPDF = async () => {
    const cols = [
      { key: 'month', header: t('reports.month'), width: 12 },
      { key: 'customerName', header: t('reports.customer'), width: 20 },
      { key: 'productName', header: t('reports.product'), width: 20 },
      { key: 'revenue', header: t('reports.revenue'), width: 15 },
    ];
    await exportToPDF(filteredData, cols, 'Sales_Analysis', {
      title: t('reports.salesAnalysis'),
      subtitle: activeCompany?.name,
      rtl: true,
    });
  };

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setCustomerFilter('');
    setProductFilter('');
    setPivotBy('none');
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <TrendingUp size={48} className="mx-auto mb-4 text-slate-400" />
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

  if (!filteredData.length) {
    return (
      <EmptyState
        icon="search"
        title={t('reports.emptyResults.title')}
        description={t('reports.emptyResults.description')}
        action={
          <Button variant="secondary" onClick={clearFilters} leftIcon={<RotateCcw size={16} />}>
            {t('reports.clearFilter')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        icon={<BarChart3 size={22} />}
        title={t('reports.salesAnalysis')}
        subtitle={t('reports.salesAnalysis.subtitle')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Filter size={16} />} onClick={() => setShowFilters((s) => !s)}>
              {t('reports.filter')}
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={!canExport}>
              Excel
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF} disabled={!canExport}>
              PDF
            </Button>
          </>
        }
      />

      {/* Filters */}
      {showFilters && (
        <Card>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.fromDate')}</label>
                <input type="date" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.toDate')}</label>
                <input type="date" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="flex items-end gap-1 flex-wrap">
                <Button size="sm" variant="ghost" leftIcon={<Calendar size={14} />} onClick={() => applyPreset('30')}>{t('reports.preset.last30')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('90')}>{t('reports.preset.last90')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('year')}>{t('reports.preset.thisYear')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('all')}>{t('reports.preset.all')}</Button>
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={clearFilters}>
                  {t('reports.clearFilter')}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.customer')}</label>
                <input type="text" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" placeholder={t('reports.placeholder.customerName')} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.product')}</label>
                <input type="text" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" placeholder={t('reports.placeholder.productName')} value={productFilter} onChange={(e) => setProductFilter(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.pivotTable')}</label>
                <select className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={pivotBy} onChange={(e) => setPivotBy(e.target.value as 'none' | 'customer' | 'product' | 'month')}>
                  <option value="none">{t('reports.pivotNone')}</option>
                  <option value="customer">{t('reports.pivotByCustomer')}</option>
                  <option value="product">{t('reports.pivotByProduct')}</option>
                  <option value="month">{t('reports.pivotByMonth')}</option>
                </select>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.totalRevenue')}</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalRevenue)}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.invoicesCount')}</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalInvoices}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('accounting.avgInvoiceValue')}</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(avgInvoice)}</p>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.salesAnalysis')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('reports.distribution')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData.slice(0, 6)} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="revenue" nameKey="name">
                    {chartData.slice(0, 6).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>

      {/* Pivot or Detail Table */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">
            {pivotBy !== 'none' ? t('reports.pivotTable') : t('reports.salesAnalysis.details')}
          </h3>
          {pivotBy !== 'none' ? (
            <Table
              data={pivotData}
              columns={[
                { key: 'dimension', header: pivotBy === 'customer' ? t('reports.customer') : pivotBy === 'product' ? t('reports.product') : t('reports.month'), mobile: 'title' as const },
                { key: 'revenue', header: t('reports.revenue'), align: 'right', mobile: 'subtitle' as const, render: (row) => formatCurrency(row.revenue) },
                { key: 'invoiceCount', header: t('reports.invoicesCount'), align: 'right' },
                { key: 'avgValue', header: t('reports.average'), align: 'right', render: (row) => formatCurrency(row.avgValue) },
              ]}
              keyExtractor={(row) => row.dimension}
            />
          ) : (
            <Table
              data={filteredData.slice(0, 200)}
              columns={[
                { key: 'date', header: t('reports.date'), mobile: 'hidden' as const },
                { key: 'customerName', header: t('reports.customer'), mobile: 'title' as const },
                { key: 'productName', header: t('reports.product'), mobile: 'subtitle' as const },
                { key: 'currencyCode', header: t('reports.currency'), align: 'right', render: (row) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{row.currencyCode}</span> },
                { key: 'revenue', header: t('reports.revenue'), align: 'right', render: (row) => formatCurrency(row.revenue) },
              ]}
              keyExtractor={(row, i) => `${row.customerName}-${i}`}
            />
          )}
        </div>
      </Card>

      {/* Currency Breakdown */}
      {currencyBreakdown.items.length > 0 && (
        <CurrencyBreakdown result={currencyBreakdown} title={t('reports.revenueByCurrency')} />
      )}
    </div>
  );
};

export default SalesAnalysisReport;
