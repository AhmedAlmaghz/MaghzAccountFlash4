import React, { useState } from 'react';
import { Target, Plus, Pencil, Trash2, CheckSquare } from 'lucide-react';
import { Card, Button, Table, Modal, Input, ConfirmDialog, Can } from '@/core/ui/components';
import { useCostCenters } from '@/core/hooks/useSettings';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { CostCenter } from '@/core/types';

export const CostCentersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { centers, isLoading, create, update, remove } = useCostCenters(activeCompany?.id || '');
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CostCenter>>({ nameAr: '', nameEn: '', code: '', type: 'department', budgetAmount: 0 });

  const reset = () => {
    setForm({ nameAr: '', nameEn: '', code: '', type: 'department', budgetAmount: 0 });
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.nameAr || !activeCompany?.id) {
      addToast('error', t('settings.costCenters.nameRequired'));
      return;
    }
    if (editingId) {
      const result = await update(editingId, form);
      if (result.success) addToast('success', t('settings.costCenters.updated'));
      else addToast('error', result.error || t('settings.costCenters.updateError'));
    } else {
      const result = await create({ ...form, companyId: activeCompany.id, isActive: true } as Omit<CostCenter, 'id'>);
      if (result.success) addToast('success', t('settings.costCenters.created'));
      else addToast('error', result.error || t('settings.costCenters.createError'));
    }
    setIsOpen(false);
    reset();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await remove(deleteId);
    if (result.success) {
      addToast('success', t('settings.costCenters.deleted'));
    } else {
      addToast('error', result.error || t('settings.costCenters.removeError'));
    }
    setDeleteId(null);
  };

  const openEdit = (c: CostCenter) => {
    setForm({ ...c });
    setEditingId(c.id);
    setIsOpen(true);
  };

  const typeLabel = (type: string) => {
    if (type === 'department') return t('settings.costCenters.typeDepartment');
    if (type === 'project') return t('settings.costCenters.typeProject');
    if (type === 'branch') return t('settings.costCenters.typeBranch');
    return type;
  };

  const columns = [
    { key: 'nameAr', header: t('settings.costCenters.name'), render: (row: CostCenter) => <span className="font-medium">{row.nameAr}</span> },
    { key: 'nameEn', header: t('settings.costCenters.nameEn'), render: (row: CostCenter) => <span className="text-slate-500 text-sm">{row.nameEn}</span> },
    { key: 'code', header: t('settings.costCenters.code'), width: '100px', render: (row: CostCenter) => <span className="font-mono text-xs">{row.code}</span> },
    { key: 'type', header: t('settings.costCenters.type'), width: '120px', render: (row: CostCenter) => <span>{typeLabel(row.type)}</span> },
    { key: 'budgetAmount', header: t('settings.costCenters.budget'), width: '140px', align: 'right' as const, render: (row: CostCenter) => <span>{formatCurrency(row.budgetAmount)}</span> },
    { key: 'isActive', header: t('settings.common.active'), width: '80px', render: (row: CostCenter) => <span className={row.isActive ? 'text-emerald-600' : 'text-slate-400'}>{row.isActive ? t('settings.common.yes') : t('settings.common.no')}</span> },
    { key: 'actions', header: '', width: '120px', render: (row: CostCenter) => (
      <div className="flex gap-1">
        <Can action="edit" module="settings"><Button size="sm" variant="ghost" onClick={() => openEdit(row)} leftIcon={<Pencil size={14} />} /></Can>
        <Can action="delete" module="settings"><Button size="sm" variant="ghost" onClick={() => setDeleteId(row.id)} leftIcon={<Trash2 size={14} className="text-rose-500" />} /></Can>
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.costCenters.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.costCenters.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { reset(); setIsOpen(true); }}>{t('settings.costCenters.new')}</Button>
        </Can>
      </div>

      <Card>
        <Table<CostCenter> data={centers} columns={columns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} emptyMessage={t('settings.costCenters.empty')} />
      </Card>

      {isOpen && (
        <Modal isOpen={isOpen} title={editingId ? t('settings.costCenters.editTitle') : t('settings.costCenters.newTitle')} onClose={() => setIsOpen(false)} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('settings.costCenters.nameAr')} value={form.nameAr || ''} onChange={e => setForm({ ...form, nameAr: e.target.value })} />
              <Input label={t('settings.costCenters.nameEn')} value={form.nameEn || ''} onChange={e => setForm({ ...form, nameEn: e.target.value })} />
              <Input label={t('settings.costCenters.code')} value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.costCenters.type')}</label>
                <select className="form-control" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="department">{t('settings.costCenters.typeDepartment')}</option>
                  <option value="project">{t('settings.costCenters.typeProject')}</option>
                  <option value="branch">{t('settings.costCenters.typeBranch')}</option>
                </select>
              </div>
              <Input label={t('settings.costCenters.budget')} type="number" value={String(form.budgetAmount || 0)} onChange={e => setForm({ ...form, budgetAmount: Number(e.target.value) })} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.costCenters.parentCenter')}</label>
                <select className="form-control" value={form.parentId || ''} onChange={e => setForm({ ...form, parentId: e.target.value || undefined })}>
                  <option value="">{t('settings.costCenters.noParent')}</option>
                  {centers.filter(c => c.id !== editingId).map(c => (
                    <option key={c.id} value={c.id}>{c.nameAr} ({c.code})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('settings.common.cancel')}</Button>
              <Button onClick={handleSave} leftIcon={<CheckSquare size={16} />}>{t('settings.common.save')}</Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('settings.costCenters.deleteTitle')}
        message={t('settings.costCenters.deleteMessage')}
        confirmText={t('settings.common.delete')}
        variant="danger"
      />
    </div>
  );
};

export default CostCentersPage;
