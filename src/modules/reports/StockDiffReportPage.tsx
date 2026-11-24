import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, TrendingUp, TrendingDown } from 'lucide-react';
import { PageHeader, Card, Button, Input, Select } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';

import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';
import { sumCol } from './shared/liveAggregates';
import type { ReportSpec } from '@/core/reports';

interface DiffRow {
  product_name: string;
  product_id: string;
  warehouse_id: string;
  warehouse_name: string;
  qty_before: number;
  qty_after: number;
  diff: number;
}

export const StockDiffReportPage: React.FC = () => {
  const { t } = useTranslation();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [, setRefreshKey] = useState(0);

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT p.name_ar AS product_name, s.product_id, s.warehouse_id, w.name AS warehouse_name,
              COALESCE(SUM(CASE WHEN sm.created_at < $2::timestamptz THEN sm.quantity ELSE 0 END), 0) AS qty_before,
              COALESCE(SUM(CASE WHEN sm.created_at >= $2::timestamptz THEN sm.quantity ELSE 0 END), 0) AS qty_after
         FROM stock s
         JOIN products p ON p.id = s.product_id AND p.company_id = $1
         LEFT JOIN warehouses w ON w.id = s.warehouse_id
         LEFT JOIN stock_movements sm ON sm.product_id = s.product_id AND sm.warehouse_id = s.warehouse_id AND sm.company_id = $1
        WHERE s.company_id = $1
          AND ($4::varchar IS NULL OR s.warehouse_id = $4::varchar::uuid)
        GROUP BY s.product_id, s.warehouse_id, w.name, p.name_ar
        HAVING COALESCE(SUM(CASE WHEN sm.created_at >= $2::timestamptz THEN sm.quantity ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.created_at < $2::timestamptz THEN sm.quantity ELSE 0 END), 0) != 0
        ORDER BY ABS(COALESCE(SUM(CASE WHEN sm.created_at >= $2::timestamptz THEN sm.quantity ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN sm.created_at < $2::timestamptz THEN sm.quantity ELSE 0 END), 0)) DESC`,
      [companyId, fromDate || null, toDate || null, warehouseId || null]
    );
    return (res.rows as DiffRow[]).map((r) => ({
      product_name: String(r.product_name ?? ''),
      product_id: String(r.product_id),
      warehouse_id: String(r.warehouse_id ?? ''),
      warehouse_name: String(r.warehouse_name ?? ''),
      qty_before: Number(r.qty_before ?? 0),
      qty_after: Number(r.qty_after ?? 0),
      diff: Number(r.qty_after ?? 0) - Number(r.qty_before ?? 0),
    }));
  }, [companyId, fromDate, toDate, warehouseId]);

  const [data, setData] = useState<DiffRow[] | null>(null);
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
    const totalDiff = sumCol(rows, 'diff');
    return { totalDiff, inbound: sumCol(rows.filter((r) => r.diff > 0), 'diff'), outbound: sumCol(rows.filter((r) => r.diff < 0), 'diff') };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.stockDiff.title')} subtitle={t('reports.stockDiff.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Input className="w-32" placeholder={t('reports.stockDiff.from')} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input className="w-32" placeholder={t('reports.stockDiff.to')} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <Select value={warehouseId} onChange={(v) => setWarehouseId(v)}>
          <option value="">{t('reports.stockDiff.allWarehouses')}</option>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'diff', title: t('reports.stockDiff.totalDiff'), value: `${summary.totalDiff}`, icon: Package, color: 'amber' },
            { key: 'in', title: t('reports.stockDiff.totalIn'), value: `${summary.inbound}`, icon: TrendingUp, color: 'emerald' },
            { key: 'out', title: t('reports.stockDiff.totalOut'), value: `${summary.outbound}`, icon: TrendingDown, color: 'rose' },
          ]} />
          <ReportTable
            title={t('reports.stockDiff.title')}
            columns={[
              { key: 'product_name', header: t('reports.stockDiff.product'), width: 140 },
              { key: 'warehouse_name', header: t('reports.stockDiff.warehouse'), width: 110 },
              { key: 'qty_before', header: t('reports.stockDiff.qtyBefore'), width: 80, format: 'quantity' },
              { key: 'qty_after', header: t('reports.stockDiff.qtyAfter'), width: 80, format: 'quantity' },
              { key: 'diff', header: t('reports.stockDiff.diff'), width: 80, format: 'quantity' },
            ]}
            rows={data || []}
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
        { key: 'product_name', header: t('reports.stockDiff.product'), format: 'text', width: 60 },
        { key: 'warehouse_name', header: t('reports.stockDiff.warehouse'), format: 'text', width: 50 },
        { key: 'qty_after', header: t('reports.stockDiff.qtyAfter'), format: 'quantity', width: 40 },
      ],
      rows: data,
      meta: { title: t('reports.stockDiff.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `StockDiff`,
    };
  }
};

export default StockDiffReportPage;
