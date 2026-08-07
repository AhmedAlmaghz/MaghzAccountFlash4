import React, { useState, useMemo } from 'react';
import { Calendar, Plus, CheckCircle, XCircle, Download, Printer } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useAppStore } from '@/core/store';
import { useLeavesPaginated, useEmployees } from '../hooks/useHr';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { DEFAULT_LOCALE } from '@/core/utils/locale';
import type { Leave } from '../types';

export const LeavesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [statusFilter, setStatusFilter] = useState<string>('');
  const leaveFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { leaves, total, page, pageSize, isLoading, goToPage, changePageSize, create, updateStatus, remove } = useLeavesPaginated(companyId, leaveFilters);
  const { employees } = useEmployees(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    employeeId: '', leaveType: 'annual' as Leave['leaveType'], startDate: '', endDate: '', days: '', reason: '',
  });

  const resetForm = () => {
    setFormData({ employeeId: '', leaveType: 'annual', startDate: '', endDate: '', days: '', reason: '' });
  };

  const handleSave = async () => {
    if (!formData.employeeId || !formData.startDate || !formData.endDate) {
      addToast('error', t('hr.leaves.requiredFields') || t('common.error'));
      return;
    }
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    if (end < start) {
      addToast('error', t('hr.leaves.invalidDates') || t('common.error'));
      return;
    }
    const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const res = await create({
      companyId,
      employeeId: formData.employeeId,
      leaveType: formData.leaveType,
      startDate: formData.startDate,
      endDate: formData.endDate,
      days: diffDays,
      status: 'pending',
      reason: formData.reason || undefined,
    });
    if (res.success) {
      addToast('success', t('hr.leaves.created'));
      setIsModalOpen(false);
      resetForm();
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res.success) {
      addToast('success', t('hr.leaves.deleted'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handleExportExcel = () => {
    try {
      exportToExcel(
        leaves.map((l) => ({ ...l, leaveType: leaveTypeLabel(l.leaveType, t) })),
        [
          { key: 'employeeName', header: t('hr.leaves.employee') },
          { key: 'leaveType', header: t('hr.leaves.leaveType') },
          { key: 'startDate', header: t('hr.leaves.from') },
          { key: 'endDate', header: t('hr.leaves.to') },
          { key: 'days', header: t('hr.leaves.days') },
          { key: 'status', header: t('hr.leaves.status') },
        ],
        `leaves-${new Date().toISOString().split('T')[0]}`
      );
    } catch (_err) {
      addToast('error', t('hr.leaves.exportError') || 'فشل تصدير الإجازات');
    }
  };

  const handleExportPDF = () => {
    try {
      exportToPDF(
        leaves.map((l) => ({ ...l, leaveType: leaveTypeLabel(l.leaveType, t) })),
        [
          { key: 'employeeName', header: t('hr.leaves.employee') },
          { key: 'leaveType', header: t('hr.leaves.leaveType') },
          { key: 'startDate', header: t('hr.leaves.from') },
          { key: 'endDate', header: t('hr.leaves.to') },
          { key: 'days', header: t('hr.leaves.days') },
          { key: 'status', header: t('hr.leaves.status') },
        ],
        `leaves-${new Date().toISOString().split('T')[0]}`,
        { title: t('hr.leaves.reportTitle'), subtitle: t('hr.leaves.allLeaves'), rtl: true }
      );
    } catch (_err) {
      addToast('error', t('hr.leaves.exportError') || 'فشل تصدير الإجازات');
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rows = leaves.map((l, i) => `
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
        <td style="padding:8px;border:1px solid #e2e8f0">${l.employeeName || l.employeeId}</td>
        <td style="padding:8px;border:1px solid #e2e8f0">${leaveTypeLabel(l.leaveType, t)}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.startDate}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.endDate}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.days}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.status === 'approved' ? t('hr.leaves.approved') : l.status === 'rejected' ? t('hr.leaves.rejected') : t('hr.leaves.pending')}</td>
      </tr>
    `).join('');
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('hr.leaves.reportTitle')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:210mm;margin:0 auto;background:white;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.1);border-radius:8px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th{background:#1e40af;color:white;padding:10px;border:1px solid #1e40af}td{border:1px solid #e2e8f0}</style></head><body>
    <div class="page"><h2>${t('hr.leaves.reportTitle')}</h2>
    <p><strong>${t('hr.leaves.reportDate')}:</strong> ${new Date().toLocaleDateString(DEFAULT_LOCALE)}</p>
    <p><strong>${t('hr.leaves.totalCount')}</strong> ${leaves.length}</p>
    <table><thead><tr><th>#</th><th>${t('hr.leaves.employee')}</th><th>${t('hr.leaves.leaveType')}</th><th>${t('hr.leaves.from')}</th><th>${t('hr.leaves.to')}</th><th>${t('hr.leaves.days')}</th><th>${t('hr.leaves.status')}</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin-top:32px;text-align:center;font-size:12px;color:#94a3b8">${t('common.printReportFooter')}</div>
    </div></body></html>`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const columns = [
    { key: 'employeeName', header: t('hr.leaves.employee'), render: (row: Leave) => row.employeeName || row.employeeId },
    { key: 'leaveType', header: t('hr.leaves.leaveType'), render: (row: Leave) => leaveTypeLabel(row.leaveType, t) },
    { key: 'startDate', header: t('hr.leaves.from'), width: '120px' },
    { key: 'endDate', header: t('hr.leaves.to'), width: '120px' },
    { key: 'days', header: t('hr.leaves.days'), width: '80px' },
    { key: 'status', header: t('hr.leaves.status'), width: '110px', render: (row: Leave) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '160px', render: (row: Leave) => (
      <div className="flex items-center gap-1">
        {row.status === 'pending' && (
          <>
            <Button variant="ghost" size="sm" className="text-emerald-600" onClick={async () => {
              const res = await updateStatus(row.id, 'approved');
              if (res.success) addToast('success', t('hr.leaves.updated'));
              else addToast('error', res.error || t('common.error'));
            }} title={t('hr.leaves.approve')}>
              <CheckCircle size={16} />
            </Button>
            <Button variant="ghost" size="sm" className="text-rose-600" onClick={async () => {
              const res = await updateStatus(row.id, 'rejected');
              if (res.success) addToast('success', t('hr.leaves.updated'));
              else addToast('error', res.error || t('common.error'));
            }} title={t('hr.leaves.reject')}>
              <XCircle size={16} />
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)} title={t('settings.common.delete')}>
          <XCircle size={16} />
        </Button>
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('hr.leaves.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('hr.leaves.subtitle')}</p>
          </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-control w-auto"
          title={t('hr.leaves.status')}
        >
          <option value="">{t('settings.common.all')}</option>
          <option value="pending">{t('hr.leaves.pending')}</option>
          <option value="approved">{t('hr.leaves.approved')}</option>
          <option value="rejected">{t('hr.leaves.rejected')}</option>
        </select>
        <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportExcel}>Excel</Button>
        <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportPDF}>PDF</Button>
        <Button variant="secondary" size="sm" leftIcon={<Printer size={16} />} onClick={handlePrint}>{t('settings.common.print')}</Button>
        <Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>{t('hr.leaves.request')}</Button></Can>
      </div>
    </div>

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-slate-500">{t('settings.common.loading')}</div>
        ) : leaves.length === 0 ? (
          <EmptyState icon="inbox" title={t('hr.leaves.emptyTitle')} description={t('hr.leaves.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>{t('hr.leaves.request')}</Button></Can>} />
        ) : (
          <>
            <Table<Leave>
              data={leaves}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('hr.leaves.emptyMessage')}
            />
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
          </>
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={t('hr.leaves.newRequest')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.leaves.employee')}</label>
            <select value={formData.employeeId} onChange={(e) => setFormData((prev) => ({ ...prev, employeeId: e.target.value }))} className="form-control">
              <option value="">{t('hr.leaves.selectEmployee')}</option>
              {employees.map((emp) => (<option key={emp.id} value={emp.id}>{emp.fullName}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.leaves.leaveType')}</label>
            <select value={formData.leaveType} onChange={(e) => setFormData((prev) => ({ ...prev, leaveType: e.target.value as Leave['leaveType'] }))} className="form-control">
              <option value="annual">{t('hr.leaves.annual')}</option>
              <option value="sick">{t('hr.leaves.sick')}</option>
              <option value="emergency">{t('hr.leaves.emergency')}</option>
              <option value="unpaid">{t('hr.leaves.unpaid')}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.leaves.fromDate')} type="date" value={formData.startDate} onChange={(e) => setFormData((prev) => ({ ...prev, startDate: e.target.value }))} />
            <Input label={t('hr.leaves.toDate')} type="date" value={formData.endDate} onChange={(e) => setFormData((prev) => ({ ...prev, endDate: e.target.value }))} />
          </div>
          <Input label={t('hr.leaves.reason')} value={formData.reason} onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('hr.leaves.deleteTitle')}
        message={t('hr.leaves.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

function leaveTypeLabel(type: Leave['leaveType'], t: (key: string) => string) {
  const labels: Record<string, string> = { annual: t('hr.leaves.annual'), sick: t('hr.leaves.sick'), emergency: t('hr.leaves.emergency'), unpaid: t('hr.leaves.unpaid') };
  return labels[type] || type;
}

export default LeavesPage;
