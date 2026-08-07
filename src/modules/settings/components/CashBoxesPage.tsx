import React, { useState } from 'react';
import { Vault, Plus, Pencil, Trash2, CheckSquare } from 'lucide-react';
import { Card, Button, Table, Modal, Input, ConfirmDialog, Can } from '@/core/ui/components';
import { BranchSelect, UserSelect, AccountSelect } from '@/core/ui/components/smart';
import { useCashBoxes } from '@/core/hooks/useSettings';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { CashBox } from '@/core/types';

export const CashBoxesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { boxes, isLoading, create, update, remove } = useCashBoxes(activeCompany?.id || '');
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CashBox>>({ name: '', code: '', currentBalance: 0 });

  const reset = () => {
    setForm({ name: '', code: '', currentBalance: 0 });
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.name || !activeCompany?.id) {
      addToast('error', t('settings.cashBoxes.nameRequired'));
      return;
    }
    if (editingId) {
      const result = await update(editingId, form);
      if (result.success) addToast('success', t('settings.cashBoxes.updated'));
      else addToast('error', result.error || t('settings.cashBoxes.updateError'));
    } else {
      const result = await create({ ...form, companyId: activeCompany.id, isActive: true } as Omit<CashBox, 'id'>);
      if (result.success) addToast('success', t('settings.cashBoxes.created'));
      else addToast('error', result.error || t('settings.cashBoxes.createError'));
    }
    setIsOpen(false);
    reset();
  };

  const openEdit = (b: CashBox) => {
    setForm({ ...b });
    setEditingId(b.id);
    setIsOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await remove(deleteId);
    if (result.success) {
      addToast('success', t('settings.cashBoxes.deleted'));
    } else {
      addToast('error', result.error || t('settings.cashBoxes.deleteError'));
    }
    setDeleteId(null);
  };

  const columns = [
    { key: 'name', header: t('settings.cashBoxes.name'), render: (row: CashBox) => <span className="font-medium">{row.name}</span> },
    { key: 'code', header: t('settings.cashBoxes.code'), width: '100px', render: (row: CashBox) => <span className="font-mono text-xs">{row.code}</span> },
    { key: 'currentBalance', header: t('settings.cashBoxes.balance'), width: '140px', align: 'right' as const, render: (row: CashBox) => <span>{formatCurrency(row.currentBalance)}</span> },
    { key: 'isActive', header: t('settings.common.active'), width: '80px', render: (row: CashBox) => <span className={row.isActive ? 'text-emerald-600' : 'text-slate-400'}>{row.isActive ? t('settings.common.yes') : t('settings.common.no')}</span> },
    { key: 'actions', header: '', width: '130px', render: (row: CashBox) => (
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
          <Vault size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.cashBoxes.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.cashBoxes.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { reset(); setIsOpen(true); }}>{t('settings.cashBoxes.new')}</Button>
        </Can>
      </div>

      <Card>
        <Table<CashBox> data={boxes} columns={columns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} emptyMessage={t('settings.cashBoxes.empty')} />
      </Card>

      {isOpen && (
        <Modal isOpen={isOpen} title={editingId ? t('settings.cashBoxes.editTitle') : t('settings.cashBoxes.newTitle')} onClose={() => setIsOpen(false)} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('settings.cashBoxes.name')} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
              <Input label={t('settings.cashBoxes.code')} value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} />
              <Input label={t('settings.cashBoxes.openingBalance')} type="number" value={String(form.currentBalance || 0)} onChange={e => setForm({ ...form, currentBalance: Number(e.target.value) })} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.cashBoxes.account')}</label>
                <AccountSelect companyId={activeCompany?.id || ''} value={form.accountId || ''} onChange={v => setForm({ ...form, accountId: v || undefined })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.cashBoxes.branch')}</label>
                <BranchSelect companyId={activeCompany?.id || ''} value={form.branchId || ''} onChange={v => setForm({ ...form, branchId: v || undefined })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.cashBoxes.responsibleUser')}</label>
                <UserSelect companyId={activeCompany?.id || ''} value={form.responsibleUserId || ''} onChange={v => setForm({ ...form, responsibleUserId: v || undefined })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('settings.common.cancel')}</Button>
              <Button onClick={handleSave} leftIcon={<CheckSquare size={16} />}>{t('settings.common.save')}</Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('settings.cashBoxes.deleteTitle')} message={t('settings.cashBoxes.deleteMessage')} />
    </div>
  );
};

export default CashBoxesPage;
