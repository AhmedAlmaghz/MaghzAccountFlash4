import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Package } from 'lucide-react';
import { PageHeader, Card, Button, Select } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';

import type { ReportSpec } from '@/core/reports';

interface VarRow {
  work_order_id: string;
  order_number: string;
  status: string;
  material_name: string;
  material_id: string;
  planned_quantity: number;
  actual_quantity: number;
  planned_unit_cost: number;
  actual_unit_cost: number;
}

export const ManufacturingVariancePage: React.FC = () => {
  const { t } = useTranslation();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [statusFilter, setStatusFilter] = useState('');

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT wo.id AS work_order_id, wo.order_number, wo.status, p.name_ar AS material_name, woc.material_id,
              woc.planned_quantity, COALESCE(woc.actual_quantity, 0) AS actual_quantity,
              COALESCE(woc.unit_cost, 0) AS planned_unit_cost, COALESCE(woc.actual_unit_cost, 0) AS actual_unit_cost
         FROM work_order_consumptions woc
         JOIN work_orders wo ON wo.id = woc.work_order_id AND wo.company_id = $1
         JOIN products p ON p.id = woc.material_id AND p.company_id = $1
        WHERE ($2::varchar IS NULL OR wo.status = $2::varchar)
        ORDER BY wo.created_at`,
      [companyId, statusFilter || null]
    );
    return (res.rows as VarRow[]).map((r) => ({
      work_order_id: String(r.work_order_id),
      order_number: String(r.order_number ?? ''),
      status: String(r.status ?? ''),
      material_name: String(r.material_name ?? ''),
      material_id: String(r.material_id ?? ''),
      planned_quantity: Number(r.planned_quantity ?? 0),
      actual_quantity: Number(r.actual_quantity ?? 0),
      planned_unit_cost: Number(r.planned_unit_cost ?? 0),
      actual_unit_cost: Number(r.actual_unit_cost ?? 0),
    }));
  }, [companyId, statusFilter]);

  const [data, setData] = useState<VarRow[] | null>(null);
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
    const over = rows.filter((r) => r.actual_quantity > r.planned_quantity);
    const under = rows.filter((r) => r.actual_quantity < r.planned_quantity);
    return { total: rows.length, over: over.length, under: under.length };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.mfgVariance.title')} subtitle={t('reports.mfgVariance.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(v) => setStatusFilter(v)}>
          <option value="">{t('reports.mfgVariance.allStatuses')}</option>
          <option value="planned">planned</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
        </Select>
        <Button variant="outline" size="sm" onClick={refresh}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'over', title: t('reports.mfgVariance.overProduction'), value: summary.over, icon: TrendingUp, color: 'emerald' },
            { key: 'under', title: t('reports.mfgVariance.underProduction'), value: summary.under, icon: TrendingDown, color: 'rose' },
            { key: 'total', title: t('reports.mfgVariance.totalRows'), value: summary.total, icon: Package, color: 'slate' },
          ]} />
          <ReportTable
            title={t('reports.mfgVariance.title')}
            columns={[
              { key: 'order_number', header: t('reports.mfgVariance.orderNumber'), width: 110, format: 'text' },
              { key: 'status', header: t('reports.mfgVariance.status'), width: 100 },
              { key: 'material_name', header: t('reports.mfgVariance.material'), width: 150 },
              { key: 'planned_quantity', header: t('reports.mfgVariance.plannedQuantity'), width: 90, format: 'quantity' },
              { key: 'actual_quantity', header: t('reports.mfgVariance.actualQuantity'), width: 90, format: 'quantity' },
              { key: 'planned_unit_cost', header: t('reports.mfgVariance.plannedUnitCost'), width: 100, format: 'money' },
              { key: 'actual_unit_cost', header: t('reports.mfgVariance.actualUnitCost'), width: 100, format: 'money' },
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
        { key: 'order_number', header: t('reports.mfgVariance.orderNumber'), format: 'text', width: 40 },
        { key: 'material_name', header: t('reports.mfgVariance.material'), format: 'text', width: 50 },
        { key: 'actual_quantity', header: t('reports.quantity'), format: 'quantity', width: 30 },
      ],
      rows: data,
      meta: { title: t('reports.mfgVariance.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `ManufacturingVariance`,
    };
  }
};

export default ManufacturingVariancePage;
