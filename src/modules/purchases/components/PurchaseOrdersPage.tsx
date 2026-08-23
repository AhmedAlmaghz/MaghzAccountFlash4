import React, { useState, useMemo, useCallback } from 'react';
import { ClipboardList, Plus, CheckSquare, Trash2, Printer, ArrowRightLeft, Layers, Clock, PackageCheck } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { logAudit } from '@/core/utils/auditLogger';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useSettings } from '@/core/utils/useSettings';
import { Card, Button, Modal, Input, Pagination, Can } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DataTablePro } from '@/core/ui/components/DataTablePro';
import { SupplierSelect, ProductSelect, CashBoxSelect, BankSelect } from '@/core/ui/components/smart';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseOrdersPaginated } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { PurchaseOrder } from '../types';
import type { Product } from '@/modules/inventory/types';
import type { ColumnDef } from '@tanstack/react-table';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';

interface OrderFormLine {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderForm {
  supplierId: string;
  date: string;
  expectedDate: string;
  paymentType: string;
  cashBoxId: string;
  bankAccountId: string;
  notes: string;
  lines: OrderFormLine[];
}

const initialLine = (): OrderFormLine => ({
  productId: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  lineTotal: 0,
});

const initialForm = (defaultCashBoxId?: string): OrderForm => ({
  supplierId: '',
  date: new Date().toISOString().split('T')[0],
  expectedDate: '',
  paymentType: 'credit',
  cashBoxId: defaultCashBoxId || '',
  bankAccountId: '',
  notes: '',
  lines: [initialLine()],
});

export const PurchaseOrdersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const orderFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { orders, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove, convertToInvoice } = usePurchaseOrdersPaginated(activeCompany?.id || '', orderFilters);
  const { getNextNumber } = useDocumentSequence();
  const { defaultCashBoxId, defaultBankId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const [modalOpen, setModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OrderForm>(initialForm(defaultCashBoxId ?? undefined));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmConvert, setConfirmConvert] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const calculateLine = useCallback((line: OrderFormLine): OrderFormLine => {
    const total = line.quantity * line.unitPrice;
    return { ...line, lineTotal: Number(total.toFixed(2)) };
  }, []);

  const formTotal = useMemo(() => form.lines.reduce((s, l) => s + l.lineTotal, 0), [form.lines]);

  const updateLine = useCallback((idx: number, patch: Partial<OrderFormLine>) => {
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
      const patch: Partial<OrderFormLine> = {
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

  const openEdit = useCallback((order: PurchaseOrder) => {
    setEditingId(order.id);
    setForm({
      supplierId: order.supplierId,
      date: order.date,
      expectedDate: order.expectedDate || '',
      paymentType: order.paymentType || 'credit',
      cashBoxId: order.cashBoxId || '',
      bankAccountId: order.bankAccountId || '',
      notes: order.notes || '',
      lines: order.lines && order.lines.length > 0
        ? order.lines.map(l => ({ productId: l.productId || '', description: l.description || '', quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal }))
        : [initialLine()],
    });
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

    const payload = {
      companyId: activeCompany.id,
      orderNumber,
      supplierId: form.supplierId,
      date: form.date,
      expectedDate: form.expectedDate || undefined,
      totalAmount: formTotal,
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
        lineTotal: l.lineTotal,
      })),
    };

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
  }, [activeCompany, form, formTotal, editingId, orders, create, update, user, getNextNumber, addToast, t]);

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
        unit: l.unit,
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
      currency: currencySymbol,
      paymentType: order.paymentType,
      createdBy: order.createdBy,
    });
  }, [activeCompany, t, currencySymbol]);

  const columns = useMemo<ColumnDef<PurchaseOrder>[]>(() => [
    { accessorKey: 'orderNumber', header: t('purchases.orderNumber'), cell: ({ row }) => <span className="font-medium text-slate-900 dark:text-slate-100">{row.original.orderNumber}</span> },
    { accessorKey: 'supplier', header: t('purchases.supplier'), cell: ({ row }) => <span>{row.original.supplier?.name || row.original.supplierId}</span> },
    { accessorKey: 'date', header: t('purchases.date') },
    { accessorKey: 'expectedDate', header: t('purchases.order.expectedDate'), cell: ({ row }) => <span>{row.original.expectedDate ? formatDate(row.original.expectedDate) : '-'}</span> },
    { accessorKey: 'totalAmount', header: t('purchases.total'), cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.totalAmount)}</span> },
    { accessorKey: 'status', header: t('purchases.status'), cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      accessorKey: 'paymentType',
      header: t('purchases.order.paymentType'),
      cell: ({ row }) => {
        const pt = row.original.paymentType;
        return pt === 'cash'
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('purchases.order.cash')}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('purchases.order.credit')}</span>;
      },
    },
    {
      accessorKey: 'actions',
      header: t('purchases.actions'),
      cell: ({ row }) => {
        const order = row.original;
        const isConverting = convertingId === order.id;
        return (
          <div className="flex items-center gap-1">
            <ActionButtons
              onView={() => openView(order)}
              onEdit={order.status === 'draft' ? () => openEdit(order) : undefined}
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
  ], [t, openView, openEdit, handleDelete, handlePrint, handleConvert, convertingId, formatCurrency, formatDate]);

  const canSave = form.supplierId && form.lines.length > 0 && form.lines.every(l => l.productId && l.quantity > 0);

  const kpis = useMemo(() => {
    const drafts = orders.filter(o => o.status === 'draft').length;
    const pending = orders.filter(o => o.status === 'sent' || o.status === 'partially_received').length;
    const invoiced = orders.filter(o => o.status === 'invoiced').length;
    return { drafts, pending, invoiced };
  }, [orders]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-600 shadow-xl shadow-blue-900/10 dark:shadow-blue-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-blue-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('purchases.orders')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('purchases.orders')}</h2>
              <p className="text-blue-100/80 text-base max-w-lg">{t('purchases.ordersSubtitle')}</p>
            </div>
            <Can action="create" module="purchases">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('purchases.order.create')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('purchases.order.totalOrders'), value: String(total), icon: ClipboardList, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
          { label: t('purchases.return.drafts'), value: String(kpis.drafts), icon: Layers, color: 'from-slate-600 to-slate-700', bg: 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/10 dark:to-slate-800/5' },
          { label: t('purchases.order.pending'), value: String(kpis.pending), icon: Clock, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('purchases.filter.invoiced'), value: String(kpis.invoiced), icon: PackageCheck, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-blue-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <span className="text-xs text-slate-500 font-medium">{t('purchases.status')}:</span>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { v: '', l: t('purchases.filter.all') },
              { v: 'draft', l: t('purchases.filter.draft') },
              { v: 'sent', l: t('purchases.order.sent') },
              { v: 'partially_received', l: t('purchases.order.partiallyReceived') },
              { v: 'received', l: t('purchases.order.received') },
              { v: 'invoiced', l: t('purchases.filter.invoiced') },
              { v: 'cancelled', l: t('purchases.filter.cancelled') },
            ].map((o) => (
              <button
                key={o.v || 'all'}
                onClick={() => setStatusFilter(o.v)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
              >{o.l}</button>
            ))}
          </div>
        </div>
      </Card>

      <Card noPadding>
        <DataTablePro<PurchaseOrder>
          data={orders}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('purchases.order.emptyTitle')}
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
        title={editingId ? t('purchases.order.edit') : t('purchases.order.new')}
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
            <Input label={t('purchases.order.expectedDate')} type="date" value={form.expectedDate} onChange={e => setForm(prev => ({ ...prev, expectedDate: e.target.value }))} />
          </div>
          <Input label={t('purchases.date')} type="date" value={form.date} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('purchases.order.paymentType')}</label>
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
              aria-label={t('purchases.order.paymentType')}
            >
              <option value="cash">{t('purchases.order.cash')}</option>
              <option value="credit">{t('purchases.order.credit')}</option>
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

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-sm">{t('purchases.order.lines')}</h4>
              <Button size="sm" variant="secondary" onClick={addLine} leftIcon={<Plus size={14} />}>
                {t('purchases.order.addLine')}
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

          <div className="flex justify-end text-lg font-bold text-primary-600">
            {t('purchases.total')}: {formatCurrency(formTotal)}
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
    </div>
  );
};

export default PurchaseOrdersPage;
