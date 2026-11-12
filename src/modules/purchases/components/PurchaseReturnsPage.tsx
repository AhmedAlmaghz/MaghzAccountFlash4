import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Undo2, Plus, CheckSquare, Printer, FileText, BookOpen, Layers, RotateCcw } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Pagination, Can, Table, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePurchaseReturnsPaginated } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { PurchaseReturn } from '../types';
import { useFormatters } from '@/core/utils/useFormatters';
import { purchasesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';
import { useSettings } from '@/core/utils/useSettings';

export const PurchaseReturnsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const { settings } = useSettings(activeCompany?.id || '');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const returnFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { returns, total, page, pageSize, isLoading, goToPage, changePageSize, remove, post } = usePurchaseReturnsPaginated(activeCompany?.id || '', returnFilters);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || 'YER';

  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<PurchaseReturn | null>(null);
  const openCreate = useCallback(() => navigate('/purchases/returns/new'), [navigate]);

  const openView = useCallback(async (ret: PurchaseReturn) => {
    if (activeCompany?.id) {
      const res = await purchasesApi.getReturnById(ret.id, activeCompany.id);
      if (res.success && res.data) { setSelectedReturn(res.data); setViewModalOpen(true); return; }
    }
    setSelectedReturn(ret);
    setViewModalOpen(true);
  }, [activeCompany]);

  const handleEditRow = useCallback((ret: PurchaseReturn) => {
    navigate(`/purchases/returns/${ret.id}`);
    void ret;
  }, [navigate]);

  const handleDelete = useCallback((id: string) => setConfirmDelete(id), []);
  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete || !activeCompany?.id) return;
    await remove(confirmDelete);
    addToast('success', t('purchases.return.deleted'));
    await logAudit({ userId: user?.id || '', action: 'delete', tableName: 'purchase_returns', recordId: confirmDelete, companyId: activeCompany.id });
    setConfirmDelete(null);
  }, [confirmDelete, activeCompany, remove, user, addToast, t]);

  const handlePost = useCallback((ret: PurchaseReturn) => setConfirmPost(ret.id), []);
  const confirmPostAction = useCallback(async () => {
    if (!confirmPost || !activeCompany?.id) return;
    setPostingId(confirmPost);
    const ret = returns.find(r => r.id === confirmPost);
    if (!ret) { setPostingId(null); setConfirmPost(null); return; }

    // Single reference: the API posts atomically (JE + stock movements + status flip + supplier balance).
    const result = await post(confirmPost);

    if (result.success) {
      addToast('success', t('purchases.return.posted'));
      await logAudit({ userId: user?.id || '', action: 'post', tableName: 'purchase_returns', recordId: confirmPost, companyId: activeCompany.id });
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setPostingId(null);
    setConfirmPost(null);
  }, [confirmPost, activeCompany, returns, post, user, addToast, t]);

  const handlePrint = useCallback(async (ret: PurchaseReturn) => {
    let lines = ret.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await purchasesApi.getReturnById(ret.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    const STATUS_LABELS: Record<string, string> = {
      draft: t('purchases.filter.draft'),
      posted: t('purchases.filter.posted'),
      cancelled: t('purchases.filter.cancelled'),
    };
    printDocument({
      type: 'purchase-return',
      docNumber: ret.returnNumber,
      date: ret.date,
      partyName: ret.supplier?.name || ret.supplierId,
      partyLabel: t('purchases.supplier.title'),
      partyTaxNumber: ret.supplier?.taxNumber,
      partyAddress: ret.supplier?.address,
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
      subtotal: ret.subtotal,
      vatAmount: ret.vatAmount,
      totalAmount: ret.totalAmount,
      notes: ret.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      companyLogoUrl: activeCompany?.logoUrl,
      vatRate: settings?.vatRate ?? 15,
      currency: currencySymbol,
      paymentType: ret.paymentType,
      createdBy: ret.createdBy,
      statusBadge: STATUS_LABELS[ret.status] || ret.status,
      statusTone: ret.status === 'posted' ? 'success' : 'muted',
    }, false, t);
  }, [activeCompany, t, currencySymbol, settings?.vatRate]);

  const totalPosted = useMemo(() => returns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalAmount, 0), [returns]);

  const visibleReturns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return returns;
    return returns.filter((r) =>
      r.returnNumber?.toLowerCase().includes(q) ||
      (r.supplier?.name || '').toLowerCase().includes(q) ||
      r.status?.toLowerCase().includes(q) ||
      String(r.totalAmount || '').includes(q)
    );
  }, [returns, search]);

  const columns = useMemo(() => [
    { key: 'returnNumber', header: t('purchases.return.number'), mobile: 'title' as const, render: (row: PurchaseReturn) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.returnNumber}</span> },
    { key: 'invoiceNumber', header: t('purchases.return.originalInvoice'), mobile: 'hidden' as const, render: (row: PurchaseReturn) => <span className="flex items-center gap-1 text-blue-600"><FileText size={14} /> {row.invoiceNumber || '-'}</span> },
    { key: 'supplier', header: t('purchases.supplier.title'), mobile: 'subtitle' as const, render: (row: PurchaseReturn) => <span>{row.supplier?.name || row.supplierId}</span> },
    { key: 'date', header: t('purchases.date'), render: (row: PurchaseReturn) => <span>{row.date ? formatDate(row.date) : '-'}</span> },
    { key: 'totalAmount', header: t('purchases.total'), render: (row: PurchaseReturn) => <span className="font-medium">{formatCurrency(row.totalAmount)}</span> },
    { key: 'status', header: t('purchases.status'), mobile: 'status' as const, render: (row: PurchaseReturn) => <StatusBadge status={row.status} /> },
    {
      key: 'paymentType',
      header: t('purchases.return.paymentType'),
      render: (row: PurchaseReturn) => {
        const pt = row.paymentType;
        return pt === 'cash'
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('purchases.return.cash')}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('purchases.return.credit')}</span>;
      },
    },
    {
      key: 'actions',
      header: t('purchases.actions'),
      mobile: 'actions' as const,
      render: (row: PurchaseReturn) => {
        const ret = row;
        const isPosting = postingId === ret.id;
        return (
          <div className="flex items-center gap-1">
            <ActionButtons
              onView={() => openView(ret)}
              onEdit={ret.status === 'draft' ? () => handleEditRow(ret) : undefined}
              onDelete={ret.status === 'draft' ? () => handleDelete(ret.id) : undefined}
              onPrint={() => handlePrint(ret)}
              showView
              showEdit={ret.status === 'draft'}
              showDelete={ret.status === 'draft'}
              showPrint
              showExport={false}
              disabled={isPosting}
            />
            {ret.status === 'draft' && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<CheckSquare size={14} />}
                onClick={() => handlePost(ret)}
                disabled={isPosting}
              >
                {isPosting ? t('loading') : t('accounting.post')}
              </Button>
            )}
            {ret.status !== 'draft' && (
              <span className="text-xs text-zinc-400 flex items-center gap-1 mr-2">
                <BookOpen size={12} /> {t('accounting.posted')}
              </span>
            )}
          </div>
        );
      },
    },
  ], [t, postingId, openView, handleEditRow, handleDelete, handlePrint, handlePost, formatCurrency, formatDate]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<RotateCcw size={22} />}
        title={t('purchases.returns')}
        subtitle={t('purchases.returnsSubtitle')}
        actions={
          <Can action="create" module="purchases">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">{t('purchases.return.create')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        columns={4}
        items={[
          { label: t('purchases.return.total'), value: String(total), icon: <Undo2 size={18} />, tone: 'primary' },
          { label: t('purchases.return.postedTotal'), value: formatCurrency(totalPosted), icon: <FileText size={18} />, tone: 'danger' },
          { label: t('purchases.return.drafts'), value: String(returns.filter(r => r.status === 'draft').length), icon: <Layers size={18} />, tone: 'warning' },
          { label: t('sales.status.posted'), value: String(returns.filter(r => r.status === 'posted').length), icon: <CheckSquare size={18} />, tone: 'success' },
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
          { key: 'cancelled', label: t('purchases.filter.cancelled') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key)}
      />

      <Card noPadding>
        <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800">
          <Table<PurchaseReturn>
            data={visibleReturns}
            columns={columns as never}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage={t('purchases.return.emptyTitle')}
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
        title={t('purchases.return.details')}
        onClose={() => setViewModalOpen(false)}
        size="lg"
      >
        {selectedReturn && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">{t('purchases.return.number')}:</span> <strong>{selectedReturn.returnNumber}</strong></div>
              <div><span className="text-slate-500">{t('purchases.supplier.title')}:</span> <strong>{selectedReturn.supplier?.name || selectedReturn.supplierId}</strong></div>
              <div><span className="text-slate-500">{t('purchases.date')}:</span> {selectedReturn.date}</div>
              <div><span className="text-slate-500">{t('purchases.return.originalInvoice')}:</span> {selectedReturn.invoiceNumber || '-'}</div>
              <div><span className="text-slate-500">{t('purchases.status')}:</span> <StatusBadge status={selectedReturn.status} /></div>
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
                  {(selectedReturn.lines || []).map((line, idx) => (
                    <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2">{line.productName || line.description || line.productId}</td>
                      <td className="p-2 text-slate-500">{line.unitName || line.unit || '-'}</td>
                      <td className="p-2">{line.quantity}</td>
                      <td className="p-2">{formatCurrency(line.unitPrice || 0)}</td>
                      <td className="p-2 font-medium">{formatCurrency(line.lineTotal || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end text-lg font-bold text-primary-600">
              {t('purchases.total')}: {formatCurrency(selectedReturn.totalAmount || 0)}
            </div>
            {selectedReturn.reason && (
              <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                {t('purchases.return.reason')}: {selectedReturn.reason}
              </div>
            )}
            {selectedReturn.notes && (
              <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                {t('notes')}: {selectedReturn.notes}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>{t('close')}</Button>
              <Button variant="primary" leftIcon={<Printer size={16} />} onClick={() => handlePrint(selectedReturn)}>{t('print.title')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title={t('purchases.return.deleteTitle')}
        message={t('purchases.return.deleteConfirm')}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmPost}
        onClose={() => setConfirmPost(null)}
        onConfirm={confirmPostAction}
        title={t('purchases.return.postTitle')}
        message={t('purchases.return.postConfirm')}
        variant="warning"
      />
    </div>
  );
};

export default PurchaseReturnsPage;
