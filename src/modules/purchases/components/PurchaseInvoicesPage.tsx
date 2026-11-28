import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, CheckSquare, BookOpen, Printer, Wallet, Layers, ShoppingCart, Store,
Receipt, Undo2 } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { todayIso } from '@/core/utils/aging';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { useUserMap } from '@/core/utils/useUserMap';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Pagination, Can, DynamicTable, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseInvoicesPaginated } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import { purchasesApi } from '../api';
import { reversePurchaseInvoice } from '@/modules/accounting/reversal';
import { ReverseDialog } from '@/modules/accounting/components/ReverseDialog';
import { useToastStore } from '@/core/store/toastStore';
import type { PurchaseInvoice } from '../types';

export const PurchaseInvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
    remove,
    post,
    reload,
  } = usePurchaseInvoicesPaginated(activeCompany?.id || '', invoiceFilters);
  const [reverseRow, setReverseRow] = useState<PurchaseInvoice | null>(null);

  const handleReverseConfirm = async (date: string, reason: string) => {
    if (!activeCompany?.id || !reverseRow) return;
    const res = await reversePurchaseInvoice(activeCompany.id, reverseRow.id, { date, reason }, user?.id || '');
    if (res.success) {
      addToast('success', `${t('accounting.reverse.success')} (${res.data.reference})`);
      setReverseRow(null);
      await reload();
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { getUserName } = useUserMap();
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || 'YER';

  const [viewModalOpen, setViewModalOpen] = useState(false);
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(null);
  // Full-page editor replaces the 4xl modal.
  const openCreate = useCallback(() => {
    navigate('/purchases/invoices/new');
  }, [navigate]);


  const openView = useCallback(async (invoice: PurchaseInvoice) => {
    if (activeCompany?.id) {
      const res = await purchasesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data) { setSelectedInvoice(res.data); setViewModalOpen(true); return; }
    }
    setSelectedInvoice(invoice);
    setViewModalOpen(true);
  }, [activeCompany]);

  // Paginated rows carry lines: [] — the editor page refetches by id.
  void 0;
  const handleEditRow = useCallback((invoice: PurchaseInvoice) => {
    navigate(`/purchases/invoices/${invoice.id}`);
  }, [navigate]);

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
    const STATUS_LABELS: Record<string, string> = {
      draft: t('purchases.filter.draft'),
      posted: t('purchases.filter.posted'),
      partially_paid: t('sales.status.partially_paid'),
      paid: t('sales.status.paid'),
      cancelled: t('purchases.filter.cancelled'),
    };
    const isOverdue = invoice.dueDate ? invoice.dueDate < todayIso() : false;
    printDocument({
      type: 'purchase-invoice',
      docNumber: invoice.invoiceNumber,
      date: invoice.date,
      dueDate: invoice.dueDate,
      partyName: invoice.supplier?.name || invoice.supplierId,
      partyLabel: t('purchases.supplier.title'),
      partyTaxNumber: invoice.supplier?.taxNumber,
      partyAddress: invoice.supplier?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.description || t('inventory.productName'),
        productCode: l.productCode,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unitName || l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: 0, // خصم على مستوى الفاتورة فقط — جديد 0007 (تم إزالته من صفوف الفاتورة)
        total: l.lineTotal,
      })),
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
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
      statusBadge: STATUS_LABELS[invoice.status] || invoice.status,
      statusTone: invoice.status === 'paid' ? 'success' : (isOverdue ? 'warning' : 'muted'),
    }, false, t);
  }, [activeCompany, t, currencySymbol, settings?.vatRate]);

  const handleExportExcel = useCallback(() => {
    const exportColumns = [
      { key: 'invoiceNumber', header: t('purchases.invoiceNumber'), width: 20 },
      { key: 'supplierName', header: t('purchases.supplier.title'), width: 25 },
      { key: 'date', header: t('purchases.date'), width: 15 },
      { key: 'subtotal', header: t('purchases.subtotal'), width: 15 },
      ...(showDiscount ? [{ key: 'discountAmount', header: t('sales.discount'), width: 15 }] : []),
      { key: 'vatAmount', header: t('purchases.vat'), width: 15 },
      { key: 'totalAmount', header: t('purchases.total'), width: 15 },
      { key: 'paymentType', header: t('purchases.invoice.paymentType'), width: 15 },
      { key: 'status', header: t('purchases.status'), width: 15 },
    ];
    const exportData = invoices.map(i => ({
      invoiceNumber: i.invoiceNumber,
      supplierName: i.supplier?.name || i.supplierId,
      date: i.date,
      subtotal: i.subtotal,
      ...(showDiscount ? { discountAmount: i.discountAmount } : {}),
      vatAmount: i.vatAmount,
      totalAmount: i.totalAmount,
      paymentType: i.paymentType,
      status: i.status,
    }));
    exportToExcel(exportData, exportColumns, 'purchase_invoices');
  }, [t, invoices, showDiscount]);

  const handleExportPdf = useCallback(() => {
    exportToPDF(invoices, [
      { key: 'invoiceNumber', header: t('purchases.invoiceNumber') },
      { key: 'supplierName', header: t('purchases.supplier.title') },
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
      header: t('purchases.supplier.title'),
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
    { key: 'subtotal', header: t('purchases.subtotal'), align: 'right' as const, render: (row: PurchaseInvoice) => <span className="tabular-nums text-sm">{formatCurrency(row.subtotal)}</span> },
    ...(showDiscount ? [{ key: 'discountAmount', header: t('sales.discount'), align: 'right' as const, render: (row: PurchaseInvoice) => <span className="tabular-nums text-sm text-amber-700 dark:text-amber-300">{formatCurrency(row.discountAmount)}</span> }] : []),
    { key: 'vatAmount', header: t('purchases.vat'), align: 'right' as const, render: (row: PurchaseInvoice) => <span className="tabular-nums text-sm text-zinc-600">{formatCurrency(row.vatAmount)}</span> },
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
              onEdit={inv.status === 'draft' ? () => handleEditRow(inv) : undefined}
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
              {['posted', 'partially_paid', 'paid'].includes(inv.status) && (
                <Can action="post" module="purchases">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('accounting.reverse.title')}
                    aria-label={t('accounting.reverse.title')}
                    onClick={() => setReverseRow(inv)}
                  >
                    <Undo2 size={14} />
                  </Button>
                </Can>
              )}
            </div>
        );
      },
    },
  ], [t, postingId, openView, handleEditRow, handleDelete, handlePrint, handlePost, formatCurrency, formatDate, getUserName, showDiscount]);

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
              <FileText size={15} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">{t('common.excel')}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5">
              <Receipt size={15} className="text-rose-600" /> <span className="hidden sm:inline text-xs">{t('common.pdf')}</span>
            </Button>
          </>
        }
      />

      <Card noPadding>
        <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800">
          <DynamicTable<PurchaseInvoice> tableKey="purchases.invoices"
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
              <div><span className="text-slate-500">{t('purchases.supplier.title')}:</span> <strong>{selectedInvoice.supplier?.name || selectedInvoice.supplierId}</strong></div>
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
                    <th className="p-2 text-right">{t('purchases.line.unit')}</th>
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
                      <td className="p-2">{line.unitName || line.unit || '-'}</td>
                      <td className="p-2">{line.quantity}</td>
                      <td className="p-2">{formatCurrency(line.unitPrice)}</td>
                      <td className="p-2 font-medium">{formatCurrency(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-4 text-sm flex-wrap">
              <span>{t('purchases.subtotal')}: <strong>{formatCurrency(selectedInvoice.subtotal)}</strong></span>
              {showDiscount && selectedInvoice.discountAmount > 0 && <span className="text-amber-700 dark:text-amber-300">{t('sales.discount')}: <strong>-{formatCurrency(selectedInvoice.discountAmount)}</strong></span>}
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
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrint(selectedInvoice)}>{t('print.title')}</Button>
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

      <ReverseDialog
        open={!!reverseRow}
        onClose={() => setReverseRow(null)}
        docLabel={reverseRow?.invoiceNumber || ''}
        onConfirm={handleReverseConfirm}
      />
    </div>
  );
};

export default PurchaseInvoicesPage;
