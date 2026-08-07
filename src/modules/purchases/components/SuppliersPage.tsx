import React, { useState, useMemo, useCallback } from 'react';
import { Store, Plus, FileText, Phone, Mail, MapPin, Hash } from 'lucide-react';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Input, Pagination, Can } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { DataTablePro } from '@/core/ui/components/DataTablePro';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useSuppliersPaginated, useSupplierDetails } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { Supplier, SupplierStatementItem } from '../types';
import type { ColumnDef } from '@tanstack/react-table';
import { printDocument } from '@/core/utils/printDocument';
import { purchasesApi } from '../api';
import { useFormatters } from '@/core/utils/useFormatters';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useToastStore } from '@/core/store/toastStore';

interface SupplierForm {
  name: string;
  code: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  isActive: boolean;
}

const initialForm = (): SupplierForm => ({
  name: '',
  code: '',
  phone: '',
  email: '',
  address: '',
  taxNumber: '',
  isActive: true,
});

export const SuppliersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const user = useAuthStore(state => state.user);
  const [isActiveFilter, setIsActiveFilter] = useState<boolean | undefined>(undefined);
  const supplierFilters = useMemo(() => ({ isActive: isActiveFilter }), [isActiveFilter]);
  const { suppliers, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useSuppliersPaginated(activeCompany?.id || '', supplierFilters);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(initialForm());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const { supplier, statement, aging, isLoading: cardLoading } = useSupplierDetails(activeCompany?.id || '', selectedSupplierId);

  const openCreate = useCallback(async () => {
    setEditingId(null);
    setForm(initialForm());
    if (activeCompany) {
      const seq = await getNextNumber('supplier', activeCompany.id);
      if (seq?.number) setForm(prev => ({ ...prev, code: seq.number || '' }));
    }
    setModalOpen(true);
  }, [activeCompany, getNextNumber]);

  const openEdit = useCallback((s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      code: s.code || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      taxNumber: s.taxNumber || '',
      isActive: s.isActive,
    });
    setModalOpen(true);
  }, []);

  const openCard = useCallback((s: Supplier) => {
    setSelectedSupplierId(s.id);
    setCardOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeCompany?.id || !form.name) return;
    const payload = {
      companyId: activeCompany.id,
      name: form.name,
      code: form.code,
      phone: form.phone,
      email: form.email,
      address: form.address,
      taxNumber: form.taxNumber,
      balance: 0,
      isActive: form.isActive,
    };

    if (editingId) {
      await update(editingId, payload);
      addToast('success', t('purchases.supplier.updated'));
      await logAudit({ userId: user?.id || '', action: 'update', tableName: 'suppliers', recordId: editingId, companyId: activeCompany.id });
    } else {
      const result = await create(payload);
      if (result.success && result.id) {
        addToast('success', t('purchases.supplier.created'));
        await logAudit({ userId: user?.id || '', action: 'create', tableName: 'suppliers', recordId: result.id, companyId: activeCompany.id });
      } else {
        addToast('error', result.error || t('common.error'));
      }
    }
    setModalOpen(false);
    setEditingId(null);
    setForm(initialForm());
  }, [activeCompany, form, editingId, create, update, user, addToast, t]);

  const handleDelete = useCallback((id: string) => {
    setConfirmDelete(id);
  }, []);

  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete || !activeCompany?.id) return;
    const result = await remove(confirmDelete);
    if (result.success) {
      addToast('success', t('purchases.supplier.deleted'));
      await logAudit({ userId: user?.id || '', action: 'delete', tableName: 'suppliers', recordId: confirmDelete, companyId: activeCompany.id });
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setConfirmDelete(null);
  }, [confirmDelete, activeCompany, remove, user, addToast, t]);

  const handleExportExcel = useCallback(() => {
    exportToExcel(suppliers, [
      { key: 'name', header: t('purchases.supplier.name'), width: 25 },
      { key: 'code', header: t('purchases.supplier.code'), width: 15 },
      { key: 'phone', header: t('purchases.supplier.phone'), width: 15 },
      { key: 'email', header: t('purchases.supplier.email'), width: 20 },
      { key: 'address', header: t('purchases.supplier.address'), width: 25 },
      { key: 'taxNumber', header: t('purchases.supplier.taxNumber'), width: 15 },
      { key: 'balance', header: t('purchases.supplier.totalBalance'), width: 15 },
    ], 'suppliers');
  }, [suppliers, t]);

  const handlePrintStatement = useCallback(async (s: Supplier) => {
    try {
      if (!activeCompany?.id) return;
      const res = await purchasesApi.getSupplierStatement(s.id, activeCompany.id);
      if (!res.success || !res.data) { addToast('error', res.error || t('common.error')); return; }
      const statementLines = res.data.map(r => ({
        date: typeof r.date === 'string' && r.date.length > 10 ? r.date.slice(0, 10) : (r.date || ''),
        docNumber: r.documentNumber,
        description: r.description || r.type,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
      }));
      const totalDebit = statementLines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = statementLines.reduce((sum, l) => sum + l.credit, 0);
      const closingBalance = statementLines.length > 0 ? statementLines[statementLines.length - 1].balance : 0;
      printDocument({
        type: 'statement',
        docNumber: s.code || s.id.slice(0, 8),
        date: new Date().toISOString().split('T')[0],
        partyName: s.name,
        partyLabel: t('purchases.supplier'),
        partyTaxNumber: s.taxNumber,
        partyAddress: s.address,
        lines: [],
        statementLines,
        subtotal: totalDebit,
        vatAmount: totalCredit,
        totalAmount: closingBalance,
        companyName: activeCompany.name,
        companyTaxNumber: activeCompany.taxNumber,
        companyPhone: activeCompany.phone,
        companyAddress: activeCompany.address,
        currency: activeCompany.currency || 'YER',
      });
    } catch (err) {
      addToast('error', String(err));
    }
  }, [activeCompany, addToast, t]);

  const handleExportPdf = useCallback(() => {
    exportToPDF(suppliers, [
      { key: 'name', header: t('purchases.supplier.name') },
      { key: 'phone', header: t('purchases.supplier.phone') },
      { key: 'email', header: t('purchases.supplier.email') },
      { key: 'balance', header: t('purchases.supplier.totalBalance') },
    ], 'suppliers', { title: t('purchases.suppliers'), rtl: true, companyName: activeCompany?.name });
  }, [suppliers, t, activeCompany]);

  const columns = useMemo<ColumnDef<Supplier>[]>(() => [
    { accessorKey: 'name', header: t('purchases.supplier.name'), cell: ({ row }) => <span className="font-medium text-slate-900 dark:text-slate-100">{row.original.name}</span> },
    { accessorKey: 'phone', header: t('purchases.supplier.phone') },
    { accessorKey: 'email', header: t('purchases.supplier.email') },
    { accessorKey: 'balance', header: t('purchases.supplier.totalBalance'), cell: ({ row }) => {
      const bal = Number(row.original.balance) || 0;
      return (
        <span className={bal > 0 ? 'text-primary-600 font-semibold' : bal < 0 ? 'text-emerald-600 font-semibold' : 'text-slate-700 dark:text-slate-200'}>
          {formatCurrency(bal)}
          {bal < 0 && <span className="text-xs mr-1">(مسدد)</span>}
        </span>
      );
    } },
    { accessorKey: 'isActive', header: t('purchases.supplier.isActive'), cell: ({ row }) => <StatusBadge status={row.original.isActive ? 'active' : 'inactive'} /> },
    {
      accessorKey: 'actions',
      header: t('purchases.actions'),
      cell: ({ row }) => (
        <ActionButtons
          onView={() => openCard(row.original)}
          onEdit={() => openEdit(row.original)}
          onDelete={() => handleDelete(row.original.id)}
          onPrint={() => handlePrintStatement(row.original)}
          showView
          showEdit
          showDelete
          showPrint
          showExport={false}
        />
      ),
    },
  ], [t, openCard, openEdit, handleDelete, handlePrintStatement, formatCurrency]);

  const totalBalance = useMemo(() => suppliers.reduce((s, sup) => s + Number(sup.balance), 0), [suppliers]);

  const statementColumns = useMemo<ColumnDef<SupplierStatementItem>[]>(() => [
    { accessorKey: 'date', header: t('date') },
    { accessorKey: 'documentNumber', header: t('documentNumber') },
    { accessorKey: 'description', header: t('description') },
    { accessorKey: 'debit', header: t('accounting.debit'), cell: ({ row }) => <span className="text-rose-600">{Number(row.original.debit || 0) > 0 ? formatCurrency(row.original.debit || 0) : '-'}</span> },
    { accessorKey: 'credit', header: t('accounting.credit'), cell: ({ row }) => <span className="text-emerald-600">{Number(row.original.credit || 0) > 0 ? formatCurrency(row.original.credit || 0) : '-'}</span> },
    { accessorKey: 'balance', header: t('balance'), cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.balance || 0)}</span> },
  ], [t, formatCurrency]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Store size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('purchases.suppliers')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('purchases.suppliersSubtitle')}</p>
          </div>
        </div>
        <Can action="create" module="purchases">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
            {t('purchases.supplier.new')}
          </Button>
        </Can>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={isActiveFilter === undefined ? 'all' : isActiveFilter ? 'active' : 'inactive'}
          onChange={(e) => {
            const v = e.target.value;
            setIsActiveFilter(v === 'all' ? undefined : v === 'active');
          }}
          className="px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
          aria-label={t('purchases.supplier.isActive')}
          title={t('purchases.supplier.isActive')}
        >
          <option value="all">{t('purchases.filter.all')}</option>
          <option value="active">{t('settings.common.active')}</option>
          <option value="inactive">{t('settings.common.inactive')}</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('purchases.supplier.total')}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{suppliers.length}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('purchases.supplier.active')}</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{suppliers.filter(s => s.isActive).length}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('purchases.supplier.totalBalance')}</p>
            <p className={`text-2xl font-bold ${totalBalance > 0 ? 'text-primary-600 dark:text-primary-400' : totalBalance < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`}>{formatCurrency(totalBalance)}</p>
          </div>
        </Card>
      </div>

      <Card>
        <DataTablePro<Supplier>
          data={suppliers}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('purchases.supplier.emptyTitle')}
          title={t('purchases.suppliers')}
          onExportExcel={handleExportExcel}
          onExportPdf={handleExportPdf}
          searchable
          searchPlaceholder={t('search') + '...'}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={changePageSize}
        />
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        title={editingId ? t('purchases.supplier.edit') : t('purchases.supplier.new')}
        onClose={() => { setModalOpen(false); setEditingId(null); setForm(initialForm()); }}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingId(null); }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={!form.name} leftIcon={<Plus size={16} />}>
              {editingId ? t('save') : t('create')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label={t('purchases.supplier.name')} value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
          <Input label={t('purchases.supplier.code')} value={form.code} onChange={e => setForm(prev => ({ ...prev, code: e.target.value }))} />
          <Input label={t('purchases.supplier.phone')} value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} />
          <Input label={t('purchases.supplier.email')} type="email" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} />
          <Input label={t('purchases.supplier.address')} value={form.address} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} />
          <Input label={t('purchases.supplier.taxNumber')} value={form.taxNumber} onChange={e => setForm(prev => ({ ...prev, taxNumber: e.target.value }))} />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={form.isActive}
              onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="isActive" className="text-sm text-slate-700 dark:text-slate-200">{t('purchases.supplier.isActive')}</label>
          </div>
        </div>
      </Modal>

      {/* Supplier Card Modal */}
      <Modal
        isOpen={cardOpen}
        title={t('purchases.supplier.card')}
        onClose={() => { setCardOpen(false); setSelectedSupplierId(null); }}
        size="xl"
      >
        {cardLoading ? (
          <div className="space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
          </div>
        ) : supplier ? (
          <div className="space-y-6">
            {/* Supplier Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
                  <Store size={18} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('purchases.supplier.name')}</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.name}</p>
                </div>
              </div>
              {supplier.phone && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                    <Phone size={18} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{t('purchases.supplier.phone')}</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.phone}</p>
                  </div>
                </div>
              )}
              {supplier.email && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <Mail size={18} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{t('purchases.supplier.email')}</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.email}</p>
                  </div>
                </div>
              )}
              {supplier.taxNumber && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                    <Hash size={18} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{t('purchases.supplier.taxNumber')}</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.taxNumber}</p>
                  </div>
                </div>
              )}
              {supplier.address && (
                <div className="flex items-center gap-3 md:col-span-3">
                  <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
                    <MapPin size={18} className="text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{t('purchases.supplier.address')}</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{supplier.address}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Tabs-like sections */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <FileText size={18} /> {t('purchases.supplier.statement')}
              </h3>
              {statement.length > 0 ? (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <DataTablePro<SupplierStatementItem>
                    data={statement}
                    columns={statementColumns}
                    keyExtractor={(row) => row.id}
                    isLoading={false}
                    emptyMessage=""
                    searchable={false}
                    pageSize={10}
                  />
                </div>
              ) : (
                <EmptyState
                  icon="file"
                  title={t('purchases.supplier.noTransactions')}
                  description={t('purchases.supplier.noTransactionsDesc')}
                />
              )}
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <Hash size={18} /> {t('purchases.supplier.aging')}
              </h3>
              {aging.length > 0 && aging.some(a => a.amount > 0) ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {aging.map((bucket) => (
                    <Card key={bucket.bucket}>
                      <div className="p-4 text-center">
                        <p className="text-sm text-slate-500 dark:text-slate-400">{bucket.bucket} {t('purchases.supplier.days')}</p>
                        <p className="text-xl font-bold text-slate-900 dark:text-slate-50">{formatCurrency(bucket.amount || 0)}</p>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="search"
                  title={t('purchases.supplier.noAging')}
                  description={t('purchases.supplier.noAgingDesc')}
                />
              )}
            </div>
          </div>
        ) : (
          <EmptyState icon="search" title={t('purchases.supplier.emptyTitle')} />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title={t('purchases.supplier.deleteTitle')}
        message={t('purchases.supplier.deleteConfirm')}
        variant="danger"
      />
    </div>
  );
};

export default SuppliersPage;
