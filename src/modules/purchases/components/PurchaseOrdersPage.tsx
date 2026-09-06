import React, { useState, useMemo, useCallback, useRef } from 'react';
import { ClipboardList, Plus, CheckSquare, Trash2, Printer, ArrowRightLeft, Layers, Clock, PackageCheck, Wallet, TrendingUp, ShoppingCart } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { logAudit } from '@/core/utils/auditLogger';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useSettings } from '@/core/utils/useSettings';
import { Card, Button, Modal, Input, Pagination, Can, Table, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { purchaseOrderFingerprint, detectDocumentDuplicates, genericNearScore } from '@/core/utils/documentDuplicate';
import { SupplierSelect, ProductSelect, CashBoxSelect, ProductUnitSelect } from '@/core/ui/components/smart';
import { toBaseQty } from '@/core/utils/unitConversion';
import type { ProductUnit } from '@/modules/inventory/types';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseOrdersPaginated } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { PurchaseOrder } from '../types';
import type { Product } from '@/modules/inventory/types';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';

interface OrderFormLine {
  productId: string;
  description: string;
  quantity: number;
  /** Chosen product_units row id + frozen factor + base qty (stock truth). */
  unitId?: string;
  unitFactor?: number;
  baseQuantity?: number;
  unitName?: string;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
}

interface OrderForm {
  supplierId: string;
  date: string;
  expectedDate: string;
  paymentType: string;
  cashBoxId: string;
  notes: string;
  lines: OrderFormLine[];
}

const initialLine = (): OrderFormLine => ({
  productId: '',
  description: '',
  quantity: 1,
  unitId: undefined,
  unitFactor: 1,
  baseQuantity: 1,
  unitName: undefined,
  unitPrice: 0,
  discountPercent: 0,
  lineTotal: 0,
});

const initialForm = (defaultCashBoxId?: string): OrderForm => ({
  supplierId: '',
  date: new Date().toISOString().split('T')[0],
  expectedDate: '',
  paymentType: 'credit',
  cashBoxId: defaultCashBoxId || '',
  notes: '',
  lines: [initialLine()],
});

