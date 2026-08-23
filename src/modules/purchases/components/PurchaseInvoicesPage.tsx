import React, { useState, useMemo, useCallback } from 'react';
import { FileText, Plus, CheckSquare, BookOpen, Trash2, Printer, Wallet, Layers, ShoppingCart } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { useUserMap } from '@/core/utils/useUserMap';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Input, Pagination, Can } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DataTablePro } from '@/core/ui/components/DataTablePro';
import { SupplierSelect, ProductSelect, CurrencySelect, CashBoxSelect, BankSelect } from '@/core/ui/components/smart';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseInvoicesPaginated } from '../hooks/usePurchases';
import { usePurchaseOrders } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { postPurchaseInvoice } from '@/core/utils/journalEntryGenerator';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';
import type { PurchaseInvoice } from '../types';
import type { Product } from '@/modules/inventory/types';
import type { ColumnDef } from '@tanstack/react-table';

interface InvoiceFormLine {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatPercent: number;
  lineTotal: number;
}

interface InvoiceForm {
  supplierId: string;
  purchaseOrderId: string;
  date: string;
  dueDate: string;
  paymentType: string;
  cashBoxId: string;
  bankAccountId: string;
  notes: string;
  lines: InvoiceFormLine[];
}

const initialLine = (): InvoiceFormLine => ({
  productId: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
  vatPercent: 15,
  lineTotal: 0,
});

const initialForm = (defaultCashBoxId?: string): InvoiceForm => ({
  supplierId: '',
  purchaseOrderId: '',
  date: new Date().toISOString().split('T')[0],
  dueDate: new Date().toISOString().split('T')[0],
  paymentType: 'credit',
  cashBoxId: defaultCashBoxId || '',
  bankAccountId: '',
  notes: '',
  lines: [initialLine()],
});

