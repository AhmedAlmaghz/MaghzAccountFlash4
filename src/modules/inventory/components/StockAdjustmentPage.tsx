import React, { useState, useMemo, useCallback } from 'react';
import { Plus, CheckSquare, BookOpen, Printer, Download, Pencil, Search, X, TrendingUp, TrendingDown, Layers, Package, ClipboardList, ArrowUpCircle, ArrowDownCircle, Clock } from 'lucide-react';
import { Card, Button, Modal, Input, Table, PageHeader } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { ProductSelect, WarehouseSelect } from '@/core/ui/components/smart';
import { useStockAdjustments } from '../hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { postStockAdjustment } from '@/core/utils/journalEntryGenerator';
import { logAudit } from '@/core/utils/auditLogger';
import { useToastStore } from '@/core/store/toastStore';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import type { StockAdjustment } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';

export const StockAdjustmentPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const { adjustments, isLoading, create, update, approve, post, remove } = useStockAdjustments(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();

  const [isOpen, setIsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<StockAdjustment>>({
    date: new Date().toISOString().split('T')[0],
    status: 'draft',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return adjustments.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (!term) return true;
      return (
        a.productName?.toLowerCase().includes(term) ||
        a.productCode?.toLowerCase().includes(term) ||
        a.reason?.toLowerCase().includes(term) ||
        a.warehouseName?.toLowerCase().includes(term) ||
        a.adjustmentNumber?.toLowerCase().includes(term)
      );
    });
  }, [adjustments, search, statusFilter]);

  const stats = useMemo(() => {
    const total = adjustments.length;
    const draft = adjustments.filter((a) => a.status === 'draft').length;
    const approved = adjustments.filter((a) => a.status === 'approved').length;
    const posted = adjustments.filter((a) => a.status === 'posted').length;
    const positive = adjustments.filter((a) => Number(a.difference) > 0).reduce((s, a) => s + Number(a.difference), 0);
    const negative = adjustments.filter((a) => Number(a.difference) < 0).reduce((s, a) => s + Math.abs(Number(a.difference)), 0);
    return { total, draft, approved, posted, positive, negative };
  }, [adjustments]);

  const hasFilters = !!(search || statusFilter);

  const resetForm = useCallback(() => {
    setForm({ date: new Date().toISOString().split('T')[0], status: 'draft' });
  }, []);

  const closeCreateModal = useCallback(() => {
    setIsOpen(false);
    resetForm();
  }, [resetForm]);

  const closeEditModal = useCallback(() => {
    setIsEditOpen(false);
    setEditingId(null);
    resetForm();
  }, [resetForm]);

  const handleAdd = async () => {
    if (!activeCompany || !form.productId) {
      addToast('error', 'الرجاء اختيار المنتج');
      return;
    }
    if (!form.warehouseId) {
      addToast('error', 'الرجاء اختيار المستودع');
      return;
    }
    setSaving(true);
    try {
      const sys = Number(form.systemQty) || 0;
      const act = Number(form.actualQty) || 0;
      const result = await create({
        companyId: activeCompany.id,
        date: form.date || new Date().toISOString().split('T')[0],
        adjustmentNumber: form.adjustmentNumber || '',
        productId: form.productId,
        warehouseId: form.warehouseId,
        systemQty: sys,
        actualQty: act,
        difference: act - sys,
        reason: form.reason || '',
        status: 'draft',
        unitCost: Number(form.unitCost) || 0,
      });
      if (result?.success) {
        addToast('success', t('inventory.adjustment.created'));
        closeCreateModal();
      } else {
        addToast('error', result?.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !activeCompany) return;
    const sys = Number(form.systemQty) || 0;
    const act = Number(form.actualQty) || 0;
    setSaving(true);
    try {
      const result = await update(editingId, {
        systemQty: sys,
        actualQty: act,
        difference: act - sys,
        reason: form.reason,
        unitCost: Number(form.unitCost) || 0,
      });
      if (result?.success) {
        addToast('success', t('inventory.adjustment.updated'));
        closeEditModal();
      } else {
        addToast('error', result?.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await remove(id);
    if (result?.success) addToast('success', t('inventory.adjustment.deleted'));
    else addToast('error', result?.error || t('common.error'));
    setConfirmDelete(null);
  };

  const handleApprove = async (id: string) => {
    if (!user?.id) return;
    const result = await approve(id, user.id);
    if (result?.success) addToast('success', 'تم اعتماد التسوية بنجاح');
    else addToast('error', result?.error || t('common.error'));
    setConfirmApprove(null);
  };

  const handlePost = async (adj: StockAdjustment) => {
    if (!activeCompany?.id || adj.difference === 0) {
      addToast('error', 'لا يمكن ترحيل تسوية بفرق صفر');
      return;
    }
    setPostingId(adj.id);
    try {
      const result = await postStockAdjustment(activeCompany.id, {
        id: adj.id,
        date: adj.date,
        product: adj.productId,
        difference: adj.difference * (adj.unitCost || 0),
        reason: adj.reason,
      });
      if (result.success) {
        await post(adj.id);
        await logAudit({ userId: user?.id || '', action: 'post', tableName: 'stock_adjustments', recordId: adj.id, companyId: activeCompany.id });
        addToast('success', t('inventory.adjustment.posted'));
      } else {
        addToast('error', result.error || t('common.error'));
      }
    } finally {
      setPostingId(null);
      setConfirmPost(null);
    }
  };

  const handleExportExcel = () => {
    exportToExcel(
      filtered,
      [
        { key: 'date', header: t('inventory.date'), width: 12 },
        { key: 'adjustmentNumber', header: t('inventory.adjustment.number'), width: 14 },
        { key: 'productName', header: t('inventory.productName'), width: 22 },
        { key: 'warehouseName', header: t('inventory.warehouse'), width: 16 },
        { key: 'systemQty', header: t('inventory.systemQty'), width: 10 },
        { key: 'actualQty', header: t('inventory.actualQty'), width: 10 },
        { key: 'difference', header: t('inventory.difference'), width: 10 },
        { key: 'reason', header: t('inventory.reason'), width: 20 },
        { key: 'status', header: t('inventory.status'), width: 10 },
      ],
      `stock-adjustments-${new Date().toISOString().split('T')[0]}`,
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      filtered,
      [
        { key: 'date', header: t('inventory.date') },
        { key: 'adjustmentNumber', header: t('inventory.adjustment.number') },
        { key: 'productName', header: t('inventory.productName') },
        { key: 'warehouseName', header: t('inventory.warehouse') },
        { key: 'systemQty', header: t('inventory.systemQty') },
        { key: 'actualQty', header: t('inventory.actualQty') },
        { key: 'difference', header: t('inventory.difference') },
        { key: 'reason', header: t('inventory.reason') },
      ],
      `stock-adjustments-${new Date().toISOString().split('T')[0]}`,
      { title: t('inventory.adjustments'), subtitle: activeCompany?.name, rtl: true },
    );
  };

  const handlePrint = () => {
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('inventory.adjustments')}</title>
<style>body{font-family:'Cairo',sans-serif;padding:24px;color:#1e293b}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#4f46e5;color:#fff;padding:10px 12px;border:1px solid #4f46e5}td{border:1px solid #e2e8f0;padding:8px 12px}tr:nth-child(even){background:#f8fafc}.header{text-align:center;margin-bottom:16px}.header h1{font-size:18px;font-weight:700;color:#4f46e5}</style>
</head><body><div class="header"><h1>${t('inventory.adjustments')}</h1><p>${activeCompany?.name || ''}</p></div>
<table><thead><tr><th>${t('inventory.date')}</th><th>${t('inventory.adjustment.number')}</th><th>${t('inventory.productName')}</th><th>${t('inventory.warehouse')}</th><th>${t('inventory.systemQty')}</th><th>${t('inventory.actualQty')}</th><th>${t('inventory.difference')}</th><th>${t('inventory.reason')}</th><th>${t('inventory.status')}</th></tr></thead>
<tbody>${filtered.map((a) => `<tr><td>${a.date}</td><td>${a.adjustmentNumber || '-'}</td><td>${a.productName || a.productId}</td><td>${a.warehouseName || a.warehouseId}</td><td>${a.systemQty}</td><td>${a.actualQty}</td><td>${a.difference > 0 ? '+' : ''}${a.difference}</td><td>${a.reason || '-'}</td><td>${a.status}</td></tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const openEdit = (adj: StockAdjustment) => {
    setForm({
      date: adj.date,
      adjustmentNumber: adj.adjustmentNumber,
      productId: adj.productId,
      warehouseId: adj.warehouseId,
      systemQty: adj.systemQty,
      actualQty: adj.actualQty,
      difference: adj.difference,
      reason: adj.reason,
      unitCost: adj.unitCost,
      status: adj.status,
    });
    setEditingId(adj.id);
    setIsEditOpen(true);
  };

  const diff = useMemo(() => {
    const sys = Number(form.systemQty) || 0;
    const act = Number(form.actualQty) || 0;
    return act - sys;
  }, [form.systemQty, form.actualQty]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <PageHeader
          icon={<ClipboardList size={22} />}
          title={t('inventory.adjustments')}
          subtitle={t('inventory.page.subtitle')}
          actions={
            <Can action="create" module="inventory">
              <Button
                variant="primary"
                leftIcon={<Plus size={16} />}
                onClick={async () => {
                  resetForm();
                  if (activeCompany) {
                    const seq = await getNextNumber('stock_adjustment', activeCompany.id);
                    if (seq?.number) setForm((prev) => ({ ...prev, adjustmentNumber: seq.number }));
                  }
                  setIsOpen(true);
                }}
                className="shadow-sm"
              >
                {t('inventory.newAdjustment')}
              </Button>
            </Can>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">الإجمالي</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stats.total}</p>
              <p className="text-xs text-slate-500">{filtered.length} ظاهر</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <ClipboardList size={18} className="text-slate-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">مسودة</p>
              <p className="text-xl font-bold text-slate-600 dark:text-slate-300 tabular-nums">{stats.draft}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Clock size={14} className="text-slate-500" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-blue-600">معتمدة</p>
              <p className="text-xl font-bold text-blue-600 tabular-nums">{stats.approved}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <CheckSquare size={14} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-emerald-600">مرحلة</p>
              <p className="text-xl font-bold text-emerald-600 tabular-nums">{stats.posted}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <TrendingUp size={14} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">صافي الفرق</p>
              <p className="text-sm font-bold tabular-nums flex items-center gap-1">
                <span className="text-emerald-600 flex items-center gap-0.5"><ArrowUpCircle size={12} />{stats.positive}</span>
                <span className="text-slate-300">/</span>
                <span className="text-rose-600 flex items-center gap-0.5"><ArrowDownCircle size={12} />{stats.negative}</span>
              </p>
            </div>
            <div className="w-8 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <Layers size={14} className="text-amber-600" />
            </div>
          </Card>
        </div>

        <Card className="p-3 sm:p-4">
          <div className="flex flex-col xl:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder={`${t('search')} — منتج / مستودع / سبب / رقم`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                {[
                  { v: '', l: t('all') },
                  { v: 'draft', l: t('inventory.draft') },
                  { v: 'approved', l: t('inventory.approved') },
                  { v: 'posted', l: t('inventory.posted') },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setStatusFilter(o.v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${statusFilter === o.v ? 'bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <Button variant="secondary" size="sm" leftIcon={<Printer size={14} />} onClick={handlePrint} className="gap-1.5">
                {t('print')}
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={handleExportExcel} className="gap-1.5">
                Excel
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={handleExportPDF} className="gap-1.5">
                PDF
              </Button>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filtered.length} من {adjustments.length} • {search ? `"${search}"` : ''} {statusFilter ? `• ${statusFilter}` : ''}</span>
              <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-primary-600 hover:underline font-medium">مسح الفلترة</button>
            </div>
          )}
        </Card>
      </div>

      <Card noPadding>
        {filtered.length === 0 && !isLoading ? (
          <div className="py-10">
            <EmptyState icon={hasFilters ? 'search' : 'inbox'} title={hasFilters ? 'لا توجد نتائج' : t('inventory.empty.adjustments.title')} description={hasFilters ? 'جرّب تغيير البحث أو الحالة' : t('inventory.empty.adjustments.description')} />
          </div>
        ) : (
          <Table<StockAdjustment>
            data={filtered}
            columns={[
              {
                key: 'date',
                header: t('inventory.date'),
                width: '110px',
                mobile: 'subtitle' as const,
                render: (row: StockAdjustment) => <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border tabular-nums">{new Date(row.date).toLocaleDateString('ar-EG')}</span>,
              },
              {
                key: 'adjustmentNumber',
                header: t('inventory.adjustment.number'),
                width: '125px',
                mobile: 'hidden' as const,
                render: (row: StockAdjustment) => row.adjustmentNumber ? <span className="font-mono text-xs font-semibold bg-primary-50 dark:bg-primary-900/20 px-2 py-1 rounded border border-primary-200 dark:border-primary-800">{row.adjustmentNumber}</span> : <span className="text-zinc-400 text-xs">—</span>,
              },
              {
                key: 'productName',
                header: t('inventory.productName'),
                mobile: 'title' as const,
                render: (row: StockAdjustment) => (
                  <div className="min-w-0">
                    <p className="font-medium truncate flex items-center gap-1.5"><Package size={12} className="text-zinc-400 shrink-0" />{row.productName || row.productId}</p>
                    {row.productCode ? <p className="text-xs text-zinc-500 font-mono">{row.productCode}</p> : null}
                    <p className="text-xs text-zinc-500 truncate">{row.warehouseName || ''}</p>
                  </div>
                ),
              },
              {
                key: 'systemQty',
                header: t('inventory.systemQty'),
                align: 'right' as const,
                width: '90px',
                render: (row: StockAdjustment) => <span className="tabular-nums text-sm">{row.systemQty}</span>,
              },
              {
                key: 'actualQty',
                header: t('inventory.actualQty'),
                align: 'right' as const,
                width: '90px',
                render: (row: StockAdjustment) => <span className="tabular-nums text-sm font-medium">{row.actualQty}</span>,
              },
              {
                key: 'difference',
                header: t('inventory.difference'),
                align: 'right' as const,
                width: '100px',
                render: (row: StockAdjustment) => (
                  <span className={`inline-flex items-center gap-1 font-bold tabular-nums px-2 py-1 rounded-full text-xs border ${row.difference > 0 ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200' : row.difference < 0 ? 'bg-rose-100 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 border-zinc-200'}`}>
                    {row.difference > 0 ? <TrendingUp size={12} /> : row.difference < 0 ? <TrendingDown size={12} /> : null}
                    {row.difference > 0 ? '+' : ''}{row.difference}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('inventory.status'),
                width: '110px',
                mobile: 'status' as const,
                render: (row: StockAdjustment) => <StatusBadge status={row.status} />,
              },
              {
                key: 'actions',
                header: '',
                width: '150px',
                mobile: 'actions' as const,
                render: (row: StockAdjustment) => (
                  <div className="flex items-center gap-1">
                    {row.status === 'draft' && (
                      <>
                        <Can action="edit" module="inventory">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title={t('edit')} className="h-7 w-7 p-0">
                            <Pencil size={13} className="text-amber-600" />
                          </Button>
                        </Can>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmApprove(row.id)} title={t('inventory.approve')} className="h-7 w-7 p-0">
                          <CheckSquare size={13} className="text-blue-600" />
                        </Button>
                      </>
                    )}
                    {row.status === 'approved' && Number(row.difference) !== 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmPost(row.id)} disabled={postingId === row.id} title={t('inventory.post')} className="h-7 w-7 p-0">
                        <BookOpen size={13} className="text-emerald-600" />
                      </Button>
                    )}
                    <Can action="delete" module="inventory">
                      <ActionButtons onView={undefined} onEdit={undefined} onDelete={() => setConfirmDelete(row.id)} showView={false} showEdit={false} showPrint={false} showExport={false} />
                    </Can>
                  </div>
                ),
              },
            ] as never}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage=""
          />
        )}
      </Card>

      <Modal
        isOpen={isOpen}
        onClose={closeCreateModal}
        title={t('inventory.newAdjustment')}
        description="تسوية جردية — مقارنة كمية النظام بالفعلي"
        size="lg"
        footer={
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={closeCreateModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleAdd} leftIcon={<CheckSquare size={16} />} isLoading={saving}>{t('save')}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productName')} *</label>
              <ProductSelect companyId={activeCompany?.id || ''} value={form.productId || ''} onChange={(v) => setForm((prev) => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock module="inventory" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.warehouse')} *</label>
              <WarehouseSelect companyId={activeCompany?.id || ''} value={form.warehouseId || ''} onChange={(v) => setForm((prev) => ({ ...prev, warehouseId: typeof v === 'string' ? v : '' }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input label={t('inventory.systemQty')} type="number" step="0.01" value={String(form.systemQty ?? '')} onChange={(e) => setForm((prev) => ({ ...prev, systemQty: Number(e.target.value) }))} />
            <Input label={t('inventory.actualQty')} type="number" step="0.01" value={String(form.actualQty ?? '')} onChange={(e) => setForm((prev) => ({ ...prev, actualQty: Number(e.target.value) }))} />
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.difference')}</label>
              <div className={`h-10 rounded-lg border flex items-center justify-center font-bold tabular-nums ${diff > 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 border-emerald-200' : diff < 0 ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 border-rose-200' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 border-slate-200'}`}>
                {diff > 0 ? '+' : ''}{diff}
              </div>
              <p className="text-xs text-slate-500 mt-1">{diff === 0 ? 'لا يوجد فرق' : diff > 0 ? 'زيادة' : 'عجز'}</p>
            </div>
          </div>
          <Input label={t('inventory.costPrice')} type="number" step="0.01" min="0" value={String(form.unitCost ?? '')} onChange={(e) => setForm((prev) => ({ ...prev, unitCost: Number(e.target.value) }))} />
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.reason')}</label>
            <textarea value={form.reason || ''} onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))} placeholder="سبب التسوية..." rows={2} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none" />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isEditOpen}
        onClose={closeEditModal}
        title={t('inventory.editAdjustment') || 'تعديل التسوية'}
        size="md"
        footer={
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={closeEditModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleUpdate} isLoading={saving}>{t('save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border text-sm">
            <span className="text-slate-500">{t('inventory.productName')}: </span>
            <span className="font-medium">{form.productName || form.productId}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('inventory.systemQty')} type="number" step="0.01" value={String(form.systemQty ?? '')} onChange={(e) => setForm((prev) => ({ ...prev, systemQty: Number(e.target.value) }))} />
            <Input label={t('inventory.actualQty')} type="number" step="0.01" value={String(form.actualQty ?? '')} onChange={(e) => setForm((prev) => ({ ...prev, actualQty: Number(e.target.value) }))} />
          </div>
          <div className={`p-3 rounded-xl border text-center font-bold tabular-nums ${diff > 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 border-emerald-200' : diff < 0 ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 border-rose-200' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 border-slate-200'}`}>
            {t('inventory.difference')}: {diff > 0 ? '+' : ''}{diff}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.reason')}</label>
            <textarea value={form.reason || ''} onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))} rows={2} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => confirmDelete && handleDelete(confirmDelete)} title={t('delete')} message={t('inventory.deleteConfirm')} variant="danger" />
      <ConfirmDialog isOpen={!!confirmApprove} onClose={() => setConfirmApprove(null)} onConfirm={() => confirmApprove && handleApprove(confirmApprove)} title={t('inventory.approve')} message={t('inventory.approveConfirm')} variant="info" />
      <ConfirmDialog
        isOpen={!!confirmPost}
        onClose={() => setConfirmPost(null)}
        onConfirm={() => {
          const adj = adjustments.find((a) => a.id === confirmPost);
          if (adj) handlePost(adj);
        }}
        title={t('inventory.postAdjustment')}
        message={t('inventory.postAdjustmentConfirm')}
        variant="warning"
      />
    </div>
  );
};

export default StockAdjustmentPage;
