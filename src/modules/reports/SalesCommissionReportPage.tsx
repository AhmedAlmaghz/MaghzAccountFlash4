import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DollarSign, Users } from 'lucide-react';
import { PageHeader, Card, Button, Input } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';
import { sumCol } from './shared/liveAggregates';
import type { ReportSpec } from '@/core/reports';

interface CommissionRow {
  invoice_number: string;
  date: string;
  customer_name: string;
  total_amount: number;
  commission_amount: number;
}

export const SalesCommissionReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [commissionRate, setCommissionRate] = useState(10);
  const [, setRefreshKey] = useState(0);

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT i.invoice_number, i.date, c.name AS customer_name, i.total_amount,
              ROUND(($2 * i.total_amount) / 100.0, 2) AS commission_amount
         FROM sales_invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.company_id = $1 AND i.status != 'cancelled'
          AND ($3::date IS NULL OR i.date >= $3::date)
          AND ($4::date IS NULL OR i.date <= $4::date)
        ORDER BY i.date DESC`,
      [companyId, commissionRate, fromDate || null, toDate || null]
    );
    return (res.rows as CommissionRow[]).map((r) => ({
      invoice_number: String(r.invoice_number ?? ''),
      date: String(r.date ?? ''),
      customer_name: String(r.customer_name ?? ''),
      total_amount: Number(r.total_amount ?? 0),
      commission_amount: Number(r.commission_amount ?? 0),
    }));
  }, [companyId, fromDate, toDate, commissionRate]);

  const [data, setData] = useState<CommissionRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setData(await queryFn()); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); setData(null); }
    finally { setIsLoading(false); }
  }, [queryFn]);
  useEffect(() => { void refresh(); }, [refresh]);
  

  const summary = useMemo(() => {
    const rows = data || [];
    return { total: sumCol(rows, 'commission_amount'), count: rows.length };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.commission.title')} subtitle={t('reports.commission.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Input className="w-28" placeholder={t('reports.commission.from')} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input className="w-28" placeholder={t('reports.commission.to')} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <label className="flex items-center gap-1 text-sm">{t('reports.commission.rate')}<Input className="w-16" type="number" value={commissionRate} onChange={(e) => setCommissionRate(Number(e.target.value))} />%</label>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'comm', title: t('reports.commission.totalCommission'), value: formatCurrency(summary.total), icon: DollarSign, color: 'emerald', trend: 'up' },
            { key: 'count', title: t('reports.commission.invoicesCount'), value: summary.count, icon: Users, color: 'slate' },
          ]} />
          <ReportTable
            title={t('reports.commission.title')}
            columns={[
              { key: 'date', header: t('reports.commission.date'), width: 80, format: 'date' },
              { key: 'invoice_number', header: t('reports.commission.invoice'), width: 110, format: 'text' },
              { key: 'customer_name', header: t('reports.commission.customer'), width: 140 },
              { key: 'total_amount', header: t('reports.commission.invoiceTotal'), width: 120, format: 'money' },
              { key: 'commission_amount', header: t('reports.commission.commissionAmount'), width: 120, format: 'money' },
            ]}
            rows={data || []}
            totals={{ label: t('reports.commission.total'), values: { commission_amount: summary.total } }}
            maxRows={500}
            actions={<ReportExportButtons spec={buildSpec} />}
          />
        </>
      )}
    </div>
  );

  function buildSpec(): ReportSpec | null {
    if (!data) return null;
    return {
      columns: [
        { key: 'date', header: t('reports.commission.date'), format: 'date', width: 20 },
        { key: 'invoice_number', header: t('reports.commission.invoice'), format: 'text', width: 40 },
        { key: 'commission_amount', header: t('reports.commission.commissionAmount'), format: 'money', width: 50 },
      ],
      rows: data,
      meta: { title: t('reports.commission.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `Commission`,
    };
  }
};

export default SalesCommissionReportPage;
