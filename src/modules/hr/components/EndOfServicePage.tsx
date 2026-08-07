import React, { useState, useMemo } from 'react';
import { LogOut, Plus, Printer, Calculator, Download } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useAppStore } from '@/core/store';
import { useEndOfServicesPaginated, useEmployees } from '../hooks/useHr';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { EndOfService } from '../types';

export const EndOfServicePage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [statusFilter, setStatusFilter] = useState<string>('');
  const eosFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { items, total, page, pageSize, isLoading, goToPage, changePageSize, create, updateStatus, remove } = useEndOfServicesPaginated(companyId, eosFilters);
  const { employees } = useEmployees(companyId);
  const { formatCurrency } = useFormatters(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<EndOfService | null>(null);
  const [formData, setFormData] = useState({
    employeeId: '', terminationDate: '', reason: 'resignation' as EndOfService['reason'], notes: '',
  });

  const resetForm = () => {
    setFormData({ employeeId: '', terminationDate: '', reason: 'resignation', notes: '' });
  };

  const selectedEmployee = useMemo(() => employees.find((e) => e.id === formData.employeeId), [employees, formData.employeeId]);

  const serviceYears = useMemo(() => {
    if (!selectedEmployee || !formData.terminationDate || !selectedEmployee.hireDate) return 0;
    const start = new Date(selectedEmployee.hireDate);
    const end = new Date(formData.terminationDate);
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)));
  }, [selectedEmployee, formData.terminationDate]);

  const lastSalary = selectedEmployee?.baseSalary || 0;

  const eosAmount = useMemo(() => {
    // Simplified EOS formula: (lastSalary / 2) * serviceYears for first 5 years, full salary per year after
    if (serviceYears <= 0 || lastSalary <= 0) return 0;
    const firstFive = Math.min(serviceYears, 5);
    const afterFive = Math.max(0, serviceYears - 5);
    return Math.round((lastSalary / 2) * firstFive + lastSalary * afterFive);
  }, [serviceYears, lastSalary]);

  const handleSave = async () => {
    if (!formData.employeeId || !formData.terminationDate) {
      addToast('error', t('hr.eos.requiredFields') || t('common.error'));
      return;
    }
    if (selectedEmployee?.hireDate && new Date(formData.terminationDate) < new Date(selectedEmployee.hireDate)) {
      addToast('error', t('hr.eos.invalidDates') || t('common.error'));
      return;
    }
    if (serviceYears <= 0) {
      addToast('error', t('hr.eos.invalidServiceYears') || t('common.error'));
      return;
    }
    const res = await create({
      companyId,
      employeeId: formData.employeeId,
      terminationDate: formData.terminationDate,
      serviceYears,
      lastSalary,
      eosAmount,
      reason: formData.reason,
      status: 'draft',
      notes: formData.notes || undefined,
    });
    if (res.success) {
      addToast('success', t('hr.eos.created'));
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
      addToast('success', t('hr.eos.deleted'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handlePrint = (item: EndOfService) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const html = generateEosPrintHtml(item, formatCurrency, t);
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleExportExcel = () => {
    try {
      exportToExcel(
        items.map((i) => ({ ...i, employeeName: i.employeeName || i.employeeId })),
        [
          { key: 'employeeName', header: t('hr.eos.employee') },
          { key: 'terminationDate', header: t('hr.eos.terminationDate') },
          { key: 'serviceYears', header: t('hr.eos.serviceYears') },
          { key: 'lastSalary', header: t('hr.eos.lastSalary') },
          { key: 'eosAmount', header: t('hr.eos.eosAmount') },
          { key: 'status', header: t('hr.eos.status') },
        ],
        `end-of-service-${new Date().toISOString().split('T')[0]}`
      );
    } catch (_err) {
      addToast('error', t('hr.eos.reportError') || 'فشل تصدير التقرير');
    }
  };

  const handleExportPDF = () => {
    try {
      exportToPDF(
        items.map((i) => ({ ...i, employeeName: i.employeeName || i.employeeId })),
        [
          { key: 'employeeName', header: t('hr.eos.employee') },
          { key: 'terminationDate', header: t('hr.eos.terminationDate') },
          { key: 'serviceYears', header: t('hr.eos.serviceYears') },
          { key: 'lastSalary', header: t('hr.eos.lastSalary') },
          { key: 'eosAmount', header: t('hr.eos.eosAmount') },
          { key: 'status', header: t('hr.eos.status') },
        ],
        `end-of-service-${new Date().toISOString().split('T')[0]}`,
        { title: t('hr.eos.reportTitle'), subtitle: t('hr.eos.allRecords'), rtl: true }
      );
    } catch (_err) {
      addToast('error', t('hr.eos.reportError') || 'فشل تصدير التقرير');
    }
  };

  const columns = [
    { key: 'employeeName', header: t('hr.eos.employee'), render: (row: EndOfService) => row.employeeName || row.employeeId },
    { key: 'terminationDate', header: t('hr.eos.terminationDate'), width: '140px' },
    { key: 'serviceYears', header: t('hr.eos.serviceYears'), width: '110px' },
    { key: 'lastSalary', header: t('hr.eos.lastSalary'), align: 'right' as const, render: (row: EndOfService) => formatCurrency(row.lastSalary) },
    { key: 'eosAmount', header: t('hr.eos.eosAmount'), align: 'right' as const, render: (row: EndOfService) => <span className="font-bold text-primary-600">{formatCurrency(row.eosAmount)}</span> },
    { key: 'status', header: t('hr.eos.status'), width: '100px', render: (row: EndOfService) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '140px', render: (row: EndOfService) => (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="text-slate-600" onClick={() => setSelectedItem(row)} title={t('hr.eos.view')}>
          <Calculator size={16} />
        </Button>
        <Button variant="ghost" size="sm" className="text-slate-600" onClick={() => handlePrint(row)} title={t('settings.common.print')}>
          <Printer size={16} />
        </Button>
          {row.status === 'draft' && (
          <Button variant="ghost" size="sm" className="text-emerald-600" onClick={async () => {
            const res = await updateStatus(row.id, 'approved');
            if (res.success) addToast('success', t('hr.eos.updated'));
            else addToast('error', res.error || t('common.error'));
          }} title={t('hr.eos.approve')}>
            <span className="text-xs">{t('hr.eos.approve')}</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)} title={t('settings.common.delete')}>
          <LogOut size={16} />
        </Button>
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LogOut size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('hr.eos.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('hr.eos.subtitle')}</p>
          </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-control w-auto"
          title={t('hr.eos.status')}
        >
          <option value="">{t('settings.common.all')}</option>
          <option value="draft">{t('hr.eos.draft')}</option>
          <option value="approved">{t('hr.eos.approved')}</option>
        </select>
        <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportExcel}>Excel</Button>
        <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportPDF}>PDF</Button>
        <Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>{t('hr.eos.newCalculation')}</Button></Can>
      </div>
    </div>

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-slate-500">{t('settings.common.loading')}</div>
        ) : items.length === 0 ? (
          <EmptyState icon="file" title={t('hr.eos.emptyTitle')} description={t('hr.eos.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>{t('hr.eos.newCalculation')}</Button></Can>} />
        ) : (
          <>
            <Table<EndOfService>
              data={items}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('hr.eos.emptyMessage')}
            />
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
          </>
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={t('hr.eos.createTitle')}
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
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.eos.employee')}</label>
            <select value={formData.employeeId} onChange={(e) => setFormData((prev) => ({ ...prev, employeeId: e.target.value }))} className="form-control">
              <option value="">{t('hr.eos.selectEmployee')}</option>
              {employees.map((emp) => (<option key={emp.id} value={emp.id}>{emp.fullName}</option>))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.eos.terminationDateLabel')} type="date" value={formData.terminationDate} onChange={(e) => setFormData((prev) => ({ ...prev, terminationDate: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.eos.reason')}</label>
              <select value={formData.reason} onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value as EndOfService['reason'] }))} className="form-control">
                <option value="resignation">{t('hr.eos.resignation')}</option>
                <option value="termination">{t('hr.eos.termination')}</option>
                <option value="contract_end">{t('hr.eos.contractEnd')}</option>
                <option value="retirement">{t('hr.eos.retirement')}</option>
              </select>
            </div>
          </div>
          {selectedEmployee && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.hireDate')}</span><span className="font-medium">{selectedEmployee.hireDate || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.lastSalaryLabel')}</span><span className="font-medium">{formatCurrency(lastSalary)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.serviceYearsLabel')}</span><span className="font-medium">{serviceYears.toFixed(1)}</span></div>
              <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2">
                <span className="text-slate-500 font-bold">{t('hr.eos.eosAmountLabel')}</span>
                <span className="font-bold text-primary-600 text-lg">{formatCurrency(eosAmount)} YER</span>
              </div>
            </div>
          )}
          <Input label={t('hr.eos.notes')} value={formData.notes} onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))} />
        </div>
      </Modal>

      {/* View Modal */}
      {selectedItem && (
        <Modal
          isOpen={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          title={t('hr.eos.detailTitle')}
          size="md"
          footer={<Button variant="secondary" onClick={() => setSelectedItem(null)}>{t('settings.common.close')}</Button>}
        >
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.employeeLabel')}</span><span className="font-medium">{selectedItem.employeeName || selectedItem.employeeId}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.terminationDateDetailLabel')}</span><span className="font-medium">{selectedItem.terminationDate}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.serviceYearsDetailLabel')}</span><span className="font-medium">{selectedItem.serviceYears}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.lastSalaryDetailLabel')}</span><span className="font-medium">{formatCurrency(selectedItem.lastSalary)}</span></div>
            <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2">
              <span className="text-slate-500 font-bold">{t('hr.eos.amountLabel')}</span>
              <span className="font-bold text-primary-600 text-lg">{formatCurrency(selectedItem.eosAmount)} YER</span>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('hr.eos.deleteTitle')}
        message={t('hr.eos.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

function generateEosPrintHtml(item: EndOfService, formatCurrency: (value: number | string) => string, t: (key: string) => string): string {
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('hr.eos.reportTitle')}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:210mm;margin:0 auto;background:white;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.1);border-radius:8px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0}.total{font-weight:700;color:#1e40af;font-size:18px;text-align:left;margin-top:12px}</style></head><body>
  <div class="page"><h2>${t('hr.eos.totalLabel')}</h2>
  <div class="row"><span>${t('hr.eos.employeeLabel')}</span><strong>${item.employeeName || item.employeeId}</strong></div>
  <div class="row"><span>${t('hr.eos.terminationDateDetailLabel')}</span><strong>${item.terminationDate}</strong></div>
  <div class="row"><span>${t('hr.eos.serviceYearsDetailLabel')}</span><strong>${item.serviceYears}</strong></div>
  <div class="row"><span>${t('hr.eos.lastSalaryDetailLabel')}</span><strong>${formatCurrency(item.lastSalary)}</strong></div>
  <div class="total">${t('hr.eos.totalLabel')} ${formatCurrency(item.eosAmount)} ${t('common.currencyYer')}</div>
   <div style="margin-top:32px;text-align:center;font-size:12px;color:#94a3b8">${t('common.printFooter')}</div>
  </div></body></html>`;
}

export default EndOfServicePage;