export const PurchaseOrdersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const orderFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { orders, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove, convertToInvoice } = usePurchaseOrdersPaginated(activeCompany?.id || '', orderFilters);
  const { getNextNumber } = useDocumentSequence();
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate, decimalPlaces: dp } = useFormatters(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OrderForm>(initialForm(defaultCashBoxId ?? undefined));
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'amount' | 'percent'>('amount');
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const showVat = settings?.invoiceShowVat ?? true;
  const vatRate = settings?.vatRate ?? 15;
  // Cache of each line-product's units (fed by ProductUnitSelect) so unit
  // switches can tell auto-filled prices apart from manual entries.
  const [lineUnitsCache, setLineUnitsCache] = useState<Record<string, ProductUnit[]>>({});
  const cacheProductUnits = useCallback((productId: string, units: ProductUnit[]) => {
    setLineUnitsCache((prev) => (prev[productId] === units ? prev : { ...prev, [productId]: units }));
  }, []);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmConvert, setConfirmConvert] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [docDuplicateOpen, setDocDuplicateOpen] = useState(false);
  const [docDuplicateInput, setDocDuplicateInput] = useState('');
  const [docDuplicateExact, setDocDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [docDuplicateNear, setDocDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const docDuplicateConfirmedRef = useRef(false);

  const calculateLine = useCallback((line: OrderFormLine): OrderFormLine => {
    const effectiveDiscount = showDiscount ? line.discountPercent : 0;
    const net = line.quantity * line.unitPrice * (1 - effectiveDiscount / 100);
    return { ...line, lineTotal: Number(net.toFixed(dp)) };
  }, [showDiscount, dp]);

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
      subtotal: Number(subtotalBeforeInvoiceDiscount.toFixed(dp)),
      vatAmount: Number(vatAmount.toFixed(dp)),
      discountAmount: Number(totalDiscountAmount.toFixed(dp)),
      invoiceDiscountAmount: Number(cappedInvoiceDiscount.toFixed(dp)),
      totalAmount: Number(totalAmount.toFixed(dp)),
      vatRate,
    };
  }, [form.lines, invoiceDiscount, invoiceDiscountType, showDiscount, showVat, vatRate, dp]);

  const updateLine = useCallback((idx: number, patch: Partial<OrderFormLine>) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      const merged = { ...newLines[idx], ...patch };
      // Keep the base quantity in sync — stock postings consume it, never
      // the display quantity.
      if (patch.quantity !== undefined) {
        merged.baseQuantity = toBaseQty(merged.quantity, merged.unitFactor ?? 1);
      }
      newLines[idx] = calculateLine(merged);
      return { ...prev, lines: newLines };
    });
  }, [calculateLine]);

  /**
   * When the user picks a product from the dropdown, reset the unit choice
   * (ProductUnitSelect auto-picks the default purchase unit, which then prices
   * the line via handleUnitChange). If the line was previously empty
   * (price = 0) seed the base cost price immediately so the row never
   * flashes a zero price while units load.
   */
  const handleProductChange = useCallback((idx: number, product: Product) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      const current = newLines[idx];
      const patch: Partial<OrderFormLine> = {
        description: current.description || product.nameAr,
        unitId: undefined,
        unitFactor: 1,
        baseQuantity: current.quantity,
        unitName: undefined,
        unitPrice: current.unitPrice > 0 ? current.unitPrice : product.costPrice,
      };
      newLines[idx] = calculateLine({ ...current, ...patch });
      return { ...prev, lines: newLines };
    });
  }, [calculateLine]);

  /**
   * Unit switch: adopt the unit's own purchase price unless the user typed a
   * custom price (i.e. current price matches no known unit price for this
   * product). Base quantity is always recomputed.
   */
  const handleUnitChange = useCallback((idx: number, unit: ProductUnit | null) => {
    setForm(prev => {
      const newLines = [...prev.lines];
      const current = newLines[idx];
      const known = lineUnitsCache[current.productId] || [];
      const isAutoPrice = current.unitPrice === 0 || known.some((u) => u.purchasePrice === current.unitPrice);
      const merged = {
        ...current,
        unitId: unit?.id,
        unitFactor: unit?.factor ?? 1,
        baseQuantity: toBaseQty(current.quantity, unit?.factor ?? 1),
        unitName: unit?.unitName,
        unitPrice: unit && isAutoPrice ? unit.purchasePrice : current.unitPrice,
      };
      newLines[idx] = calculateLine(merged);
      return { ...prev, lines: newLines };
    });
  }, [calculateLine, lineUnitsCache]);

  const addLine = useCallback(() => setForm(prev => ({ ...prev, lines: [...prev.lines, initialLine()] })), []);
  const removeLine = useCallback((idx: number) => setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) })), []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(initialForm());
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((order: PurchaseOrder) => {
    setEditingId(order.id);
    setForm({
      supplierId: order.supplierId,
      date: order.date,
      expectedDate: order.expectedDate || '',
      paymentType: order.paymentType || 'credit',
      cashBoxId: order.cashBoxId || '',
      notes: order.notes || '',
      lines: order.lines && order.lines.length > 0
        ? order.lines.map(l => ({ productId: l.productId || '', description: l.description || '', quantity: l.quantity, unitId: l.unitId, unitFactor: l.unitFactor ?? 1, baseQuantity: l.baseQuantity ?? l.quantity, unitName: l.unitName || l.unit, unitPrice: l.unitPrice, discountPercent: 0, lineTotal: l.lineTotal }))
        : [initialLine()],
    });
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
    setModalOpen(true);
  }, []);

  const openView = useCallback(async (order: PurchaseOrder) => {
    if (activeCompany?.id) {
      const res = await purchasesApi.getOrderById(order.id, activeCompany.id);
      if (res.success && res.data) { setSelectedOrder(res.data); setViewModalOpen(true); return; }
    }
    setSelectedOrder(order);
    setViewModalOpen(true);
  }, [activeCompany]);

  // Paginated rows carry lines: [] — refetch the full document so the edit
  // form shows its products instead of an empty list.
  const handleEditRow = useCallback(async (order: PurchaseOrder) => {
    let full = order;
    if ((!order.lines || order.lines.length === 0) && activeCompany?.id) {
      const res = await purchasesApi.getOrderById(order.id, activeCompany.id);
      if (res.success && res.data && (res.data.lines?.length ?? 0) > 0) full = res.data;
    }
    openEdit(full);
  }, [activeCompany, openEdit]);

  const handleSave = useCallback(async () => {
    if (!activeCompany?.id || !form.supplierId) return;
    let orderNumber: string;
    if (editingId) {
      orderNumber = orders.find(o => o.id === editingId)?.orderNumber || '';
    } else {
      const seq = await getNextNumber('purchase_order', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('purchases.order.numberError'));
        return;
      }
      orderNumber = seq.number;
    }

    const mappedLines = form.lines.map(l => {
      const effectiveDiscount = showDiscount ? l.discountPercent : 0;
      const lineNet = l.quantity * l.unitPrice * (1 - effectiveDiscount / 100);
      return {
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        unitId: l.unitId,
        unitFactor: l.unitFactor ?? 1,
        baseQuantity: toBaseQty(l.quantity, l.unitFactor ?? 1),
        unitName: l.unitName,
        unitPrice: l.unitPrice,
        lineTotal: Number(lineNet.toFixed(dp)),
      };
    });
    const payload = {
      companyId: activeCompany.id,
      orderNumber,
      supplierId: form.supplierId,
      date: form.date,
      expectedDate: form.expectedDate || undefined,
      totalAmount: formTotals.totalAmount,
      status: 'draft' as const,
      paymentType: form.paymentType,
      cashBoxId: form.paymentType === 'cash' ? (form.cashBoxId || undefined) : undefined,
      notes: form.notes,
      lines: mappedLines,
    };
    if (!docDuplicateConfirmedRef.current) {
      try {
        const existingRes = await purchasesApi.getOrdersPaginated(activeCompany.id, 1, 200);
        const existingList = (existingRes.success && existingRes.data ? ((existingRes.data as unknown as { items?: unknown[] })?.items ?? (existingRes.data as unknown as unknown[]) ?? []) : []) as unknown[];
        const inputForFp = {
          supplierId: payload.supplierId,
          date: payload.date,
          expectedDate: payload.expectedDate,
          totalAmount: payload.totalAmount,
          lines: payload.lines.map((l: unknown) => {
            const x = l as { productId?: string; quantity?: unknown; unitPrice?: unknown };
            return { productId: x.productId, quantity: x.quantity, unitPrice: x.unitPrice };
          }),
        };
        const fp = purchaseOrderFingerprint(inputForFp as never);
        const getFp = (d: unknown) => {
          const x = d as { supplierId?: string; date?: string; expectedDate?: string; totalAmount?: unknown };
          return purchaseOrderFingerprint({ supplierId: x.supplierId, date: x.date, expectedDate: x.expectedDate, totalAmount: x.totalAmount } as never);
        };
        const getNear = (inp: unknown, ex: unknown) => {
          const a = inp as { supplierId?: string; date?: string; lines?: Array<{ productId?: string }>; totalAmount?: unknown };
          const b = ex as { supplierId?: string; date?: string; lines?: Array<{ productId?: string }>; totalAmount?: unknown };
          return genericNearScore(a.supplierId, b.supplierId, a.date, b.date, a.lines ?? [], b.lines ?? [], a.totalAmount, b.totalAmount);
        };
        const dup = detectDocumentDuplicates(fp, inputForFp, existingList as never[], getFp, getNear, { excludeId: editingId || undefined });
        if (dup.exactMatch) {
          const doc = dup.exactMatch as unknown as { orderNumber?: string; id: string; date?: string; totalAmount?: unknown };
          setDocDuplicateInput(`${payload.supplierId} • ${payload.date} • ${payload.totalAmount}`);
          setDocDuplicateExact({ name: doc.orderNumber || String(doc.id).slice(0, 8), code: `${doc.date} • ${doc.totalAmount}` });
          setDocDuplicateNear([]);
          setDocDuplicateOpen(true);
          return;
        }
        if (dup.nearMatches.length) {
          setDocDuplicateInput(`${payload.supplierId} • ${payload.date}`);
          setDocDuplicateNear(
            dup.nearMatches.map((m: { item: unknown; score: number }) => {
              const d = m.item as unknown as { orderNumber?: string; id: string; date?: string; totalAmount?: unknown };
              return { name: d.orderNumber || String(d.id).slice(0, 8), code: `${d.date} • ${d.totalAmount}`, score: m.score };
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
      addToast('success', t('purchases.order.updated'));
      await logAudit({ userId: user?.id || '', action: 'update', tableName: 'purchase_orders', recordId: editingId, companyId: activeCompany.id });
    } else {
      const result = await create(payload);
      if (result.success && result.id) {
        addToast('success', t('purchases.order.created'));
        await logAudit({ userId: user?.id || '', action: 'create', tableName: 'purchase_orders', recordId: result.id, companyId: activeCompany.id });
      } else {
        addToast('error', result.error || t('common.error'));
      }
    }
    setModalOpen(false);
    setEditingId(null);
    setForm(initialForm());
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
  }, [activeCompany, form, formTotals, editingId, orders, create, update, user, getNextNumber, addToast, t, showDiscount, dp]);

  const handleDelete = useCallback((id: string) => setConfirmDelete(id), []);
  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete || !activeCompany?.id) return;
    await remove(confirmDelete);
    addToast('success', t('purchases.order.deleted'));
    await logAudit({ userId: user?.id || '', action: 'delete', tableName: 'purchase_orders', recordId: confirmDelete, companyId: activeCompany.id });
    setConfirmDelete(null);
  }, [confirmDelete, activeCompany, remove, user, addToast, t]);

  const handleConvert = useCallback((id: string) => setConfirmConvert(id), []);
  const confirmConvertAction = useCallback(async () => {
    if (!confirmConvert || !activeCompany?.id) return;
    setConvertingId(confirmConvert);
    await convertToInvoice(confirmConvert);
    addToast('success', t('purchases.order.converted'));
    await logAudit({ userId: user?.id || '', action: 'post', tableName: 'purchase_orders', recordId: confirmConvert, companyId: activeCompany.id });
    setConvertingId(null);
    setConfirmConvert(null);
  }, [confirmConvert, activeCompany, convertToInvoice, user, addToast, t]);

  const handlePrint = useCallback(async (order: PurchaseOrder) => {
    let lines = order.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await purchasesApi.getOrderById(order.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    const STATUS_LABELS: Record<string, string> = {
      draft: t('purchases.filter.draft'),
      sent: t('purchases.order.sent'),
      partially_received: t('purchases.order.partiallyReceived'),
      received: t('purchases.order.received'),
      invoiced: t('purchases.filter.invoiced'),
      cancelled: t('purchases.filter.cancelled'),
    };
    printDocument({
      type: 'purchase-order',
      docNumber: order.orderNumber,
      date: order.date,
      partyName: order.supplier?.name || order.supplierId,
      partyLabel: t('purchases.supplier'),
      partyTaxNumber: order.supplier?.taxNumber,
      partyAddress: order.supplier?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.description || t('inventory.productName'),
        productCode: l.productCode,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unitName || l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.lineTotal,
      })),
      subtotal: order.totalAmount,
      vatAmount: 0,
      totalAmount: order.totalAmount,
      notes: order.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      companyLogoUrl: activeCompany?.logoUrl,
      vatRate,
      currency: currencySymbol,
      paymentType: order.paymentType,
      createdBy: order.createdBy,
      statusBadge: STATUS_LABELS[order.status] || order.status,
      statusTone: order.status === 'invoiced' ? 'success' : 'muted',
    });
  }, [activeCompany, t, currencySymbol, vatRate]);

  const columns = useMemo(() => [
    { key: 'orderNumber', header: t('purchases.orderNumber'), mobile: 'title' as const, render: (row: PurchaseOrder) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.orderNumber}</span> },
    { key: 'supplier', header: t('purchases.supplier'), mobile: 'subtitle' as const, render: (row: PurchaseOrder) => <span>{row.supplier?.name || row.supplierId}</span> },
    { key: 'date', header: t('purchases.date'), render: (row: PurchaseOrder) => <span>{row.date ? formatDate(row.date) : '-'}</span> },
    { key: 'expectedDate', header: t('purchases.order.expectedDate'), render: (row: PurchaseOrder) => <span>{row.expectedDate ? formatDate(row.expectedDate) : '-'}</span> },
    { key: 'totalAmount', header: t('purchases.total'), render: (row: PurchaseOrder) => <span className="font-medium">{formatCurrency(row.totalAmount)}</span> },
    { key: 'status', header: t('purchases.status'), mobile: 'status' as const, render: (row: PurchaseOrder) => <StatusBadge status={row.status} /> },
    {
      key: 'paymentType',
      header: t('purchases.order.paymentType'),
      render: (row: PurchaseOrder) => {
        const pt = row.paymentType;
        return pt === 'cash'
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('purchases.order.cash')}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('purchases.order.credit')}</span>;
      },
    },
    {
      key: 'actions',
      header: t('purchases.actions'),
      mobile: 'actions' as const,
      render: (row: PurchaseOrder) => {
        const order = row;
        const isConverting = convertingId === order.id;
        return (
          <div className="flex items-center gap-1">
            <ActionButtons
              onView={() => openView(order)}
              onEdit={order.status === 'draft' ? () => handleEditRow(order) : undefined}
              onDelete={order.status === 'draft' ? () => handleDelete(order.id) : undefined}
              onPrint={() => handlePrint(order)}
              showView
              showEdit={order.status === 'draft'}
              showDelete={order.status === 'draft'}
              showPrint
              showExport={false}
            />
            {order.status === 'draft' && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<ArrowRightLeft size={14} />}
                onClick={() => handleConvert(order.id)}
                disabled={isConverting}
              >
                {isConverting ? t('loading') : t('purchases.order.convert')}
              </Button>
            )}
          </div>
        );
      },
    },
  ], [t, openView, handleEditRow, handleDelete, handlePrint, handleConvert, convertingId, formatCurrency, formatDate]);

  const canSave = form.supplierId && form.lines.length > 0 && form.lines.every(l => l.productId && l.quantity > 0);

  const kpis = useMemo(() => {
    const drafts = orders.filter(o => o.status === 'draft').length;
    const pending = orders.filter(o => o.status === 'sent' || o.status === 'partially_received').length;
    const invoiced = orders.filter(o => o.status === 'invoiced').length;
    return { drafts, pending, invoiced };
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      o.orderNumber?.toLowerCase().includes(q) ||
      (o.supplier?.name || '').toLowerCase().includes(q) ||
      o.status?.toLowerCase().includes(q) ||
      String(o.totalAmount || '').includes(q)
    );
  }, [orders, search]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<ShoppingCart size={22} />}
        title={t('purchases.orders')}
        subtitle={t('purchases.ordersSubtitle')}
        actions={
          <Can action="create" module="purchases">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">{t('purchases.order.create')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        columns={4}
        items={[
          { label: t('purchases.order.totalOrders'), value: String(total), icon: <ClipboardList size={18} />, tone: 'primary' },
          { label: t('purchases.return.drafts'), value: String(kpis.drafts), icon: <Layers size={18} />, tone: 'warning' },
          { label: t('purchases.order.pending'), value: String(kpis.pending), icon: <Clock size={18} />, tone: 'warning' },
          { label: t('purchases.filter.invoiced'), value: String(kpis.invoiced), icon: <PackageCheck size={18} />, tone: 'success' },
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
          { key: 'sent', label: t('purchases.order.sent') },
          { key: 'partially_received', label: t('purchases.order.partiallyReceived') },
          { key: 'received', label: t('purchases.order.received') },
          { key: 'invoiced', label: t('purchases.filter.invoiced') },
          { key: 'cancelled', label: t('purchases.filter.cancelled') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key)}
      />

      <Card noPadding>
        <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800">
          <Table<PurchaseOrder>
            data={visibleOrders}
            columns={columns as never}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage={t('purchases.order.emptyTitle')}
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

      {/* Create / Edit Modal — Modern Full-Featured Editor */}
      <Modal
        isOpen={modalOpen}
        title={editingId ? t('purchases.order.edit') : t('purchases.order.new')}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); setInvoiceDiscount(0); setInvoiceDiscountType('amount'); }}
        size="4xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); setInvoiceDiscount(0); setInvoiceDiscountType('amount'); }}>{t('cancel')}</Button>
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
            <Input label={t('purchases.order.expectedDate')} type="date" value={form.expectedDate} onChange={e => setForm(prev => ({ ...prev, expectedDate: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.order.paymentType')}</label>
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
                aria-label={t('purchases.order.paymentType')}
              >
                <option value="cash">{t('purchases.order.cash')}</option>
                <option value="credit">{t('purchases.order.credit')}</option>
              </select>
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

          {/* ===== Enlarged Modern Items Section — The Heart of the Order ===== */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
            <div className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <Layers size={18} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    {t('purchases.order.lines')}
                    <span className="text-xs font-normal bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border">{form.lines.length} {t('sales.itemsCount')}</span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">{t('sales.invoice.linesDesc') || 'أضف المنتجات والكميات — الأسعار تُملأ تلقائياً'}</p>
                </div>
              </div>
              <Button size="sm" onClick={addLine} leftIcon={<Plus size={14} />} className="shadow-sm">{t('purchases.order.addLine')}</Button>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-right font-semibold w-[30%]">{t('inventory.productName')}</th>
                    <th className="px-3 py-3 text-center font-semibold w-32">{t('purchases.line.unit')}</th>
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
                        <td className="px-2 py-2">
                          <ProductUnitSelect
                            companyId={activeCompany?.id || ''}
                            productId={line.productId}
                            value={line.unitId}
                            onChange={(u) => handleUnitChange(idx, u)}
                            onUnitsLoad={(units) => line.productId && cacheProductUnits(line.productId, units)}
                            mode="purchase"
                            size="sm"
                          />
                          {(line.unitFactor ?? 1) > 1 && (
                            <p className="text-[10px] text-slate-400 text-center mt-0.5 tabular-nums">≈ {line.baseQuantity} {t('purchases.line.baseEquivalent')}</p>
                          )}
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
                    <ProductUnitSelect
                      companyId={activeCompany?.id || ''}
                      productId={line.productId}
                      value={line.unitId}
                      onChange={(u) => handleUnitChange(idx, u)}
                      onUnitsLoad={(units) => line.productId && cacheProductUnits(line.productId, units)}
                      mode="purchase"
                      size="sm"
                    />
                    {(line.unitFactor ?? 1) > 1 && (
                      <p className="text-[10px] text-slate-400 text-center mt-0.5 tabular-nums">≈ {line.baseQuantity} {t('purchases.line.baseEquivalent')}</p>
                    )}
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
              <Input label={t('notes')} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('sales.notesPlaceholder') || 'ملاحظات إضافية...'} />
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
                  {currencySymbol} • {formatCurrency(formTotals.totalAmount)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={viewModalOpen}
        title={t('purchases.order.details')}
        onClose={() => setViewModalOpen(false)}
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">{t('purchases.orderNumber')}:</span> <strong>{selectedOrder.orderNumber}</strong></div>
              <div><span className="text-slate-500">{t('purchases.supplier')}:</span> <strong>{selectedOrder.supplier?.name || selectedOrder.supplierId}</strong></div>
              <div><span className="text-slate-500">{t('purchases.date')}:</span> {selectedOrder.date}</div>
              <div><span className="text-slate-500">{t('purchases.order.expectedDate')}:</span> {selectedOrder.expectedDate || '-'}</div>
              <div><span className="text-slate-500">{t('purchases.status')}:</span> <StatusBadge status={selectedOrder.status} /></div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="p-2 text-right">#</th>
                    <th className="p-2 text-right">{t('inventory.productName')}</th>
                    <th className="p-2 text-right">{t('purchases.line.unit')}</th>
                    <th className="p-2 text-right">{t('inventory.quantity')}</th>
                    <th className="p-2 text-right">{t('inventory.unitPrice')}</th>
                    <th className="p-2 text-right">{t('purchases.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedOrder.lines || []).map((line, idx) => (
                    <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2">{line.productName || line.description || line.productId}</td>
                      <td className="p-2">{line.unitName || line.unit || '-'}</td>
                      <td className="p-2">{line.quantity}</td>
                      <td className="p-2">{formatCurrency(line.unitPrice || 0)}</td>
                      <td className="p-2 font-medium">{formatCurrency(line.lineTotal || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end text-lg font-bold text-primary-600">
              {t('purchases.total')}: {formatCurrency(selectedOrder.totalAmount || 0)}
            </div>
            {selectedOrder.notes && (
              <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                {t('notes')}: {selectedOrder.notes}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>{t('close')}</Button>
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrint(selectedOrder)}>{t('print')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title={t('purchases.order.deleteTitle')}
        message={t('purchases.order.deleteConfirm')}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmConvert}
        onClose={() => setConfirmConvert(null)}
        onConfirm={confirmConvertAction}
        title={t('purchases.order.convertTitle')}
        message={t('purchases.order.convertConfirm')}
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
        entityLabel={t('purchases.orders')}
        exactMatch={docDuplicateExact}
        nearMatches={docDuplicateNear}
        isDocument
        isEdit={!!editingId}
      />
    </div>
  );
};

export default PurchaseOrdersPage;
