import React, { useState, useMemo, useCallback } from 'react';
import { Tag, Plus, FileText, CheckSquare, Trash2, Printer, ArrowRightLeft } from 'lucide-react';
import { Card, Button, Table, Input, Modal, Pagination, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CustomerSelect, ProductSelect, CashBoxSelect, BankSelect } from '@/core/ui/components/smart';
import { useQuotationsPaginated } from '../hooks/useSales';
import { salesApi } from '../api';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useSettings } from '@/core/utils/useSettings';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import { printDocument } from '@/core/utils/printDocument';
import { exportToExcel } from '@/core/utils/exportEngine';
import { logAudit } from '@/core/utils/auditLogger';
import { useToastStore } from '@/core/store/toastStore';
import type { Quotation } from '../types';
import type { Product } from '@/modules/inventory/types';

interface QuotationLineForm {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

export const QuotationsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const STATUS_FLOW = useMemo(() => ({
    draft: t('sales.status.draft'),
    sent: t('sales.status.sent'),
    accepted: t('sales.status.accepted'),
    rejected: t('sales.status.rejected'),
    converted: t('sales.status.converted'),
  }), [t]);
  const activeCompany = useAppStore(state => state.activeCompany);
  const currentUser = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'sales');
  const {
    quotations,
    total,
    page,
    pageSize,
    isLoading,
    goToPage,
    changePageSize,
    create,
    update,
    remove,
    convertToInvoice,
  } = useQuotationsPaginated(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { defaultCashBoxId, defaultBankId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Quotation | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [header, setHeader] = useState({ customerId: '', date: new Date().toISOString().split('T')[0], expiryDate: '', paymentType: 'credit', cashBoxId: '', bankAccountId: '', notes: '' });
  const [lines, setLines] = useState<QuotationLineForm[]>([{ productId: '', productName: '', quantity: 1, unitPrice: 0, discountPercent: 0 }]);

  const defaultLine = (): QuotationLineForm => ({ productId: '', productName: '', quantity: 1, unitPrice: 0, discountPercent: 0 });

  const resetForm = useCallback(() => {
    setHeader({ customerId: '', date: new Date().toISOString().split('T')[0], expiryDate: '', paymentType: 'credit', cashBoxId: defaultCashBoxId || '', bankAccountId: '', notes: '' });
    setLines([defaultLine()]);
    setEditingId(null);
  }, [defaultCashBoxId]);

  const openCreate = useCallback(async () => {
    resetForm();
    setFormOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((q: Quotation) => {
    if (q.status === 'converted') return;
    setEditingId(q.id);
    setHeader({ customerId: q.customerId, date: q.date, expiryDate: q.expiryDate || '', paymentType: q.paymentType || 'credit', cashBoxId: q.cashBoxId || '', bankAccountId: q.bankAccountId || '', notes: q.notes || '' });
    setLines(q.lines.map(l => ({ productId: l.productId, productName: l.productName || l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent })));
    setFormOpen(true);
  }, []);

  const addLine = () => setLines(prev => [...prev, defaultLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof QuotationLineForm, value: string | number) => {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'productId' && typeof value === 'string') next[idx].productName = value;
      return next;
    });
  };

  const handleProductChange = useCallback((idx: number, product: Product) => {
    setLines(prev => {
      const next = [...prev];
      const current = next[idx];
      next[idx] = {
        ...current,
        productName: product.nameAr,
        unitPrice: current.unitPrice > 0 ? current.unitPrice : product.salePrice,
      };
      return next;
    });
  }, []);

  const calculations = useMemo(() => {
    const totalAmount = lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (1 - l.discountPercent / 100)), 0);
    return { totalAmount };
  }, [lines]);

  const buildPayload = (quotationNumber: string): Omit<Quotation, 'id'> => ({
    companyId: activeCompany!.id,
    quotationNumber,
    customerId: header.customerId,
    date: header.date,
    expiryDate: header.expiryDate || undefined,
    totalAmount: calculations.totalAmount,
    paymentType: header.paymentType || 'credit',
    cashBoxId: header.paymentType === 'cash' ? (header.cashBoxId || undefined) : undefined,
    bankAccountId: header.paymentType === 'cash' ? (header.bankAccountId || undefined) : undefined,
    status: 'draft',
    notes: header.notes,
    lines: lines.map(l => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      lineTotal: l.quantity * l.unitPrice * (1 - l.discountPercent / 100),
    })),
  });

  const handleSave = async () => {
    if (!header.customerId || lines.length === 0 || !activeCompany?.id) return;
    if (lines.some(l => !l.productId)) {
      addToast('error', t('sales.invoice.productRequired') || t('common.error'));
      return;
    }
    if (lines.some(l => l.quantity <= 0)) {
      addToast('error', t('sales.invoice.quantityPositive') || t('common.error'));
      return;
    }
    setSaving(true);
    let quotationNumber: string;
    if (editingId) {
      const existing = quotations.find(q => q.id === editingId);
      quotationNumber = existing?.quotationNumber || '';
      const res = await update(editingId, buildPayload(quotationNumber));
      if (res.success && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'quotations', recordId: editingId, companyId: activeCompany.id });
        addToast('success', t('sales.quotation.updated'));
      } else {
        addToast('error', res.error || t('error'));
      }
    } else {
      const seq = await getNextNumber('quotation', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('sales.quotation.numberError'));
        setSaving(false);
        return;
      }
      quotationNumber = seq.number;
      const res = await create(buildPayload(quotationNumber));
      if (res.success && res.id && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'create', tableName: 'quotations', recordId: res.id, companyId: activeCompany.id });
        addToast('success', t('sales.quotation.created'));
      } else {
        addToast('error', res.error || t('error'));
      }
    }
    setSaving(false);
    setFormOpen(false);
    resetForm();
  };

  const handleDelete = (q: Quotation) => {
    setConfirmConfig({
      title: t('sales.quotation.deleteTitle'),
      message: `${t('sales.quotation.deleteConfirm')} ${q.quotationNumber}؟`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(q.id);
        if (res.success && activeCompany?.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'delete', tableName: 'quotations', recordId: q.id, companyId: activeCompany.id });
          addToast('success', t('sales.quotation.deleted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handleConvertToInvoice = (q: Quotation) => {
    setConfirmConfig({
      title: t('sales.quotation.convertTitle'),
      message: `${t('sales.quotation.convertConfirm')}`,
      variant: 'warning',
      confirmText: t('sales.quotation.convert'),
      onConfirm: async () => {
        setConfirmOpen(false);
        if (!activeCompany?.id) return;
        const fullRes = await salesApi.getQuotationById(q.id, activeCompany.id);
        if (!fullRes.success || !fullRes.data || !fullRes.data.lines?.length) {
          addToast('error', fullRes.error || t('sales.quotation.noLines') || t('error'));
          return;
        }
        const fullQuotation = fullRes.data;
        const seq = await getNextNumber('sales_invoice', activeCompany.id);
        if (!seq.success || !seq.number) {
          addToast('error', seq.error || t('sales.invoice.numberError'));
          return;
        }
        const invoiceNumber = seq.number;
        const payload = {
          companyId: activeCompany.id,
          invoiceNumber,
          customerId: fullQuotation.customerId,
          date: new Date().toISOString().split('T')[0],
          dueDate: new Date().toISOString().split('T')[0],
          subtotal: fullQuotation.totalAmount,
          discountAmount: 0,
          vatAmount: 0,
          totalAmount: fullQuotation.totalAmount,
          paidAmount: 0,
          paymentType: fullQuotation.paymentType || 'credit',
          status: 'draft' as const,
          notes: `${t('sales.quotation.convertedNote')} ${fullQuotation.quotationNumber}`,
          lines: fullQuotation.lines.map(l => ({
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            vatPercent: 0,
            lineTotal: l.lineTotal,
          })),
        };
        const res = await convertToInvoice(q.id, payload);
        if (res.success && activeCompany.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'quotations', recordId: q.id, companyId: activeCompany.id, newValues: { status: 'converted' } });
          addToast('success', t('sales.quotation.converted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePrint = async (q: Quotation) => {
    let lines = q.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getQuotationById(q.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    printDocument({
      type: 'quotation',
      docNumber: q.quotationNumber,
      date: q.date,
      dueDate: q.expiryDate,
      partyName: q.customer?.name || q.customerId,
      partyLabel: t('sales.customer.title'),
      partyTaxNumber: q.customer?.taxNumber,
      partyAddress: q.customer?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.productId,
        productCode: l.productCode,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.lineTotal,
      })),
      subtotal: q.totalAmount,
      vatAmount: 0,
      totalAmount: q.totalAmount,
      notes: q.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: currencySymbol,
      paymentType: q.paymentType,
      createdBy: q.createdBy,
    });
  };

  const handleExportExcel = () => {
    const cols = [
      { key: 'quotationNumber', header: t('sales.quotation.number') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'expiryDate', header: t('sales.quotation.expiry') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToExcel(quotations.map(q => ({ quotationNumber: q.quotationNumber, customerName: q.customer?.name || q.customerId, date: q.date, expiryDate: q.expiryDate || '-', totalAmount: q.totalAmount, status: STATUS_FLOW[q.status] || q.status })), cols, `quotations_${new Date().toISOString().split('T')[0]}`);
  };

  const tableColumns = [
    { key: 'quotationNumber', header: t('sales.quotation.number'), width: '120px' },
    { key: 'customerName', header: t('sales.customer.title'), render: (row: Quotation) => row.customer?.name || row.customerId },
    { key: 'date', header: t('sales.date'), width: '110px' },
    { key: 'expiryDate', header: t('sales.quotation.expiry'), width: '110px', render: (row: Quotation) => row.expiryDate ? formatDate(row.expiryDate) : '-' },
    { key: 'totalAmount', header: t('sales.total'), align: 'right' as const, render: (row: Quotation) => formatCurrency(row.totalAmount) },
    { key: 'paymentType', header: t('sales.quotation.paymentType'), render: (row: Quotation) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        row.paymentType === 'cash'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      }`}>
        {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
      </span>
    ) },
    { key: 'status', header: t('sales.status.label'), render: (row: Quotation) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: t('sales.actions'), width: '220px', render: (row: Quotation) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getQuotationById(row.id, activeCompany.id);
              if (res.success && res.data) { setViewing(res.data); setDetailOpen(true); return; }
            }
            setViewing(row); setDetailOpen(true);
          }}
          onEdit={row.status !== 'converted' ? () => openEdit(row) : undefined}
          onDelete={row.status !== 'converted' ? () => handleDelete(row) : undefined}
          onPrint={() => handlePrint(row)}
          showView
          showEdit={row.status !== 'converted'}
          showDelete={row.status !== 'converted'}
          showPrint
        />
        {row.status === 'draft' && (
          <Button size="sm" variant="secondary" onClick={() => handleConvertToInvoice(row)} leftIcon={<ArrowRightLeft size={14} />}>
            {t('sales.quotation.convert')}
          </Button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tag size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('sales.quotations')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('sales.quotationsSubtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
          <Button size="sm" variant="ghost" onClick={handleExportExcel} title={t('export')}>
            <FileText size={16} className="text-emerald-600" />
          </Button>
          <Can action="create" module="sales">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('sales.quotation.create')}</Button>
          </Can>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}
          </div>
        ) : quotations.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={t('sales.quotation.emptyTitle')}
            description={t('sales.quotation.emptyDesc')}
            action={<Can action="create" module="sales"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('sales.quotation.create')}</Button></Can>}
          />
        ) : (
          <>
            <Table<Quotation> data={quotations} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={goToPage}
              onPageSizeChange={changePageSize}
            />
          </>
        )}
      </Card>

      {/* Form Modal */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} size="3xl" title={editingId ? (t('sales.quotation.edit')) : (t('sales.quotation.new'))}>
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.customer.title')}</label>
              <CustomerSelect companyId={activeCompany?.id || ''} value={header.customerId} onChange={v => setHeader(p => ({ ...p, customerId: v || '' }))} />
            </div>
            <Input label={t('sales.date')} type="date" value={header.date} onChange={e => setHeader(p => ({ ...p, date: e.target.value }))} />
            <Input label={t('sales.quotation.expiry')} type="date" value={header.expiryDate} onChange={e => setHeader(p => ({ ...p, expiryDate: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.quotation.paymentType')}</label>
              <select
                value={header.paymentType || 'credit'}
                onChange={e => {
                  const newType = e.target.value;
                  setHeader(p => ({
                    ...p,
                    paymentType: newType,
                    cashBoxId: newType === 'cash' ? (p.cashBoxId || defaultCashBoxId || '') : '',
                    bankAccountId: newType === 'cash' ? (p.bankAccountId || defaultBankId || '') : '',
                  }));
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                aria-label={t('sales.quotation.paymentType')}
              >
                <option value="credit">{t('sales.invoice.credit')}</option>
                <option value="cash">{t('sales.invoice.cash')}</option>
              </select>
            </div>
          </div>

          {header.paymentType === 'cash' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.cashBox')}</label>
                <CashBoxSelect companyId={activeCompany?.id || ''} value={header.cashBoxId || ''} onChange={v => setHeader(p => ({ ...p, cashBoxId: v || '' }))} />
                {defaultCashBoxId && header.cashBoxId === defaultCashBoxId && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.bankAccount')}</label>
                <BankSelect companyId={activeCompany?.id || ''} value={header.bankAccountId || ''} onChange={v => setHeader(p => ({ ...p, bankAccountId: v || '' }))} />
                {defaultBankId && header.bankAccountId === defaultBankId && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
                )}
              </div>
            </div>
          )}

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-sm">{t('sales.invoice.lines')}</h4>
              <Button size="sm" variant="secondary" onClick={addLine} leftIcon={<Plus size={14} />}>{t('sales.invoice.addLine')}</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-2 py-1 text-right">{t('inventory.productName')}</th>
                    <th className="px-2 py-1 text-right w-20">{t('inventory.quantity')}</th>
                    <th className="px-2 py-1 text-right w-24">{t('inventory.unitPrice')}</th>
                    <th className="px-2 py-1 text-right w-20">{t('sales.discount')}</th>
                    <th className="px-2 py-1 text-right w-24">{t('sales.total')}</th>
                    <th className="px-2 py-1 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const lineTotal = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
                    return (
                      <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1"><ProductSelect companyId={activeCompany?.id || ''} value={line.productId} onChange={v => updateLine(idx, 'productId', Array.isArray(v) ? (v[0] || '') : (v || ''))} onProductChange={(p) => handleProductChange(idx, p)} showBarcode showStock size="sm" module="sales" /></td>
                        <td className="px-2 py-1"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1"><Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, 'discountPercent', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1 text-slate-700 dark:text-slate-200 font-medium">{formatCurrency(lineTotal)}</td>
                        <td className="px-2 py-1"><Button size="sm" variant="ghost" onClick={() => removeLine(idx)} leftIcon={<Trash2 size={14} className="text-rose-500" />} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label={t('sales.notes')} value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))} />
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300 font-medium">{t('sales.total')}</span>
              <span className="text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(calculations.totalAmount)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <Button variant="secondary" onClick={() => { setFormOpen(false); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleSave} isLoading={saving} leftIcon={<CheckSquare size={16} />}>{editingId ? (t('save')) : (t('create'))}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} size="lg" title={`${t('sales.quotation.details')} - ${viewing?.quotationNumber}`}>
        {viewing && (
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.customer.title')}</p><p className="font-semibold">{viewing.customer?.name || viewing.customerId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.status.label')}</p><StatusBadge status={viewing.status} /></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.date')}</p><p className="font-semibold">{viewing.date}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.quotation.expiry')}</p><p className="font-semibold">{viewing.expiryDate || '-'}</p></div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><tr><th className="px-3 py-2 text-right">#</th><th className="px-3 py-2 text-right">{t('inventory.productName')}</th><th className="px-3 py-2 text-right">{t('inventory.quantity')}</th><th className="px-3 py-2 text-right">{t('inventory.unitPrice')}</th><th className="px-3 py-2 text-right">{t('sales.total')}</th></tr></thead>
                <tbody>
                  {(viewing.lines || []).map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.productName || l.productId}</td>
                      <td className="px-3 py-2">{l.quantity}</td>
                      <td className="px-3 py-2">{formatCurrency(l.unitPrice)}</td>
                      <td className="px-3 py-2 font-medium">{formatCurrency(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <p className="text-slate-700 dark:text-slate-200 font-medium">{t('sales.total')}</p>
              <p className="text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(viewing.totalAmount)}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailOpen(false)}>{t('close')}</Button>
              <Button variant="primary" onClick={() => handlePrint(viewing)} leftIcon={<Printer size={16} />}>{t('print')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { confirmConfig?.onConfirm(); }}
        title={confirmConfig?.title || ''}
        message={confirmConfig?.message || ''}
        variant={confirmConfig?.variant || 'warning'}
        confirmText={confirmConfig?.confirmText || (t('confirm'))}
        cancelText={t('cancel')}
      />
    </div>
  );
};

export default QuotationsPage;
