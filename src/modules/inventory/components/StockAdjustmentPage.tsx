import React, { useState, useMemo, useCallback } from 'react';
import { Scale, Plus, CheckSquare, BookOpen, Printer, Download, Pencil, Search } from 'lucide-react';
import { Card, Button, Modal, Input, Table } from '@/core/ui/components';
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
  const activeCompany = useAppStore(state => state.activeCompany);
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
    return adjustments.filter(a => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (!term) return true;
      return (
        a.productName?.toLowerCase().includes(term) ||
        a.productCode?.toLowerCase().includes(term) ||
        a.reason?.toLowerCase().includes(term) ||
        a.warehouseName?.toLowerCase().includes(term)
      );
    });
  }, [adjustments, search, statusFilter]);

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
    if (result?.success) {
      addToast('success', t('inventory.adjustment.deleted'));
    } else {
      addToast('error', result?.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handleApprove = async (id: string) => {
    if (!user?.id) return;
    const result = await approve(id, user.id);
    if (result?.success) {
      addToast('success', 'تم اعتماد التسوية بنجاح');
    } else {
      addToast('error', result?.error || t('common.error'));
    }
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
        await logAudit({
          userId: user?.id || '',
          action: 'post',
          tableName: 'stock_adjustments',
          recordId: adj.id,
          companyId: activeCompany.id,
        });
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
        { key: 'date', header: t('inventory.date') },
        { key: 'adjustmentNumber', header: t('inventory.adjustment.number') },
        { key: 'productName', header: t('inventory.productName') },
        { key: 'warehouseName', header: t('inventory.warehouse') },
        { key: 'systemQty', header: t('inventory.systemQty') },
        { key: 'actualQty', header: t('inventory.actualQty') },
        { key: 'difference', header: t('inventory.difference') },
        { key: 'reason', header: t('inventory.reason') },
        { key: 'status', header: t('inventory.status') },
      ],
      `stock-adjustments-${new Date().toISOString().split('T')[0]}`
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
      { title: t('inventory.adjustments'), subtitle: activeCompany?.name, rtl: true }
    );
  };

  const handlePrint = () => {
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>${t('inventory.adjustments')}</title>
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
<div class="header"><h1>${t('inventory.adjustments')}</h1><p>${activeCompany?.name || ''}</p></div>
<table>
<thead><tr>
<th>${t('inventory.date')}</th>
<th>${t('inventory.adjustment.number')}</th>
<th>${t('inventory.productName')}</th>
<th>${t('inventory.warehouse')}</th>
<th>${t('inventory.systemQty')}</th>
<th>${t('inventory.actualQty')}</th>
<th>${t('inventory.difference')}</th>
<th>${t('inventory.reason')}</th>
<th>${t('inventory.status')}</th>
</tr></thead>
<tbody>
${filtered.map(a => `<tr>
<td>${a.date}</td>
<td>${a.adjustmentNumber || '-'}</td>
<td>${a.productName || a.productId}</td>
<td>${a.warehouseName || a.warehouseId}</td>
<td>${a.systemQty}</td>
<td>${a.actualQty}</td>
<td>${a.difference > 0 ? '+' : ''}${a.difference}</td>
<td>${a.reason || '-'}</td>
<td>${a.status}</td>
</tr>`).join('')}
</tbody>
</table>
<script>window.print()</script>
</body></html>`;
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Scale size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('inventory.adjustments')}</h1>
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
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            title={t('inventory.status')}
            aria-label={t('inventory.status')}
          >
            <option value="">{t('all')}</option>
            <option value="draft">{t('inventory.draft')}</option>
            <option value="approved">{t('inventory.approved')}</option>
            <option value="posted">{t('inventory.posted')}</option>
            <option value="rejected">{t('inventory.rejected')}</option>
          </select>
          <Button variant="secondary" size="sm" leftIcon={<Printer size={16} />} onClick={handlePrint}>{t('print')}</Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportExcel}>Excel</Button>
          <Button variant="secondary" size="sm" leftIcon={<Download size={16} />} onClick={handleExportPDF}>PDF</Button>
          <Can action="create" module="inventory">
            <Button variant="primary" size="sm" leftIcon={<Plus size={16} />} onClick={async () => {
              resetForm();
              if (activeCompany) {
                const seq = await getNextNumber('stock_adjustment', activeCompany.id);
                if (seq?.number) setForm(prev => ({ ...prev, adjustmentNumber: seq.number }));
              }
              setIsOpen(true);
            }}>{t('inventory.newAdjustment')}</Button>
          </Can>
        </div>
      </div>

      <Card>
        {filtered.length === 0 && !isLoading ? (
          <EmptyState icon="inbox" title={t('inventory.empty.adjustments.title')} description={t('inventory.empty.adjustments.description')} />
        ) : (
          <Table<StockAdjustment>
            data={filtered}
            columns={[
              { key: 'date', header: t('inventory.date'), render: (row) => new Date(row.date).toLocaleDateString('ar-EG') },
              { key: 'adjustmentNumber', header: t('inventory.adjustment.number'), render: (row) => row.adjustmentNumber || '-' },
              { key: 'productName', header: t('inventory.productName'), render: (row) => (
                <div>
                  <div className="font-medium">{row.productName || row.productId}</div>
                  {row.productCode && <div className="text-xs text-slate-500 font-mono">{row.productCode}</div>}
                </div>
              )},
              { key: 'warehouseName', header: t('inventory.warehouse'), render: (row) => row.warehouseName || row.warehouseId },
              { key: 'systemQty', header: t('inventory.systemQty'), align: 'right' as const },
              { key: 'actualQty', header: t('inventory.actualQty'), align: 'right' as const },
              { key: 'difference', header: t('inventory.difference'), align: 'right' as const, render: (row) => (
                <span className={row.difference > 0 ? 'text-emerald-600 font-bold' : row.difference < 0 ? 'text-rose-600 font-bold' : ''}>
                  {row.difference > 0 ? '+' : ''}{row.difference}
                </span>
              )},
              { key: 'reason', header: t('inventory.reason'), render: (row) => row.reason || '-' },
              { key: 'status', header: t('inventory.status'), render: (row) => <StatusBadge status={row.status} /> },
              { key: 'actions', header: '', width: '160px', render: (row) => (
                <div className="flex items-center gap-1">
                  {row.status === 'draft' && (
                    <>
                      <Can action="edit" module="inventory">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title={t('edit')}>
                          <Pencil size={14} className="text-amber-600" />
                        </Button>
                      </Can>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmApprove(row.id)} title={t('inventory.approve')}>
                        <CheckSquare size={14} className="text-blue-600" />
                      </Button>
                    </>
                  )}
                  {row.status === 'approved' && row.difference !== 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmPost(row.id)}
                      disabled={postingId === row.id}
                      title={t('inventory.post')}
                    >
                      <BookOpen size={14} className="text-emerald-600" />
                    </Button>
                  )}
                  <Can action="delete" module="inventory">
                    <ActionButtons
                      onView={undefined}
                      onEdit={undefined}
                      onDelete={() => setConfirmDelete(row.id)}
                      showView={false}
                      showEdit={false}
                      showPrint={false}
                      showExport={false}
                    />
                  </Can>
                </div>
              )},
            ]}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage=""
          />
        )}
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={isOpen}
        onClose={closeCreateModal}
        title={t('inventory.newAdjustment')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeCreateModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleAdd} leftIcon={<CheckSquare size={16} />} disabled={saving}>
              {saving ? t('common.loading') : t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.productName')} *</label>
            <ProductSelect companyId={activeCompany?.id || ''} value={form.productId || ''} onChange={v => setForm(prev => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock module="inventory" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.warehouse')} *</label>
            <WarehouseSelect companyId={activeCompany?.id || ''} value={form.warehouseId || ''} onChange={v => setForm(prev => ({ ...prev, warehouseId: typeof v === 'string' ? v : '' }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('inventory.systemQty')} type="number" step="0.01" value={String(form.systemQty ?? '')} onChange={e => setForm(prev => ({ ...prev, systemQty: Number(e.target.value) }))} />
            <Input label={t('inventory.actualQty')} type="number" step="0.01" value={String(form.actualQty ?? '')} onChange={e => setForm(prev => ({ ...prev, actualQty: Number(e.target.value) }))} />
          </div>
          <Input label={t('inventory.costPrice')} type="number" step="0.01" min="0" value={String(form.unitCost ?? '')} onChange={e => setForm(prev => ({ ...prev, unitCost: Number(e.target.value) }))} />
          <Input label={t('inventory.reason')} value={form.reason || ''} onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))} />
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditOpen}
        onClose={closeEditModal}
        title={t('inventory.editAdjustment') || 'تعديل التسوية'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeEditModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleUpdate} disabled={saving}>
              {saving ? t('common.loading') : t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg text-sm">
            <span className="text-slate-500">{t('inventory.productName')}: </span>
            <span className="font-medium">{form.productName || form.productId}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('inventory.systemQty')} type="number" step="0.01" value={String(form.systemQty ?? '')} onChange={e => setForm(prev => ({ ...prev, systemQty: Number(e.target.value) }))} />
            <Input label={t('inventory.actualQty')} type="number" step="0.01" value={String(form.actualQty ?? '')} onChange={e => setForm(prev => ({ ...prev, actualQty: Number(e.target.value) }))} />
          </div>
          {form.systemQty !== undefined && form.actualQty !== undefined && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-sm">
              <span className="text-slate-500">{t('inventory.difference')}: </span>
              <span className={`font-bold ${(Number(form.actualQty) - Number(form.systemQty)) > 0 ? 'text-emerald-600' : (Number(form.actualQty) - Number(form.systemQty)) < 0 ? 'text-rose-600' : ''}`}>
                {(Number(form.actualQty) - Number(form.systemQty)) > 0 ? '+' : ''}{Number(form.actualQty) - Number(form.systemQty)}
              </span>
            </div>
          )}
          <Input label={t('inventory.reason')} value={form.reason || ''} onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))} />
        </div>
      </Modal>

      {/* Confirm dialogs */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title={t('delete')}
        message={t('inventory.deleteConfirm')}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={!!confirmApprove}
        onClose={() => setConfirmApprove(null)}
        onConfirm={() => confirmApprove && handleApprove(confirmApprove)}
        title={t('inventory.approve')}
        message={t('inventory.approveConfirm')}
        variant="info"
      />
      <ConfirmDialog
        isOpen={!!confirmPost}
        onClose={() => setConfirmPost(null)}
        onConfirm={() => {
          const adj = adjustments.find(a => a.id === confirmPost);
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
