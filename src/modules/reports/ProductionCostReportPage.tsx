import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Warehouse, Coins } from 'lucide-react';
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

interface ProdRow {
  product_id: string;
  product_name: string;
  order_number: string;
  quantity: number;
  produced_quantity: number;
  wip_materials_cost: number;
  total_cost: number;
  status: string;
  planned_start_date: string;
  actual_start_date: string;
  actual_end_date: string;
}

export const ProductionCostReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [productId, setProductId] = useState('');

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT wo.product_id, p.name_ar AS product_name, wo.order_number, wo.quantity,
              COALESCE(wo.produced_quantity, 0) AS produced_quantity,
              COALESCE(wo.wip_materials_cost, 0) AS wip_materials_cost,
              COALESCE(wo.total_cost, 0) AS total_cost, wo.status,
              COALESCE(wo.planned_start_date::text, '') AS planned_start_date,
              COALESCE(wo.actual_start_date::text, '') AS actual_start_date,
              COALESCE(wo.actual_end_date::text, '') AS actual_end_date
         FROM work_orders wo
         JOIN products p ON p.id = wo.product_id AND p.company_id = $1
        WHERE wo.company_id = $1
          AND ($2::varchar IS NULL OR wo.product_id = $2::varchar::uuid)
        ORDER BY wo.actual_start_date DESC, wo.created_at DESC`,
      [companyId, productId || null]
    );
    return (res.rows as ProdRow[]).map((r) => ({
      product_id: String(r.product_id),
      product_name: String(r.product_name ?? ''),
      order_number: String(r.order_number ?? ''),
      quantity: Number(r.quantity ?? 0),
      produced_quantity: Number(r.produced_quantity ?? 0),
      wip_materials_cost: Number(r.wip_materials_cost ?? 0),
      total_cost: Number(r.total_cost ?? 0),
      status: String(r.status ?? ''),
      planned_start_date: String(r.planned_start_date ?? ''),
      actual_start_date: String(r.actual_start_date ?? ''),
      actual_end_date: String(r.actual_end_date ?? ''),
    }));
  }, [companyId, productId]);

  const [data, setData] = useState<ProdRow[] | null>(null);
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
    return { totalWip: sumCol(rows, 'wip_materials_cost'), totalCost: sumCol(rows, 'total_cost'), completed: rows.filter((r) => r.status === 'completed').length, wip: rows.filter((r) => r.status === 'in_progress').length };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.prodCost.title')} subtitle={t('reports.prodCost.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Input className="w-40" placeholder={t('reports.prodCost.productFilter')} value={productId} onChange={(e) => setProductId(e.target.value)} />
        <Button variant="outline" size="sm" onClick={refresh}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'wip', title: t('reports.prodCost.totalWip'), value: formatCurrency(summary.totalWip), icon: Warehouse, color: 'rose' },
            { key: 'cost', title: t('reports.prodCost.totalProductionCost'), value: formatCurrency(summary.totalCost), icon: Coins, color: 'emerald' },
            { key: 'completed', title: t('reports.prodCost.completedCount'), value: summary.completed, icon: Package, color: 'slate' },
            { key: 'inProgress', title: t('reports.prodCost.inProgressCount'), value: summary.wip, icon: Package, color: 'amber' },
          ]} />
          <ReportTable
            title={t('reports.prodCost.title')}
            columns={[
              { key: 'order_number', header: t('reports.prodCost.orderNumber'), width: 110, format: 'text' },
              { key: 'product_name', header: t('reports.prodCost.product'), width: 160 },
              { key: 'status', header: t('reports.prodCost.status'), width: 90 },
              { key: 'quantity', header: t('reports.prodCost.quantity'), width: 80, format: 'quantity' },
              { key: 'produced_quantity', header: t('reports.prodCost.producedQty'), width: 90, format: 'quantity' },
              { key: 'wip_materials_cost', header: t('reports.prodCost.wipCost'), width: 120, format: 'money' },
              { key: 'total_cost', header: t('reports.prodCost.totalCost'), width: 120, format: 'money' },
              { key: 'actual_start_date', header: t('reports.prodCost.actualStart'), width: 80, format: 'date' },
              { key: 'actual_end_date', header: t('reports.prodCost.actualEnd'), width: 80, format: 'date' },
            ]}
            rows={data || []}
            totals={{ label: t('reports.prodCost.total'), values: { total_cost: summary.totalCost, wip_materials_cost: summary.totalWip } }}
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
        { key: 'order_number', header: t('reports.prodCost.orderNumber'), format: 'text', width: 40 },
        { key: 'product_name', header: t('reports.prodCost.product'), format: 'text', width: 60 },
        { key: 'total_cost', header: t('reports.prodCost.totalCost'), format: 'money', width: 40 },
      ],
      rows: data,
      meta: { title: t('reports.prodCost.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `ProductionCost`,
    };
  }
};

export default ProductionCostReportPage;
