import React, { useState, useMemo, useCallback } from 'react';
import { ArrowRightLeft, Plus, Printer, Download, CheckSquare, TrendingUp, TrendingDown, Layers, Package } from 'lucide-react';
import { Card, Button, Modal, Input, Table, Badge, Can, PageHeader, FilterBar } from '@/core/ui/components';
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
import { useFormatters } from '@/core/utils/useFormatters';
import type { InventoryTransaction } from '../types';

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  in: { label: 'inventory.in', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', icon: TrendingUp },
  out: { label: 'inventory.out', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200 dark:border-rose-800', icon: TrendingDown },
  adjustment: { label: 'inventory.adjustment', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800', icon: Layers },
  transfer: { label: 'inventory.transfer', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800', icon: ArrowRightLeft },
};

export const InventoryTransactionsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatDate } = useFormatters(activeCompany?.id || '');
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
    return transactions.filter((tx) =>
      tx.reference?.toLowerCase().includes(term) ||
      tx.notes?.toLowerCase().includes(term) ||
      tx.productName?.toLowerCase().includes(term) ||
      tx.warehouseName?.toLowerCase().includes(term),
    );
  }, [transactions, search]);

  const stats = useMemo(() => {
    const inCount = transactions.filter((tx) => tx.type === 'in').length;
    const outCount = transactions.filter((tx) => tx.type === 'out').length;
    const adjCount = transactions.filter((tx) => tx.type === 'adjustment').length;
    const trCount = transactions.filter((tx) => tx.type === 'transfer').length;
    return { inCount, outCount, adjCount, trCount, total: transactions.length };
  }, [transactions]);

  const hasFilters = !!(search || typeFilter);

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
    if (result?.success) addToast('success', t('inventory.transaction.deleted'));
    else addToast('error', result?.error || t('common.error'));
    setConfirmDelete(null);
  };

  const handleExportExcel = () => {
    exportToExcel(
      filtered,
      [
        { key: 'date', header: t('inventory.date'), width: 12 },
        { key: 'type', header: t('inventory.type'), width: 12 },
        { key: 'productName', header: t('inventory.productName'), width: 24 },
        { key: 'warehouseName', header: t('inventory.warehouse'), width: 18 },
        { key: 'quantity', header: t('inventory.quantity'), width: 10 },
        { key: 'reference', header: t('inventory.reference'), width: 16 },
      ],
      `inventory-transactions-${new Date().toISOString().split('T')[0]}`,
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
      { title: t('inventory.transactions'), subtitle: activeCompany?.name, rtl: true },
    );
  };

  const handlePrint = () => {
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('inventory.transactions')}</title>
<style>body{font-family:'Cairo',sans-serif;padding:24px;color:#1e293b}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#4f46e5;color:#fff;padding:10px 12px;border:1px solid #4f46e5}td{border:1px solid #e2e8f0;padding:8px 12px}tr:nth-child(even){background:#f8fafc}.header{text-align:center;margin-bottom:16px}.header h1{font-size:18px;font-weight:700;color:#4f46e5}</style>
</head><body><div class="header"><h1>${t('inventory.transactions')}</h1><p>${activeCompany?.name || ''}</p></div>
<table><thead><tr><th>${t('inventory.date')}</th><th>${t('inventory.type')}</th><th>${t('inventory.productName')}</th><th>${t('inventory.warehouse')}</th><th>${t('inventory.quantity')}</th><th>${t('inventory.reference')}</th></tr></thead>
<tbody>${filtered.map((tx) => `<tr><td>${tx.date}</td><td>${t(TYPE_CONFIG[tx.type]?.label || tx.type)}</td><td>${tx.productName || tx.productId}</td><td>${tx.warehouseName || tx.warehouseId}</td><td>${tx.quantity}</td><td>${tx.reference || '-'}</td></tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <PageHeader
          icon={<ArrowRightLeft size={22} />}
          title={t('inventory.transactions')}
          subtitle={t('inventory.page.subtitle')}
          actions={
            <Can action="create" module="inventory">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setIsOpen(true)} className="shadow-sm">
                {t('inventory.newTransaction')}
              </Button>
            </Can>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">الإجمالي</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="text-xs text-slate-500">{filtered.length} ظاهر</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Package size={18} className="text-slate-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-emerald-600">وارد</p>
              <p className="text-xl font-bold text-emerald-600 tabular-nums">{stats.inCount}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <TrendingUp size={14} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-rose-600">صادر</p>
              <p className="text-xl font-bold text-rose-600 tabular-nums">{stats.outCount}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
              <TrendingDown size={14} className="text-rose-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-amber-600">تسوية</p>
              <p className="text-xl font-bold text-amber-600 tabular-nums">{stats.adjCount}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <Layers size={14} className="text-amber-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-blue-600">تحويل</p>
              <p className="text-xl font-bold text-blue-600 tabular-nums">{stats.trCount}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <ArrowRightLeft size={14} className="text-blue-600" />
            </div>
          </Card>
        </div>

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={`${t('search')} — منتج / مستودع / مرجع`}
          filterOptions={[
            { key: '', label: t('all') },
            { key: 'in', label: t('inventory.in') },
            { key: 'out', label: t('inventory.out') },
            { key: 'adjustment', label: 'تسوية' },
            { key: 'transfer', label: t('inventory.transfer') },
          ]}
          activeFilter={typeFilter}
          onFilterChange={(key) => setTypeFilter(key)}
          actions={
            <>
              <Button variant="secondary" size="sm" leftIcon={<Printer size={14} />} onClick={handlePrint} className="gap-1.5">
                {t('print')}
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={handleExportExcel} className="gap-1.5">
                Excel
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={handleExportPDF} className="gap-1.5">
                PDF
              </Button>
            </>
          }
        />
        {hasFilters && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{filtered.length} من {transactions.length} • {search ? `"${search}"` : ''} {typeFilter ? `• ${typeFilter}` : ''}</span>
            <button onClick={() => { setSearch(''); setTypeFilter(''); }} className="text-primary-600 hover:underline font-medium">مسح الفلترة</button>
          </div>
        )}
      </div>

      <Card noPadding>
        {filtered.length === 0 && !isLoading ? (
          <div className="py-10">
            <EmptyState icon={hasFilters ? 'search' : 'inbox'} title={hasFilters ? 'لا توجد نتائج' : t('inventory.empty.transactions.title')} description={hasFilters ? 'جرّب تغيير البحث أو النوع' : t('inventory.empty.transactions.description')} />
          </div>
        ) : (
          <>
            <Table<InventoryTransaction>
              data={filtered}
              columns={[
                {
                  key: 'date',
                  header: t('inventory.date'),
                  width: '115px',
                  mobile: 'hidden' as const,
                  render: (row: InventoryTransaction) => <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span>,
                },
                {
                  key: 'type',
                  header: t('inventory.type'),
                  width: '110px',
                  mobile: 'status' as const,
                  render: (row: InventoryTransaction) => {
                    const cfg = TYPE_CONFIG[row.type] || TYPE_CONFIG.in;
                    const Icon = cfg.icon;
                    return (
                      <Badge className={`${cfg.color} border text-xs gap-1`}>
                        <Icon size={12} /> {t(cfg.label)}
                      </Badge>
                    );
                  },
                },
                {
                  key: 'productName',
                  header: t('inventory.productName'),
                  mobile: 'title' as const,
                  render: (row: InventoryTransaction) => row.productName ? (
                    <div className="min-w-0">
                      <p className="font-medium truncate">{row.productName}</p>
                      <p className="text-xs text-zinc-500 font-mono">{row.productCode || ''}</p>
                    </div>
                  ) : <span className="font-mono text-xs">{row.productId.slice(0, 8)}</span>,
                },
                {
                  key: 'warehouseName',
                  header: t('inventory.warehouse'),
                  width: '150px',
                  mobile: 'hidden' as const,
                  render: (row: InventoryTransaction) => row.warehouseName ? (
                    <span className="text-xs bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-full border border-blue-200 dark:border-blue-800">{row.warehouseName}</span>
                  ) : <span className="font-mono text-xs">{row.warehouseId.slice(0, 8)}</span>,
                },
                {
                  key: 'quantity',
                  header: t('inventory.quantity'),
                  align: 'right' as const,
                  width: '100px',
                  render: (row: InventoryTransaction) => <span className="font-bold tabular-nums">{row.quantity}</span>,
                },
                {
                  key: 'reference',
                  header: t('inventory.reference'),
                  width: '130px',
                  mobile: 'subtitle' as const,
                  render: (row: InventoryTransaction) => row.reference ? <span className="text-xs truncate max-w-[130px] inline-block">{row.reference}</span> : <span className="text-zinc-400 text-xs">—</span>,
                },
                {
                  key: 'actions',
                  header: '',
                  width: '80px',
                  mobile: 'actions' as const,
                  render: (row: InventoryTransaction) => (
                    <ActionButtons onView={undefined} onEdit={undefined} onDelete={() => setConfirmDelete(row.id)} showView={false} showEdit={false} showPrint={false} showExport={false} />
                  ),
                },
              ] as never}
              keyExtractor={(row) => row.id}
              isLoading={isLoading}
              emptyMessage=""
            />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      <Modal
        isOpen={isOpen}
        onClose={closeModal}
        title={t('inventory.newTransaction')}
        description="إضافة حركة مخزنية يدوية"
        size="lg"
        footer={
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleAdd} leftIcon={<CheckSquare size={16} />} isLoading={saving}>{t('save')}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.type')} *</label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {(['in', 'out', 'adjustment', 'transfer'] as const).map((v) => {
                  const cfg = TYPE_CONFIG[v];
                  const active = form.type === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setForm((prev) => ({ ...prev, type: v }))}
                      className={`px-2 py-2 rounded-lg text-xs font-medium border transition ${active ? 'bg-white dark:bg-slate-700 shadow-sm border-slate-200 dark:border-slate-600' : 'border-transparent text-slate-600 dark:text-slate-400'}`}
                    >
                      {t(cfg.label)}
                    </button>
                  );
                })}
              </div>
            </div>
            <Input label={`${t('inventory.date')} *`} type="date" value={form.date || ''} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productName')} *</label>
            <ProductSelect companyId={activeCompany?.id || ''} value={form.productId || ''} onChange={(v) => setForm((prev) => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock module="inventory" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.warehouse')} *</label>
            <WarehouseSelect companyId={activeCompany?.id || ''} value={form.warehouseId || ''} onChange={(v) => setForm((prev) => ({ ...prev, warehouseId: typeof v === 'string' ? v : '' }))} />
          </div>
          <Input label={`${t('inventory.quantity')} *`} type="number" min="0.01" step="0.01" value={String(form.quantity || '')} onChange={(e) => setForm((prev) => ({ ...prev, quantity: Number(e.target.value) }))} required />
          <Input label={t('inventory.reference')} value={form.reference || ''} onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))} placeholder="مرجع اختياري" />
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.notes')}</label>
            <textarea value={form.notes || ''} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="ملاحظات..." rows={2} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => confirmDelete && handleDelete(confirmDelete)} title={t('delete')} message={t('inventory.deleteConfirm')} variant="danger" />
    </div>
  );
};

export default InventoryTransactionsPage;
