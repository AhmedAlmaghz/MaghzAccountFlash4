import React, { useState, useMemo, useCallback, useRef } from 'react';
import { FileText, Plus, CheckSquare, Trash2, Printer, Download, Paperclip, X, Wallet, TrendingUp, Layers, ShoppingCart, CheckCircle2, Clock } from 'lucide-react';
import { Card, Button, Table, Input, Modal, Pagination, Can, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectSalesInvoiceDuplicate } from '@/core/utils/documentDuplicate';
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
import { roundMoney } from '@/core/utils/locale';
import { useUserMap } from '@/core/utils/useUserMap';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { printDocument } from '@/core/utils/printDocument';
import { todayIso } from '@/core/utils/aging';
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
  const { formatCurrency, formatDate, decimalPlaces: dp } = useFormatters(activeCompany?.id || '');
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
  const [docDuplicateOpen, setDocDuplicateOpen] = useState(false);
  const [docDuplicateInput, setDocDuplicateInput] = useState('');
  const [docDuplicateExact, setDocDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [docDuplicateNear, setDocDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const docDuplicateConfirmedRef = useRef(false);

  const defaultLine = useCallback((): InvoiceLineForm => ({
    productId: '', productName: '', quantity: 1, unitPrice: 0, discountPercent: 0, vatPercent: settings?.vatRate || 15,
  }), [settings?.vatRate]);

  const [header, setHeader] = useState({ customerId: '', date: new Date().toISOString().split('T')[0], dueDate: '', paymentType: 'credit', cashBoxId: '', notes: '' });
  const [currencyCode, setCurrencyCode] = useState<string>(defaultCurrency?.code || YER_CODE);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [lines, setLines] = useState<InvoiceLineForm[]>([defaultLine()]);
  const [attachments, setAttachments] = useState<InvoiceAttachment[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'amount' | 'percent'>('amount');
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const showVat = settings?.invoiceShowVat ?? true;

  const resetForm = useCallback(() => {
    setHeader({ customerId: '', date: new Date().toISOString().split('T')[0], dueDate: '', paymentType: 'credit', cashBoxId: defaultCashBoxId || '', notes: '' });
    setCurrencyCode(defaultCurrency?.code || YER_CODE);
    setExchangeRate(1);
    setLines([defaultLine()]);
    setAttachments([]);
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
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
    // Invoice-level discount under subtotal — derive from stored discountAmount if visible
    if (showDiscount && invoice.discountAmount) {
      setInvoiceDiscount(invoice.discountAmount);
      setInvoiceDiscountType('amount');
    } else {
      setInvoiceDiscount(0);
    }
    setFormOpen(true);
  }, [showDiscount]);

  // Paginated rows carry lines: [] — refetch the full document so the edit
  // form shows its products instead of an empty list.
  const handleEditRow = async (invoice: SalesInvoice) => {
    let full = invoice;
    if ((!invoice.lines || invoice.lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data && res.data.lines.length > 0) full = res.data;
    }
    openEdit(full);
  };

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
    const lineDiscountTotal = showDiscount ? lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (l.discountPercent / 100)), 0) : 0;
    const subtotalBeforeInvoiceDiscount = lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (showDiscount ? (1 - l.discountPercent / 100) : 1)), 0);
    const invoiceDiscountAmount = showDiscount
      ? (invoiceDiscountType === 'percent' ? subtotalBeforeInvoiceDiscount * (invoiceDiscount / 100) : invoiceDiscount)
      : 0;
    const cappedInvoiceDiscount = Math.min(invoiceDiscountAmount, subtotalBeforeInvoiceDiscount);
    const netSubtotal = subtotalBeforeInvoiceDiscount - cappedInvoiceDiscount;
    const totalDiscountAmount = lineDiscountTotal + cappedInvoiceDiscount;
    const vatRate = settings?.vatRate ?? 15;
    const vatAmount = showVat ? netSubtotal * (vatRate / 100) : 0;
    const totalAmount = netSubtotal + vatAmount;
    return {
      subtotal: roundMoney(subtotalBeforeInvoiceDiscount, dp),
      vatAmount: roundMoney(vatAmount, dp),
      discountAmount: roundMoney(totalDiscountAmount, dp),
      invoiceDiscountAmount: roundMoney(cappedInvoiceDiscount, dp),
      totalAmount: roundMoney(totalAmount, dp),
      vatRate,
    };
  }, [lines, invoiceDiscount, invoiceDiscountType, showDiscount, showVat, settings?.vatRate, dp]);

  const buildInvoicePayload = (invoiceNumber: string): Omit<SalesInvoice, 'id'> => {
    const mappedLines: SalesInvoiceLine[] = lines.map(l => {
      const effectiveDiscount = showDiscount ? l.discountPercent : 0;
      const lineNet = l.quantity * l.unitPrice * (1 - effectiveDiscount / 100);
      // VAT is now invoice-level when showVat is enabled; line VAT is ignored in that mode
      const lineVat = showVat ? 0 : lineNet * (l.vatPercent / 100);
      const lineTotal = roundMoney(lineNet + lineVat, dp);
      return {
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: effectiveDiscount,
        vatPercent: showVat ? 0 : l.vatPercent,
        lineTotal,
        currencyCode,
        exchangeRate,
        baseCurrencyLineTotal: roundMoney(lineTotal * exchangeRate, dp),
      };
    });
    // When VAT is invoice-level, totals already include it; line totals are net, so add invoice VAT back via payload totals
    const payloadSubtotal = calculations.subtotal;
    const payloadDiscount = calculations.discountAmount;
    const payloadVat = calculations.vatAmount;
    const payloadTotal = calculations.totalAmount;
    return {
      companyId: activeCompany!.id,
      invoiceNumber,
      customerId: header.customerId,
      date: header.date,
      dueDate: header.dueDate || undefined,
      subtotal: payloadSubtotal,
      discountAmount: payloadDiscount,
      vatAmount: payloadVat,
      totalAmount: payloadTotal,
      paidAmount: 0,
      currencyCode,
      exchangeRate,
      baseCurrencyAmount: payloadTotal * exchangeRate,
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
    // ── حارس تكرار المستند — بصمة كاملة (حظر تام) + قريب (تحذير) ──
    if (!docDuplicateConfirmedRef.current) {
      try {
        const existingRes = await salesApi.getInvoicesPaginated(activeCompany.id, 1, 200);
        const existingList = (existingRes.success && existingRes.data ? ((existingRes.data as unknown as { items?: SalesInvoice[] })?.items ?? (existingRes.data as unknown as SalesInvoice[]) ?? []) : []) as SalesInvoice[];
        const inputForFp = {
          customerId: payload.customerId,
          date: payload.date,
          currencyCode: payload.currencyCode,
          totalAmount: payload.totalAmount,
          discountAmount: payload.discountAmount,
          vatAmount: payload.vatAmount,
          lines: payload.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent })),
        };
        const dup = detectSalesInvoiceDuplicate(inputForFp as never, existingList as never, editingId || undefined);
        if (dup.exactMatch) {
          const doc = dup.exactMatch as unknown as SalesInvoice;
          setDocDuplicateInput(`${payload.customerId} • ${payload.date} • ${payload.totalAmount}`);
          setDocDuplicateExact({ name: doc.invoiceNumber || String(doc.id).slice(0, 8), code: `${doc.date} • ${doc.totalAmount}` });
          setDocDuplicateNear([]);
          setDocDuplicateOpen(true);
          setSaving(false);
          return;
        }
        if (dup.nearMatches.length > 0) {
          setDocDuplicateInput(`${payload.customerId} • ${payload.date}`);
          setDocDuplicateNear(
            dup.nearMatches.map((m) => {
              const d = m.item as unknown as SalesInvoice;
              return { name: d.invoiceNumber || String(d.id).slice(0, 8), code: `${d.date} • ${d.totalAmount}`, score: m.score };
            }),
          );
          setDocDuplicateExact(null);
          setDocDuplicateOpen(true);
          setSaving(false);
          return;
        }
      } catch {
        /* فشل الفحص لا يمنع الحفظ */
      }
    }
    docDuplicateConfirmedRef.current = false;
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
    const isOverdue = invoice.dueDate ? invoice.dueDate < todayIso() : false;
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
      companyLogoUrl: activeCompany?.logoUrl,
      vatRate: settings?.vatRate ?? 15,
      currency: currencySymbol,
      paymentType: invoice.paymentType,
      createdBy: invoice.createdBy,
      statusBadge: STATUS_FLOW[invoice.status] || invoice.status,
      statusTone: invoice.status === 'paid' ? 'success' : (isOverdue ? 'warning' : 'muted'),
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
      mobile: 'title' as const,
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
      mobile: 'subtitle' as const,
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
    { key: 'status', header: t('sales.status.label'), width: '110px', mobile: 'status' as const, render: (row: SalesInvoice) => <StatusBadge status={row.status} /> },
    { key: 'createdBy', header: t('common.createdBy'), width: '110px', mobile: 'hidden' as const, render: (row: SalesInvoice) => (
      <span className="text-xs text-slate-600 dark:text-slate-400">{getUserName(row.createdBy)}</span>
    ) },
    { key: 'actions', header: t('sales.actions'), width: '180px', mobile: 'actions' as const, render: (row: SalesInvoice) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getInvoiceById(row.id, activeCompany.id);
              if (res.success && res.data) { setViewing(res.data); setDetailOpen(true); return; }
            }
            setViewing(row); setDetailOpen(true);
          }}
          onEdit={row.status === 'draft' ? () => handleEditRow(row) : undefined}
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
        <PageHeader
          icon={<ShoppingCart size={22} />}
          title={t('sales.invoices')}
          subtitle={t('sales.invoicesSubtitle')}
          actions={
            <>
              <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
              <Can action="create" module="sales">
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">
                  {t('sales.invoice.create')}
                </Button>
              </Can>
            </>
          }
        />

        <StatsGrid
          columns={4}
          items={[
            { label: t('sales.invoice.totalInvoices'), value: String(total), hint: `${stats.postedCount} مرحل • ${stats.draftCount} مسودة`, icon: <FileText size={18} /> },
            { label: t('sales.total'), value: formatCurrency(stats.total), hint: `${currencySymbol} • إجمالي`, icon: <Wallet size={18} />, tone: 'info' },
            { label: t('sales.paid'), value: formatCurrency(stats.paid), hint: `${currencySymbol} • محصل`, icon: <CheckCircle2 size={18} />, tone: 'success' },
            { label: t('sales.invoice.drafts'), value: String(stats.draftCount), hint: 'بانتظار الترحيل', icon: <Clock size={18} />, tone: 'warning' },
          ]}
        />

        <div>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('search')}
            filterOptions={[
              { key: '', label: t('sales.filter.all') },
              { key: 'draft', label: t('sales.status.draft') },
              { key: 'posted', label: t('sales.status.posted') },
              { key: 'paid', label: t('sales.status.paid') },
              { key: 'cancelled', label: t('sales.status.cancelled') },
            ]}
            activeFilter={statusFilter}
            onFilterChange={(key) => setStatusFilter(key)}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
                  <Download size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">Excel</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={handleExportPDF} className="gap-1.5">
                  <Printer size={14} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
                </Button>
              </>
            }
          />
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filteredInvoices.length} من {invoices.length} • {search ? `"${search}"` : ''} {statusFilter ? `• ${t('sales.status.' + statusFilter)}` : ''}</span>
              <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-primary-600 hover:underline font-medium">{t('sales.filter.clearFilters')}</button>
            </div>
          )}
        </div>
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

      {/* Form Modal — Modern Full-Featured Invoice Editor */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} size="4xl" title={editingId ? (t('sales.invoice.edit')) : (t('sales.invoice.new'))}>
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

          {/* ===== Enlarged Modern Items Section — The Heart of the Invoice ===== */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
            <div className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <Layers size={18} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    {t('sales.invoice.lines')}
                    <span className="text-xs font-normal bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border">{lines.length} {t('sales.itemsCount')}</span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">{t('sales.invoice.linesDesc') || 'أضف المنتجات والكميات — الأسعار تُملأ تلقائياً'}</p>
                </div>
              </div>
              <Button size="sm" onClick={addLine} leftIcon={<Plus size={14} />} className="shadow-sm">{t('sales.invoice.addLine')}</Button>
            </div>
            <div className="hidden md:block overflow-x-auto">
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
                    const lineNet = line.quantity * line.unitPrice * (showDiscount ? (1 - line.discountPercent / 100) : 1);
                    const lineTotal = lineNet;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group">
                        <td className="px-3 py-3">
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
                        <td className="px-3 py-2"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" className="text-center font-medium" /></td>
                        <td className="px-3 py-2"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" className="text-right tabular-nums" /></td>
                        {showDiscount && <td className="px-3 py-2"><Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, 'discountPercent', Number(e.target.value))} size="sm" className="text-center" /></td>}
                        <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-slate-50 tabular-nums bg-slate-50/50 dark:bg-slate-800/30">{formatCurrency(lineTotal)}</td>
                        <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => removeLine(idx)} className="opacity-60 group-hover:opacity-100 hover:bg-rose-50 dark:hover:bg-rose-900/20" leftIcon={<Trash2 size={14} className="text-rose-500" />} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile line-items cards */}
            <div className="md:hidden space-y-3 p-3">
              {lines.map((line, idx) => {
                const lineNet = line.quantity * line.unitPrice * (showDiscount ? (1 - line.discountPercent / 100) : 1);
                const lineTotal = lineNet;
                return (
                  <div key={idx} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3">
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
                    <div className="grid grid-cols-2 gap-3">
                      <Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" className="text-center font-medium" />
                      <Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" className="text-right tabular-nums" />
                    </div>
                    {showDiscount && <Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, 'discountPercent', Number(e.target.value))} size="sm" className="text-center" />}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(lineTotal)}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeLine(idx)} className="hover:bg-rose-50 dark:hover:bg-rose-900/20" leftIcon={<Trash2 size={14} className="text-rose-500" />} />
                    </div>
                  </div>
                );
              })}
            </div>
            {lines.length === 0 && (
              <div className="py-12 text-center text-slate-400">
                <Layers size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('sales.invoice.emptyLines') || 'لا توجد سطور — أضف منتجاً للبدء'}</p>
              </div>
            )}
          </div>

          {/* ===== Modern Totals Card — Discount under Subtotal per Settings ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <Input label={t('sales.notes')} value={header.notes} onChange={e => setHeader(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('sales.notesPlaceholder') || 'ملاحظات إضافية للفاتورة...'} />
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1"><Paperclip size={12} /> {t('sales.invoice.notesHint') || 'ستظهر الملاحظات في الطباعة وكشف الحساب'}</p>
            </div>
            <div className="lg:col-span-2 order-first lg:order-last rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50">
              <div className="px-4 py-3 bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2"><Wallet size={16} /> {t('sales.invoice.summary')}</span>
                <span className="text-xs bg-white/15 px-2 py-1 rounded-full">{lines.length} {t('sales.itemsCount')}</span>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2"><Layers size={14} className="text-slate-400" /> {t('sales.subtotal')}</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(calculations.subtotal)}</span>
                </div>
                {showDiscount && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-100 flex items-center gap-1.5">٪ {t('sales.discount')}</span>
                      <div className="flex items-center gap-1 bg-white dark:bg-slate-800 rounded-full p-1 border">
                        <button onClick={() => setInvoiceDiscountType('amount')} className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${invoiceDiscountType === 'amount' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow' : 'text-slate-600'}`}>{currencySymbol}</button>
                        <button onClick={() => setInvoiceDiscountType('percent')} className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${invoiceDiscountType === 'percent' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow' : 'text-slate-600'}`}>%</button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input type="number" min={0} max={invoiceDiscountType === 'percent' ? 100 : undefined} value={String(invoiceDiscount)} onChange={e => setInvoiceDiscount(Math.max(0, Number(e.target.value) || 0))} placeholder="0" size="sm" className="flex-1" />
                      <div className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border text-sm font-bold tabular-nums min-w-[110px] text-center text-amber-700 dark:text-amber-300">
                        -{formatCurrency(calculations.invoiceDiscountAmount)}
                      </div>
                    </div>
                    {invoiceDiscount > 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {invoiceDiscountType === 'percent' ? `${invoiceDiscount}% ${t('sales.discount')} = ${formatCurrency(calculations.invoiceDiscountAmount)}` : `${t('sales.discount')} ${formatCurrency(calculations.invoiceDiscountAmount)}`}
                      </p>
                    )}
                  </div>
                )}
                {showVat ? (
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                      {t('sales.vat')} <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">{calculations.vatRate}%</span>
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(calculations.vatAmount)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700 opacity-60">
                    <span className="text-slate-500 text-xs">{t('sales.vat')} — {t('settings.vat.disabled') || 'غير مفعّل'}</span>
                    <span className="text-xs">{formatCurrency(0)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2"><TrendingUp size={16} className="text-primary-600" /> {t('sales.total')}</span>
                  <span className="text-xl font-black tabular-nums text-primary-600 dark:text-primary-400">{formatCurrency(calculations.totalAmount)}</span>
                </div>
                <p className="text-xs text-slate-400 text-center pt-2 border-t border-slate-100 dark:border-slate-700">
                  {currencySymbol} {t('sales.baseCurrency')} • {formatCurrency(calculations.totalAmount * exchangeRate)} {t('sales.invoice.baseTotal') || 'بالأساسية'}
                </p>
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

      <DuplicateWarningDialog
        isOpen={docDuplicateOpen}
        onClose={() => setDocDuplicateOpen(false)}
        onConfirm={() => {
          docDuplicateConfirmedRef.current = true;
          setDocDuplicateOpen(false);
          void handleSave();
        }}
        inputName={docDuplicateInput}
        entityLabel={t('sales.invoices')}
        exactMatch={docDuplicateExact}
        nearMatches={docDuplicateNear}
        isDocument
        isEdit={!!editingId}
      />
    </div>
  );
};

export default InvoicesPage;
