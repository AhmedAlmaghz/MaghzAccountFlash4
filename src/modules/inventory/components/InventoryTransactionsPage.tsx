import React, { useState, useMemo, useCallback } from 'react';
import { ArrowRightLeft, Plus, Printer, Download, CheckSquare, Search } from 'lucide-react';
import { Card, Button, Modal, Input, Table, Badge, Can } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { ProductSelect, WarehouseSelect } from '@/core/ui/components/smart';
import { useInventoryTransactionsPaginated } from '../hooks/useInventory';
import { Pagination } from '@/core/ui/components/Pagination';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { InventoryTransaction } from '../types';

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  in: { label: 'inventory.in', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  out: { label: 'inventory.out', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  adjustment: { label: 'inventory.adjustment', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  transfer: { label: 'inventory.transfer', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
};

export const InventoryTransactionsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const txFilters = useMemo(() => ({ type: typeFilter || undefined }), [typeFilter]);
  const { transactions, total, page, pageSize, isLoading, goToPage, changePageSize, create, remove } = useInventoryTransactionsPaginated(activeCompany?.id || '', txFilters);

  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<InventoryTransaction>>({
    date: new Date().toISOString().split('T')[0],
    type: 'in',
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return transactions;
    return transactions.filter(tx =>
      tx.reference?.toLowerCase().includes(term) ||
      tx.notes?.toLowerCase().includes(term) ||
      tx.productName?.toLowerCase().includes(term) ||
      tx.warehouseName?.toLowerCase().includes(term)
    );
  }, [transactions, search]);

  const resetForm = useCallback(() => {
    setForm({ date: new Date().toISOString().split('T')[0], type: 'in' });
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    resetForm();
  }, [resetForm]);

  const handleAdd = async () => {
    if (!activeCompany || !form.productId || !form.warehouseId) {
      addToast('error', 'الرجاء اختيار المنتج والمستودع');
      return;
    }
    if (!form.quantity || Number(form.quantity) <= 0) {
      addToast('error', 'الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    setSaving(true);
    try {
      const result = await create({
        companyId: activeCompany.id,
        date: form.date || new Date().toISOString().split('T')[0],
        type: form.type || 'in',
        productId: form.productId,
        warehouseId: form.warehouseId,
        quantity: Number(form.quantity),
        reference: form.reference || '',
        notes: form.notes || '',
      });
      if (result?.success) {
        addToast('success', t('inventory.transaction.created'));
        closeModal();
      } else {
        addToast('error', result?.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await remove(id);
    if (result?.success) {
      addToast('success', t('inventory.transaction.deleted'));
    } else {
      addToast('error', result?.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handleExportExcel = () => {
    exportToExcel(
      filtered,
      [
        { key: 'date', header: t('inventory.date') },
        { key: 'type', header: t('inventory.type') },
        { key: 'productName', header: t('inventory.productName') },
        { key: 'warehouseName', header: t('inventory.warehouse') },
        { key: 'quantity', header: t('inventory.quantity') },
        { key: 'reference', header: t('inventory.reference') },
      ],
      `inventory-transactions-${new Date().toISOString().split('T')[0]}`
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      filtered,
      [
        { key: 'date', header: t('inventory.date') },
        { key: 'type', header: t('inventory.type') },
        { key: 'productName', header: t('inventory.productName') },
        { key: 'warehouseName', header: t('inventory.warehouse') },
        { key: 'quantity', header: t('inventory.quantity') },
        { key: 'reference', header: t('inventory.reference') },
      ],
      `inventory-transactions-${new Date().toISOString().split('T')[0]}`,
      {
        title: t('inventory.transactions'),
        subtitle: activeCompany?.name,
        rtl: true,
      }
    );
  };

  const handlePrint = () => {
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>${t('inventory.transactions')}</title>
<style>
body{font-family:'Cairo',sans-serif;padding:24px;color:#1e293b}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#4f46e5;color:#fff;padding:10px 12px;border:1px solid #4f46e5}
td{border:1px solid #e2e8f0;padding:8px 12px}
tr:nth-child(even){background:#f8fafc}
.header{text-align:center;margin-bottom:16px}
.header h1{font-size:18px;font-weight:700;color:#4f46e5}
</style>
</head>
<body>
<div class="header"><h1>${t('inventory.transactions')}</h1><p>${activeCompany?.name || ''}</p></div>
<table>
<thead><tr>
<th>${t('inventory.date')}</th>
<th>${t('inventory.type')}</th>
<th>${t('inventory.productName')}</th>
<th>${t('inventory.warehouse')}</th>
<th>${t('inventory.quantity')}</th>
<th>${t('inventory.reference')}</th>
</tr></thead>
<tbody>
${filtered.map(tx => `<tr>
<td>${tx.date}</td>
<td>${t(TYPE_CONFIG[tx.type]?.label || tx.type)}</td>
<td>${tx.productName || tx.productId}</td>
<td>${tx.warehouseName || tx.warehouseId}</td>
<td>${tx.quantity}</td>
<td>${tx.reference || '-'}</td>
</tr>`).join('')}
</tbody>
</table>
<script>window.print()</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ArrowRightLeft size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('inventory.transactions')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('inventory.page.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-10 pr-9 pl-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm w-48"
              aria-label={t('search')}
            />
          </div>
          <select
            className="h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            title={t('inventory.type')}
            aria-label={t('inventory.type')}
          >
            <option value="">{t('all')}</option>
            <option value="in">{t('inventory.in')}</option>
            <option value="out">{t('inventory.out')}</option>
            <option value="adjustment">{t('inventory.adjustment')}</option>
            <option value="transfer">{t('inventory.transfer')}</option>
          </select>
          <Button variant="secondary" size="sm" leftIcon={<Printer size={16} />} onClick={handlePrint}>
            {t('print')}
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportExcel}>
            Excel
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportPDF}>
            PDF
          </Button>
          <Can action="create" module="inventory">
            <Button variant="primary" size="sm" leftIcon={<Plus size={16} />} onClick={() => setIsOpen(true)}>
              {t('inventory.newTransaction')}
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        {filtered.length === 0 && !isLoading ? (
          <EmptyState icon="inbox" title={t('inventory.empty.transactions.title')} description={t('inventory.empty.transactions.description')} />
        ) : (
          <Table<InventoryTransaction>
            data={filtered}
            columns={[
              { key: 'date', header: t('inventory.date'), render: (row) => new Date(row.date).toLocaleDateString('ar-EG') },
              { key: 'type', header: t('inventory.type'), render: (row) => {
                const cfg = TYPE_CONFIG[row.type] || TYPE_CONFIG.in;
                return <Badge className={cfg.color}>{t(cfg.label)}</Badge>;
              }},
              { key: 'productName', header: t('inventory.productName'), render: (row) => row.productName ? <span>{row.productName} <span className="text-xs text-slate-500 font-mono">({row.productCode})</span></span> : row.productId },
              { key: 'warehouseName', header: t('inventory.warehouse'), render: (row) => row.warehouseName || row.warehouseId },
              { key: 'quantity', header: t('inventory.quantity'), align: 'right' as const, render: (row) => <span className="font-semibold">{row.quantity}</span> },
              { key: 'reference', header: t('inventory.reference'), render: (row) => row.reference || '-' },
              { key: 'actions', header: '', width: '80px', render: (row) => (
                <ActionButtons
                  onView={undefined}
                  onEdit={undefined}
                  onDelete={() => setConfirmDelete(row.id)}
                  showView={false}
                  showEdit={false}
                  showPrint={false}
                  showExport={false}
                />
              )},
            ]}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage=""
          />
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={changePageSize}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={isOpen}
        onClose={closeModal}
        title={t('inventory.newTransaction')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleAdd} leftIcon={<CheckSquare size={16} />} disabled={saving}>
              {saving ? t('common.loading') : t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1 font-medium text-slate-700 dark:text-slate-200">{t('inventory.type')}</label>
              <select
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                value={form.type || 'in'}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value as InventoryTransaction['type'] }))}
              >
                <option value="in">{t('inventory.in')}</option>
                <option value="out">{t('inventory.out')}</option>
                <option value="adjustment">{t('inventory.adjustment')}</option>
                <option value="transfer">{t('inventory.transfer')}</option>
              </select>
            </div>
            <Input label={t('inventory.date')} type="date" value={form.date || ''} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.productName')} *</label>
            <ProductSelect companyId={activeCompany?.id || ''} value={form.productId || ''} onChange={v => setForm(prev => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock module="inventory" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.warehouse')} *</label>
            <WarehouseSelect companyId={activeCompany?.id || ''} value={form.warehouseId || ''} onChange={v => setForm(prev => ({ ...prev, warehouseId: typeof v === 'string' ? v : '' }))} />
          </div>
          <Input label={t('inventory.quantity')} type="number" min="0.01" step="0.01" value={String(form.quantity || '')} onChange={e => setForm(prev => ({ ...prev, quantity: Number(e.target.value) }))} required />
          <Input label={t('inventory.reference')} value={form.reference || ''} onChange={e => setForm(prev => ({ ...prev, reference: e.target.value }))} />
          <Input label={t('inventory.notes')} value={form.notes || ''} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title={t('delete')}
        message={t('inventory.deleteConfirm')}
        variant="danger"
      />
    </div>
  );
};

export default InventoryTransactionsPage;
