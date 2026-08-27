import React, { useState, useMemo, useCallback } from 'react';
import { Tag, Plus, FileText, CheckSquare, Trash2, Printer, ArrowRightLeft, Search, X, Layers, Sparkles, Download } from 'lucide-react';
import { Card, Button, Table, Input, Modal, Pagination, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CustomerSelect, ProductSelect, CashBoxSelect } from '@/core/ui/components/smart';
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
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
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
  } = useQuotationsPaginated(activeCompany?.id || '', useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]));

  const filteredQuotations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter((qt) => (qt.quotationNumber?.toLowerCase() || '').includes(q) || (qt.customer?.name?.toLowerCase() || '').includes(q));
  }, [quotations, search]);
  const hasFilters = !!(search || statusFilter);
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Quotation | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [header, setHeader] = useState({ customerId: '', date: new Date().toISOString().split('T')[0], expiryDate: '', paymentType: 'credit', cashBoxId: '', notes: '' });
  const [lines, setLines] = useState<QuotationLineForm[]>([{ productId: '', productName: '', quantity: 1, unitPrice: 0, discountPercent: 0 }]);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'amount' | 'percent'>('amount');
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const showVat = settings?.invoiceShowVat ?? true;

  const defaultLine = (): QuotationLineForm => ({ productId: '', productName: '', quantity: 1, unitPrice: 0, discountPercent: 0 });

  const resetForm = useCallback(() => {
    setHeader({ customerId: '', date: new Date().toISOString().split('T')[0], expiryDate: '', paymentType: 'credit', cashBoxId: defaultCashBoxId || '', notes: '' });
    setLines([defaultLine()]);
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
    setEditingId(null);
  }, [defaultCashBoxId]);

  const openCreate = useCallback(async () => {
    resetForm();
    setFormOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((q: Quotation) => {
    if (q.status === 'converted') return;
    setEditingId(q.id);
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
    const lineDiscountTotal = showDiscount ? lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (l.discountPercent / 100)), 0) : 0;
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (showDiscount ? (1 - l.discountPercent / 100) : 1)), 0);
    const invoiceDiscountAmount = showDiscount ? (invoiceDiscountType === 'percent' ? subtotal * (invoiceDiscount / 100) : invoiceDiscount) : 0;
    const cappedInvoiceDiscount = Math.min(invoiceDiscountAmount, subtotal);
    const netSubtotal = subtotal - cappedInvoiceDiscount;
    const vatRate = settings?.vatRate ?? 15;
    const vatAmount = showVat ? netSubtotal * (vatRate / 100) : 0;
    const totalAmount = netSubtotal + vatAmount;
    return { subtotal, vatAmount, discountAmount: lineDiscountTotal + cappedInvoiceDiscount, invoiceDiscountAmount: cappedInvoiceDiscount, totalAmount, vatRate };
  }, [lines, invoiceDiscount, invoiceDiscountType, showDiscount, showVat, settings?.vatRate]);

  const buildPayload = (quotationNumber: string): Omit<Quotation, 'id'> => ({
    companyId: activeCompany!.id,
    quotationNumber,
    customerId: header.customerId,
    date: header.date,
    expiryDate: header.expiryDate || undefined,
    totalAmount: calculations.totalAmount,
    paymentType: header.paymentType || 'credit',
    cashBoxId: header.paymentType === 'cash' ? (header.cashBoxId || undefined) : undefined,
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

  const handleExportPdf = () => {
    const exportColumns = [
      { key: 'quotationNumber', header: t('sales.quotation.number') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'expiryDate', header: t('sales.quotation.expiry') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToPDF(filteredQuotations.map(q => ({ quotationNumber: q.quotationNumber, customerName: q.customer?.name || q.customerId, date: q.date, expiryDate: q.expiryDate || '-', totalAmount: formatCurrency(q.totalAmount), status: STATUS_FLOW[q.status] || q.status })), exportColumns, `quotations_${new Date().toISOString().split('T')[0]}`, {
      title: t('sales.quotations'),
      rtl: true,
    });
  };

  const kpis = useMemo(() => {
    const accepted = quotations.filter(q => q.status === 'accepted').length;
    const draft = quotations.filter(q => q.status === 'draft').length;
    const converted = quotations.filter(q => q.status === 'converted').length;
    const totalValue = quotations.reduce((s, q) => s + Number(q.totalAmount || 0), 0);
    return { accepted, draft, converted, totalValue };
  }, [quotations]);

  const tableColumns = [
    {
      key: 'quotationNumber',
      header: t('sales.quotation.number'),
      width: '135px',
      render: (row: Quotation) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <Tag size={12} className="text-primary-500" />
          {row.quotationNumber}
       </span>
      ),
    },
    {
      key: 'customerName',
      header: t('sales.customer.title'),
      render: (row: Quotation) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(row.customer?.name || row.customerId || '?').charAt(0).toUpperCase()}
         </div>
          <span className="font-medium truncate">{row.customer?.name || row.customerId.slice(0, 8)}</span>
       </div>
      ),
    },
    { key: 'date', header: t('sales.date'), width: '110px', render: (row: Quotation) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span> },
    { key: 'expiryDate', header: t('sales.quotation.expiry'), width: '110px', render: (row: Quotation) => row.expiryDate ? <span className="font-mono text-xs tabular-nums">{formatDate(row.expiryDate)}</span> : <span className="text-slate-400">—</span> },
    { key: 'totalAmount', header: t('sales.total'), align: 'right' as const, render: (row: Quotation) => <span className="font-bold tabular-nums">{formatCurrency(row.totalAmount)}</span> },
    {
      key: 'paymentType',
      header: t('sales.quotation.paymentType'),
      width: '95px',
      render: (row: Quotation) => (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${row.paymentType === 'cash' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'}`}
        >
          {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
       </span>
      ),
    },
    { key: 'status', header: t('sales.status.label'), width: '110px', render: (row: Quotation) => <StatusBadge status={row.status} /> },
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
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-700 via-violet-600 to-fuchsia-600 shadow-xl shadow-violet-900/10 dark:shadow-violet-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-violet-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('sales.quotations')}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-violet-100/60">{activeCompany?.name || ''}</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('sales.quotations')}</h2>
          <p className="text-violet-100/80 text-base max-w-lg">{t('sales.quotationsSubtitle')}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('sales.quotation.total'), value: quotations.length, icon: Sparkles, color: 'from-violet-600 to-violet-700', bg: 'bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-900/10 dark:to-violet-800/5' },
          { label: t('sales.quotation.accepted'), value: kpis.accepted, icon: CheckSquare, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
          { label: t('sales.quotation.convertedCount'), value: kpis.converted, icon: ArrowRightLeft, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('sales.quotation.drafts'), value: kpis.draft, icon: FileText, color: 'from-rose-600 to-rose-700', bg: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/10 dark:to-rose-800/5' },
        ].map((k) => (
          <Card key={k.label} className="p-0 overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${k.color}`} />
            <div className={`flex items-start gap-3 p-4 ${k.bg} dark:text-white`}>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
                <k.icon size={20} className="text-slate-700 dark:text-slate-200" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight">{k.label}</p>
                <p className="text-2xl font-extrabold tabular-nums leading-tight mt-1">{k.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-violet-500/30">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('search')}
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-colors placeholder:text-slate-400"
              aria-label={t('search')}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Clear"><X size={14} /></button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium">{t('sales.status.label')}:</span>
            {[
              { value: '', label: t('sales.filter.all') },
              { value: 'draft', label: t('sales.status.draft') },
              { value: 'sent', label: t('sales.status.sent') },
              { value: 'accepted', label: t('sales.status.accepted') },
              { value: 'rejected', label: t('sales.status.rejected') },
              { value: 'converted', label: t('sales.status.converted') },
            ].map((opt) => (
              <button
                key={opt.value || 'all'}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === opt.value ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-300'}`}
              >{opt.label}</button>
            ))}
          </div>
          <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
          <Can action="create" module="sales">
            <Button size="sm" variant="primary" leftIcon={<Plus size={15} />} onClick={openCreate}>{t('sales.quotation.create')}</Button>
          </Can>
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Button size="sm" variant="secondary" onClick={handleExportExcel} leftIcon={<Download size={15} className="text-emerald-600" />}>Excel</Button>
            <Button size="sm" variant="secondary" onClick={handleExportPdf} leftIcon={<Printer size={15} />}>PDF</Button>
          </div>
        </div>
      </Card>

      {/* Filter result count */}
      {hasFilters && (
        <div className="text-xs text-slate-500 flex items-center gap-2 px-1">
          <span>{filteredQuotations.length} من {quotations.length}</span>
          {search ? <span>• &ldquo;{search}&rdquo;</span> : null}
          {statusFilter ? <span>• {t('sales.status.' + statusFilter)}</span> : null}
          <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-violet-600 hover:underline font-medium ml-2">{t('sales.filter.clearFilters')}</button>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between py-1 px-1">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('sales.quotations')}</h3>
          <span className="text-[11px] uppercase tracking-widest text-slate-400 font-medium">{quotations.length}</span>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}
          </div>
        ) : quotations.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('sales.quotation.emptyTitle')}
              description={t('sales.quotation.emptyDesc')}
              action={<Can action="create" module="sales"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('sales.quotation.create')}</Button></Can>}
            />
          </div>
        ) : filteredQuotations.length === 0 ? (
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
            <Table<Quotation> data={filteredQuotations} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} />
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

      {/* Form Modal — Modern Quotation Editor */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} size="4xl" title={editingId ? (t('sales.quotation.edit')) : (t('sales.quotation.new'))}>
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
            </div>
          )}

          {/* Enlarged Modern Items — Quotations */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
            <div className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                  <Layers size={18} className="text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    {t('sales.invoice.lines')}
                    <span className="text-xs font-normal bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border">{lines.length} {t('sales.itemsCount')}</span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">أضف المنتجات — الأسعار تُملأ تلقائياً</p>
                </div>
              </div>
              <Button size="sm" onClick={addLine} leftIcon={<Plus size={14} />} className="shadow-sm">{t('sales.invoice.addLine')}</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-right font-semibold w-[48%]">{t('inventory.productName')}</th>
                    <th className="px-3 py-3 text-center font-semibold w-24">{t('inventory.quantity')}</th>
                    <th className="px-3 py-3 text-right font-semibold w-32">{t('inventory.unitPrice')}</th>
                    {showDiscount && <th className="px-3 py-3 text-center font-semibold w-24">{t('sales.discount')} %</th>}
                    <th className="px-4 py-3 text-right font-semibold w-32">{t('sales.total')}</th>
                    <th className="px-2 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lines.map((line, idx) => {
                    const lineTotal = line.quantity * line.unitPrice * (showDiscount ? (1 - line.discountPercent / 100) : 1);
                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group">
                        <td className="px-3 py-3"><ProductSelect companyId={activeCompany?.id || ''} value={line.productId} onChange={v => updateLine(idx, 'productId', Array.isArray(v) ? (v[0] || '') : (v || ''))} onProductChange={(p) => handleProductChange(idx, p)} showBarcode showStock size="sm" module="sales" /></td>
                        <td className="px-3 py-2"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" className="text-center font-medium" /></td>
                        <td className="px-3 py-2"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" className="text-right tabular-nums" /></td>
                        {showDiscount && <td className="px-3 py-2"><Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, 'discountPercent', Number(e.target.value))} size="sm" className="text-center" /></td>}
                        <td className="px-4 py-3 text-right font-bold tabular-nums bg-slate-50/50 dark:bg-slate-800/30">{formatCurrency(lineTotal)}</td>
                        <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => removeLine(idx)} className="opacity-60 group-hover:opacity-100 hover:bg-rose-50" leftIcon={<Trash2 size={14} className="text-rose-500" />} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <Input label={t('sales.notes')} value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))} placeholder="ملاحظات العرض..." />
            </div>
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50">
              <div className="px-4 py-3 bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between">
                <span className="text-sm font-semibold">الملخص</span>
                <span className="text-xs bg-white/15 px-2 py-1 rounded-full">{lines.length} صنف</span>
              </div>
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-dashed border-slate-200 dark:border-slate-700"><span className="text-slate-600 dark:text-slate-300">{t('sales.subtotal')}</span><span className="font-semibold tabular-nums">{formatCurrency(calculations.subtotal)}</span></div>
                {showDiscount && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-100">٪ {t('sales.discount')}</span>
                      <div className="flex gap-1 bg-white dark:bg-slate-800 rounded-full p-1 border">
                        <button onClick={() => setInvoiceDiscountType('amount')} className={`px-2.5 py-1 rounded-full text-xs font-medium ${invoiceDiscountType === 'amount' ? 'bg-slate-900 text-white shadow' : 'text-slate-600'}`}>{currencySymbol}</button>
                        <button onClick={() => setInvoiceDiscountType('percent')} className={`px-2.5 py-1 rounded-full text-xs font-medium ${invoiceDiscountType === 'percent' ? 'bg-slate-900 text-white shadow' : 'text-slate-600'}`}>%</button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input type="number" min={0} value={String(invoiceDiscount)} onChange={e => setInvoiceDiscount(Math.max(0, Number(e.target.value) || 0))} size="sm" className="flex-1" />
                      <div className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border text-sm font-bold min-w-[110px] text-center text-amber-700">-{formatCurrency(calculations.invoiceDiscountAmount)}</div>
                    </div>
                  </div>
                )}
                {showVat ? (
                  <div className="flex justify-between py-2 border-b border-dashed border-slate-200 dark:border-slate-700"><span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">{t('sales.vat')} <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{calculations.vatRate}%</span></span><span className="font-semibold text-emerald-700">{formatCurrency(calculations.vatAmount)}</span></div>
                ) : (
                  <div className="flex justify-between py-2 border-b border-dashed opacity-60 text-xs"><span>{t('sales.vat')} — غير مفعّل</span><span>{formatCurrency(0)}</span></div>
                )}
                <div className="flex justify-between items-center pt-2"><span className="font-black text-slate-900 dark:text-white">{t('sales.total')}</span><span className="text-xl font-black text-violet-600">{formatCurrency(calculations.totalAmount)}</span></div>
              </div>
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
