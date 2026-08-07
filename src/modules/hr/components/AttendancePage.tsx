import React, { useState, useMemo } from 'react';
import { UserCheck, Plus, CalendarDays, CheckSquare, Download, Printer } from 'lucide-react';
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

  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const now = new Date();
  const [isOpen, setIsOpen] = useState(false);

  const { employees } = useEmployees(companyId);
  const { records, isLoading, save } = useAttendance(companyId, now.getMonth() + 1, now.getFullYear());
  void now;

  const filteredRecords = useMemo(() => records.filter((r) => r.date === selectedDate), [records, selectedDate]);

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
    const payload: Omit<AttendanceRecord, 'id'>[] = Object.values(formRecords).map((rec) => {
      const checkInH = rec.checkIn ? Number(rec.checkIn.split(':')[0]) : 0;
      const checkOutH = rec.checkOut ? Number(rec.checkOut.split(':')[0]) : 0;
      let overtimeHours = Number(rec.overtime) || 0;
      if (!overtimeHours && rec.checkIn && rec.checkOut) {
        const diff = (checkOutH + Number(rec.checkOut.split(':')[1] || 0) / 60) - (checkInH + Number(rec.checkIn.split(':')[1] || 0) / 60) - 8;
        if (diff > 0) overtimeHours = Math.round(diff * 100) / 100;
      }
      return {
        companyId,
        employeeId: rec.employeeId,
        date: selectedDate,
        checkIn: rec.checkIn,
        checkOut: rec.checkOut,
        overtimeHours,
        status: rec.status,
        notes: undefined,
      };
    });
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCheck size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('hr.attendancePage.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('hr.attendancePage.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-40" />
          <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExportExcel}>{t('settings.common.export')}</Button>
          <Button variant="secondary" leftIcon={<Printer size={16} />} onClick={handleExportPDF}>{t('settings.common.print')}</Button>
          <Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openModal}>{t('hr.attendancePage.title')}</Button></Can>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label={t('hr.attendancePage.present')} value={String(presentCount)} color="bg-emerald-500" />
        <StatCard label={t('hr.attendancePage.absent')} value={String(absentCount)} color="bg-rose-500" />
        <StatCard label={t('hr.attendancePage.late')} value={String(lateCount)} color="bg-amber-500" />
        <StatCard label={t('hr.attendancePage.totalHours')} value={String(Math.round(totalHours))} color="bg-blue-500" />
      </div>

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-slate-500">{t('settings.common.loading')}</div>
        ) : filteredRecords.length === 0 ? (
          <EmptyState icon="file" title={t('hr.attendancePage.emptyTitle')} description={t('hr.attendancePage.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openModal}>{t('hr.attendancePage.title')}</Button></Can>} />
        ) : (
          <Table<AttendanceRecord>
            data={filteredRecords}
            columns={columns}
            keyExtractor={(row) => row.id}
            emptyMessage={t('hr.attendancePage.emptyMessage')}
          />
        )}
      </Card>

      {isOpen && (
        <Modal isOpen={isOpen} title={t('hr.attendancePage.title') + ' - ' + selectedDate} onClose={() => setIsOpen(false)} size="xl">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="flex gap-2 items-center">
              <span className="text-sm text-slate-500">{t('hr.attendancePage.recordingDate')}</span>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-40" />
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-right">{t('hr.attendancePage.table.employee')}</th>
                    <th className="px-3 py-2">{t('hr.attendancePage.table.status')}</th>
                    <th className="px-3 py-2">{t('hr.attendancePage.table.checkIn')}</th>
                    <th className="px-3 py-2">{t('hr.attendancePage.table.checkOut')}</th>
                    <th className="px-3 py-2">{t('hr.attendancePage.table.overtimeShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(formRecords).map((rec) => (
                    <tr key={rec.employeeId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2 font-medium">{rec.employeeName}</td>
                      <td className="px-3 py-2">
                        <select value={rec.status} onChange={(e) => updateRecord(rec.employeeId, 'status', e.target.value)} className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-sm">
                          <option value="present">{t('hr.attendancePage.status.present')}</option>
                          <option value="absent">{t('hr.attendancePage.status.absent')}</option>
                          <option value="late">{t('hr.attendancePage.status.late')}</option>
                        </select>
                      </td>
                      <td className="px-3 py-2"><Input type="time" value={rec.checkIn} onChange={(e) => updateRecord(rec.employeeId, 'checkIn', e.target.value)} className="w-28" /></td>
                      <td className="px-3 py-2"><Input type="time" value={rec.checkOut} onChange={(e) => updateRecord(rec.employeeId, 'checkOut', e.target.value)} className="w-28" /></td>
                      <td className="px-3 py-2"><Input type="number" value={rec.overtime} onChange={(e) => updateRecord(rec.employeeId, 'overtime', e.target.value)} className="w-20" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 ${color} rounded-lg flex items-center justify-center text-white`}>
        <CalendarDays size={24} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

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
