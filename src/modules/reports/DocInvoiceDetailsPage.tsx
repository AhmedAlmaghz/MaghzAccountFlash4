import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, User, TrendingUp, CreditCard } from 'lucide-react';
import { PageHeader, Card, Button, Select } from '@/core/ui/components';
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

interface DocRow {
  invoice_number: string;
  date: string;
  customer_name: string;
  total_amount: number;
  paid_amount: number;
  payment_type: string;
  status: string;
  attachment_count: number;
}

export const DocInvoiceDetailsPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [paymentType, setPaymentType] = useState('');

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT i.invoice_number, i.date, c.name AS customer_name, i.total_amount, i.paid_amount,
              i.payment_type AS payment_type, i.status,
              CASE WHEN i.attachments IS NULL THEN 0 ELSE COALESCE(jsonb_array_length(i.attachments), 0) END AS attachment_count
         FROM sales_invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.company_id = $1 AND i.is_pos = false
          AND ($2::varchar IS NULL OR i.status = $2::varchar)
        ORDER BY i.date DESC`,
      [companyId, paymentType || null]
    );
    return (res.rows as DocRow[]).map((r) => ({
      invoice_number: String(r.invoice_number ?? ''),
      date: String(r.date ?? ''),
      customer_name: String(r.customer_name ?? ''),
      total_amount: Number(r.total_amount ?? 0),
      paid_amount: Number(r.paid_amount ?? 0),
      payment_type: String(r.payment_type ?? 'credit'),
      status: String(r.status ?? ''),
      attachment_count: Number(r.attachment_count ?? 0),
    }));
  }, [companyId, paymentType]);

  const [data, setData] = useState<DocRow[] | null>(null);
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
    return { total: sumCol(rows, 'total_amount'), paid: sumCol(rows, 'paid_amount'), attachments: rows.reduce((a, r) => a + r.attachment_count, 0), docs: rows.length };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.docDetails.title')} subtitle={t('reports.docDetails.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Select value={paymentType} onChange={(v) => setPaymentType(v)}>
          <option value="">{t('reports.docDetails.allTypes')}</option>
          <option value="credit">{t('accounting.payment.credit')}</option>
          <option value="cash">{t('accounting.payment.cash')}</option>
          <option value="check">{t('accounting.payment.check')}</option>
          <option value="bank">{t('accounting.payment.bank')}</option>
          <option value="partial">{t('accounting.payment.partial')}</option>
        </Select>
        <Button variant="outline" size="sm" onClick={refresh}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'total', title: t('reports.docDetails.totalRevenue'), value: formatCurrency(summary.total), icon: TrendingUp, color: 'emerald' },
            { key: 'paid', title: t('reports.docDetails.totalPaid'), value: formatCurrency(summary.paid), icon: CreditCard, color: 'slate' },
            { key: 'attachments', title: t('reports.docDetails.totalAttachments'), value: summary.attachments, icon: Package, color: 'amber' },
            { key: 'docs', title: t('reports.docDetails.docsCount'), value: summary.docs, icon: User, color: 'slate' },
          ]} />
          <ReportTable
            title={t('reports.docDetails.title')}
            columns={[
              { key: 'date', header: t('reports.docDetails.date'), width: 80, format: 'date' },
              { key: 'invoice_number', header: t('reports.docDetails.invoice'), width: 120, format: 'text' },
              { key: 'customer_name', header: t('reports.docDetails.customer'), width: 150 },
              { key: 'total_amount', header: t('reports.docDetails.total'), width: 120, format: 'money' },
              { key: 'paid_amount', header: t('reports.docDetails.paid'), width: 120, format: 'money' },
              { key: 'payment_method', header: t('reports.docDetails.paymentType'), width: 90 },
              { key: 'status', header: t('reports.docDetails.status'), width: 90 },
              { key: 'attachment_count', header: t('reports.docDetails.attachmentsCount'), width: 80, format: 'number' },
            ]}
            rows={data || []}
            totals={{ label: t('reports.docDetails.total'), values: { total_amount: summary.total } }}
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
        { key: 'invoice_number', header: t('reports.docDetails.invoice'), format: 'text', width: 40 },
        { key: 'customer_name', header: t('reports.docDetails.customer'), format: 'text', width: 50 },
        { key: 'total_amount', header: t('reports.docDetails.total'), format: 'money', width: 40 },
      ],
      rows: data,
      meta: { title: t('reports.docDetails.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `InvoiceDetails`,
    };
  }
};

export default DocInvoiceDetailsPage;
