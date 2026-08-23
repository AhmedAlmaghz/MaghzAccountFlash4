import React, { useState, useMemo, useCallback } from 'react';
import { Undo2, Plus, CheckSquare, Trash2, Printer, FileText, Package, BookOpen, Search, X, Wallet, Layers, Sparkles, Download } from 'lucide-react';
import { Card, Button, Table, Input, Modal, Pagination, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CustomerSelect, ProductSelect, CashBoxSelect, BankSelect } from '@/core/ui/components/smart';
import { useReturnsPaginated, usePostedInvoicesWithLines } from '../hooks/useSales';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useSettings } from '@/core/utils/useSettings';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { printDocument } from '@/core/utils/printDocument';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { postSalesReturn } from '@/core/utils/journalEntryGenerator';
import { logAudit } from '@/core/utils/auditLogger';
import { salesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import type { SalesReturn } from '../types';

interface ReturnLineForm {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export const SalesReturnsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const currentUser = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const {
    returns,
    total,
    page,
    pageSize,
    isLoading: returnsLoading,
    goToPage,
    changePageSize,
    create,
    update,
    remove,
    post,
  } = useReturnsPaginated(activeCompany?.id || '', useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]));

  const filteredReturns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return returns;
    return returns.filter((r) => (r.returnNumber?.toLowerCase() || '').includes(q) || (r.customer?.name?.toLowerCase() || '').includes(q) || (r.invoice?.invoiceNumber?.toLowerCase() || '').includes(q));
  }, [returns, search]);
  const hasFilters = !!(search || statusFilter);
  const { invoices } = usePostedInvoicesWithLines(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { defaultCashBoxId, defaultBankId } = useDefaultPaymentAccounts(activeCompany?.id || '');

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SalesReturn | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [postingId, setPostingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [header, setHeader] = useState({ invoiceId: '', customerId: '', date: new Date().toISOString().split('T')[0], paymentType: 'credit', cashBoxId: '', bankAccountId: '', reason: '', notes: '' });
  const [lines, setLines] = useState<ReturnLineForm[]>([{ productId: '', productName: '', quantity: 1, unitPrice: 0 }]);

  const defaultLine = (): ReturnLineForm => ({ productId: '', productName: '', quantity: 1, unitPrice: 0 });

  const resetForm = useCallback(() => {
    setHeader({ invoiceId: '', customerId: '', date: new Date().toISOString().split('T')[0], paymentType: 'credit', cashBoxId: defaultCashBoxId || '', bankAccountId: '', reason: '', notes: '' });
    setLines([defaultLine()]);
    setEditingId(null);
  }, [defaultCashBoxId]);

  const addLine = () => setLines(prev => [...prev, defaultLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof ReturnLineForm, value: string | number) => {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'productId' && typeof value === 'string') next[idx].productName = value;
      return next;
    });
  };

  const handleProductChange = useCallback((idx: number, product: { nameAr: string; salePrice: number }) => {
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

  const vatRate = settings?.vatRate ?? 15;
  const calculations = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice), 0);
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const totalAmount = subtotal + vatAmount;
    return { subtotal, vatAmount, totalAmount };
  }, [lines, vatRate]);

  const handleInvoiceSelect = (invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv) {
      setHeader(prev => ({ ...prev, invoiceId, customerId: inv.customerId }));
      setLines(inv.lines.map(l => ({ productId: l.productId, productName: l.productName || l.productId, quantity: 1, unitPrice: l.unitPrice })));
    } else {
      setHeader(prev => ({ ...prev, invoiceId, customerId: '' }));
      setLines([defaultLine()]);
    }
  };

  const buildPayload = (returnNumber: string): Omit<SalesReturn, 'id'> => ({
    companyId: activeCompany!.id,
    returnNumber,
    invoiceId: header.invoiceId,
    customerId: header.customerId,
    date: header.date,
    subtotal: calculations.subtotal,
    vatAmount: calculations.vatAmount,
    totalAmount: calculations.totalAmount,
    paymentType: header.paymentType || 'credit',
    cashBoxId: header.paymentType === 'cash' ? (header.cashBoxId || undefined) : undefined,
    bankAccountId: header.paymentType === 'cash' ? (header.bankAccountId || undefined) : undefined,
    reason: header.reason,
    status: 'draft',
    notes: header.notes,
    lines: lines.map(l => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.quantity * l.unitPrice,
    })),
  });

  const handleSave = async () => {
    if (!header.customerId || !header.invoiceId || lines.length === 0 || !activeCompany?.id) return;
    if (lines.some(l => !l.productId)) {
      addToast('error', t('sales.invoice.productRequired') || t('common.error'));
      return;
    }
    if (lines.some(l => l.quantity <= 0)) {
      addToast('error', t('sales.invoice.quantityPositive') || t('common.error'));
      return;
    }
    if (!header.reason.trim()) {
      addToast('error', t('sales.return.reason') + ' ' + (t('validation.required') || ''));
      return;
    }
    setSaving(true);
    let returnNumber: string;
    if (editingId) {
      const existing = returns.find(r => r.id === editingId);
      returnNumber = existing?.returnNumber || '';
      const res = await update(editingId, buildPayload(returnNumber));
      if (res.success && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'sales_returns', recordId: editingId, companyId: activeCompany.id });
        addToast('success', t('sales.return.updated'));
      } else {
        addToast('error', res.error || t('error'));
      }
    } else {
      const seq = await getNextNumber('sales_return', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('sales.return.numberError'));
        setSaving(false);
        return;
      }
      returnNumber = seq.number;
      const res = await create(buildPayload(returnNumber));
      if (res.success && res.id && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'create', tableName: 'sales_returns', recordId: res.id, companyId: activeCompany.id });
        addToast('success', t('sales.return.created'));
      } else {
        addToast('error', res.error || t('error'));
      }
    }
    setSaving(false);
    setFormOpen(false);
    resetForm();
  };

  const handleDelete = (ret: SalesReturn) => {
    if (ret.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.return.deleteTitle'),
      message: `${t('sales.return.deleteConfirm')} ${ret.returnNumber}؟`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(ret.id);
        if (res.success && activeCompany?.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'delete', tableName: 'sales_returns', recordId: ret.id, companyId: activeCompany.id });
          addToast('success', t('sales.return.deleted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePost = (ret: SalesReturn) => {
    if (ret.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.return.postTitle'),
      message: `${t('sales.return.postConfirm')}`,
      variant: 'warning',
      confirmText: t('sales.return.post'),
      onConfirm: async () => {
        setConfirmOpen(false);
        if (!activeCompany?.id) return;
        setPostingId(ret.id);
        const postResult = await postSalesReturn(activeCompany.id, {
          id: ret.id,
          returnNumber: ret.returnNumber,
          date: ret.date,
          customer: ret.customer?.name || ret.customerId,
          amount: ret.totalAmount,
        });
        if (postResult.success) {
          await post(ret.id);
          await logAudit({ userId: currentUser?.id || 'system', action: 'post', tableName: 'sales_returns', recordId: ret.id, companyId: activeCompany.id });
          addToast('success', t('sales.return.posted'));
        } else {
          addToast('error', postResult.error || t('error'));
        }
        setPostingId(null);
      },
    });
    setConfirmOpen(true);
  };

  const handlePrint = async (ret: SalesReturn) => {
    let lines = ret.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getReturnById(ret.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    printDocument({
      type: 'sales-return',
      docNumber: ret.returnNumber,
      date: ret.date,
      partyName: ret.customer?.name || ret.customerId,
      partyLabel: t('sales.customer.title'),
      partyTaxNumber: ret.customer?.taxNumber,
      partyAddress: ret.customer?.address,
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
      subtotal: ret.subtotal,
      vatAmount: ret.vatAmount,
      totalAmount: ret.totalAmount,
      notes: `${ret.reason}\n${ret.notes || ''}`,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: activeCompany?.currency,
      paymentType: ret.paymentType,
      createdBy: ret.createdBy,
    });
  };

  const handleExportExcel = () => {
    const cols = [
      { key: 'returnNumber', header: t('sales.return.number') },
      { key: 'invoiceNumber', header: t('sales.invoiceNumber') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToExcel(returns.map(r => ({ returnNumber: r.returnNumber, invoiceNumber: r.invoice?.invoiceNumber || r.invoiceId, customerName: r.customer?.name || r.customerId, date: r.date, totalAmount: r.totalAmount, status: r.status })), cols, `sales_returns_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPdf = () => {
    const exportColumns = [
      { key: 'returnNumber', header: t('sales.return.number') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToPDF(filteredReturns.map(r => ({ returnNumber: r.returnNumber, customerName: r.customer?.name || r.customerId, date: r.date, totalAmount: formatCurrency(r.totalAmount), status: r.status })), exportColumns, `sales_returns_${new Date().toISOString().split('T')[0]}`, {
      title: t('sales.returns'),
      rtl: true,
    });
  };

  const tableColumns = [
    {
      key: 'returnNumber',
      header: t('sales.return.number'),
      width: '135px',
      render: (row: SalesReturn) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <Undo2 size={12} className="text-rose-500" />
          {row.returnNumber}
        </span>
      ),
    },
    { key: 'invoiceNumber', header: t('sales.return.originalInvoice'), width: '140px', render: (row: SalesReturn) => (
      <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-mono text-xs"><FileText size={13} /> {row.invoice?.invoiceNumber || row.invoiceId.slice(0, 8)}</span>
    )},
    {
      key: 'customerName',
      header: t('sales.customer.title'),
      render: (row: SalesReturn) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(row.customer?.name || row.customerId || '?').charAt(0).toUpperCase()}
          </div>
          <span className="font-medium truncate">{row.customer?.name || row.customerId.slice(0, 8)}</span>
        </div>
      ),
    },
    { key: 'date', header: t('sales.date'), width: '110px', render: (row: SalesReturn) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span> },
    { key: 'reason', header: t('sales.return.reason'), render: (row: SalesReturn) => <span className="text-sm text-slate-600 dark:text-slate-300 truncate max-w-[180px] inline-block">{row.reason}</span> },
    { key: 'totalAmount', header: t('sales.total'), align: 'right' as const, render: (row: SalesReturn) => <span className="font-bold tabular-nums text-rose-700 dark:text-rose-300">{formatCurrency(row.totalAmount)}</span> },
    {
      key: 'paymentType',
      header: t('sales.return.paymentType'),
      width: '95px',
      render: (row: SalesReturn) => (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${row.paymentType === 'cash' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'}`}
        >
          {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
        </span>
      ),
    },
    { key: 'status', header: t('sales.status.label'), width: '110px', render: (row: SalesReturn) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: t('sales.actions'), width: '200px', render: (row: SalesReturn) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getReturnById(row.id, activeCompany.id);
              if (res.success && res.data) { setViewing(res.data); setDetailOpen(true); return; }
            }
            setViewing(row); setDetailOpen(true);
          }}
          onEdit={row.status === 'draft' ? () => {
            setEditingId(row.id);
            setHeader({ invoiceId: row.invoiceId, customerId: row.customerId, date: row.date, paymentType: row.paymentType || 'credit', cashBoxId: row.cashBoxId || '', bankAccountId: row.bankAccountId || '', reason: row.reason, notes: row.notes || '' });
            setLines(row.lines.map(l => ({ productId: l.productId, productName: l.productName || l.productId, quantity: l.quantity, unitPrice: l.unitPrice })));
            setFormOpen(true);
          } : undefined}
          onDelete={row.status === 'draft' ? () => handleDelete(row) : undefined}
          onPrint={() => handlePrint(row)}
          showView
          showEdit={row.status === 'draft'}
          showDelete={row.status === 'draft'}
          showPrint
        />
        {row.status === 'draft' && (
          <Button size="sm" variant="secondary" onClick={() => handlePost(row)} disabled={postingId === row.id} leftIcon={<CheckSquare size={14} />}>
            {postingId === row.id ? (t('loading')) : (t('sales.return.post'))}
          </Button>
        )}
      </div>
    )},
  ];

  const stats = useMemo(() => {
    const total = returns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalAmount, 0);
    const draftCount = returns.filter(r => r.status === 'draft').length;
    const postedCount = returns.filter(r => r.status === 'posted').length;
    return { total, draftCount, postedCount };
  }, [returns]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-700 via-rose-600 to-orange-600 shadow-xl shadow-rose-900/10 dark:shadow-rose-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-rose-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('sales.returns')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('sales.returns')}</h2>
              <p className="text-rose-100/80 text-base max-w-lg">{t('sales.returnsSubtitle')}</p>
            </div>
            <Can action="create" module="sales">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setFormOpen(true); }} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('sales.return.create')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('sales.return.total'), value: String(total), icon: Layers, color: 'from-rose-600 to-rose-700', bg: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/10 dark:to-rose-800/5' },
          { label: t('sales.return.postedTotal'), value: formatCurrency(stats.total), icon: Wallet, color: 'from-orange-600 to-orange-700', bg: 'bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/10 dark:to-orange-800/5' },
          { label: t('sales.return.drafts'), value: String(stats.draftCount), icon: FileText, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('sales.status.posted'), value: String(stats.postedCount), icon: CheckSquare, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-rose-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('search')}
              className="w-full pr-9 pl-9 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-colors placeholder:text-slate-400"
              aria-label={t('search')}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><X size={14} /></button>
            )}
            {!search && <span className="absolute left-3 top-1/2 -translate-y-1/2"><Sparkles size={14} className="text-slate-300" /></span>}
          </div>
          <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
          <Button size="sm" variant="ghost" onClick={handleExportExcel} title={t('export')}><Download size={16} className="text-emerald-600" /></Button>
          <Button size="sm" variant="ghost" onClick={handleExportPdf} title="PDF"><Printer size={16} className="text-rose-600" /></Button>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">{t('sales.status.label')}:</span>
          {[
            { value: '', label: t('sales.filter.all') },
            { value: 'draft', label: t('sales.status.draft') },
            { value: 'posted', label: t('sales.status.posted') },
            { value: 'cancelled', label: t('sales.status.cancelled') },
          ].map((opt) => (
            <button
              key={opt.value || 'all'}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === opt.value ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-rose-300'}`}
            >{opt.label}</button>
          ))}
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <span>{filteredReturns.length} من {returns.length} {search ? `• "${search}"` : ''} {statusFilter ? `• ${t('sales.status.' + statusFilter)}` : ''}</span>
            <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-rose-600 hover:underline font-medium">{t('sales.filter.clearFilters')}</button>
          </div>
        )}
      </Card>

      <Card noPadding>
        {returnsLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : returns.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('sales.return.emptyTitle')}
              description={t('sales.return.emptyDesc')}
              action={<Can action="create" module="sales"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setFormOpen(true); }}>{t('sales.return.create')}</Button></Can>}
            />
          </div>
        ) : filteredReturns.length === 0 ? (
          <div className="py-10">
            <EmptyState
              icon="search"
              title={t('sales.filter.noResults')}
              description={t('sales.filter.noResultsDesc')}
              action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>{t('sales.filter.clearFilters')}</Button>}
            />
          </div>
        ) : (
          <>
            <Table<SalesReturn> data={filteredReturns} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={returnsLoading} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Form Modal */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} size="3xl" title={editingId ? (t('sales.return.edit')) : (t('sales.return.new'))}>
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.return.originalInvoice')}</label>
              <select
                className="form-control w-full"
                value={header.invoiceId}
                onChange={e => handleInvoiceSelect(e.target.value)}
              >
                <option value="">{t('sales.invoice.select')}</option>
                {invoices.filter(i => i.status === 'posted' || i.status === 'partially_paid' || i.status === 'paid').map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.invoiceNumber} - {inv.customer?.name || inv.customerId}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.customer.title')}</label>
              <CustomerSelect companyId={activeCompany?.id || ''} value={header.customerId} onChange={v => setHeader(p => ({ ...p, customerId: v || '' }))} />
            </div>
            <Input label={t('sales.date')} type="date" value={header.date} onChange={e => setHeader(p => ({ ...p, date: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.return.paymentType')}</label>
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
                aria-label={t('sales.return.paymentType')}
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
                    <th className="px-2 py-1 text-right w-24">{t('sales.total')}</th>
                    <th className="px-2 py-1 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const lineTotal = line.quantity * line.unitPrice;
                    return (
                      <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1"><ProductSelect companyId={activeCompany?.id || ''} value={line.productId} onChange={v => updateLine(idx, 'productId', Array.isArray(v) ? (v[0] || '') : (v || ''))} onProductChange={(p) => handleProductChange(idx, p)} showBarcode showStock size="sm" module="sales" /></td>
                        <td className="px-2 py-1"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1 text-slate-700 dark:text-slate-200 font-medium">{formatCurrency(lineTotal)}</td>
                        <td className="px-2 py-1"><Button size="sm" variant="ghost" onClick={() => removeLine(idx)} leftIcon={<Trash2 size={14} className="text-rose-500" />} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input label={t('sales.return.reason')} value={header.reason} onChange={e => setHeader(p => ({ ...p, reason: e.target.value }))} />
            <Input label={t('sales.notes')} value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))} />
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300 font-medium">{t('sales.total')}</span>
              <span className="text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(calculations.totalAmount)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <Button variant="secondary" onClick={() => { setFormOpen(false); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleSave} isLoading={saving} leftIcon={<CheckSquare size={16} />}>{editingId ? (t('save')) : (t('sales.return.saveDraft'))}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} size="lg" title={`${t('sales.return.details')} - ${viewing?.returnNumber}`}>
        {viewing && (
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.customer.title')}</p><p className="font-semibold">{viewing.customer?.name || viewing.customerId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.status.label')}</p><StatusBadge status={viewing.status} /></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.return.originalInvoice')}</p><p className="font-semibold flex items-center gap-1"><FileText size={14} /> {viewing.invoice?.invoiceNumber || viewing.invoiceId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.return.reason')}</p><p className="font-semibold">{viewing.reason}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.date')}</p><p className="font-semibold">{viewing.date}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.total')}</p><p className="font-semibold">{formatCurrency(viewing.totalAmount)}</p></div>
            </div>

            {/* Impact badges */}
            <div className="flex gap-2">
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg px-3 py-2 text-sm">
                <BookOpen size={16} /> {t('sales.return.accountingEffect')}
              </div>
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-2 text-sm">
                <Package size={16} /> {t('sales.return.inventoryEffect')}
              </div>
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
              <div className="space-y-1 text-sm">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.subtotal')}: <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.subtotal)}</span></p>
                <p className="text-slate-500 dark:text-slate-400">{t('sales.vat')}: <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.vatAmount)}</span></p>
              </div>
              <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
                {t('sales.total')}: {formatCurrency(viewing.totalAmount)}
              </div>
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

export default SalesReturnsPage;