export const PurchaseInvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'purchases');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const invoiceFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const {
    invoices,
    total,
    page,
    pageSize,
    isLoading,
    goToPage,
    changePageSize,
    create,
    update,
    remove,
    post,
  } = usePurchaseInvoicesPaginated(activeCompany?.id || '', invoiceFilters);
  const { orders } = usePurchaseOrders(activeCompany?.id || '');
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();
  const { getUserName } = useUserMap();
  const { currencies, defaultCurrency } = useCurrencyDisplay();
  const { defaultCashBoxId, defaultBankId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceForm>(initialForm(defaultCashBoxId ?? undefined));
  const [currencyCode, setCurrencyCode] = useState<string>(defaultCurrency?.code || YER_CODE);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);

  const handleCurrencyChange = useCallback((code: string | null) => {
    if (!code) {
      setCurrencyCode(YER_CODE);
      setExchangeRate(1);
      return;
    }
    setCurrencyCode(code);
    const c = currencies.find((x) => x.code === code);
    setExchangeRate(c ? c.exchangeRate : 1);
  }, [currencies]);

  const vatRate = settings?.vatRate ?? 15;

  const calculateLine = useCallback((line: InvoiceFormLine): InvoiceFormLine => {
    const gross = line.quantity * line.unitPrice;
    const discount = gross * (line.discountPercent / 100);
    const net = gross - discount;
    const vat = net * (line.vatPercent / 100);
    const total = net + vat;
    return { ...line, lineTotal: Number(total.toFixed(2)) };
  }, []);

  const formTotals = useMemo(() => {
    const subtotal = form.lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (1 - l.discountPercent / 100)), 0);
    const vatAmount = form.lines.reduce((s, l) => {
      const net = l.quantity * l.unitPrice * (1 - l.discountPercent / 100);
      return s + net * (l.vatPercent / 100);
    }, 0);
    const totalAmount = subtotal + vatAmount;
    return { subtotal: Number(subtotal.toFixed(2)), vatAmount: Number(vatAmount.toFixed(2)), totalAmount: Number(totalAmount.toFixed(2)) };
  }, [form.lines]);

  const updateLine = useCallback((idx: number, patch: Partial<InvoiceFormLine>) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      newLines[idx] = calculateLine({ ...newLines[idx], ...patch });
      return { ...prev, lines: newLines };
    });
  }, [calculateLine]);

  /**
   * Auto-fill unit price with the product's cost price when the user picks
   * a product from the dropdown. Empty lines (price = 0) get auto-filled;
   * existing manual prices are preserved.
   */
  const handleProductChange = useCallback((idx: number, product: Product) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      const current = newLines[idx];
      const patch: Partial<InvoiceFormLine> = {
        description: current.description || product.nameAr,
        unitPrice: current.unitPrice > 0 ? current.unitPrice : product.costPrice,
      };
      newLines[idx] = calculateLine({ ...current, ...patch });
      return { ...prev, lines: newLines };
    });
  }, [calculateLine]);

  const addLine = useCallback(() => {
    setForm(prev => ({ ...prev, lines: [...prev.lines, { ...initialLine(), vatPercent: vatRate }] }));
  }, [vatRate]);

  const removeLine = useCallback((idx: number) => {
    setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));
  }, []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({ ...initialForm(), lines: [{ ...initialLine(), vatPercent: vatRate }] });
    setModalOpen(true);
  }, [vatRate]);

  const openEdit = useCallback((invoice: PurchaseInvoice) => {
    setEditingId(invoice.id);
    setCurrencyCode(invoice.currencyCode || YER_CODE);
    setExchangeRate(invoice.exchangeRate ?? 1);
    setForm({
      supplierId: invoice.supplierId,
      purchaseOrderId: invoice.purchaseOrderId || '',
      date: invoice.date,
      dueDate: invoice.dueDate || invoice.date,
      paymentType: invoice.paymentType || 'credit',
      cashBoxId: invoice.cashBoxId || '',
      bankAccountId: invoice.bankAccountId || '',
      notes: invoice.notes || '',
      lines: invoice.lines.length > 0
        ? invoice.lines.map(l => ({
            productId: l.productId || '',
            description: l.description || '',
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent || 0,
            vatPercent: l.vatPercent || vatRate,
            lineTotal: l.lineTotal,
          }))
        : [initialLine()],
    });
    setModalOpen(true);
  }, [vatRate]);

  const openView = useCallback(async (invoice: PurchaseInvoice) => {
    if (activeCompany?.id) {
      const res = await purchasesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data) { setSelectedInvoice(res.data); setViewModalOpen(true); return; }
    }
    setSelectedInvoice(invoice);
    setViewModalOpen(true);
  }, [activeCompany]);

  const handleSave = useCallback(async () => {
    if (!activeCompany?.id || !form.supplierId) return;
    const existingInvoice = editingId ? invoices.find(i => i.id === editingId) : null;
    if (editingId && !existingInvoice?.invoiceNumber) {
      addToast('error', t('purchases.invoice.numberError'));
      return;
    }
    const payload = {
      companyId: activeCompany.id,
      invoiceNumber: editingId ? existingInvoice!.invoiceNumber : '',
      supplierId: form.supplierId,
      purchaseOrderId: form.purchaseOrderId || undefined,
      date: form.date,
      dueDate: form.dueDate,
      subtotal: formTotals.subtotal,
      discountAmount: 0,
      vatAmount: formTotals.vatAmount,
      totalAmount: formTotals.totalAmount,
      paidAmount: 0,
      currencyCode,
      exchangeRate,
      baseCurrencyAmount: formTotals.totalAmount * exchangeRate,
      baseCurrencyPaid: 0,
      status: 'draft' as const,
      paymentType: form.paymentType,
      cashBoxId: form.paymentType === 'cash' ? (form.cashBoxId || undefined) : undefined,
      bankAccountId: form.paymentType === 'cash' ? (form.bankAccountId || undefined) : undefined,
      notes: form.notes,
      lines: form.lines.map(l => ({
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        vatPercent: l.vatPercent,
        lineTotal: l.lineTotal,
        currencyCode,
        exchangeRate,
        baseCurrencyLineTotal: l.lineTotal * exchangeRate,
      })),
    };

    if (editingId) {
      await update(editingId, payload);
      addToast('success', t('purchases.invoice.updated'));
      await logAudit({
        userId: user?.id || '',
        action: 'update',
        tableName: 'purchase_invoices',
        recordId: editingId,
        companyId: activeCompany.id,
      });
    } else {
      const seq = await getNextNumber('purchase_invoice', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('purchases.invoice.numberError'));
        setModalOpen(false);
        setEditingId(null);
        setForm(initialForm());
        return;
      }
      payload.invoiceNumber = seq.number;
      const result = await create(payload);
      if (result.success && result.id) {
        addToast('success', t('purchases.invoice.created'));
        await logAudit({
          userId: user?.id || '',
          action: 'create',
          tableName: 'purchase_invoices',
          recordId: result.id,
          companyId: activeCompany.id,
        });
      } else {
        addToast('error', result.error || t('common.error'));
      }
    }
    setModalOpen(false);
    setEditingId(null);
    setForm(initialForm());
  }, [activeCompany, form, formTotals, editingId, invoices, create, update, user, getNextNumber, currencyCode, exchangeRate, addToast, t]);

  const handleDelete = useCallback(async (id: string) => {
    setConfirmDelete(id);
  }, []);

  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete || !activeCompany?.id) return;
    await remove(confirmDelete);
    addToast('success', t('purchases.invoice.deleted'));
    await logAudit({
      userId: user?.id || '',
      action: 'delete',
      tableName: 'purchase_invoices',
      recordId: confirmDelete,
      companyId: activeCompany.id,
    });
    setConfirmDelete(null);
  }, [confirmDelete, activeCompany, remove, user, addToast, t]);

  const handlePost = useCallback(async (invoice: PurchaseInvoice) => {
    setConfirmPost(invoice.id);
  }, []);

  const confirmPostAction = useCallback(async () => {
    if (!confirmPost || !activeCompany?.id) return;
    setPostingId(confirmPost);
    const invoice = invoices.find(i => i.id === confirmPost);
    if (!invoice) {
      setPostingId(null);
      setConfirmPost(null);
      return;
    }

    const result = await postPurchaseInvoice(activeCompany.id, {
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      supplierId: invoice.supplierId,
      subtotal: invoice.subtotal,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.totalAmount,
    });

    if (result.success) {
      await post(confirmPost);
      addToast('success', t('purchases.invoice.posted'));
      await logAudit({
        userId: user?.id || '',
        action: 'post',
        tableName: 'purchase_invoices',
        recordId: confirmPost,
        companyId: activeCompany.id,
      });
    } else {
      addToast('error', result.error || t('purchases.invoice.postErrorUnknown'));
    }
    setPostingId(null);
    setConfirmPost(null);
  }, [confirmPost, activeCompany, invoices, post, user, t, addToast]);

  const handlePrint = useCallback(async (invoice: PurchaseInvoice) => {
    let lines = invoice.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await purchasesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    printDocument({
      type: 'purchase-invoice',
      docNumber: invoice.invoiceNumber,
      date: invoice.date,
      dueDate: invoice.dueDate,
      partyName: invoice.supplier?.name || invoice.supplierId,
      partyLabel: t('purchases.supplier'),
      partyTaxNumber: invoice.supplier?.taxNumber,
      partyAddress: invoice.supplier?.address,
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
      subtotal: invoice.subtotal,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.totalAmount,
      notes: invoice.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: currencySymbol,
      paymentType: invoice.paymentType,
      createdBy: invoice.createdBy,
    });
  }, [activeCompany, t, currencySymbol]);

  const handleExportExcel = useCallback(() => {
    exportToExcel(invoices, [
      { key: 'invoiceNumber', header: t('purchases.invoiceNumber'), width: 20 },
      { key: 'supplierName', header: t('purchases.supplier'), width: 25 },
      { key: 'date', header: t('purchases.date'), width: 15 },
      { key: 'subtotal', header: t('purchases.subtotal'), width: 15 },
      { key: 'vatAmount', header: t('purchases.vat'), width: 15 },
      { key: 'totalAmount', header: t('purchases.total'), width: 15 },
      { key: 'paymentType', header: t('purchases.invoice.paymentType'), width: 15 },
      { key: 'status', header: t('purchases.status'), width: 15 },
    ], 'purchase_invoices');
  }, [t, invoices]);

  const handleExportPdf = useCallback(() => {
    exportToPDF(invoices, [
      { key: 'invoiceNumber', header: t('purchases.invoiceNumber') },
      { key: 'supplierName', header: t('purchases.supplier') },
      { key: 'date', header: t('purchases.date') },
      { key: 'subtotal', header: t('purchases.subtotal') },
      { key: 'totalAmount', header: t('purchases.total') },
      { key: 'status', header: t('purchases.status') },
    ], 'purchase_invoices', {
      title: t('purchases.invoices'),
      rtl: true,
      companyName: activeCompany?.name,
      currency: currencySymbol,
    });
  }, [t, activeCompany, invoices, currencySymbol]);

  const columns = useMemo<ColumnDef<PurchaseInvoice>[]>(() => [
    {
      accessorKey: 'invoiceNumber',
      header: t('purchases.invoiceNumber'),
      cell: ({ row }) => <span className="font-medium text-slate-900 dark:text-slate-100">{row.original.invoiceNumber}</span>,
    },
    {
      accessorKey: 'supplier',
      header: t('purchases.supplier'),
      cell: ({ row }) => <span>{row.original.supplier?.name || row.original.supplierId}</span>,
    },
    {
      accessorKey: 'date',
      header: t('purchases.date'),
      cell: ({ row }) => <span>{row.original.date ? formatDate(row.original.date) : '-'}</span>,
    },
    {
      accessorKey: 'totalAmount',
      header: t('purchases.total'),
      cell: ({ row }) => <span className="text-slate-900 dark:text-slate-100 font-medium">{formatCurrency(row.original.totalAmount)}</span>,
    },
    {
      accessorKey: 'status',
      header: t('purchases.status'),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'paymentType',
      header: t('purchases.invoice.paymentType'),
      cell: ({ row }) => {
        const pt = row.original.paymentType;
        return pt === 'cash'
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('purchases.invoice.cash')}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('purchases.invoice.credit')}</span>;
      },
    },
    {
      accessorKey: 'createdBy',
      header: t('common.createdBy'),
      size: 110,
      cell: ({ row }) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">{getUserName(row.original.createdBy)}</span>
      ),
    },
    {
      accessorKey: 'actions',
      header: t('purchases.actions'),
      cell: ({ row }) => {
        const inv = row.original;
        const isPosting = postingId === inv.id;
        return (
          <div className="flex items-center gap-1">
            <ActionButtons
              onView={() => openView(inv)}
              onEdit={inv.status === 'draft' ? () => openEdit(inv) : undefined}
              onDelete={inv.status === 'draft' ? () => handleDelete(inv.id) : undefined}
              onPrint={() => handlePrint(inv)}
              onExport={undefined}
              showView
              showEdit={inv.status === 'draft'}
              showDelete={inv.status === 'draft'}
              showPrint
              showExport={false}
              disabled={isPosting}
            />
            {inv.status === 'draft' && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<CheckSquare size={14} />}
                onClick={() => handlePost(inv)}
                disabled={isPosting}
                className="mr-1"
              >
                {isPosting ? t('loading') : t('accounting.post')}
              </Button>
            )}
            {inv.status !== 'draft' && (
              <span className="text-xs text-slate-400 flex items-center gap-1 mr-2">
                <BookOpen size={12} /> {t('accounting.posted')}
              </span>
            )}
          </div>
        );
      },
    },
  ], [t, postingId, openView, openEdit, handleDelete, handlePrint, handlePost, formatCurrency, formatDate, getUserName]);

  const canSave = form.supplierId && form.lines.length > 0 && form.lines.every(l => l.productId && l.quantity > 0);

  const kpis = useMemo(() => {
    const active = invoices.filter(i => i.status !== 'cancelled');
    const posted = invoices.filter(i => i.status === 'posted');
    const drafts = invoices.filter(i => i.status === 'draft').length;
    const totalPosted = posted.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
    const outstanding = active.reduce((s, i) => s + Math.max(0, Number(i.totalAmount || 0) - Number(i.paidAmount || 0)), 0);
    return { drafts, totalPosted, outstanding };
  }, [invoices]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-blue-600 shadow-xl shadow-indigo-900/10 dark:shadow-indigo-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-indigo-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('purchases.invoices')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('purchases.invoices')}</h2>
              <p className="text-indigo-100/80 text-base max-w-lg">{t('purchases.invoicesSubtitle')}</p>
            </div>
            <Can action="create" module="purchases">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('purchases.invoice.create')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('purchases.invoice.totalInvoices'), value: String(total), icon: FileText, color: 'from-indigo-600 to-indigo-700', bg: 'bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/10 dark:to-indigo-800/5' },
          { label: t('purchases.return.postedTotal'), value: formatCurrency(kpis.totalPosted), icon: ShoppingCart, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
          { label: t('purchases.return.drafts'), value: String(kpis.drafts), icon: Layers, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('purchases.invoice.outstanding'), value: formatCurrency(kpis.outstanding), icon: Wallet, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-indigo-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium">{t('purchases.status')}:</span>
            {[
              { v: '', l: t('purchases.filter.all') },
              { v: 'draft', l: t('purchases.filter.draft') },
              { v: 'posted', l: t('purchases.filter.posted') },
              { v: 'partially_paid', l: t('sales.status.partially_paid') },
              { v: 'paid', l: t('sales.status.paid') },
              { v: 'cancelled', l: t('purchases.filter.cancelled') },
            ].map((o) => (
              <button
                key={o.v || 'all'}
                onClick={() => setStatusFilter(o.v)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}
              >{o.l}</button>
            ))}
          </div>
          <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
        </div>
      </Card>

      <Card noPadding>
        <DataTablePro<PurchaseInvoice>
          data={invoices}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('purchases.invoice.emptyTitle')}
          onExportExcel={handleExportExcel}
          onExportPdf={handleExportPdf}
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
        title={editingId ? t('purchases.invoice.edit') : t('purchases.invoice.new')}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); }}
        size="3xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); }}>
              {t('cancel')}
            </Button>
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
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.invoice.linkOrder')}</label>
              <select
                className="form-control w-full"
                value={form.purchaseOrderId}
                onChange={e => setForm(prev => ({ ...prev, purchaseOrderId: e.target.value }))}
              >
                <option value="">{t('all')}</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>{o.orderNumber} - {o.supplier?.name || o.supplierId}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('purchases.date')} type="date" value={form.date} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
            <Input label={t('purchases.dueDate')} type="date" value={form.dueDate} onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.invoice.paymentType')}</label>
              <select
                className="form-control w-full"
                value={form.paymentType}
                onChange={e => {
                  const newType = e.target.value;
                  setForm(prev => ({
                    ...prev,
                    paymentType: newType,
                    // Auto-select default cash box / bank when switching to cash
                    cashBoxId: newType === 'cash' ? (prev.cashBoxId || defaultCashBoxId || '') : '',
                    bankAccountId: newType === 'cash' ? (prev.bankAccountId || defaultBankId || '') : '',
                  }));
                }}
                aria-label={t('purchases.invoice.paymentType')}
              >
                <option value="cash">{t('purchases.invoice.cash')}</option>
                <option value="credit">{t('purchases.invoice.credit')}</option>
              </select>
            </div>
            <Input label={t('purchases.notes')} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
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
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.currency')}</label>
              <CurrencySelect companyId={activeCompany?.id || ''} value={currencyCode} onChange={handleCurrencyChange} />
            </div>
            <Input
              label={t('purchases.exchangeRate')}
              type="number"
              min={0}
              step="0.0001"
              value={String(exchangeRate)}
              onChange={e => setExchangeRate(Number(e.target.value) || 1)}
            />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.baseCurrency')}</label>
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200">
                {formatCurrency(formTotals.totalAmount * exchangeRate)} <span className="text-slate-500">{currencySymbol}</span>
              </div>
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-sm">{t('purchases.invoice.lines')}</h4>
              <Button size="sm" variant="secondary" onClick={addLine} leftIcon={<Plus size={14} />}>
                {t('purchases.invoice.addLine')}
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <label className="text-xs text-slate-500">{t('inventory.productName')}</label>
                  <ProductSelect companyId={activeCompany?.id || ''} value={line.productId} onChange={v => updateLine(idx, { productId: Array.isArray(v) ? (v[0] || '') : (v || '') })} onProductChange={(p) => handleProductChange(idx, p)} showBarcode showStock size="sm" module="purchases" />
                </div>
                <div className="col-span-2">
                  <Input type="text" placeholder={t('description')} value={line.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                </div>
                <div className="col-span-1">
                  <Input type="number" placeholder={t('inventory.quantity')} value={String(line.quantity)} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <Input type="number" placeholder={t('inventory.unitPrice')} value={String(line.unitPrice)} onChange={e => updateLine(idx, { unitPrice: Number(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <Input type="number" placeholder={t('purchases.vat') + '%'} value={String(line.vatPercent)} onChange={e => updateLine(idx, { vatPercent: Number(e.target.value) })} />
                </div>
                <div className="col-span-1 text-sm font-medium text-slate-700 dark:text-slate-200 text-center">
                  {formatCurrency(line.lineTotal)}
                </div>
                <div className="col-span-1">
                  <Button size="sm" variant="ghost" onClick={() => removeLine(idx)} leftIcon={<Trash2 size={14} className="text-rose-500" />} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-sm border-t border-slate-200 dark:border-slate-700 pt-3">
            <span className="text-slate-500">{t('purchases.vat')}: {vatRate}%</span>
            <div className="space-y-1 text-end">
              <p>{t('purchases.subtotal')}: <strong>{formatCurrency(formTotals.subtotal)}</strong></p>
              <p>{t('purchases.vat')}: <strong>{formatCurrency(formTotals.vatAmount)}</strong></p>
              <p className="text-lg font-bold text-primary-600">{t('purchases.total')}: {formatCurrency(formTotals.totalAmount)}</p>
            </div>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={viewModalOpen}
        title={t('purchases.invoice.details')}
        onClose={() => setViewModalOpen(false)}
        size="lg"
      >
        {selectedInvoice && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">{t('purchases.invoiceNumber')}:</span> <strong>{selectedInvoice.invoiceNumber}</strong></div>
              <div><span className="text-slate-500">{t('purchases.supplier')}:</span> <strong>{selectedInvoice.supplier?.name || selectedInvoice.supplierId}</strong></div>
              <div><span className="text-slate-500">{t('purchases.date')}:</span> {selectedInvoice.date}</div>
              <div><span className="text-slate-500">{t('purchases.dueDate')}:</span> {selectedInvoice.dueDate}</div>
              <div><span className="text-slate-500">{t('purchases.status')}:</span> <StatusBadge status={selectedInvoice.status} /></div>
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
                  {(selectedInvoice.lines || []).map((line, idx) => (
                    <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2">{line.productName || line.description || t('inventory.productName')}</td>
                      <td className="p-2">{line.quantity}</td>
                      <td className="p-2">{formatCurrency(line.unitPrice)}</td>
                      <td className="p-2 font-medium">{formatCurrency(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-4 text-sm">
              <span>{t('purchases.subtotal')}: <strong>{formatCurrency(selectedInvoice.subtotal)}</strong></span>
              <span>{t('purchases.vat')}: <strong>{formatCurrency(selectedInvoice.vatAmount)}</strong></span>
              <span className="text-primary-600 font-bold">{t('purchases.total')}: {formatCurrency(selectedInvoice.totalAmount)}</span>
            </div>
            {selectedInvoice.notes && (
              <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                {t('notes')}: {selectedInvoice.notes}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>{t('close')}</Button>
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrint(selectedInvoice)}>{t('print')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title={t('purchases.invoice.deleteTitle')}
        message={t('purchases.invoice.deleteConfirm')}
        variant="danger"
      />

      {/* Confirm Post */}
      <ConfirmDialog
        isOpen={!!confirmPost}
        onClose={() => setConfirmPost(null)}
        onConfirm={confirmPostAction}
        title={t('purchases.invoice.postTitle')}
        message={t('purchases.invoice.postConfirm')}
        variant="warning"
      />
    </div>
  );
};

export default PurchaseInvoicesPage;
