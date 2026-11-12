import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Printer, ArrowRightLeft, Layers, Clock, PackageCheck, ShoppingCart } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { logAudit } from '@/core/utils/auditLogger';
import { useSettings } from '@/core/utils/useSettings';
import { Card, Button, Modal, Pagination, Can, Table, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseOrdersPaginated } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { PurchaseOrder } from '../types';
import { useFormatters } from '@/core/utils/useFormatters';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';

export const PurchaseOrdersPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const orderFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { orders, total, page, pageSize, isLoading, goToPage, changePageSize, remove, convertToInvoice } = usePurchaseOrdersPaginated(activeCompany?.id || '', orderFilters);
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || 'YER';

  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmConvert, setConfirmConvert] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const openView = useCallback(async (order: PurchaseOrder) => {
    if (activeCompany?.id) {
      const res = await purchasesApi.getOrderById(order.id, activeCompany.id);
      if (res.success && res.data) { setSelectedOrder(res.data); setViewModalOpen(true); return; }
    }
    setSelectedOrder(order);
    setViewModalOpen(true);
  }, [activeCompany]);

  // Paginated rows carry lines: [] — the editor page refetches by id.
  const handleEditRow = useCallback((order: PurchaseOrder) => {
    navigate(`/purchases/orders/${order.id}`);
  }, [navigate]);
  const openCreate = useCallback(() => {
    navigate('/purchases/orders/new');
  }, [navigate]);

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
      partyLabel: t('purchases.supplier.title'),
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
      vatRate: settings?.vatRate ?? 15,
      currency: currencySymbol,
      paymentType: order.paymentType,
      createdBy: order.createdBy,
      statusBadge: STATUS_LABELS[order.status] || order.status,
      statusTone: order.status === 'invoiced' ? 'success' : 'muted',
    }, false, t);
  }, [activeCompany, t, currencySymbol, settings?.vatRate]);

  const columns = useMemo(() => [
    { key: 'orderNumber', header: t('purchases.orderNumber'), mobile: 'title' as const, render: (row: PurchaseOrder) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.orderNumber}</span> },
    { key: 'supplier', header: t('purchases.supplier.title'), mobile: 'subtitle' as const, render: (row: PurchaseOrder) => <span>{row.supplier?.name || row.supplierId}</span> },
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
              <div><span className="text-slate-500">{t('purchases.supplier.title')}:</span> <strong>{selectedOrder.supplier?.name || selectedOrder.supplierId}</strong></div>
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
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrint(selectedOrder)}>{t('print.title')}</Button>
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
