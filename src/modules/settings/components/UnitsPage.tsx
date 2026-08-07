import React, { useState } from 'react';
import { Scale, Plus, Pencil, Trash2, CheckSquare } from 'lucide-react';
import { Card, Button, Table, Modal, Input, ConfirmDialog, Can } from '@/core/ui/components';
import { useUnits } from '@/core/hooks/useSettings';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { Unit } from '@/core/types';

export const UnitsPage: React.FC = () => {
  const activeCompany = useAppStore(state => state.activeCompany);
  const { units, isLoading, create, update, remove } = useUnits(activeCompany?.id || '');
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Unit>>({ nameAr: '', nameEn: '', code: '', conversionFactor: 1 });

  const reset = () => {
    setForm({ nameAr: '', nameEn: '', code: '', conversionFactor: 1 });
    setEditingId(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await remove(deleteId);
    if (result.success) {
      addToast('success', t('settings.units.deleted'));
    } else {
      addToast('error', result.error || t('settings.units.deleted'));
    }
    setDeleteId(null);
  };

  const handleSave = async () => {
    if (!form.nameAr || !activeCompany?.id) {
      addToast('error', t('settings.units.nameRequired'));
      return;
    }
    if (editingId) {
      const result = await update(editingId, form);
      if (result.success) addToast('success', t('settings.units.updated'));
      else addToast('error', result.error || t('settings.units.updated'));
    } else {
      const result = await create({ ...form, companyId: activeCompany.id, isActive: true } as Omit<Unit, 'id'>);
      if (result.success) addToast('success', t('settings.units.created'));
      else addToast('error', result.error || t('settings.units.created'));
    }
    setIsOpen(false);
    reset();
  };

  const openEdit = (u: Unit) => {
    setForm({ ...u });
    setEditingId(u.id);
    setIsOpen(true);
  };

  const columns = [
    { key: 'nameAr', header: t('settings.units.nameHeader'), render: (row: Unit) => <span className="font-medium">{row.nameAr}</span> },
    { key: 'nameEn', header: t('settings.units.nameEnHeader'), render: (row: Unit) => <span className="text-slate-500 text-sm">{row.nameEn}</span> },
    { key: 'code', header: t('settings.units.codeHeader'), width: '100px', render: (row: Unit) => <span className="font-mono text-xs">{row.code}</span> },
    { key: 'conversionFactor', header: t('settings.units.conversionFactor'), width: '120px', render: (row: Unit) => <span>{row.conversionFactor}</span> },
    { key: 'actions', header: '', width: '100px', render: (row: Unit) => (
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
          <Scale size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.units.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.units.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { reset(); setIsOpen(true); }}>{t('settings.units.newUnit')}</Button>
        </Can>
      </div>

      <Card>
        <Table<Unit> data={units} columns={columns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} emptyMessage={t('settings.units.emptyMessage')} />
      </Card>

      {isOpen && (
        <Modal isOpen={isOpen} title={editingId ? t('settings.units.editUnit') : t('settings.units.newUnit')} onClose={() => setIsOpen(false)} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('settings.units.nameAr')} value={form.nameAr || ''} onChange={e => setForm({ ...form, nameAr: e.target.value })} />
              <Input label={t('settings.units.nameEn')} value={form.nameEn || ''} onChange={e => setForm({ ...form, nameEn: e.target.value })} />
              <Input label={t('settings.units.code')} value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} />
              <Input label={t('settings.units.conversionFactor')} type="number" value={String(form.conversionFactor || 1)} onChange={e => setForm({ ...form, conversionFactor: Number(e.target.value) })} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.units.baseUnit')}</label>
                <select className="form-control" value={form.baseUnitId || ''} onChange={e => setForm({ ...form, baseUnitId: e.target.value || undefined })}>
                  <option value="">{t('settings.common.none')}</option>
                  {units.filter(u => u.id !== editingId).map(u => (
                    <option key={u.id} value={u.id}>{u.nameAr} ({u.code})</option>
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
        title={t('settings.units.deleteTitle')}
        message={t('settings.units.deleteMessage')}
        confirmText={t('settings.common.delete')}
        variant="danger"
      />
    </div>
  );
};

export default UnitsPage;
