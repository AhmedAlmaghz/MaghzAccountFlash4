import React, { useState, useMemo } from 'react';
import { Plus, CheckCircle, XCircle, CalendarDays, Download, Printer, Clock3 } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination, Can, PageHeader, StatsGrid } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useAppStore } from '@/core/store';
import { useLeavesPaginated, useEmployees, useLeaveBalances } from '../hooks/useHr';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { DEFAULT_LOCALE } from '@/core/utils/locale';
import type { Leave } from '../types';

export const LeavesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const user = useAuthStore((s) => s.user);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const leaveFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { leaves, total, page, pageSize, isLoading, goToPage, changePageSize, create, updateStatus, remove } = useLeavesPaginated(companyId, leaveFilters);
  const { employees } = useEmployees(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    employeeId: '', leaveType: 'annual' as Leave['leaveType'], startDate: '', endDate: '', reason: '',
  });

  /** Live leave balances for the employee selected in the create form. */
  const { balances, isLoading: balancesLoading } = useLeaveBalances(companyId, formData.employeeId);

  const resetForm = () => {
    setFormData({ employeeId: '', leaveType: 'annual', startDate: '', endDate: '', reason: '' });
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
    // days are computed SERVER-side — the client no longer derives them.
    const res = await create({
      companyId,
      employeeId: formData.employeeId,
      leaveType: formData.leaveType,
      startDate: formData.startDate,
      endDate: formData.endDate,
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

  const handleApprove = async (row: Leave) => {
    // approvedBy = current user id; the server enforces the balance strictly.
    const res = await updateStatus(row.id, 'approved', user?.id);
    if (res.success) addToast('success', t('hr.leaves.approveSuccess'));
    else addToast('error', res.error || t('hr.leaves.insufficient'));
  };

  const handleReject = async (row: Leave) => {
    const res = await updateStatus(row.id, 'rejected', user?.id);
    if (res.success) addToast('success', t('hr.leaves.updated'));
    else addToast('error', res.error || t('common.error'));
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
    { key: 'employeeName', header: t('hr.leaves.employee'), mobile: 'title' as const, render: (row: Leave) => row.employeeName || row.employeeId },
    { key: 'leaveType', header: t('hr.leaves.leaveType'), mobile: 'subtitle' as const, render: (row: Leave) => leaveTypeLabel(row.leaveType, t) },
    { key: 'startDate', header: t('hr.leaves.from'), width: '120px', mobile: 'hidden' as const },
    { key: 'endDate', header: t('hr.leaves.to'), width: '120px', mobile: 'hidden' as const },
    { key: 'days', header: t('hr.leaves.days'), width: '80px' },
    { key: 'status', header: t('hr.leaves.status'), width: '110px', mobile: 'status' as const, render: (row: Leave) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '160px', mobile: 'actions' as const, render: (row: Leave) => (
      <div className="flex items-center gap-1">
        {row.status === 'pending' && (
          <>
            <Button variant="ghost" size="sm" className="text-emerald-600" onClick={() => void handleApprove(row)} title={t('hr.leaves.approve')}>
              <CheckCircle size={16} />
            </Button>
            <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void handleReject(row)} title={t('hr.leaves.reject')}>
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
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<CalendarDays size={22} />}
        title={t('hr.leaves.title')}
        subtitle={t('hr.leaves.subtitle')}
        actions={
          <Can action="create" module="hr">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)} className="shadow-sm">{t('hr.leaves.request')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        items={[
          { label: t('hr.leaves.totalCount'), value: String(total), icon: <CalendarDays size={18} />, tone: 'primary' },
          { label: t('hr.leaves.pending'), value: String(leaves.filter((l) => l.status === 'pending').length), icon: <Clock3 size={18} />, tone: 'warning' },
          { label: t('hr.leaves.approved'), value: String(leaves.filter((l) => l.status === 'approved').length), icon: <CheckCircle size={18} />, tone: 'success' },
          { label: t('hr.leaves.rejected'), value: String(leaves.filter((l) => l.status === 'rejected').length), icon: <XCircle size={18} />, tone: 'danger' },
        ]}
      />

      {/* Toolbar */}
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-blue-500/30">
        <span className="text-xs text-slate-500 font-medium">{t('hr.leaves.status')}:</span>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {[
            { v: '', l: t('settings.common.all') },
            { v: 'pending', l: t('hr.leaves.pending') },
            { v: 'approved', l: t('hr.leaves.approved') },
            { v: 'rejected', l: t('hr.leaves.rejected') },
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setStatusFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
            >{o.l}</button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" onClick={handleExportExcel} title="Excel"><Download size={16} className="text-emerald-600" /></Button>
          <Button variant="ghost" onClick={handleExportPDF} title="PDF"><Download size={16} className="text-rose-600" /></Button>
          <Button variant="ghost" onClick={handlePrint} title={t('settings.common.print')}><Printer size={16} className="text-slate-600" /></Button>
        </div>
      </Card>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : leaves.length === 0 ? (
          <div className="py-8">
            <EmptyState icon="inbox" title={t('hr.leaves.emptyTitle')} description={t('hr.leaves.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>{t('hr.leaves.request')}</Button></Can>} />
          </div>
        ) : (
          <>
            <Table<Leave>
              data={leaves}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('hr.leaves.emptyMessage')}
            />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
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
          {formData.employeeId && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
              <p className="text-xs font-bold text-blue-700 dark:text-blue-300 mb-2">{t('hr.leaves.balanceTitle')}</p>
              {balancesLoading ? (
                <div className="h-8 bg-blue-100 dark:bg-blue-800/40 rounded animate-pulse" />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(['annual', 'sick', 'emergency', 'unpaid'] as const).map((type) => {
                    const b = balances.find((x) => x.leaveType === type);
                    const label = leaveBalanceLabel(type, t);
                    return (
                      <div key={type} className="bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
                        <span className={`text-xs font-bold tabular-nums ${b && !b.uncapped && b.remaining <= 0 ? 'text-rose-600' : 'text-blue-700 dark:text-blue-300'}`}>
                          {b && b.uncapped
                            ? `${t('hr.leaves.remaining')}: ${t('hr.leaves.uncapped')}`
                            : b
                              ? `${t('hr.leaves.remaining')} ${b.remaining} ${t('hr.leaves.entitled')} ${b.entitled}`
                              : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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

function leaveBalanceLabel(type: 'annual' | 'sick' | 'emergency' | 'unpaid', t: (key: string) => string) {
  const labels: Record<string, string> = {
    annual: t('hr.leaves.annualLabel'),
    sick: t('hr.leaves.sickLabel'),
    emergency: t('hr.leaves.emergencyLabel'),
    unpaid: t('hr.leaves.unpaidLabel'),
  };
  return labels[type] || type;
}

export default LeavesPage;
