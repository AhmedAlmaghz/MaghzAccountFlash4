import React, { useState, useMemo, useEffect } from 'react';
import { LogOut, Plus, Printer, Calculator, Download, CheckCircle2, Wallet, Banknote } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination, Can, PageHeader, StatsGrid } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CashBoxSelect } from '@/core/ui/components/smart/fields/CashBoxSelect';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useAppStore } from '@/core/store';
import { hrApi } from '../api';
import { useEndOfServicesPaginated, useEmployees } from '../hooks/useHr';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { EndOfService } from '../types';

/** Server-computed EOS preview shape (mirrors ComputedEos). */
interface EosPreview {
  serviceYears: number;
  lastSalary: number;
  eosAmount: number;
  firstYearsAmount: number;
  beyondYearsAmount: number;
}

export const EndOfServicePage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [statusFilter, setStatusFilter] = useState<string>('');
  const eosFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { items, total, page, pageSize, isLoading, goToPage, changePageSize, create, updateStatus, pay, remove } = useEndOfServicesPaginated(companyId, eosFilters);
  const { employees } = useEmployees(companyId);
  const { formatCurrency } = useFormatters(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<EndOfService | null>(null);
  const [payTarget, setPayTarget] = useState<EndOfService | null>(null);
  const [payCashBoxId, setPayCashBoxId] = useState('');
  const [eosPreview, setEosPreview] = useState<EosPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [formData, setFormData] = useState({
    employeeId: '', terminationDate: '', reason: 'resignation' as EndOfService['reason'], notes: '',
  });

  const resetForm = () => {
    setFormData({ employeeId: '', terminationDate: '', reason: 'resignation', notes: '' });
    setEosPreview(null);
  };

  const selectedEmployee = useMemo(() => employees.find((e) => e.id === formData.employeeId), [employees, formData.employeeId]);

  // Debounced server-side EOS preview — the formula lives in the engine, not here.
  useEffect(() => {
    if (!formData.employeeId || !formData.terminationDate) {
      setEosPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const res = await hrApi.previewEndOfService(companyId, formData.employeeId, formData.terminationDate, formData.reason);
        if (!cancelled) {
          if (res.success && res.data) setEosPreview(res.data);
          else setEosPreview(null);
        }
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [companyId, formData.employeeId, formData.terminationDate, formData.reason]);

  const handleSave = async () => {
    if (!formData.employeeId || !formData.terminationDate) {
      addToast('error', t('hr.eos.requiredFields') || t('common.error'));
      return;
    }
    // Server computes serviceYears/lastSalary/eosAmount — the client sends ONLY inputs.
    const res = await create({
      companyId,
      employeeId: formData.employeeId,
      terminationDate: formData.terminationDate,
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

  const handlePay = async () => {
    if (!payTarget || !payCashBoxId) return;
    const res = await pay(payTarget.id, payCashBoxId);
    if (res.success) {
      addToast('success', t('hr.eos.paidSuccess'));
      setPayTarget(null);
      setPayCashBoxId('');
    } else {
      addToast('error', res.error || t('common.error'));
    }
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
    { key: 'employeeName', header: t('hr.eos.employee'), mobile: 'title' as const, render: (row: EndOfService) => row.employeeName || row.employeeId },
    { key: 'terminationDate', header: t('hr.eos.terminationDate'), width: '140px', mobile: 'subtitle' as const },
    { key: 'serviceYears', header: t('hr.eos.serviceYears'), width: '110px' },
    { key: 'lastSalary', header: t('hr.eos.lastSalary'), align: 'right' as const, render: (row: EndOfService) => formatCurrency(row.lastSalary) },
    { key: 'eosAmount', header: t('hr.eos.eosAmount'), align: 'right' as const, render: (row: EndOfService) => <span className="font-bold text-primary-600">{formatCurrency(row.eosAmount)}</span> },
    { key: 'status', header: t('hr.eos.status'), width: '100px', mobile: 'status' as const, render: (row: EndOfService) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '180px', mobile: 'actions' as const, render: (row: EndOfService) => (
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
          }} title={t('hr.eos.approveHint')}>
            <span className="text-xs">{t('hr.eos.approve')}</span>
          </Button>
        )}
        {row.status === 'approved' && (
          <Button variant="ghost" size="sm" className="text-primary-600" onClick={() => { setPayTarget(row); setPayCashBoxId(''); }} title={t('hr.eos.payAction')}>
            <Banknote size={16} />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)} title={t('settings.common.delete')}>
          <LogOut size={16} />
        </Button>
      </div>
    )},
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<LogOut size={22} />}
        title={t('hr.eos.title')}
        subtitle={t('hr.eos.subtitle')}
        actions={
          <Can action="create" module="hr">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)} className="shadow-sm">{t('hr.eos.newCalculation')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        items={[
          { label: t('settings.common.all'), value: String(total), icon: <LogOut size={18} />, tone: 'primary' },
          { label: t('hr.eos.draft'), value: String(items.filter((i) => i.status === 'draft').length), icon: <Calculator size={18} />, tone: 'warning' },
          { label: t('hr.eos.approved'), value: String(items.filter((i) => i.status === 'approved').length), icon: <CheckCircle2 size={18} />, tone: 'success' },
          { label: t('hr.eos.totalAmount') || 'إجمالي المستحقات', value: formatCurrency(items.reduce((s, i) => s + Number(i.eosAmount || 0), 0)), icon: <Wallet size={18} />, tone: 'info' },
        ]}
      />

      {/* Toolbar */}
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-orange-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div>
            <span className="text-xs text-slate-500 font-medium">{t('hr.eos.status')}:</span>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {[
                { v: '', l: t('settings.common.all') },
                { v: 'draft', l: t('hr.eos.draft') },
                { v: 'approved', l: t('hr.eos.approved') },
              ].map((o) => (
                <button
                  key={o.v || 'all'}
                  onClick={() => setStatusFilter(o.v)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-orange-600 text-white border-orange-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-orange-300'}`}
                >{o.l}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 mr-auto">
            <Button variant="ghost" onClick={handleExportExcel} title="Excel"><Download size={16} className="text-emerald-600" /></Button>
            <Button variant="ghost" onClick={handleExportPDF} title="PDF"><Download size={16} className="text-rose-600" /></Button>
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
        ) : items.length === 0 ? (
          <div className="py-8">
            <EmptyState icon="file" title={t('hr.eos.emptyTitle')} description={t('hr.eos.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>{t('hr.eos.newCalculation')}</Button></Can>} />
          </div>
        ) : (
          <>
            <Table<EndOfService>
              data={items}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('hr.eos.emptyMessage')}
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
              {isPreviewLoading && <div className="h-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />}
              {eosPreview && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.lastSalaryLabel')}</span><span className="font-medium">{formatCurrency(eosPreview.lastSalary)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.serviceYearsLabel')}</span><span className="font-medium">{eosPreview.serviceYears.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.firstYearsPart')}</span><span className="font-medium tabular-nums">{formatCurrency(eosPreview.firstYearsAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('hr.eos.beyondYearsPart')}</span><span className="font-medium tabular-nums">{formatCurrency(eosPreview.beyondYearsAmount)}</span></div>
                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2">
                    <span className="text-slate-500 font-bold">{t('hr.eos.eosAmountLabel')}</span>
                    <span className="font-bold text-primary-600 text-lg">{formatCurrency(eosPreview.eosAmount)} YER</span>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{t('hr.eos.computedBySystem')}</p>
                </>
              )}
              {!isPreviewLoading && !eosPreview && formData.terminationDate && (
                <p className="text-xs text-amber-600">{t('hr.eos.invalidServiceYears') || t('common.error')}</p>
              )}
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

      {/* Pay Modal (approved rows only) */}
      {payTarget && (
        <Modal
          isOpen={!!payTarget}
          onClose={() => { setPayTarget(null); setPayCashBoxId(''); }}
          title={t('hr.eos.payTitle')}
          size="sm"
          footer={
            <div className="flex items-center gap-2 justify-end w-full">
              <Button variant="secondary" onClick={() => { setPayTarget(null); setPayCashBoxId(''); }}>{t('settings.common.cancel')}</Button>
              <Button variant="primary" leftIcon={<Banknote size={16} />} onClick={() => void handlePay()} disabled={!payCashBoxId}>{t('hr.eos.payAction')}</Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex justify-between text-sm border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="text-slate-500">{t('hr.eos.employeeLabel')}</span>
              <span className="font-medium">{payTarget.employeeName || payTarget.employeeId}</span>
            </div>
            <div className="flex justify-between text-sm border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="text-slate-500">{t('hr.eos.amountLabel')}</span>
              <span className="font-bold text-primary-600">{formatCurrency(payTarget.eosAmount)} YER</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.eos.cashBox')}</label>
              <CashBoxSelect companyId={companyId} value={payCashBoxId} onChange={(v) => setPayCashBoxId(v || '')} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">{t('hr.eos.payConfirm')}</p>
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
