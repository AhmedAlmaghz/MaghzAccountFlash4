import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User, DollarSign, AlertTriangle } from 'lucide-react';
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

interface PayrollRow {
  month: number;
  year: number;
  employee_name: string;
  employee_number: string;
  base_salary: number;
  allowances: number;
  deductions: number;
  overtime: number;
  net_salary: number;
}

export const PayrollReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [year, setYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState('');

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT pr.month, pr.year, e.employee_number, e.full_name AS employee_name,
              pl.base_salary, pl.allowances, pl.deductions, COALESCE(pl.overtime_hours, 0) AS overtime_hours,
              pl.net_salary
         FROM payroll_lines pl
         JOIN payroll_runs pr ON pr.id = pl.payroll_run_id AND pr.company_id = $1
         JOIN employees e ON e.id = pl.employee_id
        WHERE pr.company_id = $1 AND pr.year = $2
          AND ($3::varchar IS NULL OR pr.status = $3::varchar)
        ORDER BY pr.year DESC, pr.month DESC, e.full_name`,
      [companyId, year, statusFilter || null]
    );
    return (res.rows as PayrollRow[]).map((r) => ({
      month: Number(r.month ?? 1),
      year: Number(r.year ?? year),
      employee_name: String(r.employee_name ?? ''),
      employee_number: String(r.employee_number ?? ''),
      base_salary: Number(r.base_salary ?? 0),
      allowances: Number(r.allowances ?? 0),
      deductions: Number(r.deductions ?? 0),
      overtime: Number(r.overtime ?? 0),
      net_salary: Number(r.net_salary ?? 0),
    }));
  }, [companyId, year, statusFilter]);

  const [data, setData] = useState<PayrollRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setData(await queryFn()); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); setData(null); }
    finally { setIsLoading(false); }
  }, [queryFn]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (refreshKey > 0) void refresh(); }, [refreshKey, refresh]);

  const summary = useMemo(() => {
    const rows = data || [];
    return {
      totalNet: sumCol(rows, 'net_salary'),
      totalDeductions: sumCol(rows, 'deductions'),
      totalAllowances: sumCol(rows, 'allowances'),
      totalOvertime: sumCol(rows, 'overtime'),
      employeesCount: new Set(rows.map((r) => r.employee_number)).size,
      netRatio: percentOf(sumCol(rows, 'net_salary'), sumCol(rows, 'net_salary') + sumCol(rows, 'deductions')),
    };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.payroll.title')} subtitle={t('reports.payroll.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onChange={(v) => setYear(Number(v))}>
          {[new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(v) => setStatusFilter(v)}>
          <option value="">{t('reports.payroll.allStatuses')}</option>
          <option value="posted">{t('hr.payroll.status.posted')}</option>
          <option value="draft">{t('hr.payroll.status.draft')}</option>
          <option value="cancelled">{t('hr.payroll.status.cancelled')}</option>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'net', title: t('reports.payroll.totalNet'), value: formatCurrency(summary.totalNet), icon: DollarSign, color: 'emerald', trend: 'up' },
            { key: 'ded', title: t('reports.payroll.totalDeductions'), value: formatCurrency(summary.totalDeductions), icon: User, color: 'rose' },
            { key: 'allow', title: t('reports.payroll.totalAllowances'), value: formatCurrency(summary.totalAllowances), icon: User, color: 'amber' },
            { key: 'ot', title: t('reports.payroll.totalOvertime'), value: formatCurrency(summary.totalOvertime), icon: AlertTriangle, color: 'slate' },
            { key: 'count', title: t('reports.payroll.employeesCount'), value: summary.employeesCount, icon: User, color: 'slate' },
          ]} />

          <ReportTable
            title={t('reports.payroll.title')}
            columns={[
              { key: 'month', header: t('reports.payroll.month'), width: 60, format: 'number' },
              { key: 'year', header: t('reports.payroll.year'), width: 60, format: 'number' },
              { key: 'employee_name', header: t('hr.payroll.employeeName'), width: 180 },
              { key: 'employee_number', header: t('hr.employees.number'), width: 90, format: 'text' },
              { key: 'base_salary', header: t('hr.payroll.baseSalary'), width: 120, format: 'money' },
              { key: 'allowances', header: t('hr.payroll.allowances'), width: 100, format: 'money' },
              { key: 'deductions', header: t('hr.payroll.deductions'), width: 100, format: 'money' },
              { key: 'overtime_hours', header: t('hr.payroll.overtimeHours'), width: 90, format: 'number' },
              { key: 'net_salary', header: t('hr.payroll.netSalary'), width: 120, format: 'money' },
            ]}
            rows={data || []}
            totals={{
              label: t('reports.payroll.total'),
              values: { base_salary: summary.totalNet + summary.totalDeductions + summary.totalOvertime, net_salary: summary.totalNet, deductions: summary.totalDeductions },
            }}
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
        { key: 'month', header: t('reports.payroll.month'), format: 'number', width: 20 },
        { key: 'employee_name', header: t('hr.payroll.employeeName'), width: 80 },
        { key: 'base_salary', header: t('hr.payroll.baseSalary'), format: 'money', width: 70 },
        { key: 'deductions', header: t('hr.payroll.deductions'), format: 'money', width: 60 },
        { key: 'net_salary', header: t('hr.payroll.netSalary'), format: 'money', width: 70 },
      ],
      rows: data,
      meta: { title: t('reports.payroll.title'), direction: 'rtl', periodLabel: String(year) },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `Payroll_${year}`,
    };
  }
};

export default PayrollReportPage;
