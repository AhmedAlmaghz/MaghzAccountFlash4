import React, { useState, useMemo, useCallback } from 'react';
import { Banknote, Plus, Calculator, Printer, FileText, CheckCircle2, Trash2, RefreshCw } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination, Can, PageHeader, StatsGrid } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { hrApi } from '../api';
import { usePayrollRunsPaginated } from '../hooks/useHr';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { ComputedPayroll } from '../payrollEngine';
import type { PayrollLine } from '../types';

/** Editable preview line — user only tweaks allowances/deductions overrides. */
interface PreviewLine {
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  allowances: number;
  deductions: number;
  overtime: number;
  netSalary: number;
}

export const PayrollPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [statusFilter, setStatusFilter] = useState<string>('');
  const payrollFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { payrolls, total, page, pageSize, isLoading, goToPage, changePageSize, create, post, removeDraft } = usePayrollRunsPaginated(companyId, payrollFilters);
  const { formatCurrency } = useFormatters(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<string | null>(null);
  const [confirmDeleteDraft, setConfirmDeleteDraft] = useState<string | null>(null);
  const [formData, setFormData] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [preview, setPreview] = useState<ComputedPayroll | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  /** Auto preview: the server computes every line from employee cards + components + attendance overtime. */
  const runPreview = useCallback(async (overrides?: Array<{ employeeId: string; extraAllowances: number; extraDeductions: number }>) => {
    if (!companyId) return;
    setIsPreviewLoading(true);
    try {
      const res = await hrApi.previewPayrollRun(companyId, formData.month, formData.year, overrides);
      if (res.success && res.data) {
        setPreview(res.data);
        setLines(res.data.lines.map((l) => ({
          employeeId: l.employeeId,
          employeeName: l.employeeName || '',
          baseSalary: l.baseSalary,
          allowances: l.allowances,
          deductions: l.deductions,
          overtime: l.overtime,
          netSalary: l.netSalary,
        })));
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setIsPreviewLoading(false);
    }
  }, [companyId, formData.month, formData.year, addToast, t]);

  const openModal = () => {
    setLines([]);
    setPreview(null);
    setIsModalOpen(true);
  };

  /** Recalculate: re-run the preview with overrides built from the current editable table. */
  const handleRecalculate = () => {
    void runPreview(lines.map((l) => ({
      employeeId: l.employeeId,
      extraAllowances: Number(l.allowances) || 0,
      extraDeductions: Number(l.deductions) || 0,
    })));
  };

  const updateLine = (index: number, field: 'allowances' | 'deductions', value: number) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const handleSave = async () => {
    if (!formData.month || formData.month < 1 || formData.month > 12) {
      addToast('error', t('hr.payroll.invalidMonth') || t('common.error'));
      return;
    }
    if (!formData.year || formData.year < 2000 || formData.year > 2100) {
      addToast('error', t('hr.payroll.invalidYear') || t('common.error'));
      return;
    }
    if (lines.length === 0) {
      addToast('error', t('hr.payroll.noEmployees') || t('common.error'));
      return;
    }
    // Lines carry ONLY the per-employee overrides — the server recomputes net from them.
    const res = await create({
      companyId,
      month: formData.month,
      year: formData.year,
      status: 'draft',
      lines: lines.map((l) => ({
        employeeId: l.employeeId,
        allowances: Number(l.allowances) || 0,
        deductions: Number(l.deductions) || 0,
      })),
    });
    if (res.success) {
      addToast('success', t('hr.payroll.created'));
      setIsModalOpen(false);
      setLines([]);
      setPreview(null);
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };

  const handlePost = async (id: string) => {
    const res = await post(id);
    if (res.success) {
      addToast('success', t('hr.payroll.postedWithEntry'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };

  const handleDeleteDraft = async () => {
    if (!confirmDeleteDraft) return;
    const res = await removeDraft(confirmDeleteDraft);
    if (res.success) {
      addToast('success', t('hr.payroll.deleteDraft'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
    setConfirmDeleteDraft(null);
  };

  const selectedPayrollData = selectedPayroll ? payrolls.find((p) => p.id === selectedPayroll) || null : null;

  const kpis = useMemo(() => ({
    drafts: payrolls.filter((p) => p.status === 'draft').length,
    posted: payrolls.filter((p) => p.status === 'posted').length,
    postedTotal: payrolls.filter((p) => p.status === 'posted').reduce((s, p) => s + Number(p.totalAmount || 0), 0),
  }), [payrolls]);

  const columns = [
    { key: 'runNumber', header: t('hr.payroll.runNumberLabel'), render: (row: { runNumber?: string }) => row.runNumber || '—' },
    { key: 'month', header: t('hr.payroll.month'), mobile: 'title' as const, render: (row: { month: number; year: number }) => `${row.month}/${row.year}` },
    { key: 'totalAmount', header: t('hr.payroll.total'), align: 'right' as const, render: (row: { totalAmount: number }) => formatCurrency(row.totalAmount) },
    { key: 'status', header: t('hr.payroll.status'), mobile: 'status' as const, render: (row: { status: string }) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', mobile: 'actions' as const, render: (row: { id: string; status: string }) => (
      <div className="flex items-center gap-1">
        <button onClick={() => setSelectedPayroll(row.id)} className="text-sm text-primary-600 hover:underline">{t('hr.payroll.viewDetails')}</button>
        {row.status === 'draft' && (
          <button onClick={() => handlePost(row.id)} className="text-sm text-emerald-600 hover:underline mr-2">{t('hr.payroll.post')}</button>
        )}
        {row.status === 'draft' && (
          <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDeleteDraft(row.id)} title={t('hr.payroll.deleteDraft')}>
            <Trash2 size={16} />
          </Button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<Banknote size={22} />}
        title={t('hr.payroll.title')}
        subtitle={t('hr.payroll.subtitle')}
        actions={
          <Can action="create" module="hr">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openModal} className="shadow-sm">{t('hr.payroll.newPayroll')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        items={[
          { label: t('settings.common.all'), value: String(total), icon: <FileText size={18} />, tone: 'primary' },
          { label: t('hr.payroll.draft'), value: String(kpis.drafts), icon: <Calculator size={18} />, tone: 'warning' },
          { label: t('hr.payroll.postedShort'), value: String(kpis.posted), icon: <CheckCircle2 size={18} />, tone: 'success' },
          { label: t('purchases.return.postedTotal'), value: formatCurrency(kpis.postedTotal), icon: <Banknote size={18} />, tone: 'info' },
        ]}
      />

      {/* Toolbar */}
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-violet-500/30">
        <span className="text-xs text-slate-500 font-medium">{t('hr.payroll.status')}:</span>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {[
            { v: '', l: t('settings.common.all') },
            { v: 'draft', l: t('hr.payroll.draft') },
            { v: 'posted', l: t('hr.payroll.postedShort') },
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setStatusFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-300'}`}
            >{o.l}</button>
          ))}
        </div>
      </Card>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : payrolls.length === 0 ? (
          <div className="py-8">
            <EmptyState icon="file" title={t('hr.payroll.emptyTitle')} description={t('hr.payroll.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openModal}>{t('hr.payroll.newPayroll')}</Button></Can>} />
          </div>
        ) : (
          <>
            <Table
              data={payrolls}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('hr.payroll.emptyMessage')}
            />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Detail Modal */}
      {selectedPayrollData && (
        <Modal
          isOpen={!!selectedPayrollData}
          onClose={() => setSelectedPayroll(null)}
          title={t('hr.payroll.detailTitle') + ' ' + selectedPayrollData.month + '/' + selectedPayrollData.year}
          size="lg"
          footer={
            <div className="flex items-center gap-2 justify-end w-full">
              <Button variant="secondary" onClick={() => setSelectedPayroll(null)}>{t('settings.common.close')}</Button>
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrintPayroll(selectedPayrollData, formatCurrency, t)}>{t('settings.common.print')}</Button>
            </div>
          }
        >
          <Table<PayrollLine>
            data={selectedPayrollData.lines}
            columns={[
              { key: 'employeeName', header: t('hr.payroll.employee') },
              { key: 'baseSalary', header: t('hr.payroll.baseSalary'), align: 'right' as const, render: (row) => formatCurrency(row.baseSalary) },
              { key: 'allowances', header: t('hr.payroll.allowances'), align: 'right' as const, render: (row) => formatCurrency(row.allowances) },
              { key: 'overtime', header: t('hr.payroll.overtime'), align: 'right' as const, render: (row) => formatCurrency(row.overtime) },
              { key: 'deductions', header: t('hr.payroll.deductions'), align: 'right' as const, render: (row) => formatCurrency(row.deductions) },
              { key: 'netSalary', header: t('hr.payroll.netSalary'), align: 'right' as const, render: (row) => <span className="font-bold">{formatCurrency(row.netSalary)}</span> },
            ]}
            keyExtractor={(row) => row.id}
          />
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-between">
            <span className="font-bold text-slate-700 dark:text-slate-200">{t('hr.payroll.grandTotal')}</span>
            <span className="font-bold text-primary-600 text-xl">{formatCurrency(selectedPayrollData.totalAmount)} YER</span>
          </div>
        </Modal>
      )}

      {/* Create Payroll Modal — server-driven preview */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('hr.payroll.createTitle')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" leftIcon={<Calculator size={16} />} onClick={handleSave} disabled={lines.length === 0}>{t('hr.payroll.calculateAndSave')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 items-end">
            <Input label={t('hr.payroll.month')} type="number" value={String(formData.month)} onChange={(e) => setFormData((prev) => ({ ...prev, month: Number(e.target.value) }))} />
            <Input label={t('hr.payroll.year')} type="number" value={String(formData.year)} onChange={(e) => setFormData((prev) => ({ ...prev, year: Number(e.target.value) }))} />
            <Button variant="primary" leftIcon={<RefreshCw size={16} />} onClick={() => void runPreview()} isLoading={isPreviewLoading} disabled={!formData.month || !formData.year}>
              {t('hr.payroll.autoPreview')}
            </Button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('hr.payroll.previewHint')}</p>

          {lines.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right">{t('hr.payroll.employee')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-28">{t('hr.payroll.baseSalary')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-24">{t('hr.payroll.allowancesShort')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-24">{t('hr.payroll.deductionsShort')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-24">{t('hr.payroll.overtimeShort')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-28">{t('hr.payroll.netSalary')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={line.employeeId} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="p-2 text-sm">{line.employeeName}</td>
                      <td className="p-2 text-sm tabular-nums text-right">{formatCurrency(line.baseSalary)}</td>
                      <td className="p-2"><Input type="number" value={String(line.allowances)} onBlur={handleRecalculate} onChange={(e) => updateLine(idx, 'allowances', Number(e.target.value))} /></td>
                      <td className="p-2"><Input type="number" value={String(line.deductions)} onBlur={handleRecalculate} onChange={(e) => updateLine(idx, 'deductions', Number(e.target.value))} /></td>
                      <td className="p-2 text-sm tabular-nums text-right">{formatCurrency(line.overtime)}</td>
                      <td className="p-2 text-sm font-bold text-primary-600 text-right">{formatCurrency(line.netSalary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview && lines.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800 p-3 text-center">
                <p className="text-[11px] font-semibold text-primary-700 dark:text-primary-300">{t('hr.payroll.grossTotal')}</p>
                <p className="font-bold text-primary-700 dark:text-primary-300 tabular-nums">{formatCurrency(preview.totalGross)}</p>
              </div>
              <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800 p-3 text-center">
                <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">{t('hr.payroll.deductionsTotal')}</p>
                <p className="font-bold text-rose-700 dark:text-rose-300 tabular-nums">{formatCurrency(preview.totalDeductions)}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 text-center">
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{t('hr.payroll.netTotal')}</p>
                <p className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrency(preview.totalNet)}</p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteDraft}
        onClose={() => setConfirmDeleteDraft(null)}
        onConfirm={handleDeleteDraft}
        title={t('hr.payroll.deleteDraft')}
        message={t('hr.payroll.deleteDraftConfirm')}
        variant="danger"
      />
    </div>
  );
};

function handlePrintPayroll(payroll: { month: number; year: number; totalAmount: number; lines: PayrollLine[] }, formatCurrency: (value: number | string) => string, t: (key: string) => string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  const rows = payroll.lines.map((l, i) => `
    <tr>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
      <td style="padding:8px;border:1px solid #e2e8f0">${l.employeeName}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency(l.baseSalary)}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency(l.allowances)}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency(l.deductions)}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency(l.overtime)}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;font-weight:700">${formatCurrency(l.netSalary)}</td>
    </tr>
  `).join('');
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('hr.payroll.printTitle')}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:210mm;margin:0 auto;background:white;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.1);border-radius:8px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th{background:#1e40af;color:white;padding:10px;border:1px solid #1e40af}td{border:1px solid #e2e8f0}.total{font-weight:700;color:#1e40af;font-size:18px;text-align:left;margin-top:12px}</style></head><body>
  <div class="page"><h2>${t('hr.payroll.printTitle')}</h2>
  <p><strong>${t('hr.payroll.printMonthYear')}</strong> ${payroll.month}/${payroll.year}</p>
  <table><thead><tr><th>#</th><th>${t('hr.payroll.employee')}</th><th>${t('hr.payroll.baseSalary')}</th><th>${t('hr.payroll.allowances')}</th><th>${t('hr.payroll.deductions')}</th><th>${t('hr.payroll.overtime')}</th><th>${t('hr.payroll.netSalary')}</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total">${t('hr.payroll.grandTotal')} ${formatCurrency(payroll.totalAmount)} ${t('common.currencyYer')}</div>
  <div style="margin-top:32px;text-align:center;font-size:12px;color:#94a3b8">${t('common.printFooter')}</div>
  </div></body></html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

export default PayrollPage;
