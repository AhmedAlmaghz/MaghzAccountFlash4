import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TrendingUp, BarChart3, FileDown, Filter, RotateCcw, Calendar, ShoppingCart, DollarSign, Users, CreditCard } from 'lucide-react';
import { Card, Button, Table, PageHeader } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CurrencyBreakdown } from '@/core/ui/components/CurrencyBreakdown';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportReportExcel, exportReportPdf, exportReportHtml, useReportBranding, type ReportColumnDef, type ReportSpec } from '@/core/reports';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useCurrencies } from '@/core/utils/useCurrencyDisplay';
import { buildCurrencyBreakdown, type CurrencyBreakdownResult } from '@/core/utils/currencyBreakdown';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { usePermission } from '@/modules/auth/hooks/usePermission';

interface PosSaleRow {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  shiftId: string | null;
  shiftName: string;
  cashierName: string;
  customerName: string;
  paymentType: string;
  cashAmount: number;
  creditAmount: number;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currencyCode: string;
}

interface GroupRow {
  dimension: string;
  revenue: number;
  cashTotal: number;
  creditTotal: number;
  invoiceCount: number;
  avgValue: number;
  quantity: number;
}

export const PosReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const branding = useReportBranding();
  const direction = useAppStore((s) => s.language) === 'en' ? 'ltr' : 'rtl';
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { currencies } = useCurrencies(activeCompany?.id || '');
  const [rawData, setRawData] = useState<PosSaleRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'credit' | 'mixed'>('all');
  const [cashierFilter, setCashierFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'day' | 'shift' | 'cashier' | 'product' | 'payment'>('none');
  const [sortBy, setSortBy] = useState<'date' | 'total' | 'cashier'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const applyPreset = useCallback((preset: 'today' | 'week' | 'month' | 'year' | 'all') => {
    if (preset === 'all') { setFromDate(''); setToDate(''); return; }
    const now = new Date();
    setToDate(now.toISOString().split('T')[0]);
    if (preset === 'today') {
      setFromDate(now.toISOString().split('T')[0]);
    } else if (preset === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7); setFromDate(d.toISOString().split('T')[0]);
    } else if (preset === 'month') {
      const d = new Date(now); d.setDate(d.getDate() - 30); setFromDate(d.toISOString().split('T')[0]);
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
                  i.invoice_number,
                  i.date,
                  i.shift_id,
                  i.payment_type,
                  i.subtotal,
                  i.discount_amount,
                  i.vat_amount,
                  i.total_amount,
                  i.currency_code,
                  c.name AS customer_name,
                  ps.id AS shift_id2,
                  cb.name AS shift_name,
                  u.full_name AS cashier_name,
                  l.id AS line_id,
                  l.product_id,
                  l.quantity,
                  l.unit_price,
                  l.line_total,
                  p.name_ar AS product_name,
                  p.name_en AS product_name_en,
                  pp.cash_amount,
                  pp.credit_amount
             FROM sales_invoices i
             LEFT JOIN customers c ON c.id = i.customer_id
             LEFT JOIN pos_shifts ps ON ps.id = i.shift_id
             LEFT JOIN cash_boxes cb ON cb.id = ps.cash_box_id
             LEFT JOIN users u ON u.id = ps.user_id
             LEFT JOIN sales_invoice_lines l ON l.invoice_id = i.id
             LEFT JOIN products p ON p.id = l.product_id
             LEFT JOIN LATERAL (
               SELECT
                 SUM(CASE WHEN pp2.method='cash' THEN pp2.amount ELSE 0 END) AS cash_amount,
                 SUM(CASE WHEN pp2.method='credit' THEN pp2.amount ELSE 0 END) AS credit_amount
               FROM pos_payments pp2 WHERE pp2.invoice_id = i.id
             ) pp ON true
            WHERE i.company_id = $1
              AND i.is_pos = true
              AND i.status != 'cancelled'
              AND ($2::date IS NULL OR i.date >= $2::date)
              AND ($3::date IS NULL OR i.date <= $3::date)
            ORDER BY i.date DESC, i.id DESC, l.id ASC`,
          [companyId, fromDate || null, toDate || null]
        );
        const dbRows = (result.rows || []) as Record<string, unknown>[];
        const invoiceMap = new Map<string, {
          invoiceId: string;
          invoiceNumber: string;
          date: string;
          shiftId: string | null;
          shiftName: string;
          cashierName: string;
          customerName: string;
          paymentType: string;
          cashAmount: number;
          creditAmount: number;
          subtotal: number;
          discountAmount: number;
          vatAmount: number;
          totalAmount: number;
          currencyCode: string;
          lines: { productName: string; quantity: number; unitPrice: number; lineTotal: number }[];
        }>();
        for (const r of dbRows) {
          const invId = String(r.invoice_id || '');
          if (!invId) continue;
          let entry = invoiceMap.get(invId);
          if (!entry) {
            entry = {
              invoiceId: invId,
              invoiceNumber: String(r.invoice_number || ''),
              date: String(r.date || ''),
              shiftId: r.shift_id ? String(r.shift_id) : null,
              shiftName: String(r.shift_name || r.shift_id2 || t('pos.shiftNumber')),
              cashierName: String(r.cashier_name || t('reports.unknown')),
              customerName: String(r.customer_name || t('pos.walkIn')),
              paymentType: String(r.payment_type || 'cash'),
              cashAmount: Number(r.cash_amount ?? r.subtotal ?? 0),
              creditAmount: Number(r.credit_amount ?? 0),
              subtotal: Number(r.subtotal ?? 0),
              discountAmount: Number(r.discount_amount ?? 0),
              vatAmount: Number(r.vat_amount ?? 0),
              totalAmount: Number(r.total_amount ?? 0),
              currencyCode: String(r.currency_code || YER_CODE),
              lines: [],
            };
            // Fallback for cash/credit when pos_payments not yet populated
            if (entry.cashAmount === 0 && entry.creditAmount === 0) {
              if (entry.paymentType === 'cash') entry.cashAmount = entry.totalAmount;
              else if (entry.paymentType === 'credit') entry.creditAmount = entry.totalAmount;
            }
            invoiceMap.set(invId, entry);
          }
          if (r.line_id != null) {
            entry.lines.push({
              productName: String(r.product_name || r.product_name_en || '-'),
              quantity: Number(r.quantity ?? 0),
              unitPrice: Number(r.unit_price ?? 0),
              lineTotal: Number(r.line_total ?? 0),
            });
          }
        }
        const rows: PosSaleRow[] = [];
        for (const entry of invoiceMap.values()) {
          if (entry.lines.length === 0) {
            rows.push({
              invoiceId: entry.invoiceId,
              invoiceNumber: entry.invoiceNumber,
              date: entry.date,
              shiftId: entry.shiftId,
              shiftName: entry.shiftName,
              cashierName: entry.cashierName,
              customerName: entry.customerName,
              paymentType: entry.paymentType,
              cashAmount: entry.cashAmount,
              creditAmount: entry.creditAmount,
              subtotal: entry.subtotal,
              discountAmount: entry.discountAmount,
              vatAmount: entry.vatAmount,
              totalAmount: entry.totalAmount,
              productName: '-',
              quantity: 0,
              unitPrice: 0,
              lineTotal: 0,
              currencyCode: entry.currencyCode,
            });
          } else {
            for (const l of entry.lines) {
              rows.push({
                invoiceId: entry.invoiceId,
                invoiceNumber: entry.invoiceNumber,
                date: entry.date,
                shiftId: entry.shiftId,
                shiftName: entry.shiftName,
                cashierName: entry.cashierName,
                customerName: entry.customerName,
                paymentType: entry.paymentType,
                cashAmount: entry.cashAmount,
                creditAmount: entry.creditAmount,
                subtotal: entry.subtotal,
                discountAmount: entry.discountAmount,
                vatAmount: entry.vatAmount,
                totalAmount: entry.totalAmount,
                productName: l.productName,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                lineTotal: l.lineTotal,
                currencyCode: entry.currencyCode,
              });
            }
          }
        }
        setRawData(rows);
      } catch {
        setRawData([]);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [activeCompany?.id, fromDate, toDate, t]);

  const filteredData = useMemo(() => {
    let data = rawData.filter((row) => {
      if (paymentFilter !== 'all') {
        const isMixed = row.cashAmount > 0 && row.creditAmount > 0;
        if (paymentFilter === 'mixed' && !isMixed) return false;
        if (paymentFilter === 'cash' && !(row.paymentType === 'cash' || (!isMixed && row.cashAmount > 0))) return false;
        if (paymentFilter === 'credit' && !(row.paymentType === 'credit' || (!isMixed && row.creditAmount > 0))) return false;
      }
      if (cashierFilter && !(row.cashierName?.toLowerCase() || '').includes(cashierFilter.toLowerCase())) return false;
      if (productFilter && !(row.productName?.toLowerCase() || '').includes(productFilter.toLowerCase())) return false;
      if (customerFilter && !(row.customerName?.toLowerCase() || '').includes(customerFilter.toLowerCase())) return false;
      return true;
    });
    // Deduplicate by invoiceId for invoice-level filters, but keep line granularity for product grouping
    // For sorting, sort by the requested field
    data = [...data].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
      else if (sortBy === 'total') cmp = a.totalAmount - b.totalAmount;
      else if (sortBy === 'cashier') cmp = a.cashierName.localeCompare(b.cashierName);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [rawData, paymentFilter, cashierFilter, productFilter, customerFilter, sortBy, sortDir]);

  // Deduplicate for invoice-level KPIs (avoid double-counting lines)
  const invoiceLevelData = useMemo(() => {
    const seen = new Set<string>();
    return filteredData.filter((r) => {
      if (seen.has(r.invoiceId)) return false;
      seen.add(r.invoiceId);
      return true;
    });
  }, [filteredData]);

  const groupedData = useMemo((): GroupRow[] => {
    if (groupBy === 'none') return [];
    const map: Record<string, { revenue: number; cashTotal: number; creditTotal: number; invoiceCount: number; quantity: number; ids: Set<string> }> = {};
    for (const row of filteredData) {
      let key = '';
      if (groupBy === 'day') key = row.date ? String(row.date).slice(0, 10) : t('reports.unknown');
      else if (groupBy === 'shift') key = row.shiftName || row.shiftId || t('reports.unknown');
      else if (groupBy === 'cashier') key = row.cashierName;
      else if (groupBy === 'product') key = row.productName;
      else if (groupBy === 'payment') {
        const isMixed = row.cashAmount > 0 && row.creditAmount > 0;
        key = isMixed ? t('pos.mixed') : row.paymentType === 'cash' ? t('pos.cash') : t('pos.credit');
      }
      if (!map[key]) map[key] = { revenue: 0, cashTotal: 0, creditTotal: 0, invoiceCount: 0, quantity: 0, ids: new Set() };
      // For product grouping, sum lineTotal; otherwise sum invoice total once per invoice
      if (groupBy === 'product') {
        map[key].revenue += row.lineTotal;
        map[key].quantity += row.quantity;
      } else {
        if (!map[key].ids.has(row.invoiceId)) {
          map[key].revenue += row.totalAmount;
          map[key].cashTotal += row.cashAmount;
          map[key].creditTotal += row.creditAmount;
          map[key].invoiceCount += 1;
          map[key].ids.add(row.invoiceId);
        }
        map[key].quantity += row.quantity;
      }
      if (groupBy === 'product' && !map[key].ids.has(row.invoiceId)) {
        map[key].ids.add(row.invoiceId);
        map[key].invoiceCount += 1;
        // For product, cash/credit are not meaningful per line, leave 0
      }
    }
    return Object.entries(map).map(([dimension, v]) => ({
      dimension,
      revenue: v.revenue,
      cashTotal: v.cashTotal,
      creditTotal: v.creditTotal,
      invoiceCount: v.invoiceCount,
      avgValue: v.invoiceCount > 0 ? Math.round(v.revenue / v.invoiceCount) : 0,
      quantity: v.quantity,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredData, groupBy, t]);

  const totalRevenue = invoiceLevelData.reduce((s, d) => s + d.totalAmount, 0);
  const totalCash = invoiceLevelData.reduce((s, d) => s + d.cashAmount, 0);
  const totalCredit = invoiceLevelData.reduce((s, d) => s + d.creditAmount, 0);
  const totalInvoices = invoiceLevelData.length;
  const avgInvoice = totalInvoices > 0 ? Math.round(totalRevenue / totalInvoices) : 0;
  const totalQuantity = filteredData.reduce((s, d) => s + d.quantity, 0);

  const currencyBreakdown: CurrencyBreakdownResult = useMemo(
    () => buildCurrencyBreakdown(
      invoiceLevelData.map((r) => ({ code: r.currencyCode, amount: r.totalAmount })),
      currencies,
    ),
    [invoiceLevelData, currencies],
  );

  const chartData = useMemo(() => {
    if (groupBy !== 'none') return groupedData.map((p) => ({ name: p.dimension, revenue: p.revenue, cash: p.cashTotal, credit: p.creditTotal }));
    // Daily trend when no grouping
    const dayMap: Record<string, number> = {};
    for (const row of invoiceLevelData) {
      const day = row.date ? String(row.date).slice(0, 10) : t('reports.unknown');
      dayMap[day] = (dayMap[day] || 0) + row.totalAmount;
    }
    return Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([name, revenue]) => ({ name, revenue }));
  }, [groupedData, groupBy, invoiceLevelData, t]);

  const buildSpec = (): ReportSpec => {
    const columns: ReportColumnDef[] = groupBy !== 'none'
      ? [
        { key: 'dimension', header: t('pos.report.group') },
        { key: 'revenue', header: t('reports.revenue'), format: 'money' },
        { key: 'cashTotal', header: t('pos.cashPayments'), format: 'money' },
        { key: 'creditTotal', header: t('pos.creditPayments'), format: 'money' },
        { key: 'invoiceCount', header: t('reports.invoicesCount'), format: 'quantity' },
        { key: 'avgValue', header: t('reports.average'), format: 'money' },
      ]
      : [
        { key: 'date', header: t('reports.date') },
        { key: 'invoiceNumber', header: t('pos.receiptNumber') },
        { key: 'cashierName', header: t('pos.cashier') },
        { key: 'customerName', header: t('reports.customer') },
        { key: 'productName', header: t('reports.product') },
        { key: 'quantity', header: t('reports.quantity'), format: 'quantity' },
        { key: 'totalAmount', header: t('reports.revenue'), format: 'money' },
        { key: 'paymentType', header: t('pos.paymentMethod') },
      ];
    const rows = (groupBy !== 'none' ? groupedData : filteredData) as unknown as Record<string, unknown>[];
    const periodLabel = fromDate || toDate
      ? `${t('reports.fromDate')}: ${fromDate || '…'} — ${t('reports.toDate')}: ${toDate || '…'}`
      : undefined;
    return {
      columns,
      rows,
      meta: {
        title: t('pos.reports.title'),
        subtitle: branding.companyName,
        ...(periodLabel ? { periodLabel } : {}),
        direction,
      },
      branding,
      filename: 'POS_Report',
      totals: {
        label: t('reports.total'),
        values: { revenue: totalRevenue, invoiceCount: totalInvoices },
      },
    };
  };

  const clearFilters = () => {
    setFromDate(''); setToDate(''); setPaymentFilter('all');
    setCashierFilter(''); setProductFilter(''); setCustomerFilter('');
    setGroupBy('none'); setSortBy('date'); setSortDir('desc');
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

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<BarChart3 size={22} />}
        title={t('pos.reports.title')}
        subtitle={t('pos.reports.subtitle')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Filter size={16} />} onClick={() => setShowFilters((s) => !s)}>
              {t('reports.filter')}
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={() => exportReportExcel(buildSpec())} disabled={!canExport}>
              {t('reports.exportExcel')}
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={() => exportReportPdf(buildSpec())} disabled={!canExport}>
              {t('reports.exportPdf')}
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={() => exportReportHtml(buildSpec())} disabled={!canExport}>
              {t('reports.exportHtml')}
            </Button>
          </>
        }
      />

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
                <Button size="sm" variant="ghost" leftIcon={<Calendar size={14} />} onClick={() => applyPreset('today')}>{t('pos.reports.today')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('week')}>{t('pos.reports.thisWeek')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('month')}>{t('reports.preset.last30')}</Button>
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
                <label className="block text-xs text-slate-500 mb-1">{t('pos.paymentMethod')}</label>
                <select className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as never)}>
                  <option value="all">{t('reports.filterAll')}</option>
                  <option value="cash">{t('pos.cash')}</option>
                  <option value="credit">{t('pos.credit')}</option>
                  <option value="mixed">{t('pos.mixed')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('pos.cashier')}</label>
                <input type="text" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" placeholder={t('pos.cashier')} value={cashierFilter} onChange={(e) => setCashierFilter(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.customer')}</label>
                <input type="text" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" placeholder={t('reports.placeholder.customerName')} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.product')}</label>
                <input type="text" className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" placeholder={t('reports.placeholder.productName')} value={productFilter} onChange={(e) => setProductFilter(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('pos.report.group')}</label>
                <select className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={groupBy} onChange={(e) => setGroupBy(e.target.value as never)}>
                  <option value="none">{t('pos.report.noGroup')}</option>
                  <option value="day">{t('pos.report.byDay')}</option>
                  <option value="shift">{t('pos.report.byShift')}</option>
                  <option value="cashier">{t('pos.report.byCashier')}</option>
                  <option value="product">{t('pos.report.byProduct')}</option>
                  <option value="payment">{t('pos.report.byPayment')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.sortBy')}</label>
                <select className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={sortBy} onChange={(e) => setSortBy(e.target.value as never)}>
                  <option value="date">{t('reports.date')}</option>
                  <option value="total">{t('reports.revenue')}</option>
                  <option value="cashier">{t('pos.cashier')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.sortDir')}</label>
                <select className="w-full min-h-11 px-3 py-2 text-sm border rounded-xl dark:bg-slate-900 dark:border-slate-600" value={sortDir} onChange={(e) => setSortDir(e.target.value as never)}>
                  <option value="desc">{t('reports.desc')}</option>
                  <option value="asc">{t('reports.asc')}</option>
                </select>
              </div>
              <div className="flex items-end">
                <span className="text-xs text-slate-500">{filteredData.length} {t('reports.rows')} • {totalInvoices} {t('reports.invoicesCount')}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card><div className="p-4 text-center"><DollarSign size={20} className="mx-auto mb-1 text-emerald-500" /><p className="text-xs text-slate-500">{t('reports.totalRevenue')}</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(totalRevenue)}</p></div></Card>
        <Card><div className="p-4 text-center"><ShoppingCart size={20} className="mx-auto mb-1 text-blue-500" /><p className="text-xs text-slate-500">{t('reports.invoicesCount')}</p><p className="text-lg font-bold text-blue-600">{totalInvoices}</p></div></Card>
        <Card><div className="p-4 text-center"><BarChart3 size={20} className="mx-auto mb-1 text-amber-500" /><p className="text-xs text-slate-500">{t('reports.average')}</p><p className="text-lg font-bold text-amber-600">{formatCurrency(avgInvoice)}</p></div></Card>
        <Card><div className="p-4 text-center"><CreditCard size={20} className="mx-auto mb-1 text-emerald-500" /><p className="text-xs text-slate-500">{t('pos.cashPayments')}</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(totalCash)}</p></div></Card>
        <Card><div className="p-4 text-center"><Users size={20} className="mx-auto mb-1 text-sky-500" /><p className="text-xs text-slate-500">{t('pos.creditPayments')}</p><p className="text-lg font-bold text-sky-600">{formatCurrency(totalCredit)}</p></div></Card>
        <Card><div className="p-4 text-center"><TrendingUp size={20} className="mx-auto mb-1 text-violet-500" /><p className="text-xs text-slate-500">{t('reports.quantity')}</p><p className="text-lg font-bold text-violet-600">{totalQuantity}</p></div></Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold mb-4">{groupBy === 'none' ? t('pos.reports.dailyTrend') : t('pos.reports.groupChart')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                {groupBy === 'none' ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} dy={10} height={60} />
                    <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="font-semibold mb-4">{t('pos.reports.paymentBreakdown')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[
                    { name: t('pos.cash'), value: totalCash },
                    { name: t('pos.credit'), value: totalCredit },
                  ].filter((d) => d.value > 0)} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" nameKey="name">
                    <Cell fill="#10b981" />
                    <Cell fill="#3b82f6" />
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold mb-4">{groupBy !== 'none' ? t('pos.report.groupedTable') : t('pos.reports.detailedTable')}</h3>
          {groupBy !== 'none' ? (
            <Table
              data={groupedData}
              columns={[
                { key: 'dimension', header: t('pos.report.group'), mobile: 'title' as const },
                { key: 'revenue', header: t('reports.revenue'), align: 'right', render: (r) => formatCurrency(r.revenue) },
                { key: 'cashTotal', header: t('pos.cashPayments'), align: 'right', render: (r) => formatCurrency(r.cashTotal) },
                { key: 'creditTotal', header: t('pos.creditPayments'), align: 'right', render: (r) => formatCurrency(r.creditTotal) },
                { key: 'invoiceCount', header: t('reports.invoicesCount'), align: 'right' },
                { key: 'avgValue', header: t('reports.average'), align: 'right', render: (r) => formatCurrency(r.avgValue) },
                { key: 'quantity', header: t('reports.quantity'), align: 'right' },
              ]}
              keyExtractor={(r) => r.dimension}
            />
          ) : filteredData.length === 0 ? (
            <EmptyState icon="search" title={t('reports.emptyResults.title')} description={t('reports.emptyResults.description')} action={<Button variant="secondary" onClick={clearFilters} leftIcon={<RotateCcw size={16} />}>{t('reports.clearFilter')}</Button>} />
          ) : (
            <Table
              data={filteredData.slice(0, 300)}
              columns={[
                { key: 'date', header: t('reports.date'), render: (r) => String(r.date).slice(0, 10) },
                { key: 'invoiceNumber', header: t('pos.receiptNumber'), mobile: 'title' as const },
                { key: 'cashierName', header: t('pos.cashier') },
                { key: 'customerName', header: t('reports.customer'), mobile: 'subtitle' as const },
                { key: 'productName', header: t('reports.product') },
                { key: 'quantity', header: t('reports.quantity'), align: 'right' },
                { key: 'totalAmount', header: t('reports.revenue'), align: 'right', render: (r) => formatCurrency(r.totalAmount) },
                { key: 'paymentType', header: t('pos.paymentMethod'), align: 'right', render: (r) => {
                  const isMixed = r.cashAmount > 0 && r.creditAmount > 0;
                  const label = isMixed ? t('pos.mixed') : r.paymentType === 'cash' ? t('pos.cash') : t('pos.credit');
                  const color = r.paymentType === 'cash' ? 'bg-emerald-100 text-emerald-700' : r.paymentType === 'credit' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700';
                  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>{label}</span>;
                }},
              ]}
              keyExtractor={(r, i) => `${r.invoiceId}-${i}`}
            />
          )}
        </div>
      </Card>

      {currencyBreakdown.items.length > 0 && (
        <CurrencyBreakdown result={currencyBreakdown} title={t('reports.revenueByCurrency')} />
      )}
    </div>
  );
};

export default PosReportsPage;
