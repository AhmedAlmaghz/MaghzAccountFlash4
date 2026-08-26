import React, { useState, useMemo, useCallback } from 'react';
import { FileText, Plus, CheckSquare, Trash2, Printer, Download, Paperclip, X, Search, Wallet, TrendingUp, Layers } from 'lucide-react';
import { Card, Button, Table, Input, Modal, Pagination, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CustomerSelect, ProductSelect, CurrencySelect, CashBoxSelect } from '@/core/ui/components/smart';
import { useInvoicesPaginated } from '../hooks/useSales';
import { useAppStore } from '@/core/store';
import { useToastStore } from '@/core/store/toastStore';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { useUserMap } from '@/core/utils/useUserMap';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { printDocument } from '@/core/utils/printDocument';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { salesApi } from '../api';
import { logAudit } from '@/core/utils/auditLogger';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import type { SalesInvoice, SalesInvoiceLine, InvoiceAttachment } from '../types';
import type { Product } from '@/modules/inventory/types';

interface InvoiceLineForm {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatPercent: number;
}

export const InvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const STATUS_FLOW = useMemo(() => ({
    draft: t('sales.status.draft'),
    posted: t('sales.status.posted'),
    partially_paid: t('sales.status.partially_paid'),
    paid: t('sales.status.paid'),
    cancelled: t('sales.status.cancelled'),
  }), [t]);
  const activeCompany = useAppStore(state => state.activeCompany);
  const currentUser = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
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
  } = useInvoicesPaginated(activeCompany?.id || '', useMemo(() => ({
    createdBy: isOwnOnly ? currentUser?.id : undefined,
    status: statusFilter || undefined,
  }), [isOwnOnly, currentUser?.id, statusFilter]));
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { getUserName } = useUserMap();
  const { currencies, defaultCurrency } = useCurrencyDisplay();
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SalesInvoice | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [postingId, setPostingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaultLine = useCallback((): InvoiceLineForm => ({
    productId: '', productName: '', quantity: 1, unitPrice: 0, discountPercent: 0, vatPercent: settings?.vatRate || 15,
  }), [settings?.vatRate]);

  const [header, setHeader] = useState({ customerId: '', date: new Date().toISOString().split('T')[0], dueDate: '', paymentType: 'credit', cashBoxId: '', notes: '' });
  const [currencyCode, setCurrencyCode] = useState<string>(defaultCurrency?.code || YER_CODE);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [lines, setLines] = useState<InvoiceLineForm[]>([defaultLine()]);
  const [attachments, setAttachments] = useState<InvoiceAttachment[]>([]);

  const resetForm = useCallback(() => {
    setHeader({ customerId: '', date: new Date().toISOString().split('T')[0], dueDate: '', paymentType: 'credit', cashBoxId: defaultCashBoxId || '', notes: '' });
    setCurrencyCode(defaultCurrency?.code || YER_CODE);
    setExchangeRate(1);
    setLines([defaultLine()]);
    setAttachments([]);
    setEditingId(null);
  }, [defaultLine, defaultCurrency?.code, defaultCashBoxId]);

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

  const openCreate = useCallback(async () => {
    resetForm();
    if (activeCompany?.id) {
      const seq = await getNextNumber('sales_invoice', activeCompany.id);
      if (seq.success && seq.number) {
        setFormOpen(true);
        return;
      }
    }
    setFormOpen(true);
  }, [activeCompany?.id, getNextNumber, resetForm]);

  const openEdit = useCallback((invoice: SalesInvoice) => {
    if (invoice.status !== 'draft') return;
    setEditingId(invoice.id);
    setHeader({
      customerId: invoice.customerId,
      date: invoice.date,
      dueDate: invoice.dueDate || '',
      paymentType: invoice.paymentType || 'credit',
      cashBoxId: invoice.cashBoxId || '',
      notes: invoice.notes || '',
    });
    setCurrencyCode(invoice.currencyCode || YER_CODE);
    setExchangeRate(invoice.exchangeRate ?? 1);
    setLines(invoice.lines.map(l => ({
      productId: l.productId,
      productName: l.productName || l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      vatPercent: l.vatPercent,
    })));
    setAttachments(invoice.attachments ?? []);
    setFormOpen(true);
  }, []);

  const addLine = () => setLines(prev => [...prev, defaultLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof InvoiceLineForm, value: string | number) => {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'productId' && typeof value === 'string') {
        next[idx].productName = value;
      }
      return next;
    });
  };

  /**
   * When the user picks a product from the dropdown, auto-fill the unit price
   * with the product's sale price (in the chosen invoice currency). If the
   * line was previously empty (price = 0) we always overwrite; otherwise we
   * leave the user's manual entry intact to avoid surprising edits.
   */
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
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (1 - l.discountPercent / 100)), 0);
    const vatAmount = lines.reduce((s, l) => {
      const lineNet = l.quantity * l.unitPrice * (1 - l.discountPercent / 100);
      return s + (lineNet * (l.vatPercent / 100));
    }, 0);
    const discountAmount = lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (l.discountPercent / 100)), 0);
    const totalAmount = subtotal + vatAmount;
    return { subtotal, vatAmount, discountAmount, totalAmount };
  }, [lines]);

  const buildInvoicePayload = (invoiceNumber: string): Omit<SalesInvoice, 'id'> => {
    const mappedLines: SalesInvoiceLine[] = lines.map(l => {
      const lineNet = l.quantity * l.unitPrice * (1 - l.discountPercent / 100);
      const lineVat = lineNet * (l.vatPercent / 100);
      const lineTotal = lineNet + lineVat;
      return {
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        vatPercent: l.vatPercent,
        lineTotal,
        currencyCode,
        exchangeRate,
        baseCurrencyLineTotal: lineTotal * exchangeRate,
      };
    });
    return {
      companyId: activeCompany!.id,
      invoiceNumber,
      customerId: header.customerId,
      date: header.date,
      dueDate: header.dueDate || undefined,
      subtotal: calculations.subtotal,
      discountAmount: calculations.discountAmount,
      vatAmount: calculations.vatAmount,
      totalAmount: calculations.totalAmount,
      paidAmount: 0,
      currencyCode,
      exchangeRate,
      baseCurrencyAmount: calculations.totalAmount * exchangeRate,
      baseCurrencyPaid: 0,
      paymentType: header.paymentType || 'credit',
      cashBoxId: header.paymentType === 'cash' ? (header.cashBoxId || undefined) : undefined,
      status: 'draft',
      notes: header.notes,
      attachments,
      lines: mappedLines,
    };
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      addToast('error', t('sales.invoice.attachmentTooLarge') || t('common.error'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const attachment: InvoiceAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl,
      };
      setAttachments(prev => [...prev, attachment]);
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

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
    let invoiceNumber: string;
    if (editingId) {
      const existing = invoices.find(i => i.id === editingId);
      invoiceNumber = existing?.invoiceNumber || '';
    } else {
      const seq = await getNextNumber('sales_invoice', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('sales.invoice.numberError'));
        setSaving(false);
        return;
      }
      invoiceNumber = seq.number;
    }
    const payload = buildInvoicePayload(invoiceNumber);
    if (editingId) {
      const res = await update(editingId, { ...payload, status: 'draft' });
      if (res.success) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'sales_invoices', recordId: editingId, companyId: activeCompany.id, newValues: payload });
        addToast('success', t('sales.invoice.updated'));
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } else {
      const res = await create(payload);
      if (res.success && res.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'create', tableName: 'sales_invoices', recordId: res.id, companyId: activeCompany.id, newValues: payload });
        addToast('success', t('sales.invoice.created'));
      } else {
        addToast('error', res.error || t('common.error'));
      }
    }
    setSaving(false);
    setFormOpen(false);
    resetForm();
  };

  const handleDelete = (invoice: SalesInvoice) => {
    if (invoice.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.invoice.deleteTitle'),
      message: `${t('sales.invoice.deleteConfirm')} ${invoice.invoiceNumber}؟`,
      variant: 'danger',
      confirmText: t('delete'),
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(invoice.id);
        if (res.success && activeCompany?.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'delete', tableName: 'sales_invoices', recordId: invoice.id, companyId: activeCompany.id });
          addToast('success', t('sales.invoice.deleted'));
        } else {
          addToast('error', res.error || t('common.error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePost = (invoice: SalesInvoice) => {
    if (invoice.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.invoice.postTitle'),
      message: `${t('sales.invoice.postConfirm')}`,
      variant: 'warning',
      confirmText: t('sales.invoice.post'),
      onConfirm: async () => {
        setConfirmOpen(false);
        if (!activeCompany?.id) return;
        setPostingId(invoice.id);
        // Single reference: the API posts atomically (JE + status flip + customer balance).
        const postResult = await post(invoice.id);
        if (postResult.success) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'post', tableName: 'sales_invoices', recordId: invoice.id, companyId: activeCompany.id });
          addToast('success', t('sales.invoice.posted'));
        } else {
          addToast('error', `${t('sales.invoice.postFailed')}: ${postResult.error || t('sales.invoice.unknownError')}`);
        }
        setPostingId(null);
      },
    });
    setConfirmOpen(true);
  };

  const handlePrint = async (invoice: SalesInvoice) => {
    let lines = invoice.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    printDocument({
      type: 'sales-invoice',
      docNumber: invoice.invoiceNumber,
      date: invoice.date,
      dueDate: invoice.dueDate,
      partyName: invoice.customer?.name || invoice.customerId,
      partyLabel: t('sales.customer.title'),
      partyTaxNumber: invoice.customer?.taxNumber,
      partyAddress: invoice.customer?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.productId,
        productCode: l.productCode,
        productName: l.productName,
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
  };

  const handleExportExcel = () => {
    const exportColumns = [
      { key: 'invoiceNumber', header: t('sales.invoiceNumber') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'dueDate', header: t('sales.dueDate') },
      { key: 'paymentType', header: t('sales.invoice.paymentType') },
      { key: 'currencyCode', header: t('sales.currency') },
      { key: 'status', header: t('sales.status.label') },
      { key: 'subtotal', header: t('sales.subtotal') },
      { key: 'vatAmount', header: t('sales.vat') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'paidAmount', header: t('sales.paid') },
      { key: 'itemsCount', header: t('sales.itemsCount') },
    ];
    const data = invoices.map(i => ({
      invoiceNumber: i.invoiceNumber,
      customerName: i.customer?.name || i.customerId,
      date: i.date,
      dueDate: i.dueDate || '-',
      paymentType: i.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit'),
      currencyCode: i.currencyCode || YER_CODE,
      status: STATUS_FLOW[i.status] || i.status,
      subtotal: i.subtotal,
      vatAmount: i.vatAmount,
      totalAmount: i.totalAmount,
      paidAmount: i.paidAmount,
      itemsCount: i.lines?.length || 0,
    }));
    exportToExcel(data, exportColumns, `sales_invoices_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPDF = () => {
    const exportColumns = [
      { key: 'invoiceNumber', header: t('sales.invoiceNumber'), width: 30 },
      { key: 'customerName', header: t('sales.customer.title'), width: 40 },
      { key: 'date', header: t('sales.date'), width: 20 },
      { key: 'status', header: t('sales.status.label'), width: 20 },
      { key: 'totalAmount', header: t('sales.total'), width: 25 },
    ];
    const data = invoices.map(i => ({
      invoiceNumber: i.invoiceNumber,
      customerName: i.customer?.name || i.customerId,
      date: i.date,
      status: STATUS_FLOW[i.status] || i.status,
      totalAmount: formatCurrency(i.totalAmount),
    }));
    exportToPDF(data, exportColumns, `sales_invoices_${new Date().toISOString().split('T')[0]}`, {
      title: t('sales.invoices'),
      rtl: true,
    });
  };

  const tableColumns = [
    {
      key: 'invoiceNumber',
      header: t('sales.invoiceNumber'),
      width: '135px',
      render: (row: SalesInvoice) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
          {row.invoiceNumber}
        </span>
      ),
    },
    {
      key: 'customerName',
      header: t('sales.customer.title'),
      render: (row: SalesInvoice) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(row.customer?.name || row.customerId || '?').charAt(0).toUpperCase()}
          </div>
          <span className="font-medium truncate">{row.customer?.name || row.customerId.slice(0, 8)}</span>
        </div>
      ),
    },
    { key: 'date', header: t('sales.date'), width: '110px', render: (row: SalesInvoice) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span> },
    { key: 'dueDate', header: t('sales.dueDate'), width: '110px', render: (row: SalesInvoice) => row.dueDate ? <span className="font-mono text-xs tabular-nums">{formatDate(row.dueDate)}</span> : <span className="text-slate-400">—</span> },
    { key: 'subtotal', header: t('sales.subtotal'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm">{formatCurrency(row.subtotal)}</span> },
    { key: 'vatAmount', header: t('sales.vat'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm text-slate-600">{formatCurrency(row.vatAmount)}</span> },
    {
      key: 'totalAmount',
      header: t('sales.total'),
      align: 'right' as const,
      render: (row: SalesInvoice) => (
        <div className="text-end">
          <p className="font-bold tabular-nums">{formatCurrency(row.totalAmount)}</p>
          {row.currencyCode && row.currencyCode !== currencySymbol && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-slate-600">{row.currencyCode}</span>}
        </div>
      ),
    },
    { key: 'paidAmount', header: t('sales.paid'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm text-emerald-700 dark:text-emerald-300">{formatCurrency(row.paidAmount)}</span> },
    {
      key: 'paymentType',
      header: t('sales.invoice.paymentType'),
      width: '95px',
      render: (row: SalesInvoice) => (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${row.paymentType === 'cash' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'}`}
        >
          {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
        </span>
      ),
    },
    { key: 'status', header: t('sales.status.label'), width: '110px', render: (row: SalesInvoice) => <StatusBadge status={row.status} /> },
    { key: 'createdBy', header: t('common.createdBy'), width: '110px', render: (row: SalesInvoice) => (
      <span className="text-xs text-slate-600 dark:text-slate-400">{getUserName(row.createdBy)}</span>
    ) },
    { key: 'actions', header: t('sales.actions'), width: '180px', render: (row: SalesInvoice) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getInvoiceById(row.id, activeCompany.id);
              if (res.success && res.data) { setViewing(res.data); setDetailOpen(true); return; }
            }
            setViewing(row); setDetailOpen(true);
          }}
          onEdit={row.status === 'draft' ? () => openEdit(row) : undefined}
          onDelete={row.status === 'draft' ? () => handleDelete(row) : undefined}
          onPrint={() => handlePrint(row)}
          showView
          showEdit={row.status === 'draft'}
          showDelete={row.status === 'draft'}
          showPrint
        />
        {row.status === 'draft' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handlePost(row)}
            disabled={postingId === row.id}
            leftIcon={<CheckSquare size={14} />}
          >
            {postingId === row.id ? (t('loading')) : (t('sales.invoice.post'))}
          </Button>
        )}
      </div>
    )},
  ];

  const stats = useMemo(() => {
    const active = invoices.filter(i => i.status !== 'cancelled');
    const total = active.reduce((s, i) => s + i.totalAmount, 0);
    const paid = active.reduce((s, i) => s + i.paidAmount, 0);
    const draftCount = invoices.filter(i => i.status === 'draft').length;
    const postedCount = active.length - draftCount;
    return { total, paid, draftCount, postedCount };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => (inv.invoiceNumber?.toLowerCase() || '').includes(q) || (inv.customer?.name?.toLowerCase() || '').includes(q) || inv.customerId.toLowerCase().includes(q));
  }, [invoices, search]);

  const hasFilters = !!(search || statusFilter);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <FileText size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('sales.invoices')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('sales.invoicesSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
            <Can action="create" module="sales">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">
                {t('sales.invoice.create')}
              </Button>
            </Can>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('sales.invoice.totalInvoices')}</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="text-xs text-slate-500">{stats.postedCount} مرحل • {stats.draftCount} مسودة</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <FileText size={18} className="text-primary-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('sales.total')}</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{formatCurrency(stats.total)}</p>
              <p className="text-xs text-slate-500">{currencySymbol} • إجمالي</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Wallet size={18} className="text-slate-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('sales.paid')}</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(stats.paid)}</p>
              <p className="text-xs text-slate-500">{currencySymbol} • محصل</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('sales.invoice.drafts')}</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{stats.draftCount}</p>
              <p className="text-xs text-slate-500">بانتظار الترحيل</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <Layers size={18} className="text-amber-600" />
            </div>
          </Card>
        </div>

        <Card className="p-3 sm:p-4">
          <div className="flex flex-col xl:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search')}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                {[
                  { v: '', l: t('sales.filter.all') },
                  { v: 'draft', l: t('sales.status.draft') },
                  { v: 'posted', l: t('sales.status.posted') },
                  { v: 'paid', l: t('sales.status.paid') },
                  { v: 'cancelled', l: t('sales.status.cancelled') },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setStatusFilter(o.v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${statusFilter === o.v ? 'bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
                <Download size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">Excel</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={handleExportPDF} className="gap-1.5">
                <Printer size={14} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
              </Button>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filteredInvoices.length} من {invoices.length} • {search ? `"${search}"` : ''} {statusFilter ? `• ${t('sales.status.' + statusFilter)}` : ''}</span>
              <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-primary-600 hover:underline font-medium">{t('sales.filter.clearFilters')}</button>
            </div>
          )}
        </Card>
      </div>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="file"
              title={t('sales.invoice.emptyTitle')}
              description={t('sales.invoice.emptyDescription')}
              action={
                <Can action="create" module="sales">
                  <Button onClick={openCreate} leftIcon={<Plus size={16} />}>{t('sales.invoice.create')}</Button>
                </Can>
              }
            />
          </div>
        ) : filteredInvoices.length === 0 ? (
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
            <Table<SalesInvoice> data={filteredInvoices} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Form Modal */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} size="3xl" title={editingId ? (t('sales.invoice.edit')) : (t('sales.invoice.new'))}>
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.customer.title')}</label>
              <CustomerSelect companyId={activeCompany?.id || ''} value={header.customerId} onChange={v => setHeader(prev => ({ ...prev, customerId: v || '' }))} />
            </div>
            <Input label={t('sales.date')} type="date" value={header.date} onChange={e => setHeader(prev => ({ ...prev, date: e.target.value }))} />
            <Input label={t('sales.dueDate')} type="date" value={header.dueDate} onChange={e => setHeader(prev => ({ ...prev, dueDate: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.invoice.paymentType')}</label>
              <select
                value={header.paymentType || 'credit'}
                onChange={e => {
                  const newType = e.target.value;
                  setHeader(prev => ({
                    ...prev,
                    paymentType: newType,
                    cashBoxId: newType === 'cash' ? (prev.cashBoxId || defaultCashBoxId || '') : '',
                  }));
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                aria-label={t('sales.invoice.paymentType')}
              >
                <option value="credit">{t('sales.invoice.credit')}</option>
                <option value="cash">{t('sales.invoice.cash')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.currency')}</label>
              <CurrencySelect companyId={activeCompany?.id || ''} value={currencyCode} onChange={handleCurrencyChange} />
            </div>
            <Input
              label={t('sales.exchangeRate')}
              type="number"
              min={0}
              step="0.0001"
              value={String(exchangeRate)}
              onChange={e => setExchangeRate(Number(e.target.value) || 1)}
            />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.baseCurrency')}</label>
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200">
                {formatCurrency(calculations.totalAmount * exchangeRate)} <span className="text-slate-500">{currencySymbol}</span>
              </div>
            </div>
          </div>

          {header.paymentType === 'cash' && (
            <div>
  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.cashBox')}</label>
  <CashBoxSelect companyId={activeCompany?.id || ''} value={header.cashBoxId || ''} onChange={v => setHeader(prev => ({ ...prev, cashBoxId: v || '' }))} />
  {defaultCashBoxId && header.cashBoxId === defaultCashBoxId && (
    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
  )}
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
                    <th className="px-2 py-1 text-right w-20">{t('sales.vat')}</th>
                    <th className="px-2 py-1 text-right w-24">{t('sales.total')}</th>
                    <th className="px-2 py-1 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const lineNet = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
                    const lineTotal = lineNet + (lineNet * (line.vatPercent / 100));
                    return (
                      <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1">
                          <ProductSelect
                            companyId={activeCompany?.id || ''}
                            value={line.productId}
                            onChange={v => updateLine(idx, 'productId', Array.isArray(v) ? (v[0] || '') : (v || ''))}
                            onProductChange={(p) => handleProductChange(idx, p)}
                            showStock
                            showBarcode
                            size="sm"
                            module="sales"
                          />
                        </td>
                        <td className="px-2 py-1"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1"><Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, 'discountPercent', Number(e.target.value))} size="sm" /></td>
                        <td className="px-2 py-1"><Input type="number" min={0} value={String(line.vatPercent)} onChange={e => updateLine(idx, 'vatPercent', Number(e.target.value))} size="sm" /></td>
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
            <Input label={t('sales.notes')} value={header.notes} onChange={e => setHeader(prev => ({ ...prev, notes: e.target.value }))} />
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>{t('sales.subtotal')}</span><span className="font-medium">{formatCurrency(calculations.subtotal)}</span></div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>{t('sales.discount')}</span><span className="font-medium">{formatCurrency(calculations.discountAmount)}</span></div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>{t('sales.vat')}</span><span className="font-medium">{formatCurrency(calculations.vatAmount)}</span></div>
              <div className="flex justify-between text-lg font-bold text-primary-600 dark:text-primary-400 pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>{t('sales.total')}</span>
                <span>{formatCurrency(calculations.totalAmount)}</span>
             </div>
           </div>
         </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('sales.invoice.attachments')}</label>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                <Paperclip size={14} />
                <span>{t('sales.invoice.addAttachment')}</span>
                <input type="file" className="hidden" onChange={handleAttachmentChange} />
             </label>
           </div>
            {attachments.length > 0 && (
              <ul className="space-y-1">
                {attachments.map(att => (
                  <li key={att.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md text-sm">
                    <a href={att.dataUrl} download={att.name} className="flex items-center gap-2 text-primary-600 dark:text-primary-400 hover:underline truncate">
                      <FileText size={14} />
                      <span className="truncate">{att.name}</span>
                      <span className="text-xs text-slate-500">({Math.round(att.size / 1024)} KB)</span>
                   </a>
                    <Button size="sm" variant="ghost" onClick={() => removeAttachment(att.id)} leftIcon={<X size={14} className="text-rose-500" />} aria-label={t('delete')} />
                 </li>
                ))}
             </ul>
            )}
         </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <Button variant="secondary" onClick={() => { setFormOpen(false); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleSave} isLoading={saving} leftIcon={<CheckSquare size={16} />}>{editingId ? (t('save')) : (t('sales.invoice.saveDraft'))}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} size="lg" title={`${t('sales.invoice.details')} - ${viewing?.invoiceNumber}`}>
        {viewing && (
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.customer.title')}</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.customer?.name || viewing.customerId}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.status.label')}</p>
                <StatusBadge status={viewing.status} />
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.date')}</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{formatDate(viewing.date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.dueDate')}</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.dueDate ? formatDate(viewing.dueDate) : '-'}</p>
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-right">#</th>
                    <th className="px-3 py-2 text-right">{t('inventory.productName')}</th>
                    <th className="px-3 py-2 text-right">{t('select.product.code')}</th>
                    <th className="px-3 py-2 text-right">{t('select.product.barcode')}</th>
                    <th className="px-3 py-2 text-right">{t('select.product.unit')}</th>
                    <th className="px-3 py-2 text-right">{t('inventory.quantity')}</th>
                    <th className="px-3 py-2 text-right">{t('inventory.unitPrice')}</th>
                    <th className="px-3 py-2 text-right">{t('sales.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.lines || []).map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.productName || l.productId}</td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-xs">{l.productCode || '-'}</td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-xs">{l.barcode || '-'}</td>
                      <td className="px-3 py-2 text-slate-500">{l.unit || '-'}</td>
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
                {viewing.baseCurrencyAmount !== undefined && viewing.baseCurrencyAmount > 0 && viewing.currencyCode !== currencySymbol && (
                  <p className="text-slate-500 dark:text-slate-400">{t('sales.baseCurrency')} ({currencySymbol}): <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.baseCurrencyAmount)}</span></p>
                )}
              </div>
              <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
                {t('sales.total')}: {formatCurrency(viewing.totalAmount)}
                {viewing.currencyCode && viewing.currencyCode !== currencySymbol && (
                  <span className="text-sm font-normal text-slate-500 mr-2">({viewing.currencyCode})</span>
                )}
              </div>
            </div>
            {viewing.attachments && viewing.attachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('sales.invoice.attachments')}</p>
                <ul className="space-y-1">
                  {viewing.attachments.map(att => (
                    <li key={att.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md text-sm">
                      <FileText size={14} className="text-slate-500" />
                      <a href={att.dataUrl} download={att.name} className="flex-1 text-primary-600 dark:text-primary-400 hover:underline truncate">
                        {att.name}
                       </a>
                      <span className="text-xs text-slate-500">({Math.round(att.size / 1024)} KB)</span>
                     </li>
                  ))}
                 </ul>
               </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailOpen(false)}>{t('close')}</Button>
              <Button variant="primary" onClick={() => { handlePrint(viewing); }} leftIcon={<Printer size={16} />}>{t('print')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Dialog */}
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

export default InvoicesPage;
