import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, TrendingUp, TrendingDown } from 'lucide-react';
import { PageHeader, Card, Button, Input } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';
import { sumCol,  } from './shared/liveAggregates';
import type { ReportSpec } from '@/core/reports';

interface LedgerRow {
  date: string;
  type: string;
  product_name: string;
  warehouse_name: string;
  quantity: number;
  reference: string;
  notes: string;
}

export const InventoryItemLedgerPage: React.FC = () => {
  const { t } = useTranslation();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [productId, setProductId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [, setRefreshKey] = useState(0);

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT sm.created_at::date AS date, sm.type, sm.quantity, sm.reference, sm.notes,
              p.name_ar AS product_name,
              COALESCE(w.name, '') AS warehouse_name
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id AND p.company_id = $1
         LEFT JOIN warehouses w ON w.id = sm.warehouse_id
        WHERE sm.company_id = $1
          AND ($2::varchar IS NULL OR sm.product_id = $2::varchar::uuid)
          AND ($3::date IS NULL OR sm.created_at::date >= $3::date)
          AND ($4::date IS NULL OR sm.created_at::date <= $4::date)
        ORDER BY sm.created_at`,
      [companyId, productId || null, fromDate || null, toDate || null]
    );
    return (res.rows as LedgerRow[]).map((r) => ({
      date: String(r.date ?? ''),
      type: String(r.type ?? ''),
      product_name: String(r.product_name ?? ''),
      warehouse_name: String(r.warehouse_name ?? ''),
      quantity: Number(r.quantity ?? 0),
      reference: String(r.reference ?? ''),
      notes: String(r.notes ?? ''),
    }));
  }, [companyId, productId, fromDate, toDate]);

  const [data, setData] = useState<LedgerRow[] | null>(null);
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
    const ins = sumCol(rows.filter((r) => r.type === 'in'), 'quantity');
    const out = sumCol(rows.filter((r) => r.type === 'out'), 'quantity');
    const adj = sumCol(rows.filter((r) => r.type === 'adjustment'), 'quantity');
    const transfer = sumCol(rows.filter((r) => r.type === 'transfer'), 'quantity');
    return { ins, out, adj, transfer, count: rows.length };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.inventoryLedger.title')} subtitle={t('reports.inventoryLedger.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Input className="w-32" placeholder={t('reports.inventoryLedger.productFilter')} value={productId} onChange={(e) => setProductId(e.target.value)} />
        <Input className="w-28" placeholder={t('reports.inventoryLedger.from')} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input className="w-28" placeholder={t('reports.inventoryLedger.to')} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'ins', title: t('reports.inventoryLedger.totalIn'), value: `${summary.ins}`, icon: TrendingUp, color: 'emerald' },
            { key: 'out', title: t('reports.inventoryLedger.totalOut'), value: `${summary.out}`, icon: TrendingDown, color: 'rose' },
            { key: 'adj', title: t('reports.inventoryLedger.totalAdjustment'), value: `${summary.adj}`, icon: Package, color: 'amber' },
            { key: 'trans', title: t('reports.inventoryLedger.totalTransfer'), value: `${summary.transfer}`, icon: Package, color: 'slate' },
          ]} />

          <ReportTable
            title={t('reports.inventoryLedger.title')}
            columns={[
              { key: 'date', header: t('reports.inventoryLedger.date'), width: 80, format: 'date' },
              { key: 'product_name', header: t('reports.inventoryLedger.product'), width: 160 },
              { key: 'type', header: t('reports.inventoryLedger.type'), width: 90 },
              { key: 'warehouse_name', header: t('reports.inventoryLedger.warehouse'), width: 120 },
              { key: 'quantity', header: t('reports.inventoryLedger.quantity'), width: 90, format: 'quantity' },
              { key: 'reference', header: t('reports.inventoryLedger.reference'), width: 120 },
            ]}
            rows={data || []}
            maxRows={1000}
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
        { key: 'date', header: t('reports.inventoryLedger.date'), format: 'date', width: 20 },
        { key: 'product_name', header: t('reports.inventoryLedger.product'), width: 70 },
        { key: 'type', header: t('reports.inventoryLedger.type'), width: 40 },
        { key: 'quantity', header: t('reports.inventoryLedger.quantity'), format: 'quantity', width: 50 },
      ],
      rows: data,
      meta: { title: t('reports.inventoryLedger.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `InventoryItemLedger`,
    };
  }
};

export default InventoryItemLedgerPage;
