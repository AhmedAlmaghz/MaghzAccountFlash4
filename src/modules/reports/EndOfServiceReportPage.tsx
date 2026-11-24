import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, Coins, Users } from 'lucide-react';
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

interface EosRow {
  employee_name: string;
  employee_number: string;
  termination_date: string;
  service_years: number;
  last_salary: number;
  eos_amount: number;
  reason: string;
  status: string;
}

export const EndOfServiceReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [, setRefreshKey] = useState(0);

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT e.employee_number, e.full_name AS employee_name, e.termination_date,
              e.service_years, e.last_salary, e.eos_amount, e.reason, e.status
         FROM end_of_service e
        WHERE e.company_id = $1
          AND ($2::varchar IS NULL OR e.status = $2::varchar)
        ORDER BY e.termination_date DESC`,
      [companyId, statusFilter || null]
    );
    return (res.rows as EosRow[]).map((r) => ({
      employee_name: String(r.employee_name ?? ''),
      employee_number: String(r.employee_number ?? ''),
      termination_date: String(r.termination_date ?? ''),
      service_years: Number(r.service_years ?? 0),
      last_salary: Number(r.last_salary ?? 0),
      eos_amount: Number(r.eos_amount ?? 0),
      reason: String(r.reason ?? ''),
      status: String(r.status ?? ''),
    }));
  }, [companyId, statusFilter]);

  const [data, setData] = useState<EosRow[] | null>(null);
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
    return { total: sumCol(rows, 'eos_amount'), count: rows.length, avg: sumCol(rows, 'eos_amount') / Math.max(1, rows.length) };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.eos.title')} subtitle={t('reports.eos.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(v) => setStatusFilter(v)}>
          <option value="">{t('reports.eos.allStatuses')}</option>
          <option value="draft">{t('hr.eos.status.draft')}</option>
          <option value="approved">{t('hr.eos.status.approved')}</option>
          <option value="paid">{t('hr.eos.status.paid')}</option>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'total', title: t('reports.eos.totalEos'), value: formatCurrency(summary.total), icon: Coins, color: 'emerald', trend: 'up' },
            { key: 'count', title: t('reports.eos.employeesCount'), value: summary.count, icon: Users, color: 'slate' },
            { key: 'avg', title: t('reports.eos.avgEos'), value: formatCurrency(summary.avg), icon: TrendingUp, color: 'amber' },
          ]} />

          <ReportTable
            title={t('reports.eos.title')}
            columns={[
              { key: 'termination_date', header: t('reports.eos.terminationDate'), width: 90, format: 'date' },
              { key: 'employee_name', header: t('hr.employees.name'), width: 180 },
              { key: 'employee_number', header: t('hr.employees.number'), width: 90, format: 'text' },
              { key: 'service_years', header: t('reports.eos.serviceYears'), width: 80, format: 'number' },
              { key: 'last_salary', header: t('hr.eos.lastSalary'), width: 120, format: 'money' },
              { key: 'eos_amount', header: t('reports.eos.eosAmount'), width: 130, format: 'money' },
              { key: 'status', header: t('hr.eos.status.title'), width: 80 },
              { key: 'reason', header: t('reports.eos.reason'), width: 110 },
            ]}
            rows={data || []}
            totals={{ label: t('reports.eos.total'), values: { eos_amount: summary.total } }}
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
        { key: 'termination_date', header: t('reports.eos.terminationDate'), format: 'date', width: 20 },
        { key: 'employee_name', header: t('hr.employees.name'), width: 80 },
        { key: 'eos_amount', header: t('reports.eos.eosAmount'), format: 'money', width: 60 },
      ],
      rows: data,
      meta: { title: t('reports.eos.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `EndOfService`,
    };
  }
};

export default EndOfServiceReportPage;
