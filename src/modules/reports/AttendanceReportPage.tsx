import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, CalendarCheck } from 'lucide-react';
import { PageHeader, Card, Button, Input } from '@/core/ui/components';
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

interface AttendanceRow {
  date: string;
  employee_name: string;
  employee_number: string;
  status: string;
  notes: string;
  is_absent: boolean;
  is_late: boolean;
  late_minutes: number;
  overtime_hours: number;
}

export const AttendanceReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [, setRefreshKey] = useState(0);

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT a.date, e.employee_number, e.full_name AS employee_name,
              a.status, a.notes,
              COALESCE((a.status = 'absent' OR a.status = 'on_leave'), false) AS is_absent,
              COALESCE(a.late_minutes, 0) AS late_minutes,
              COALESCE(a.overtime_hours, 0) AS overtime_hours,
              COALESCE(a.status = 'late', false) AS is_late
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.company_id = $1
          AND ($2::date IS NULL OR a.date >= $2::date)
          AND ($3::date IS NULL OR a.date <= $3::date)
        ORDER BY a.date, e.full_name`,
      [companyId, fromDate || null, toDate || null]
    );
    return (res.rows as AttendanceRow[]).map((r) => ({
      date: String(r.date ?? ''),
      employee_name: String(r.employee_name ?? ''),
      employee_number: String(r.employee_number ?? ''),
      status: String(r.status ?? 'present'),
      notes: String(r.notes ?? ''),
      is_absent: !!r.is_absent,
      is_late: !!r.is_late,
      late_minutes: Number(r.late_minutes ?? 0),
      overtime_hours: Number(r.overtime_hours ?? 0),
    }));
  }, [companyId, fromDate, toDate]);

  const [data, setData] = useState<AttendanceRow[] | null>(null);
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
    const rows = (data || []) as AttendanceRow[];
    const absent = rows.filter((r) => r.is_absent).length;
    const late = rows.filter((r) => r.is_late).length;
    const overtime = sumCol(rows, 'overtime_hours');
    const totalDays = rows.length;
    return { totalDays, absent, late, overtime };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.attendance.title')} subtitle={t('reports.attendance.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Input placeholder={t('reports.attendance.from')} className="w-36" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input placeholder={t('reports.attendance.to')} className="w-36" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'present', title: t('reports.attendance.presentDays'), value: `${(data?.filter(r => r.is_absent === false && r.status !== 'present').length || 0)}` as string, icon: CalendarCheck, color: 'emerald' },
            { key: 'absent', title: t('reports.attendance.absentDays'), value: summary.absent, icon: CalendarCheck, color: 'rose' },
            { key: 'late', title: t('reports.attendance.lateDays'), value: summary.late, icon: Clock, color: 'amber' },
            { key: 'overtime', title: t('reports.attendance.totalOvertime'), value: formatCurrency(summary.overtime), icon: Clock, color: 'slate' },
          ]} />

          <ReportTable
            title={t('reports.attendance.title')}
            columns={[
              { key: 'date', header: t('reports.attendance.date'), width: 90, format: 'date' },
              { key: 'employee_name', header: t('hr.employees.name'), width: 170 },
              { key: 'employee_number', header: t('hr.employees.number'), width: 80, format: 'text' },
              { key: 'status', header: t('reports.attendance.status'), width: 80 },
              { key: 'is_absent', header: t('reports.attendance.absent'), width: 70, format: 'text' },
              { key: 'late_minutes', header: t('reports.attendance.lateMinutes'), width: 90, format: 'number' },
              { key: 'overtime_hours', header: t('reports.attendance.overtimeHours'), width: 90, format: 'number' },
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
        { key: 'date', header: t('reports.attendance.date'), format: 'date', width: 20 },
        { key: 'employee_name', header: t('hr.employees.name'), width: 80 },
        { key: 'status', header: t('reports.attendance.status'), width: 50 },
      ],
      rows: data,
      meta: { title: t('reports.attendance.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `Attendance`,
    };
  }
};

export default AttendanceReportPage;
