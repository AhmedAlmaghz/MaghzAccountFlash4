import React, { useState, useEffect, useCallback } from 'react';
import { Users, Filter, RotateCcw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { Card, Button, Table } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useTranslation } from '@/core/i18n/useTranslation';
import { formatCurrency } from '@/core/utils';
import { usePermission } from '@/modules/auth/hooks/usePermission';

interface LeadSourceRow {
  source: string;
  total: number;
  contacted: number;
  qualified: number;
  converted: number;
  lost: number;
  conversionRate: number;
}

interface ConversionSummary {
  totalLeads: number;
  contacted: number;
  qualified: number;
  converted: number;
  lost: number;
  overallRate: number;
  totalEstimatedValue: number;
  convertedValue: number;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function yearStart(): string {
  const d = new Date();
  d.setMonth(0, 1);
  return d.toISOString().split('T')[0];
}

export const LeadConversionReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const [summary, setSummary] = useState<ConversionSummary | null>(null);
  const [sourceData, setSourceData] = useState<LeadSourceRow[]>([]);
  const [funnelData, setFunnelData] = useState<Array<{ stage: string; count: number }>>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<Array<{ month: string; total: number; converted: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const applyPreset = useCallback((preset: '30' | '90' | 'year' | 'all') => {
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    setToDate(new Date().toISOString().split('T')[0]);
    if (preset === '30') setFromDate(daysAgo(30));
    else if (preset === '90') setFromDate(daysAgo(90));
    else if (preset === 'year') setFromDate(yearStart());
  }, []);

  useEffect(() => {
    if (!activeCompany?.id) return;
    const companyId = activeCompany.id;

    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();

      const conditions: string[] = ['company_id = $1'];
      const params: unknown[] = [companyId];
      if (fromDate) { conditions.push(`created_at >= $${params.length + 1}::date`); params.push(fromDate); }
      if (toDate) { conditions.push(`created_at <= $${params.length + 1}::date`); params.push(toDate); }
      const whereBase = `WHERE ${conditions.join(' AND ')}`;

      const summaryResult = await adapter.query<Record<string, unknown>>(
        `SELECT
           COUNT(*)::int AS total,
           COALESCE(SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END))::int AS contacted,
           COALESCE(SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END))::int AS qualified,
           COALESCE(SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END))::int AS converted,
           COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END))::int AS lost,
           COALESCE(SUM(estimated_value), 0) AS total_estimated,
           COALESCE(SUM(CASE WHEN status = 'converted' THEN estimated_value ELSE 0 END), 0) AS converted_value
         FROM leads ${whereBase}`,
        params
      );

      const sourceResult = await adapter.query<Record<string, unknown>>(
        `SELECT
           COALESCE(source, 'unknown') AS source,
           COUNT(*)::int AS total,
           COALESCE(SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END))::int AS contacted,
           COALESCE(SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END))::int AS qualified,
           COALESCE(SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END))::int AS converted,
           COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END))::int AS lost
         FROM leads ${whereBase}
         GROUP BY source
         ORDER BY total DESC`,
        params
      );

      if (summaryResult.success && summaryResult.rows?.[0]) {
        const r = summaryResult.rows[0];
        const total = Number(r.total) || 0;
        const converted = Number(r.converted) || 0;
        setSummary({
          totalLeads: total,
          contacted: Number(r.contacted) || 0,
          qualified: Number(r.qualified) || 0,
          converted,
          lost: Number(r.lost) || 0,
          overallRate: total > 0 ? (converted / total) * 100 : 0,
          totalEstimatedValue: Number(r.total_estimated) || 0,
          convertedValue: Number(r.converted_value) || 0,
        });
      } else {
        setSummary(null);
      }

      if (sourceResult.success && sourceResult.rows) {
        const rows: LeadSourceRow[] = sourceResult.rows.map((r: Record<string, unknown>) => {
          const ttl = Number(r.total) || 1;
          const conv = Number(r.converted) || 0;
          return {
            source: String(r.source),
            total: ttl,
            contacted: Number(r.contacted) || 0,
            qualified: Number(r.qualified) || 0,
            converted: conv,
            lost: Number(r.lost) || 0,
            conversionRate: (conv / ttl) * 100,
          };
        });
        setSourceData(rows);
      } else {
        setSourceData([]);
      }

      const funnelResult = await adapter.query<{ stage: string; cnt: string | number }>(
        `SELECT status AS stage, COUNT(*)::int AS cnt
           FROM leads ${whereBase}
          GROUP BY status
          ORDER BY MIN(CASE status
            WHEN 'new' THEN 1 WHEN 'contacted' THEN 2
            WHEN 'qualified' THEN 3 WHEN 'converted' THEN 4
            WHEN 'lost' THEN 5 ELSE 6
          END)`,
        params,
      );
      if (funnelResult.success && funnelResult.rows) {
        setFunnelData(funnelResult.rows.map((r) => ({
          stage: String(r.stage),
          count: Number(r.cnt) || 0,
        })));
      } else {
        setFunnelData([]);
      }

      const trendResult = await adapter.query<{ month: string; cnt: string | number; conv: string | number }>(
        `SELECT to_char(created_at, 'YYYY-MM') AS month,
                COUNT(*)::int AS cnt,
                COALESCE(SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END))::int AS conv
           FROM leads ${whereBase}
          GROUP BY month
          ORDER BY month`,
        params,
      );
      if (trendResult.success && trendResult.rows) {
        setMonthlyTrend(trendResult.rows.map((r) => ({
          month: String(r.month),
          total: Number(r.cnt) || 0,
          converted: Number(r.conv) || 0,
        })));
      } else {
        setMonthlyTrend([]);
      }

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lead conversion');
        setSummary(null);
        setSourceData([]);
        setFunnelData([]);
        setMonthlyTrend([]);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [activeCompany?.id, fromDate, toDate]);

  const hasActiveFilters = fromDate || toDate;

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
  };

  const handleExportExcel = async () => {
    if (!sourceData.length) return;
    const cols: Array<{ key: string; header: string; width?: number }> = [
      { key: 'source', header: t('reports.source') },
      { key: 'total', header: t('crm.status.new') },
      { key: 'contacted', header: t('crm.status.contacted') },
      { key: 'qualified', header: t('crm.status.qualified') },
      { key: 'converted', header: t('crm.status.converted') },
      { key: 'lost', header: t('crm.status.lost') },
      { key: 'conversionRate', header: t('reports.conversionRate') },
    ];
    const rows = sourceData.map((r) => ({
      source: r.source,
      total: r.total,
      contacted: r.contacted,
      qualified: r.qualified,
      converted: r.converted,
      lost: r.lost,
      conversionRate: `${r.conversionRate.toFixed(1)}%`,
    }));
    await exportToExcel(rows, cols, `Lead_Conversion_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPDF = async () => {
    if (!summary) return;
    const pdfRows = [
      { metric: t('reports.totalLeads'), value: summary.totalLeads },
      { metric: t('reports.overallConversionRate'), value: `${summary.overallRate.toFixed(1)}%` },
      { metric: t('reports.convertedLeads'), value: summary.converted },
      { metric: t('reports.totalEstimatedValue'), value: formatCurrency(summary.totalEstimatedValue) },
      { metric: t('reports.convertedValue'), value: formatCurrency(summary.convertedValue) },
    ];
    const pdfCols = [
      { key: 'metric', header: t('reports.kpiMetric'), width: 50 },
      { key: 'value', header: t('reports.kpiValue'), width: 50 },
    ];
    await exportToPDF(pdfRows, pdfCols, `Lead_Conversion_${new Date().toISOString().split('T')[0]}`, {
      title: t('reports.leadConversion'),
      subtitle: activeCompany?.name || '',
      companyName: activeCompany?.name,
      rtl: true,
    });
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Users size={48} className="mx-auto mb-4 text-slate-400" />
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

  if (!summary || summary.totalLeads === 0) {
    return (
      <EmptyState
        icon="inbox"
        title={hasActiveFilters ? t('reports.emptyResults.title') : t('reports.noData')}
        description={hasActiveFilters ? t('reports.emptyResults.description') : t('reports.leadConversionNoData')}
        action={
          hasActiveFilters ? (
            <Button variant="secondary" onClick={clearFilters} leftIcon={<RotateCcw size={16} />}>
              {t('reports.clearFilter')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('reports.leadConversion')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('reports.leadConversionDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" leftIcon={<Filter size={16} />} onClick={() => setShowFilters((s) => !s)}>
            {t('reports.filter')}
          </Button>
          {summary.totalLeads > 0 && (
            <>
              <Button variant="secondary" onClick={handleExportExcel} disabled={!canExport}>{t('reports.exportExcel')}</Button>
              <Button variant="secondary" onClick={handleExportPDF} disabled={!canExport}>{t('reports.exportPdf')}</Button>
            </>
          )}
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <Card>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.fromDate')}</label>
                <input type="date" className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('reports.toDate')}</label>
                <input type="date" className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="flex items-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => applyPreset('30')}>{t('reports.preset.last30')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('90')}>{t('reports.preset.last90')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('year')}>{t('reports.preset.thisYear')}</Button>
                <Button size="sm" variant="ghost" onClick={() => applyPreset('all')}>{t('reports.preset.all')}</Button>
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={clearFilters}>
                  {t('reports.clearFilter')}
                </Button>
              </div>
            </div>
            {hasActiveFilters && (
              <p className="text-xs text-primary-600 dark:text-primary-400">
                {t('reports.filter')}: {fromDate ? `${t('reports.fromDate')} ${fromDate}` : ''}{fromDate && toDate ? ' — ' : ''}{toDate ? `${t('reports.toDate')} ${toDate}` : ''}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><div className="p-4 text-center"><p className="text-3xl font-bold text-primary-600">{summary.totalLeads}</p><p className="text-sm text-slate-500 mt-1">{t('reports.totalLeads')}</p></div></Card>
        <Card><div className="p-4 text-center"><p className="text-3xl font-bold text-blue-600">{summary.contacted}</p><p className="text-sm text-slate-500 mt-1">{t('crm.status.contacted')}</p></div></Card>
        <Card><div className="p-4 text-center"><p className="text-3xl font-bold text-purple-600">{summary.qualified}</p><p className="text-sm text-slate-500 mt-1">{t('crm.status.qualified')}</p></div></Card>
        <Card><div className="p-4 text-center"><p className="text-3xl font-bold text-emerald-600">{summary.converted}</p><p className="text-sm text-slate-500 mt-1">{t('crm.status.converted')}</p></div></Card>
        <Card><div className="p-4 text-center"><p className="text-3xl font-bold text-rose-600">{summary.lost}</p><p className="text-sm text-slate-500 mt-1">{t('crm.status.lost')}</p></div></Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.overallConversionRate')}</p><p className="text-2xl font-bold mt-1">{summary.overallRate.toFixed(1)}%</p></div></Card>
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.totalEstimatedValue')}</p><p className="text-2xl font-bold mt-1">{formatCurrency(summary.totalEstimatedValue)}</p></div></Card>
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.convertedValue')}</p><p className="text-2xl font-bold mt-1">{formatCurrency(summary.convertedValue)}</p></div></Card>
        <Card><div className="p-4"><p className="text-sm text-slate-500">{t('reports.qualifiedRate')}</p><p className="text-2xl font-bold mt-1">{summary.totalLeads > 0 ? ((summary.qualified / summary.totalLeads) * 100).toFixed(1) : '0'}%</p></div></Card>
      </div>

      {/* Charts Row: Funnel + Source Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel Chart */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4 text-sm">{t('reports.leadFunnel')}</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" />
                <YAxis dataKey="stage" type="category" tick={{ fontSize: 12 }} width={80} />
                <Tooltip formatter={(value: unknown) => [Number(value), t('reports.count')]} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {funnelData.map((entry) => {
                    const colors: Record<string, string> = {
                      new: '#94a3b8', contacted: '#3b82f6', qualified: '#f59e0b',
                      converted: '#10b981', lost: '#ef4444',
                    };
                    return <Cell key={entry.stage} fill={colors[entry.stage] || '#94a3b8'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Source Distribution Pie */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4 text-sm">{t('reports.sourceDistribution')}</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sourceData} cx="50%" cy="45%" outerRadius={80} dataKey="total" nameKey="source" paddingAngle={3}>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={
                      ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'][i % 8]
                    } />
                  ))}
                </Pie>
                <Tooltip formatter={(value: unknown) => [Number(value), t('reports.count')]} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Monthly Trend */}
      {monthlyTrend.length > 0 && (
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4 text-sm">{t('reports.monthlyConversionTrend')}</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total" fill="#94a3b8" name={t('reports.totalLeads')} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="converted" fill="#10b981" name={t('reports.convertedLeads')} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      {/* Source Breakdown Table */}
      <Card>
        <div className="space-y-4 p-4">
          <h3 className="font-bold text-lg">{t('reports.leadConversionBySource')}</h3>
          <Table<LeadSourceRow>
            data={sourceData}
            columns={[
              { key: 'source', header: t('reports.source'), render: (r) => <span className="font-medium">{r.source === 'unknown' ? t('reports.unknown') : r.source}</span> },
              { key: 'total', header: t('crm.status.new'), width: '80px', align: 'center' },
              { key: 'contacted', header: t('crm.status.contacted'), width: '90px', align: 'center' },
              { key: 'qualified', header: t('crm.status.qualified'), width: '90px', align: 'center' },
              { key: 'converted', header: t('crm.status.converted'), width: '90px', align: 'center' },
              { key: 'lost', header: t('crm.status.lost'), width: '80px', align: 'center' },
              { key: 'conversionRate', header: t('reports.conversionRate'), width: '110px', align: 'center', render: (r) => (
                <span className="font-semibold text-primary-600">{r.conversionRate.toFixed(1)}%</span>
              )},
            ]}
            keyExtractor={(r) => r.source}
            emptyMessage={t('reports.noData')}
          />
        </div>
      </Card>
    </div>
  );
};

export default LeadConversionReport;
