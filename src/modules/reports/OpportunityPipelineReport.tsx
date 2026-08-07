import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card, Button, Table } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel } from '@/core/utils/exportEngine';
import { useTranslation } from '@/core/i18n/useTranslation';
import { formatCurrency } from '@/core/utils';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { usePermission } from '@/modules/auth/hooks/usePermission';

interface StageSummary {
  stage: string;
  count: number;
  totalValue: number;
  avgValue: number;
  weightedValue: number;
  probability: number;
}

interface RepSummary {
  name: string;
  count: number;
  totalValue: number;
  weightedValue: number;
}

const STAGE_KEYS: Record<string, string> = {
  new: 'crm.stage.new',
  qualified: 'crm.stage.qualified',
  proposal: 'crm.stage.proposal',
  negotiation: 'crm.stage.negotiation',
  won: 'crm.stage.won',
  lost: 'crm.stage.lost',
};

export const OpportunityPipelineReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const [stages, setStages] = useState<StageSummary[]>([]);
  const [repData, setRepData] = useState<RepSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompany?.id) return;
    const companyId = activeCompany.id;

    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();

      const stageResult = await adapter.query<Record<string, unknown>>(
        `SELECT
           stage,
           COUNT(*)::int AS count,
           COALESCE(SUM(value), 0) AS total_value,
           COALESCE(AVG(value), 0) AS avg_value,
           COALESCE(AVG(probability), 0) AS avg_probability
         FROM opportunities
         WHERE company_id = $1
         GROUP BY stage
         ORDER BY MIN(CASE stage
           WHEN 'new' THEN 1 WHEN 'qualified' THEN 2
           WHEN 'proposal' THEN 3 WHEN 'negotiation' THEN 4
           WHEN 'won' THEN 5 WHEN 'lost' THEN 6 ELSE 99 END)`,
        [companyId]
      );

      const repResult = await adapter.query<Record<string, unknown>>(
        `SELECT
           COALESCE(u.full_name, 'unassigned') AS name,
           COUNT(*)::int AS count,
           COALESCE(SUM(o.value), 0) AS total_value,
           COALESCE(SUM(o.value * o.probability / 100.0), 0) AS weighted_value
         FROM opportunities o
         LEFT JOIN users u ON o.assigned_to = u.id
         WHERE o.company_id = $1 AND o.stage NOT IN ('won', 'lost')
         GROUP BY u.full_name
         ORDER BY total_value DESC`,
        [companyId]
      );

      if (stageResult.success && stageResult.rows) {
        const rows: StageSummary[] = stageResult.rows.map((r: Record<string, unknown>) => {
          const totalValue = Number(r.total_value) || 0;
          const count = Number(r.count) || 1;
          const prob = Number(r.avg_probability) || 0;
          return {
            stage: String(r.stage),
            count,
            totalValue,
            avgValue: totalValue / count,
            weightedValue: totalValue * (prob / 100),
            probability: prob,
          };
        });
        setStages(rows);
      }

      if (repResult.success && repResult.rows) {
        setRepData(repResult.rows.map((r: Record<string, unknown>) => ({
          name: String(r.name),
          count: Number(r.count) || 0,
          totalValue: Number(r.total_value) || 0,
          weightedValue: Number(r.weighted_value) || 0,
        })));
      }

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pipeline');
        setStages([]);
        setRepData([]);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [activeCompany?.id]);

  const totalPipeline = useMemo(() => stages.reduce((s, st) => s + (st.stage !== 'won' && st.stage !== 'lost' ? st.totalValue : 0), 0), [stages]);
  const totalWeighted = useMemo(() => stages.reduce((s, st) => s + (st.stage !== 'won' && st.stage !== 'lost' ? st.weightedValue : 0), 0), [stages]);
  const wonValue = useMemo(() => stages.find((s) => s.stage === 'won')?.totalValue || 0, [stages]);
  const totalCount = useMemo(() => stages.reduce((s, st) => s + st.count, 0), [stages]);

  const handleExportExcel = async () => {
    const cols: Array<{ key: string; header: string; width?: number }> = [
      { key: 'stage', header: t('reports.stage') },
      { key: 'count', header: t('reports.count') },
      { key: 'totalValue', header: t('reports.totalValue') },
      { key: 'avgValue', header: t('reports.avgValue') },
      { key: 'weightedValue', header: t('reports.weightedValue') },
      { key: 'probability', header: t('reports.probability') },
    ];
    const rows = stages.map((s) => ({
      stage: t(STAGE_KEYS[s.stage] || s.stage),
      count: s.count,
      totalValue: formatCurrency(s.totalValue),
      avgValue: formatCurrency(s.avgValue),
      weightedValue: formatCurrency(s.weightedValue),
      probability: `${s.probability.toFixed(0)}%`,
    }));
    await exportToExcel(rows, cols, `Opportunity_Pipeline_${new Date().toISOString().split('T')[0]}`);
  };

  const chartData = stages
    .filter((s) => s.stage !== 'won' && s.stage !== 'lost')
    .map((s) => ({ name: t(STAGE_KEYS[s.stage] || s.stage), count: s.count, totalValue: s.totalValue }));

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <BarChart3 size={48} className="mx-auto mb-4 text-slate-400" />
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

  if (totalCount === 0) {
    return (
      <EmptyState icon="inbox" title={t('reports.noData')} description={t('reports.opportunityPipelineNoData')} />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('reports.opportunityPipeline')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('reports.opportunityPipelineDesc')}</p>
          </div>
        </div>
        {totalCount > 0 && <Button variant="secondary" onClick={handleExportExcel} disabled={!canExport}>{t('reports.exportExcel')}</Button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.totalOpportunities')}</p><p className="text-3xl font-bold mt-1">{totalCount}</p></div></Card>
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.pipelineValue')}</p><p className="text-2xl font-bold mt-1">{formatCurrency(totalPipeline)}</p></div></Card>
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.weightedPipeline')}</p><p className="text-2xl font-bold mt-1">{formatCurrency(totalWeighted)}</p></div></Card>
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.wonValue')}</p><p className="text-2xl font-bold mt-1 text-emerald-600">{formatCurrency(wonValue)}</p></div></Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          <div className="p-4">
            <h3 className="font-bold text-lg mb-4">{t('reports.pipelineByStage')}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" orientation="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="count" name={t('reports.count')} fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="totalValue" name={t('reports.totalValue')} fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="space-y-4 p-4">
            <h3 className="font-bold text-lg">{t('reports.stageBreakdown')}</h3>
            <Table<StageSummary>
              data={stages}
              columns={[
                { key: 'stage', header: t('reports.stage'), render: (r) => t(STAGE_KEYS[r.stage] || r.stage) },
                { key: 'count', header: t('reports.count'), width: '60px', align: 'center' },
                { key: 'totalValue', header: t('reports.totalValue'), width: '120px', align: 'right', render: (r) => formatCurrency(r.totalValue) },
                { key: 'weightedValue', header: t('reports.weightedValue'), width: '120px', align: 'right', render: (r) => formatCurrency(r.weightedValue) },
                { key: 'probability', header: t('reports.probability'), width: '80px', align: 'center', render: (r) => `${r.probability.toFixed(0)}%` },
              ]}
              keyExtractor={(r) => r.stage}
              emptyMessage={t('reports.noData')}
            />
          </div>
        </Card>

        <Card>
          <div className="space-y-4 p-4">
            <h3 className="font-bold text-lg">{t('reports.repPerformance')}</h3>
            {repData.length === 0 ? (
              <EmptyState title={t('reports.noData')} description={t('reports.noRepData')} />
            ) : (
              <Table<RepSummary>
                data={repData}
                columns={[
                  { key: 'name', header: t('reports.repName') },
                  { key: 'count', header: t('reports.opportunitiesCount'), width: '80px', align: 'center' },
                  { key: 'totalValue', header: t('reports.totalValue'), width: '120px', align: 'right', render: (r) => formatCurrency(r.totalValue) },
                  { key: 'weightedValue', header: t('reports.weightedValue'), width: '120px', align: 'right', render: (r) => formatCurrency(r.weightedValue) },
                ]}
                keyExtractor={(r) => r.name}
                emptyMessage={t('reports.noData')}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default OpportunityPipelineReport;
