import React, { useState, useMemo, useCallback } from 'react';
import { Undo2, Plus, CheckSquare, Trash2, Printer, FileText, BookOpen, Wallet, Layers } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Input, Pagination, Can } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DataTablePro } from '@/core/ui/components/DataTablePro';
import { SupplierSelect, ProductSelect, CashBoxSelect, BankSelect } from '@/core/ui/components/smart';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseReturnsPaginated, usePurchaseInvoices } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { PurchaseReturn } from '../types';
import type { Product } from '@/modules/inventory/types';
import type { ColumnDef } from '@tanstack/react-table';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useSettings } from '@/core/utils/useSettings';

interface ReturnFormLine {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ReturnForm {
  supplierId: string;
  invoiceId: string;
  date: string;
  paymentType: string;
  cashBoxId: string;
  bankAccountId: string;
  reason: string;
  notes: string;
  lines: ReturnFormLine[];
}

const initialLine = (): ReturnFormLine => ({
  productId: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  lineTotal: 0,
});

const initialForm = (defaultCashBoxId?: string): ReturnForm => ({
  supplierId: '',
  invoiceId: '',
  date: new Date().toISOString().split('T')[0],
  paymentType: 'credit',
  cashBoxId: defaultCashBoxId || '',
  bankAccountId: '',
  reason: '',
  notes: '',
  lines: [initialLine()],
});

export const PurchaseReturnsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const { getNextNumber } = useDocumentSequence();
  const { defaultCashBoxId, defaultBankId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const { settings } = useSettings(activeCompany?.id || '');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const returnFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { returns, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove, post } = usePurchaseReturnsPaginated(activeCompany?.id || '', returnFilters);
  const { invoices } = usePurchaseInvoices(activeCompany?.id || '');
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnForm>(initialForm(defaultCashBoxId ?? undefined));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<PurchaseReturn | null>(null);

  const calculateLine = useCallback((line: ReturnFormLine): ReturnFormLine => {
    const total = line.quantity * line.unitPrice;
    return { ...line, lineTotal: Number(total.toFixed(2)) };
  }, []);

  const formTotal = useMemo(() => form.lines.reduce((s, l) => s + l.lineTotal, 0), [form.lines]);

  const updateLine = useCallback((idx: number, patch: Partial<ReturnFormLine>) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      newLines[idx] = calculateLine({ ...newLines[idx], ...patch });
      return { ...prev, lines: newLines };
    });
  }, [calculateLine]);

  const handleProductChange = useCallback((idx: number, product: Product) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      const current = newLines[idx];
      const patch: Partial<ReturnFormLine> = {
        description: current.description || product.nameAr,
        unitPrice: current.unitPrice > 0 ? current.unitPrice : product.costPrice,
      };
      newLines[idx] = calculateLine({ ...current, ...patch });
      return { ...prev, lines: newLines };
    });
  }, [calculateLine]);

  const addLine = useCallback(() => setForm(prev => ({ ...prev, lines: [...prev.lines, initialLine()] })), []);
  const removeLine = useCallback((idx: number) => setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) })), []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(initialForm());
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((ret: PurchaseReturn) => {
    setEditingId(ret.id);
    setForm({
      supplierId: ret.supplierId,
      invoiceId: ret.invoiceId || '',
      date: ret.date,
      paymentType: ret.paymentType || 'credit',
      cashBoxId: ret.cashBoxId || '',
      bankAccountId: ret.bankAccountId || '',
      reason: ret.reason || '',
      notes: ret.notes || '',
      lines: ret.lines.length > 0
        ? ret.lines.map(l => ({ productId: l.productId || '', description: l.description || '', quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal }))
        : [initialLine()],
    });
    setModalOpen(true);
  }, []);

  const openView = useCallback(async (ret: PurchaseReturn) => {
    if (activeCompany?.id) {
      const res = await purchasesApi.getReturnById(ret.id, activeCompany.id);
      if (res.success && res.data) { setSelectedReturn(res.data); setViewModalOpen(true); return; }
    }
    setSelectedReturn(ret);
    setViewModalOpen(true);
  }, [activeCompany]);

  const handleSave = useCallback(async () => {
    if (!activeCompany?.id || !form.supplierId) return;
    const existingReturn = editingId ? returns.find(r => r.id === editingId) : null;
    if (editingId && !existingReturn?.returnNumber) {
      addToast('error', t('purchases.return.numberError'));
      return;
    }
    let returnNumber = existingReturn?.returnNumber || '';
    if (!editingId) {
      const seq = await getNextNumber('purchase_return', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('purchases.return.numberError'));
        setModalOpen(false);
        setEditingId(null);
        setForm(initialForm());
        return;
      }
      returnNumber = seq.number;
    }

    const payload = {
      companyId: activeCompany.id,
      returnNumber,
      invoiceId: form.invoiceId || undefined,
      supplierId: form.supplierId,
      date: form.date,
      subtotal: formTotal,
      vatAmount: 0,
      totalAmount: formTotal,
      status: 'draft' as const,
      paymentType: form.paymentType,
      cashBoxId: form.paymentType === 'cash' ? (form.cashBoxId || undefined) : undefined,
      bankAccountId: form.paymentType === 'cash' ? (form.bankAccountId || undefined) : undefined,
      notes: form.notes,
      reason: form.reason,
      lines: form.lines.map(l => ({
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    };

    if (editingId) {
      await update(editingId, payload);
      addToast('success', t('purchases.return.updated'));
      await logAudit({ userId: user?.id || '', action: 'update', tableName: 'purchase_returns', recordId: editingId, companyId: activeCompany.id });
    } else {
      const result = await create(payload);
      if (result.success && result.id) {
        addToast('success', t('purchases.return.created'));
        await logAudit({ userId: user?.id || '', action: 'create', tableName: 'purchase_returns', recordId: result.id, companyId: activeCompany.id });
      } else {
        addToast('error', result.error || t('common.error'));
      }
    }
    setModalOpen(false);
    setEditingId(null);
    setForm(initialForm());
  }, [activeCompany, form, formTotal, editingId, returns, create, update, user, addToast, t, getNextNumber]);

  const handleDelete = useCallback((id: string) => setConfirmDelete(id), []);
  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete || !activeCompany?.id) return;
    await remove(confirmDelete);
    addToast('success', t('purchases.return.deleted'));
    await logAudit({ userId: user?.id || '', action: 'delete', tableName: 'purchase_returns', recordId: confirmDelete, companyId: activeCompany.id });
    setConfirmDelete(null);
  }, [confirmDelete, activeCompany, remove, user, addToast, t]);

  const handlePost = useCallback((ret: PurchaseReturn) => setConfirmPost(ret.id), []);
  const confirmPostAction = useCallback(async () => {
    if (!confirmPost || !activeCompany?.id) return;
    setPostingId(confirmPost);
    const ret = returns.find(r => r.id === confirmPost);
    if (!ret) { setPostingId(null); setConfirmPost(null); return; }

    // Single reference: the API posts atomically (JE + stock movements + status flip + supplier balance).
    const result = await post(confirmPost);

    if (result.success) {
      addToast('success', t('purchases.return.posted'));
      await logAudit({ userId: user?.id || '', action: 'post', tableName: 'purchase_returns', recordId: confirmPost, companyId: activeCompany.id });
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setPostingId(null);
    setConfirmPost(null);
  }, [confirmPost, activeCompany, returns, post, user, addToast, t]);

  const handlePrint = useCallback(async (ret: PurchaseReturn) => {
    let lines = ret.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await purchasesApi.getReturnById(ret.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    printDocument({
      type: 'purchase-return',
      docNumber: ret.returnNumber,
      date: ret.date,
      partyName: ret.supplier?.name || ret.supplierId,
      partyLabel: t('purchases.supplier'),
      partyTaxNumber: ret.supplier?.taxNumber,
      partyAddress: ret.supplier?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.description || t('inventory.productName'),
        productCode: l.productCode,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.lineTotal,
      })),
      subtotal: ret.subtotal,
      vatAmount: ret.vatAmount,
      totalAmount: ret.totalAmount,
      notes: ret.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: currencySymbol,
      paymentType: ret.paymentType,
      createdBy: ret.createdBy,
    });
  }, [activeCompany, t, currencySymbol]);

  const totalPosted = useMemo(() => returns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalAmount, 0), [returns]);

  const columns = useMemo<ColumnDef<PurchaseReturn>[]>(() => [
    { accessorKey: 'returnNumber', header: t('purchases.return.number'), cell: ({ row }) => <span className="font-medium text-slate-900 dark:text-slate-100">{row.original.returnNumber}</span> },
    { accessorKey: 'invoiceNumber', header: t('purchases.return.originalInvoice'), cell: ({ row }) => <span className="flex items-center gap-1 text-blue-600"><FileText size={14} /> {row.original.invoiceNumber || '-'}</span> },
    { accessorKey: 'supplier', header: t('purchases.supplier'), cell: ({ row }) => <span>{row.original.supplier?.name || row.original.supplierId}</span> },
    { accessorKey: 'date', header: t('purchases.date') },
    { accessorKey: 'totalAmount', header: t('purchases.total'), cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.totalAmount)}</span> },
    { accessorKey: 'status', header: t('purchases.status'), cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      accessorKey: 'paymentType',
      header: t('purchases.return.paymentType'),
      cell: ({ row }) => {
        const pt = row.original.paymentType;
        return pt === 'cash'
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('purchases.return.cash')}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('purchases.return.credit')}</span>;
      },
    },
    {
      accessorKey: 'actions',
      header: t('purchases.actions'),
      cell: ({ row }) => {
        const ret = row.original;
        const isPosting = postingId === ret.id;
        return (
          <div className="flex items-center gap-1">
            <ActionButtons
              onView={() => openView(ret)}
              onEdit={ret.status === 'draft' ? () => openEdit(ret) : undefined}
              onDelete={ret.status === 'draft' ? () => handleDelete(ret.id) : undefined}
              onPrint={() => handlePrint(ret)}
              showView
              showEdit={ret.status === 'draft'}
              showDelete={ret.status === 'draft'}
              showPrint
              showExport={false}
              disabled={isPosting}
            />
            {ret.status === 'draft' && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<CheckSquare size={14} />}
                onClick={() => handlePost(ret)}
                disabled={isPosting}
              >
                {isPosting ? t('loading') : t('accounting.post')}
              </Button>
            )}
            {ret.status !== 'draft' && (
              <span className="text-xs text-slate-400 flex items-center gap-1 mr-2">
                <BookOpen size={12} /> {t('accounting.posted')}
              </span>
            )}
          </div>
        );
      },
    },
  ], [t, postingId, openView, openEdit, handleDelete, handlePrint, handlePost, formatCurrency]);

  const canSave = form.supplierId && form.lines.length > 0 && form.lines.every(l => l.productId && l.quantity > 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-700 via-amber-600 to-rose-600 shadow-xl shadow-orange-900/10 dark:shadow-orange-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-orange-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('purchases.returns')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('purchases.returns')}</h2>
              <p className="text-orange-100/80 text-base max-w-lg">{t('purchases.returnsSubtitle')}</p>
            </div>
            <Can action="create" module="purchases">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('purchases.return.create')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('purchases.return.total'), value: String(total), icon: Undo2, color: 'from-orange-600 to-orange-700', bg: 'bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/10 dark:to-orange-800/5' },
          { label: t('purchases.return.postedTotal'), value: formatCurrency(totalPosted), icon: Wallet, color: 'from-rose-600 to-rose-700', bg: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/10 dark:to-rose-800/5' },
          { label: t('purchases.return.drafts'), value: String(returns.filter(r => r.status === 'draft').length), icon: FileText, color: 'from-slate-600 to-slate-700', bg: 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/10 dark:to-slate-800/5' },
          { label: t('sales.status.posted'), value: String(returns.filter(r => r.status === 'posted').length), icon: CheckSquare, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
        ].map((k) => (
          <Card key={k.label} className="p-0 overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${k.color}`} />
            <div className={`p-4 ${k.bg}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight truncate">{k.label}</p>
                  <p className="text-lg md:text-xl font-extrabold tabular-nums leading-tight mt-1 truncate">{k.value}</p>
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-orange-500/30">
        <span className="text-xs text-slate-500 font-medium">{t('purchases.status')}:</span>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {[
            { v: '', l: t('purchases.filter.all') },
            { v: 'draft', l: t('purchases.filter.draft') },
            { v: 'posted', l: t('purchases.filter.posted') },
            { v: 'cancelled', l: t('purchases.filter.cancelled') },
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setStatusFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-orange-600 text-white border-orange-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-orange-300'}`}
            >{o.l}</button>
          ))}
        </div>
      </Card>

      <Card noPadding>
        <DataTablePro<PurchaseReturn>
          data={returns}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('purchases.return.emptyTitle')}
          searchable
          searchPlaceholder={t('search') + '...'}
        />
        <div className="border-t border-slate-200 dark:border-slate-800">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={goToPage}
            onPageSizeChange={changePageSize}
          />
        </div>
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        title={editingId ? t('purchases.return.edit') : t('purchases.return.new')}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); }}
        size="3xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingId(null); }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={!canSave} leftIcon={<CheckSquare size={16} />}>
              {editingId ? t('save') : t('create')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.supplier')}</label>
              <SupplierSelect companyId={activeCompany?.id || ''} value={form.supplierId} onChange={v => setForm(prev => ({ ...prev, supplierId: v || '' }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.return.linkInvoice')}</label>
              <select
                className="form-control w-full"
                value={form.invoiceId}
                onChange={e => setForm(prev => ({ ...prev, invoiceId: e.target.value }))}
              >
                <option value="">{t('all')}</option>
                {invoices.map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.invoiceNumber} - {inv.supplier?.name || inv.supplierId}</option>
                ))}
              </select>
            </div>
          </div>
          <Input label={t('purchases.date')} type="date" value={form.date} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.return.paymentType')}</label>
            <select
              className="form-control w-full"
              value={form.paymentType}
              onChange={e => {
                const newType = e.target.value;
                setForm(prev => ({
                  ...prev,
                  paymentType: newType,
                  cashBoxId: newType === 'cash' ? (prev.cashBoxId || defaultCashBoxId || '') : '',
                  bankAccountId: newType === 'cash' ? (prev.bankAccountId || defaultBankId || '') : '',
                }));
              }}
              aria-label={t('purchases.return.paymentType')}
            >
              <option value="cash">{t('purchases.return.cash')}</option>
              <option value="credit">{t('purchases.return.credit')}</option>
            </select>
          </div>
          {form.paymentType === 'cash' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.cashBox')}</label>
                <CashBoxSelect companyId={activeCompany?.id || ''} value={form.cashBoxId || ''} onChange={v => setForm(prev => ({ ...prev, cashBoxId: v || '' }))} />
                {defaultCashBoxId && form.cashBoxId === defaultCashBoxId && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.bankAccount')}</label>
                <BankSelect companyId={activeCompany?.id || ''} value={form.bankAccountId || ''} onChange={v => setForm(prev => ({ ...prev, bankAccountId: v || '' }))} />
                {defaultBankId && form.bankAccountId === defaultBankId && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
                )}
              </div>
            </div>
          )}
          <Input label={t('purchases.return.reason')} value={form.reason} onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))} />

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-sm">{t('purchases.return.details')}</h4>
              <Button size="sm" variant="secondary" onClick={addLine} leftIcon={<Plus size={14} />}>
                {t('purchases.invoice.addLine')}
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <label className="text-xs text-slate-500">{t('inventory.productName')}</label>
                  <ProductSelect companyId={activeCompany?.id || ''} value={line.productId} onChange={v => updateLine(idx, { productId: Array.isArray(v) ? (v[0] || '') : (v || '') })} onProductChange={(p) => handleProductChange(idx, p)} showBarcode showStock size="sm" module="purchases" />
                </div>
                <div className="col-span-3">
                  <Input type="text" placeholder={t('description')} value={line.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Input type="number" placeholder={t('inventory.quantity')} value={String(line.quantity)} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <Input type="number" placeholder={t('inventory.unitPrice')} value={String(line.unitPrice)} onChange={e => updateLine(idx, { unitPrice: Number(e.target.value) })} />
                </div>
                <div className="col-span-1">
                  <Button size="sm" variant="ghost" onClick={() => removeLine(idx)} leftIcon={<Trash2 size={14} className="text-rose-500" />} />
                </div>
              </div>
            ))}
          </div>

          <Input label={t('notes')} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
              <p className="text-emerald-700 dark:text-emerald-400 font-medium">{t('purchases.return.accountingEffect')}</p>
              <p className="text-emerald-600 dark:text-emerald-300 text-xs mt-1">{t('accounting.postEntry')}: {t('purchases.return.accountingEffectDesc')}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-blue-700 dark:text-blue-400 font-medium">{t('purchases.return.inventoryEffect')}</p>
              <p className="text-blue-600 dark:text-blue-300 text-xs mt-1">{t('inventory.out')}: {t('purchases.return.inventoryEffectDesc')}</p>
            </div>
          </div>

          <div className="flex justify-end text-lg font-bold text-primary-600">
            {t('purchases.total')}: {formatCurrency(formTotal || 0)}
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={viewModalOpen}
        title={t('purchases.return.details')}
        onClose={() => setViewModalOpen(false)}
        size="lg"
      >
        {selectedReturn && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">{t('purchases.return.number')}:</span> <strong>{selectedReturn.returnNumber}</strong></div>
              <div><span className="text-slate-500">{t('purchases.supplier')}:</span> <strong>{selectedReturn.supplier?.name || selectedReturn.supplierId}</strong></div>
              <div><span className="text-slate-500">{t('purchases.date')}:</span> {selectedReturn.date}</div>
              <div><span className="text-slate-500">{t('purchases.return.originalInvoice')}:</span> {selectedReturn.invoiceNumber || '-'}</div>
              <div><span className="text-slate-500">{t('purchases.status')}:</span> <StatusBadge status={selectedReturn.status} /></div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="p-2 text-right">#</th>
                    <th className="p-2 text-right">{t('inventory.productName')}</th>
                    <th className="p-2 text-right">{t('inventory.quantity')}</th>
                    <th className="p-2 text-right">{t('inventory.unitPrice')}</th>
                    <th className="p-2 text-right">{t('purchases.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedReturn.lines || []).map((line, idx) => (
                    <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2">{line.productName || line.description || line.productId}</td>
                      <td className="p-2">{line.quantity}</td>
                      <td className="p-2">{formatCurrency(line.unitPrice || 0)}</td>
                      <td className="p-2 font-medium">{formatCurrency(line.lineTotal || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end text-lg font-bold text-primary-600">
              {t('purchases.total')}: {formatCurrency(selectedReturn.totalAmount || 0)}
            </div>
            {selectedReturn.reason && (
              <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                {t('purchases.return.reason')}: {selectedReturn.reason}
              </div>
            )}
            {selectedReturn.notes && (
              <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                {t('notes')}: {selectedReturn.notes}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>{t('close')}</Button>
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrint(selectedReturn)}>{t('print')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title={t('purchases.return.deleteTitle')}
        message={t('purchases.return.deleteConfirm')}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmPost}
        onClose={() => setConfirmPost(null)}
        onConfirm={confirmPostAction}
        title={t('purchases.return.postTitle')}
        message={t('purchases.return.postConfirm')}
        variant="warning"
      />
    </div>
  );
};

export default PurchaseReturnsPage;
