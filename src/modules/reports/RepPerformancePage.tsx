import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, DollarSign, UserIcon } from 'lucide-react';
import { PageHeader, Card, Button, Select } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';
import { sumCol, percentOf } from './shared/liveAggregates';
import type { ReportSpec } from '@/core/reports';

interface RepRow {
  user_id: string;
  rep_name: string;
  deals: number;
  won: number;
  lost: number;
  pipeline: number;
  wonValue: number;
  lossValue: number;
  winRate: number;
  avgDeal: number;
}

export const RepPerformancePage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [repId, setRepId] = useState('');

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT a.id AS user_id, u.username AS rep_name,
              COUNT(o.id) AS deals,
              COALESCE(SUM(CASE WHEN o.status = 'won' THEN 1 ELSE 0 END), 0) AS won,
              COALESCE(SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END), 0) AS lost,
              COALESCE(SUM(o.probability * COALESCE(o.value, 0)) / NULLIF(COUNT(o.id), 0), 0) AS pipeline,
              COALESCE(SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.value, 0) ELSE 0 END), 0) AS wonValue,
              COALESCE(SUM(CASE WHEN o.status = 'lost' THEN COALESCE(o.value, 0) ELSE 0 END), 0) AS lossValue
         FROM users a
         LEFT JOIN opportunities o ON o.assigned_to = a.id AND o.company_id = a.company_id
        WHERE a.company_id = $1 AND a.role IN ('sales_rep', 'manager', 'admin', 'sales')
        GROUP BY a.id, u.username
        HAVING COUNT(o.id) > 0
        ORDER BY deals DESC`,
      [companyId]
    );
    return (res.rows as RepRow[]).map((r) => {
      const avg = r.deals > 0 ? r.wonValue / Math.max(1, r.deals) : 0;
      return {
        user_id: String(r.user_id),
        rep_name: String(r.rep_name),
        deals: Number(r.deals),
        won: Number(r.won),
        lost: Number(r.lost),
        pipeline: Number(r.pipeline),
        wonValue: Number(r.wonValue),
        lossValue: Number(r.lossValue),
        winRate: percentOf(r.won, r.deals),
        avgDeal: avg,
      };
    });
  }, [companyId]);

  const [data, setData] = useState<RepRow[] | null>(null);
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
    return {
      reps: rows.length,
      totalDeals: sumCol(rows, 'deals'),
      totalWon: sumCol(rows, 'wonValue'),
      totalPipeline: sumCol(rows, 'pipeline'),
    };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.repPerf.title')} subtitle={t('reports.repPerf.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Select value={repId} onChange={(v) => setRepId(v)}>
          <option value="">{t('reports.repPerf.allReps')}</option>
          {data?.map((r) => <option key={r.user_id} value={r.user_id}>{r.rep_name}</option>)}
        </Select>
        <Button variant="outline" size="sm" onClick={refresh}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'reps', title: t('reports.repPerf.reps'), value: summary.reps, icon: UserIcon, color: 'slate' },
            { key: 'won', title: t('reports.repPerf.totalWon'), value: formatCurrency(summary.totalWon), icon: TrendingUp, color: 'emerald', trend: 'up' },
            { key: 'pipeline', title: t('reports.repPerf.totalPipeline'), value: formatCurrency(summary.totalPipeline), icon: DollarSign, color: 'amber' },
          ]} />

          <ReportTable
            title={t('reports.repPerf.title')}
            columns={[
              { key: 'rep_name', header: t('reports.repPerf.repName'), width: 180 },
              { key: 'deals', header: t('reports.repPerf.deals'), width: 70, format: 'number' },
              { key: 'won', header: t('reports.repPerf.won'), width: 70, format: 'number' },
              { key: 'lost', header: t('reports.repPerf.lost'), width: 60, format: 'number' },
              { key: 'winRate', header: t('reports.repPerf.winRate'), width: 80, format: 'percent' },
              { key: 'pipeline', header: t('reports.repPerf.pipelineValue'), width: 120, format: 'money' },
              { key: 'wonValue', header: t('reports.repPerf.wonValue'), width: 120, format: 'money' },
              { key: 'lossValue', header: t('reports.repPerf.lossValue'), width: 100, format: 'money' },
              { key: 'avgDeal', header: t('reports.repPerf.avgDeal'), width: 100, format: 'money' },
            ]}
            rows={data || []}
            totals={{ label: t('reports.repPerf.total'), values: { deals: summary.totalDeals, won: 0, lost: 0, wonValue: summary.totalWon } }}
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
        { key: 'rep_name', header: t('reports.repPerf.repName'), width: 60 },
        { key: 'deals', header: t('reports.repPerf.deals'), format: 'number', width: 50 },
        { key: 'wonValue', header: t('reports.repPerf.wonValue'), format: 'money', width: 60 },
        { key: 'winRate', header: t('reports.repPerf.winRate'), format: 'percent', width: 40 },
      ],
      rows: data,
      meta: { title: t('reports.repPerf.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `RepPerformance`,
    };
  }
};

export default RepPerformancePage;
