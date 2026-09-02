import React, { useState, useMemo, useCallback, useRef } from 'react';
import { FileText, Plus, CheckSquare, BookOpen, Trash2, Printer, Wallet, Layers, ShoppingCart, TrendingUp, Store, Receipt } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { useUserMap } from '@/core/utils/useUserMap';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Input, Pagination, Can, Table, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { purchaseInvoiceFingerprint, detectDocumentDuplicates, genericNearScore } from '@/core/utils/documentDuplicate';
import { SupplierSelect, ProductSelect, CurrencySelect, CashBoxSelect } from '@/core/ui/components/smart';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseInvoicesPaginated } from '../hooks/usePurchases';
import { usePurchaseOrders } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';
import type { PurchaseInvoice } from '../types';
import type { Product } from '@/modules/inventory/types';

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
  const [search, setSearch] = useState('');
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
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceForm>(initialForm(defaultCashBoxId ?? undefined));
  const [currencyCode, setCurrencyCode] = useState<string>(defaultCurrency?.code || YER_CODE);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'amount' | 'percent'>('amount');
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const showVat = settings?.invoiceShowVat ?? true;
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  const [docDuplicateOpen, setDocDuplicateOpen] = useState(false);
  const [docDuplicateInput, setDocDuplicateInput] = useState('');
  const [docDuplicateExact, setDocDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [docDuplicateNear, setDocDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const docDuplicateConfirmedRef = useRef(false);

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
    const effectiveDiscount = showDiscount ? line.discountPercent : 0;
    const gross = line.quantity * line.unitPrice;
    const discount = gross * (effectiveDiscount / 100);
    const net = gross - discount;
    const vat = showVat ? 0 : net * (line.vatPercent / 100);
    const total = net + vat;
    return { ...line, lineTotal: Number(total.toFixed(2)) };
  }, [showDiscount, showVat]);

  const formTotals = useMemo(() => {
    const lineDiscountTotal = showDiscount ? form.lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (l.discountPercent / 100)), 0) : 0;
    const subtotalBeforeInvoiceDiscount = form.lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (showDiscount ? (1 - l.discountPercent / 100) : 1)), 0);
    const invoiceDiscountAmount = showDiscount
      ? (invoiceDiscountType === 'percent' ? subtotalBeforeInvoiceDiscount * (invoiceDiscount / 100) : invoiceDiscount)
      : 0;
    const cappedInvoiceDiscount = Math.min(invoiceDiscountAmount, subtotalBeforeInvoiceDiscount);
    const netSubtotal = subtotalBeforeInvoiceDiscount - cappedInvoiceDiscount;
    const totalDiscountAmount = lineDiscountTotal + cappedInvoiceDiscount;
    const vatAmount = showVat ? netSubtotal * (vatRate / 100) : 0;
    const totalAmount = netSubtotal + vatAmount;
    return {
      subtotal: Number(subtotalBeforeInvoiceDiscount.toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
      discountAmount: Number(totalDiscountAmount.toFixed(2)),
      invoiceDiscountAmount: Number(cappedInvoiceDiscount.toFixed(2)),
      totalAmount: Number(totalAmount.toFixed(2)),
      vatRate,
    };
  }, [form.lines, invoiceDiscount, invoiceDiscountType, showDiscount, showVat, vatRate]);

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
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
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
    if (showDiscount && invoice.discountAmount) {
      setInvoiceDiscount(invoice.discountAmount);
      setInvoiceDiscountType('amount');
    } else {
      setInvoiceDiscount(0);
    }
    setModalOpen(true);
  }, [vatRate, showDiscount]);

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
    const mappedLines = form.lines.map(l => {
      const effectiveDiscount = showDiscount ? l.discountPercent : 0;
      const lineNet = l.quantity * l.unitPrice * (1 - effectiveDiscount / 100);
      const lineVat = showVat ? 0 : lineNet * (l.vatPercent / 100);
      const lineTotal = lineNet + lineVat;
      return {
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: effectiveDiscount,
        vatPercent: showVat ? 0 : l.vatPercent,
        lineTotal,
        currencyCode,
        exchangeRate,
        baseCurrencyLineTotal: lineTotal * exchangeRate,
      };
    });
    const payload = {
      companyId: activeCompany.id,
      invoiceNumber: editingId ? existingInvoice!.invoiceNumber : '',
      supplierId: form.supplierId,
      purchaseOrderId: form.purchaseOrderId || undefined,
      date: form.date,
      dueDate: form.dueDate,
      subtotal: formTotals.subtotal,
      discountAmount: formTotals.discountAmount,
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
      notes: form.notes,
      lines: mappedLines,
    };
    if (!docDuplicateConfirmedRef.current) {
      try {
        const existingRes = await purchasesApi.getInvoicesPaginated(activeCompany.id, 1, 200);
        const existingList = (existingRes.success && existingRes.data ? ((existingRes.data as unknown as { items?: unknown[] })?.items ?? (existingRes.data as unknown as unknown[]) ?? []) : []) as unknown[];
        const inputForFp = {
          supplierId: payload.supplierId,
          date: payload.date,
          currencyCode: payload.currencyCode,
          totalAmount: payload.totalAmount,
          lines: payload.lines.map((l: unknown) => {
            const x = l as { productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown };
            return { productId: x.productId, quantity: x.quantity, unitPrice: x.unitPrice, discountPercent: x.discountPercent };
          }),
        };
        const fp = purchaseInvoiceFingerprint(inputForFp as never);
        const getFp = (d: unknown) => {
          const x = d as { supplierId?: string; date?: string; currencyCode?: string; totalAmount?: unknown };
          return purchaseInvoiceFingerprint({ supplierId: x.supplierId, date: x.date, currencyCode: x.currencyCode, totalAmount: x.totalAmount } as never);
        };
        const getNear = (inp: unknown, ex: unknown) => {
          const a = inp as { supplierId?: string; date?: string; lines?: Array<{ productId?: string }>; totalAmount?: unknown };
          const b = ex as { supplierId?: string; date?: string; lines?: Array<{ productId?: string }>; totalAmount?: unknown };
          return genericNearScore(a.supplierId, b.supplierId, a.date, b.date, a.lines ?? [], b.lines ?? [], a.totalAmount, b.totalAmount);
        };
        const dup = detectDocumentDuplicates(fp, inputForFp, existingList as never[], getFp, getNear, { excludeId: editingId || undefined });
        if (dup.exactMatch) {
          const doc = dup.exactMatch as unknown as { invoiceNumber?: string; id: string; date?: string; totalAmount?: unknown };
          setDocDuplicateInput(`${payload.supplierId} • ${payload.date} • ${payload.totalAmount}`);
          setDocDuplicateExact({ name: doc.invoiceNumber || String(doc.id).slice(0, 8), code: `${doc.date} • ${doc.totalAmount}` });
          setDocDuplicateNear([]);
          setDocDuplicateOpen(true);
          return;
        }
        if (dup.nearMatches.length) {
          setDocDuplicateInput(`${payload.supplierId} • ${payload.date}`);
          setDocDuplicateNear(
            dup.nearMatches.map((m: { item: unknown; score: number }) => {
              const d = m.item as unknown as { invoiceNumber?: string; id: string; date?: string; totalAmount?: unknown };
              return { name: d.invoiceNumber || String(d.id).slice(0, 8), code: `${d.date} • ${d.totalAmount}`, score: m.score };
            }),
          );
          setDocDuplicateExact(null);
          setDocDuplicateOpen(true);
          return;
        }
      } catch {}
    }
    docDuplicateConfirmedRef.current = false;

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
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
  }, [activeCompany, form, formTotals, editingId, invoices, create, update, user, getNextNumber, currencyCode, exchangeRate, showDiscount, showVat, addToast, t]);

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

    // Single reference: the API posts atomically (JE + status flip + supplier balance).
    const result = await post(confirmPost);

    if (result.success) {
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

  const columns = useMemo(() => [
    {
      key: 'invoiceNumber',
      header: t('purchases.invoiceNumber'),
      mobile: 'title' as const,
      render: (row: PurchaseInvoice) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.invoiceNumber}</span>,
    },
    {
      key: 'supplier',
      header: t('purchases.supplier'),
      mobile: 'subtitle' as const,
      render: (row: PurchaseInvoice) => <span>{row.supplier?.name || row.supplierId}</span>,
    },
    {
      key: 'date',
      header: t('purchases.date'),
      render: (row: PurchaseInvoice) => <span>{row.date ? formatDate(row.date) : '-'}</span>,
    },
    {
      key: 'dueDate',
      header: t('purchases.dueDate'),
      render: (row: PurchaseInvoice) => <span>{row.dueDate ? formatDate(row.dueDate) : '-'}</span>,
    },
    {
      key: 'totalAmount',
      header: t('purchases.total'),
      render: (row: PurchaseInvoice) => <span className="text-zinc-900 dark:text-zinc-100 font-medium">{formatCurrency(row.totalAmount)}</span>,
    },
    {
      key: 'status',
      header: t('purchases.status'),
      mobile: 'status' as const,
      render: (row: PurchaseInvoice) => <StatusBadge status={row.status} />,
    },
    {
      key: 'paymentType',
      header: t('purchases.invoice.paymentType'),
      render: (row: PurchaseInvoice) => {
        const pt = row.paymentType;
        return pt === 'cash'
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('purchases.invoice.cash')}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('purchases.invoice.credit')}</span>;
      },
    },
    {
      key: 'createdBy',
      header: t('common.createdBy'),
      width: '110px',
      mobile: 'hidden' as const,
      render: (row: PurchaseInvoice) => (
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{getUserName(row.createdBy)}</span>
      ),
    },
    {
      key: 'actions',
      header: t('purchases.actions'),
      mobile: 'actions' as const,
      render: (row: PurchaseInvoice) => {
        const inv = row;
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
              <span className="text-xs text-zinc-400 flex items-center gap-1 mr-2">
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

  const visibleInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i) =>
      i.invoiceNumber?.toLowerCase().includes(q) ||
      (i.supplier?.name || '').toLowerCase().includes(q) ||
      i.status?.toLowerCase().includes(q) ||
      String(i.totalAmount || '').includes(q)
    );
  }, [invoices, search]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<Store size={22} />}
        title={t('purchases.invoices')}
        subtitle={t('purchases.invoicesSubtitle')}
        actions={
          <Can action="create" module="purchases">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">{t('purchases.invoice.create')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        columns={4}
        items={[
          { label: t('purchases.invoice.totalInvoices'), value: String(total), icon: <FileText size={18} />, tone: 'primary' },
          { label: t('purchases.return.postedTotal'), value: formatCurrency(kpis.totalPosted), icon: <ShoppingCart size={18} />, tone: 'info' },
          { label: t('purchases.return.drafts'), value: String(kpis.drafts), icon: <Layers size={18} />, tone: 'warning' },
          { label: t('purchases.invoice.outstanding'), value: formatCurrency(kpis.outstanding), icon: <Wallet size={18} />, tone: 'success' },
        ]}
      />

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('search') + '...'}
        filterOptions={[
          { key: '', label: t('purchases.filter.all') },
          { key: 'draft', label: t('purchases.filter.draft') },
          { key: 'posted', label: t('purchases.filter.posted') },
          { key: 'partially_paid', label: t('sales.status.partially_paid') },
          { key: 'paid', label: t('sales.status.paid') },
          { key: 'cancelled', label: t('purchases.filter.cancelled') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key)}
        actions={
          <>
            <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
            <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
              <FileText size={15} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">Excel</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5">
              <Receipt size={15} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
            </Button>
          </>
        }
      />

      <Card noPadding>
        <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800">
          <Table<PurchaseInvoice>
            data={visibleInvoices}
            columns={columns as never}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage={t('purchases.invoice.emptyTitle')}
          />
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={goToPage}
            onPageSizeChange={changePageSize}
          />
        </div>
      </Card>

      {/* Create / Edit Modal — Modern Full-Featured Invoice Editor */}
      <Modal
        isOpen={modalOpen}
        title={editingId ? t('purchases.invoice.edit') : t('purchases.invoice.new')}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); setInvoiceDiscount(0); setInvoiceDiscountType('amount'); }}
        size="4xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); setInvoiceDiscount(0); setInvoiceDiscountType('amount'); }}>
              {t('cancel')}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!canSave} leftIcon={<CheckSquare size={16} />}>
              {editingId ? t('save') : t('create')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.supplier')}</label>
              <SupplierSelect companyId={activeCompany?.id || ''} value={form.supplierId} onChange={v => setForm(prev => ({ ...prev, supplierId: v || '' }))} />
            </div>
            <Input label={t('purchases.date')} type="date" value={form.date} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
            <Input label={t('purchases.dueDate')} type="date" value={form.dueDate} onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.invoice.paymentType')}</label>
              <select
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                value={form.paymentType}
                onChange={e => {
                  const newType = e.target.value;
                  setForm(prev => ({
                    ...prev,
                    paymentType: newType,
                    cashBoxId: newType === 'cash' ? (prev.cashBoxId || defaultCashBoxId || '') : '',
                  }));
                }}
                aria-label={t('purchases.invoice.paymentType')}
              >
                <option value="cash">{t('purchases.invoice.cash')}</option>
                <option value="credit">{t('purchases.invoice.credit')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.invoice.linkOrder')}</label>
              <select
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                value={form.purchaseOrderId}
                onChange={e => setForm(prev => ({ ...prev, purchaseOrderId: e.target.value }))}
              >
                <option value="">{t('all')}</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>{o.orderNumber} - {o.supplier?.name || o.supplierId}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.currency')}</label>
              <CurrencySelect companyId={activeCompany?.id || ''} value={currencyCode} onChange={handleCurrencyChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            {form.paymentType === 'cash' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.cashBox')}</label>
                <CashBoxSelect companyId={activeCompany?.id || ''} value={form.cashBoxId || ''} onChange={v => setForm(prev => ({ ...prev, cashBoxId: v || '' }))} />
                {defaultCashBoxId && form.cashBoxId === defaultCashBoxId && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
                )}
              </div>
            )}
          </div>

          {/* ===== Enlarged Modern Items Section — The Heart of the Invoice ===== */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
            <div className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <Layers size={18} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    {t('purchases.invoice.lines')}
                    <span className="text-xs font-normal bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border">{form.lines.length} {t('sales.itemsCount')}</span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">{t('sales.invoice.linesDesc') || 'أضف المنتجات والكميات — الأسعار تُملأ تلقائياً'}</p>
                </div>
              </div>
              <Button size="sm" onClick={addLine} leftIcon={<Plus size={14} />} className="shadow-sm">{t('purchases.invoice.addLine')}</Button>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-right font-semibold w-[38%]">{t('inventory.productName')}</th>
                    <th className="px-3 py-3 text-center font-semibold w-28">{t('description')}</th>
                    <th className="px-3 py-3 text-center font-semibold w-24">{t('inventory.quantity')}</th>
                    <th className="px-3 py-3 text-right font-semibold w-32">{t('inventory.unitPrice')}</th>
                    {showDiscount && <th className="px-3 py-3 text-center font-semibold w-24">{t('sales.discount')} %</th>}
                    <th className="px-4 py-3 text-right font-semibold w-32">{t('purchases.total')}</th>
                    <th className="px-2 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {form.lines.map((line, idx) => {
                    const lineNet = line.quantity * line.unitPrice * (showDiscount ? (1 - line.discountPercent / 100) : 1);
                    const lineTotal = lineNet;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group">
                        <td className="px-3 py-3">
                          <ProductSelect
                            companyId={activeCompany?.id || ''}
                            value={line.productId}
                            onChange={v => updateLine(idx, { productId: Array.isArray(v) ? (v[0] || '') : (v || '') })}
                            onProductChange={(p) => handleProductChange(idx, p)}
                            showStock
                            showBarcode
                            size="sm"
                            module="purchases"
                          />
                        </td>
                        <td className="px-3 py-2"><Input type="text" placeholder={t('description')} value={line.description} onChange={e => updateLine(idx, { description: e.target.value })} size="sm" /></td>
                        <td className="px-3 py-2"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} size="sm" className="text-center font-medium" /></td>
                        <td className="px-3 py-2"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, { unitPrice: Number(e.target.value) })} size="sm" className="text-right tabular-nums" /></td>
                        {showDiscount && <td className="px-3 py-2"><Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, { discountPercent: Number(e.target.value) })} size="sm" className="text-center" /></td>}
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
              {form.lines.map((line, idx) => {
                const lineNet = line.quantity * line.unitPrice * (showDiscount ? (1 - line.discountPercent / 100) : 1);
                const lineTotal = lineNet;
                return (
                  <div key={idx} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3">
                    <ProductSelect
                      companyId={activeCompany?.id || ''}
                      value={line.productId}
                      onChange={v => updateLine(idx, { productId: Array.isArray(v) ? (v[0] || '') : (v || '') })}
                      onProductChange={(p) => handleProductChange(idx, p)}
                      showStock
                      showBarcode
                      size="sm"
                      module="purchases"
                    />
                    <Input type="text" placeholder={t('description')} value={line.description} onChange={e => updateLine(idx, { description: e.target.value })} size="sm" />
                    <div className="grid grid-cols-2 gap-3">
                      <Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} size="sm" />
                      <Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, { unitPrice: Number(e.target.value) })} size="sm" />
                    </div>
                    {showDiscount && (
                      <Input type="number" min={0} max={100} value={String(line.discountPercent)} onChange={e => updateLine(idx, { discountPercent: Number(e.target.value) })} size="sm" />
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(lineTotal)}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeLine(idx)} className="hover:bg-rose-50 dark:hover:bg-rose-900/20" leftIcon={<Trash2 size={14} className="text-rose-500" />} />
                    </div>
                  </div>
                );
              })}
            </div>
            {form.lines.length === 0 && (
              <div className="py-12 text-center text-slate-400">
                <Layers size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('sales.invoice.emptyLines') || 'لا توجد سطور — أضف منتجاً للبدء'}</p>
              </div>
            )}
          </div>

          {/* ===== Modern Totals Card — Discount under Subtotal per Settings ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <Input label={t('purchases.notes')} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('sales.notesPlaceholder') || 'ملاحظات إضافية للفاتورة...'} />
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">{t('sales.invoice.notesHint') || 'ستظهر الملاحظات في الطباعة وكشف الحساب'}</p>
            </div>
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50">
              <div className="px-4 py-3 bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2"><Wallet size={16} /> {t('sales.invoice.summary')}</span>
                <span className="text-xs bg-white/15 px-2 py-1 rounded-full">{form.lines.length} {t('sales.itemsCount')}</span>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2"><Layers size={14} className="text-slate-400" /> {t('purchases.subtotal')}</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(formTotals.subtotal)}</span>
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
                        -{formatCurrency(formTotals.invoiceDiscountAmount)}
                      </div>
                    </div>
                    {invoiceDiscount > 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {invoiceDiscountType === 'percent' ? `${invoiceDiscount}% ${t('sales.discount')} = ${formatCurrency(formTotals.invoiceDiscountAmount)}` : `${t('sales.discount')} ${formatCurrency(formTotals.invoiceDiscountAmount)}`}
                      </p>
                    )}
                  </div>
                )}
                {showVat ? (
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                      {t('purchases.vat')} <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">{formTotals.vatRate}%</span>
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(formTotals.vatAmount)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700 opacity-60">
                    <span className="text-slate-500 text-xs">{t('purchases.vat')} — {t('settings.vat.disabled') || 'غير مفعّل'}</span>
                    <span className="text-xs">{formatCurrency(0)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2"><TrendingUp size={16} className="text-primary-600" /> {t('purchases.total')}</span>
                  <span className="text-xl font-black tabular-nums text-primary-600 dark:text-primary-400">{formatCurrency(formTotals.totalAmount)}</span>
                </div>
                <p className="text-xs text-slate-400 text-center pt-2 border-t border-slate-100 dark:border-slate-700">
                  {currencySymbol} {t('purchases.baseCurrency')} • {formatCurrency(formTotals.totalAmount * exchangeRate)} {t('sales.invoice.baseTotal') || 'بالأساسية'}
                </p>
              </div>
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

      <DuplicateWarningDialog
        isOpen={docDuplicateOpen}
        onClose={() => setDocDuplicateOpen(false)}
        onConfirm={() => {
          docDuplicateConfirmedRef.current = true;
          setDocDuplicateOpen(false);
          void handleSave();
        }}
        inputName={docDuplicateInput}
        entityLabel={t('purchases.invoices')}
        exactMatch={docDuplicateExact}
        nearMatches={docDuplicateNear}
        isDocument
        isEdit={!!editingId}
      />
    </div>
  );
};

export default PurchaseInvoicesPage;
