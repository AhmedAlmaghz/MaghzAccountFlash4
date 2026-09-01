import React, { useState, useMemo } from 'react';
import { UserCheck, Plus, CalendarDays, CheckSquare, Download, Printer, Layers, Clock } from 'lucide-react';
import { Card, Button, Input, Table, Modal, Can } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { exportToPDF, exportToExcel } from '@/core/utils/exportEngine';
import { useAppStore } from '@/core/store';
import { useAttendance, useEmployees } from '../hooks/useHr';
import type { AttendanceRecord } from '../types';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

interface DailyFormRecord {
  employeeId: string;
  employeeName: string;
  status: 'present' | 'absent' | 'late' | 'on_leave';
  checkIn: string;
  checkOut: string;
  overtime: string;
}

export const AttendancePage: React.FC = () => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  // LOCAL today (toISOString() is UTC — after 21:00 local it flips to the
  // next day and the page opens on an empty date).
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = localToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [isOpen, setIsOpen] = useState(false);

  // Load the MONTH the selected date belongs to — records for other days stay
  // available when the user browses within the same month, and switching the
  // month re-fetches (the hook keys on month/year).
  const selectedMonth = Number(selectedDate.slice(5, 7)) || new Date().getMonth() + 1;
  const selectedYear = Number(selectedDate.slice(0, 4)) || new Date().getFullYear();

  const { employees } = useEmployees(companyId);
  const { records, isLoading, save } = useAttendance(companyId, selectedMonth, selectedYear);

  const filteredRecords = useMemo(
    () => records.filter((r) => String(r.date).slice(0, 10) === selectedDate),
    [records, selectedDate]
  );

  const presentCount = filteredRecords.filter((r) => r.status === 'present').length;
  const absentCount = filteredRecords.filter((r) => r.status === 'absent').length;
  const lateCount = filteredRecords.filter((r) => r.status === 'late').length;
  const totalHours = filteredRecords.reduce((sum, r) => {
    if (r.checkIn && r.checkOut) {
      const [inH, inM] = r.checkIn.split(':').map(Number);
      const [outH, outM] = r.checkOut.split(':').map(Number);
      return sum + (outH + outM / 60) - (inH + inM / 60);
    }
    return sum;
  }, 0);

  const [formRecords, setFormRecords] = useState<Record<string, DailyFormRecord>>({});

  const openModal = () => {
    const existing: Record<string, DailyFormRecord> = {};
    filteredRecords.forEach((r) => {
      existing[r.employeeId] = {
        employeeId: r.employeeId,
        employeeName: r.employeeName || r.employeeId,
        status: r.status,
        checkIn: r.checkIn || '08:00',
        checkOut: r.checkOut || '17:00',
        overtime: String(r.overtimeHours || 0),
      };
    });
    employees.forEach((emp) => {
      if (!existing[emp.id]) {
        existing[emp.id] = {
          employeeId: emp.id,
          employeeName: emp.fullName,
          status: 'present',
          checkIn: '08:00',
          checkOut: '17:00',
          overtime: '0',
        };
      }
    });
    setFormRecords(existing);
    setIsOpen(true);
  };

  const handleSave = async () => {
    // Late status + overtime are DERIVED server-side from company policy —
    // the client only sends the raw check-in/out times and the manual
    // overtime override (kept only when > 0).
    const payload: Omit<AttendanceRecord, 'id'>[] = Object.values(formRecords).map((rec) => ({
      companyId,
      employeeId: rec.employeeId,
      date: selectedDate,
      checkIn: rec.checkIn,
      checkOut: rec.checkOut,
      overtimeHours: Number(rec.overtime) || 0,
      status: rec.status,
      notes: undefined,
    }));
    const res = await save(payload);
    if (res.success) {
      addToast('success', t('hr.attendancePage.created'));
      setIsOpen(false);
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };

  const updateRecord = (employeeId: string, field: keyof DailyFormRecord, value: string) => {
    setFormRecords((prev) => ({ ...prev, [employeeId]: { ...prev[employeeId], [field]: value } }));
  };

  const handleExportExcel = () => {
    try {
      exportToExcel(
        filteredRecords.map((r) => ({ ...r, employeeName: r.employeeName || r.employeeId })),
        [
          { key: 'employeeName', header: t('hr.attendancePage.table.employee') },
          { key: 'date', header: t('hr.attendancePage.table.date') },
          { key: 'checkIn', header: t('hr.attendancePage.table.checkIn') },
          { key: 'checkOut', header: t('hr.attendancePage.table.checkOut') },
          { key: 'overtimeHours', header: t('hr.attendancePage.table.overtime') },
          { key: 'status', header: t('hr.attendancePage.table.status') },
        ],
        `attendance-${selectedDate}`
      );
    } catch (_err) {
      addToast('error', t('hr.attendancePage.exportError') || 'فشل تصدير الحضور');
    }
  };

  const handleExportPDF = () => {
    try {
      exportToPDF(
        filteredRecords.map((r) => ({ ...r, employeeName: r.employeeName || r.employeeId, status: statusLabel(r.status, t) })),
        [
          { key: 'employeeName', header: t('hr.attendancePage.table.employee') },
          { key: 'date', header: t('hr.attendancePage.table.date') },
          { key: 'checkIn', header: t('hr.attendancePage.table.checkIn') },
          { key: 'checkOut', header: t('hr.attendancePage.table.checkOut') },
          { key: 'overtimeHours', header: t('hr.attendancePage.table.overtime') },
          { key: 'status', header: t('hr.attendancePage.table.status') },
        ],
        `attendance-${selectedDate}`,
        { title: t('hr.attendancePage.exportTitle'), subtitle: t('hr.attendancePage.exportDatePrefix') + ' ' + selectedDate, rtl: true }
      );
    } catch (_err) {
      addToast('error', t('hr.attendancePage.exportError') || 'فشل تصدير الحضور');
    }
  };

  const columns = [
    { key: 'employeeName', header: t('hr.attendancePage.table.employee'), render: (row: AttendanceRecord) => row.employeeName || row.employeeId },
    { key: 'date', header: t('hr.attendancePage.table.date'), width: '120px' },
    { key: 'checkIn', header: t('hr.attendancePage.table.checkIn'), width: '100px' },
    { key: 'checkOut', header: t('hr.attendancePage.table.checkOut'), width: '100px' },
    { key: 'overtimeHours', header: t('hr.attendancePage.table.overtime'), width: '100px' },
    { key: 'status', header: t('hr.attendancePage.table.status'), width: '100px', render: (row: AttendanceRecord) => (
      <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[row.status]}`}>{statusLabel(row.status, t)}</span>
    )},
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 shadow-xl shadow-emerald-900/10 dark:shadow-emerald-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-emerald-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('hr.attendancePage.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('hr.attendancePage.title')}</h2>
              <p className="text-emerald-100/80 text-base max-w-lg">{t('hr.attendancePage.subtitle')}</p>
            </div>
            <Can action="create" module="hr">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openModal} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('hr.attendancePage.title')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('hr.attendancePage.present'), value: String(presentCount), icon: UserCheck, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
          { label: t('hr.attendancePage.absent'), value: String(absentCount), icon: Layers, color: 'from-rose-600 to-rose-700', bg: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/10 dark:to-rose-800/5' },
          { label: t('hr.attendancePage.late'), value: String(lateCount), icon: Clock, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('hr.attendancePage.totalHours'), value: String(Math.round(totalHours)), icon: CalendarDays, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
        ].map((k) => (
          <Card key={k.label} className="p-0 overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${k.color}`} />
            <div className={`p-4 ${k.bg}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight truncate">{k.label}</p>
                  <p className="text-xl md:text-2xl font-extrabold tabular-nums leading-tight mt-1 truncate">{k.value}</p>
                </div>
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 shrink-0">
                  <k.icon size={18} className="text-slate-600 dark:text-slate-300" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-emerald-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-44" aria-label={t('hr.attendancePage.table.date')} />
          <div className="flex items-center gap-2 mr-auto">
            <Button variant="ghost" onClick={handleExportExcel} title={t('settings.common.export')}><Download size={16} className="text-emerald-600" /></Button>
            <Button variant="ghost" onClick={handleExportPDF} title={t('settings.common.print')}><Printer size={16} className="text-rose-600" /></Button>
          </div>
        </div>
      </Card>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-8">
            <EmptyState icon="file" title={t('hr.attendancePage.emptyTitle')} description={t('hr.attendancePage.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openModal}>{t('hr.attendancePage.title')}</Button></Can>} />
          </div>
        ) : (
          <Table<AttendanceRecord>
            data={filteredRecords}
            columns={columns}
            keyExtractor={(row) => row.id}
            emptyMessage={t('hr.attendancePage.emptyMessage')}
          />
        )}
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">{t('hr.attendancePage.autoDeriveHint')}</p>
        </div>
      </Card>

      {isOpen && (
        <Modal isOpen={isOpen} title={t('hr.attendancePage.title') + ' - ' + selectedDate} onClose={() => setIsOpen(false)} size="4xl">
          <div className="space-y-4">
            <div className="flex gap-2 items-center justify-between flex-wrap">
              <div className="flex gap-2 items-center">
                <span className="text-sm text-slate-500">{t('hr.attendancePage.recordingDate')}</span>
                <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-40" />
              </div>
              <span className="text-[11px] text-slate-400">{t('hr.attendancePage.autoDeriveHint')}</span>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="max-h-[58vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">{t('hr.attendancePage.table.employee')}</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 w-36">{t('hr.attendancePage.table.status')}</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 w-32">{t('hr.attendancePage.table.checkIn')}</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 w-32">{t('hr.attendancePage.table.checkOut')}</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-300 w-28">{t('hr.attendancePage.table.overtimeShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(formRecords).map((rec) => (
                      <tr key={rec.employeeId} className={`border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${rowTone[rec.status]}`}>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{rec.employeeName}</td>
                        <td className="px-3 py-2">
                          <select
                            value={rec.status}
                            onChange={(e) => updateRecord(rec.employeeId, 'status', e.target.value)}
                            aria-label={t('hr.attendancePage.table.status')}
                            title={t('hr.attendancePage.table.status')}
                            className="border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 text-sm w-full"
                          >
                            <option value="present">{t('hr.attendancePage.status.present')}</option>
                            <option value="absent">{t('hr.attendancePage.status.absent')}</option>
                            <option value="late">{t('hr.attendancePage.status.late')}</option>
                            <option value="on_leave">{t('hr.attendancePage.status.onLeave')}</option>
                          </select>
                        </td>
                        <td className="px-3 py-2"><Input type="time" value={rec.checkIn} onChange={(e) => updateRecord(rec.employeeId, 'checkIn', e.target.value)} className="w-full" /></td>
                        <td className="px-3 py-2"><Input type="time" value={rec.checkOut} onChange={(e) => updateRecord(rec.employeeId, 'checkOut', e.target.value)} className="w-full" /></td>
                        <td className="px-3 py-2"><Input type="number" value={rec.overtime} onChange={(e) => updateRecord(rec.employeeId, 'overtime', e.target.value)} className="w-full" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 text-xs">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{t('hr.attendancePage.status.present')}: {Object.values(formRecords).filter((r) => r.status === 'present').length}</span>
                  <span className="text-rose-700 dark:text-rose-400 font-semibold">{t('hr.attendancePage.status.absent')}: {Object.values(formRecords).filter((r) => r.status === 'absent').length}</span>
                  <span className="text-amber-700 dark:text-amber-400 font-semibold">{t('hr.attendancePage.status.late')}: {Object.values(formRecords).filter((r) => r.status === 'late').length}</span>
                  <span className="text-blue-700 dark:text-blue-400 font-semibold">{t('hr.attendancePage.status.onLeave')}: {Object.values(formRecords).filter((r) => r.status === 'on_leave').length}</span>
                </div>
                <span className="text-slate-500 dark:text-slate-400">{Object.keys(formRecords).length} {t('hr.employeesPage.title')}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('settings.common.cancel')}</Button>
              <Button onClick={handleSave} leftIcon={<CheckSquare size={16} />}>{t('hr.attendancePage.saveRegistration')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const rowTone: Record<string, string> = {
  present: '',
  absent: 'bg-rose-50/60 dark:bg-rose-900/10',
  late: 'bg-amber-50/60 dark:bg-amber-900/10',
  on_leave: 'bg-blue-50/60 dark:bg-blue-900/10',
};

const statusLabel = (status: string, t: (key: string) => string) => {
  const labels: Record<string, string> = { present: t('hr.attendancePage.status.present'), absent: t('hr.attendancePage.status.absent'), late: t('hr.attendancePage.status.late'), on_leave: t('hr.attendancePage.status.onLeave') };
  return labels[status] || status;
};

const statusColors: Record<string, string> = {
  present: 'bg-emerald-100 text-emerald-700',
  absent: 'bg-rose-100 text-rose-700',
  late: 'bg-amber-100 text-amber-700',
  on_leave: 'bg-blue-100 text-blue-700',
};

export default AttendancePage;
