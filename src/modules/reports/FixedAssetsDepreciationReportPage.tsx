import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, Coins, Package } from 'lucide-react';
import { PageHeader, Card, Button, Select, Input } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';
import { sumCol,  } from './shared/liveAggregates';
import type { ReportSpec } from '@/core/reports';

interface AssetRow {
  asset_code: string;
  asset_name: string;
  category: string;
  purchase_date: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  method: string;
  accumulated_depreciation: number;
  current_depreciation: number;
  current_balance: number;
  status: string;
}

export const FixedAssetsDepreciationReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT fa.code AS asset_code, fa.name_ar AS asset_name, fa.category, fa.purchase_date,
              fa.cost, fa.salvage_value, fa.useful_life_months, fa.method, fa.accumulated_depreciation,
              fa.status,
              (fa.cost - fa.accumulated_depreciation) AS current_balance
         FROM fixed_assets fa
        WHERE fa.company_id = $1
          AND ($2::varchar IS NULL OR fa.status = $2::varchar)
          AND ($3::date IS NULL OR fa.purchase_date <= $3::date)
        ORDER BY fa.code`,
      [companyId, statusFilter || null, fromDate || null]
    );
    return (res.rows as AssetRow[]).map((r) => ({
      asset_code: String(r.asset_code ?? ''),
      asset_name: String(r.asset_name ?? ''),
      category: String(r.category ?? ''),
      purchase_date: String(r.purchase_date ?? ''),
      cost: Number(r.cost ?? 0),
      salvage_value: Number(r.salvage_value ?? 0),
      useful_life_months: Number(r.useful_life_months ?? 0),
      method: String(r.method ?? 'straight_line'),
      accumulated_depreciation: Number(r.accumulated_depreciation ?? 0),
      current_depreciation: Number(r.current_balance ?? 0),
      current_balance: Number(r.current_balance ?? 0),
      status: String(r.status ?? 'active'),
    }));
  }, [companyId, statusFilter, fromDate]);

  const [data, setData] = useState<AssetRow[] | null>(null);
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
      totalValue: sumCol(rows, 'cost'),
      totalDepr: sumCol(rows, 'accumulated_depreciation'),
      remaining: sumCol(rows.map((r) => ({ ...r, cost: r.cost - r.accumulated_depreciation })), 'cost'),
      count: rows.length,
    };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.assetsDepr.title')} subtitle={t('reports.assetsDepr.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(v) => setStatusFilter(v)}>
          <option value="">{t('reports.assetsDepr.allStatuses')}</option>
          <option value="active">{t('reports.assetsDepr.active')}</option>
          <option value="disposed">{t('reports.assetsDepr.disposed')}</option>
        </Select>
        <Input className="w-28" placeholder={t('reports.assetsDepr.fromDate')} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Button variant="outline" size="sm" onClick={refresh}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'total', title: t('reports.assetsDepr.totalAssetsValue'), value: formatCurrency(summary.totalValue), icon: Package, color: 'slate' },
            { key: 'depr', title: t('reports.assetsDepr.totalDeprAccumulated'), value: formatCurrency(summary.totalDepr), icon: TrendingUp, color: 'emerald' },
            { key: 'remaining', title: t('reports.assetsDepr.remainingValue'), value: formatCurrency(summary.remaining), icon: Coins, color: 'rose' },
            { key: 'count', title: t('reports.assetsDepr.assetsCount'), value: summary.count, icon: Package, color: 'slate' },
          ]} />
          <ReportTable
            title={t('reports.assetsDepr.title')}
            columns={[
              { key: 'asset_code', header: t('reports.assetsDepr.code'), width: 90, format: 'text' },
              { key: 'asset_name', header: t('reports.assetsDepr.name'), width: 160 },
              { key: 'category', header: t('reports.assetsDepr.category'), width: 110 },
              { key: 'purchase_date', header: t('reports.assetsDepr.purchaseDate'), width: 80, format: 'date' },
              { key: 'cost', header: t('reports.assetsDepr.cost'), width: 110, format: 'money' },
              { key: 'accumulated_depreciation', header: t('reports.assetsDepr.accumulatedDepr'), width: 130, format: 'money' },
              { key: 'current_balance', header: t('reports.assetsDepr.currentBalance'), width: 110, format: 'money' },
              { key: 'method', header: t('reports.assetsDepr.method'), width: 100 },
              { key: 'status', header: t('reports.assetsDepr.status'), width: 80 },
            ]}
            rows={data || []}
            totals={{ label: t('reports.assetsDepr.total'), values: { cost: summary.totalValue, accumulated_depreciation: summary.totalDepr } }}
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
        { key: 'asset_code', header: t('reports.assetsDepr.code'), format: 'text', width: 40 },
        { key: 'asset_name', header: t('reports.assetsDepr.name'), format: 'text', width: 50 },
        { key: 'accumulated_depreciation', header: t('reports.assetsDepr.accumulatedDepr'), format: 'money', width: 40 },
      ],
      rows: data,
      meta: { title: t('reports.assetsDepr.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `FixedAssetsDepreciation`,
    };
  }
};

export default FixedAssetsDepreciationReportPage;
