import React, { useState } from 'react';
import { Landmark, Plus, Pencil, Trash2, CheckSquare } from 'lucide-react';
import { Card, Button, Table, Modal, Input, ConfirmDialog, Can } from '@/core/ui/components';
import { AccountSelect, BranchSelect } from '@/core/ui/components/smart';
import { useBanks } from '@/core/hooks/useSettings';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { Bank } from '@/core/types';

export const BanksPage: React.FC = () => {
  const activeCompany = useAppStore(state => state.activeCompany);
  const { banks, isLoading, create, update, remove } = useBanks(activeCompany?.id || '');
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Bank>>({ name: '', bankName: '', accountNumber: '', currentBalance: 0 });

  const reset = () => {
    setForm({ name: '', bankName: '', accountNumber: '', currentBalance: 0 });
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.name || !activeCompany?.id) {
      addToast('error', t('settings.banks.accountNameRequired'));
      return;
    }
    if (editingId) {
      const result = await update(editingId, form);
      if (result.success) addToast('success', t('settings.banks.updated'));
      else addToast('error', result.error || t('settings.banks.updateError'));
    } else {
      const result = await create({ ...form, companyId: activeCompany.id, isActive: true } as Omit<Bank, 'id'>);
      if (result.success) addToast('success', t('settings.banks.created'));
      else addToast('error', result.error || t('settings.banks.createError'));
    }
    setIsOpen(false);
    reset();
  };

  const openEdit = (b: Bank) => {
    setForm({ ...b });
    setEditingId(b.id);
    setIsOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await remove(deleteId);
    if (result.success) {
      addToast('success', t('settings.banks.deleted'));
    } else {
      addToast('error', result.error || t('settings.banks.deleteError'));
    }
    setDeleteId(null);
  };

  const columns = [
    { key: 'name', header: t('settings.banks.accountName'), render: (row: Bank) => <span className="font-medium">{row.name}</span> },
    { key: 'bankName', header: t('settings.banks.bankName'), render: (row: Bank) => <span className="text-slate-500 text-sm">{row.bankName}</span> },
    { key: 'accountNumber', header: t('settings.banks.accountNumber'), width: '140px', render: (row: Bank) => <span className="font-mono text-xs">{row.accountNumber}</span> },
    { key: 'currentBalance', header: t('settings.banks.currentBalance'), width: '140px', align: 'right' as const, render: (row: Bank) => <span>{formatCurrency(row.currentBalance)}</span> },
    { key: 'isActive', header: t('settings.common.active'), width: '80px', render: (row: Bank) => <span className={row.isActive ? 'text-emerald-600' : 'text-slate-400'}>{row.isActive ? t('settings.banks.yes') : t('settings.banks.no')}</span> },
    { key: 'actions', header: '', width: '130px', render: (row: Bank) => (
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
          <Landmark size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.banks.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.banks.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { reset(); setIsOpen(true); }}>{t('settings.banks.newBank')}</Button>
        </Can>
      </div>

      <Card>
        <Table<Bank> data={banks} columns={columns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} emptyMessage={t('settings.banks.emptyMessage')} />
      </Card>

      {isOpen && (
        <Modal isOpen={isOpen} title={editingId ? t('settings.banks.editBank') : t('settings.banks.newBank')} onClose={() => setIsOpen(false)} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label={`${t('settings.banks.accountName')} *`} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
              <Input label={t('settings.banks.bankName')} value={form.bankName || ''} onChange={e => setForm({ ...form, bankName: e.target.value })} />
              <Input label={t('settings.banks.accountNumber')} value={form.accountNumber || ''} onChange={e => setForm({ ...form, accountNumber: e.target.value })} />
              <Input label={t('settings.banks.iban')} value={form.iban || ''} onChange={e => setForm({ ...form, iban: e.target.value })} />
              <Input label={t('settings.banks.openingBalance')} type="number" value={String(form.currentBalance || 0)} onChange={e => setForm({ ...form, currentBalance: Number(e.target.value) })} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.banks.accountingAccount')}</label>
                <AccountSelect companyId={activeCompany?.id || ''} value={form.accountId || ''} onChange={v => setForm({ ...form, accountId: v || undefined })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.banks.branch')}</label>
                <BranchSelect companyId={activeCompany?.id || ''} value={form.branchId || ''} onChange={v => setForm({ ...form, branchId: v || undefined })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('settings.common.cancel')}</Button>
              <Button onClick={handleSave} leftIcon={<CheckSquare size={16} />}>{t('settings.common.save')}</Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('settings.banks.deleteTitle')} message={t('settings.banks.deleteMessage')} />
    </div>
  );
};

export default BanksPage;
