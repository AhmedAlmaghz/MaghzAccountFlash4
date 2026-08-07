import React, { useState } from 'react';
import { Layers, Plus, Pencil, Trash2, CheckSquare } from 'lucide-react';
import { Card, Button, Table, Modal, Input, Badge, ConfirmDialog, Can } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { useProductTypes } from '@/core/hooks/useSettings';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { ProductType } from '@/core/types';

export const ProductTypesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { types, isLoading, create, update, remove } = useProductTypes(activeCompany?.id || '');
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ProductType>>({
    nameAr: '', nameEn: '', code: '',
    appearsInSales: true, appearsInPurchases: true, appearsInInventory: true,
    appearsInManufacturing: false, hasStockTracking: true, hasBOM: false,
    isActive: true,
  });

  const resetForm = () => {
    setForm({ nameAr: '', nameEn: '', code: '', appearsInSales: true, appearsInPurchases: true, appearsInInventory: true, appearsInManufacturing: false, hasStockTracking: true, hasBOM: false, isActive: true });
  };

  const handleSave = async () => {
    if (!form.nameAr || !activeCompany?.id) {
      addToast('error', t('settings.productTypes.nameRequired'));
      return;
    }
    if (editingId) {
      const result = await update(editingId, form);
      if (result.success) addToast('success', t('settings.productTypes.updated'));
      else addToast('error', result.error || t('settings.productTypes.updateError'));
      setEditingId(null);
    } else {
      const result = await create({ ...form, companyId: activeCompany.id } as Omit<ProductType, 'id'>);
      if (result.success) addToast('success', t('settings.productTypes.created'));
      else addToast('error', result.error || t('settings.productTypes.createError'));
    }
    setIsOpen(false);
    resetForm();
  };

  const openEdit = (pt: ProductType) => {
    setForm({ ...pt });
    setEditingId(pt.id);
    setIsOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await remove(deleteId);
    if (result.success) {
      addToast('success', t('settings.productTypes.deleted'));
    } else {
      addToast('error', result.error || t('settings.productTypes.deleteError'));
    }
    setDeleteId(null);
  };

  const boolBadge = (val: boolean) => (
    <Badge className={val ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}>
      {val ? t('settings.common.yes') : t('settings.common.no')}
    </Badge>
  );

  const columns = [
    { key: 'nameAr', header: t('settings.productTypes.name'), render: (row: ProductType) => <span className="font-medium">{row.nameAr}</span> },
    { key: 'code', header: t('settings.productTypes.code'), width: '80px', render: (row: ProductType) => <span className="font-mono text-xs text-slate-500">{row.code}</span> },
    { key: 'sales', header: t('settings.productTypes.sales'), width: '70px', render: (row: ProductType) => boolBadge(row.appearsInSales) },
    { key: 'purchases', header: t('settings.productTypes.purchases'), width: '80px', render: (row: ProductType) => boolBadge(row.appearsInPurchases) },
    { key: 'inventory', header: t('settings.productTypes.inventory'), width: '70px', render: (row: ProductType) => boolBadge(row.appearsInInventory) },
    { key: 'manufacturing', header: t('settings.productTypes.manufacturing'), width: '70px', render: (row: ProductType) => boolBadge(row.appearsInManufacturing) },
    { key: 'stock', header: t('settings.productTypes.stockTracking'), width: '70px', render: (row: ProductType) => boolBadge(row.hasStockTracking) },
    { key: 'bom', header: 'BOM', width: '60px', render: (row: ProductType) => boolBadge(row.hasBOM) },
    { key: 'isActive', header: t('settings.common.active'), width: '60px', render: (row: ProductType) => (
      <span className={row.isActive ? 'text-emerald-600' : 'text-slate-400'}>{row.isActive ? t('settings.common.yes') : t('settings.common.no')}</span>
    )},
    { key: 'actions', header: '', width: '100px', render: (row: ProductType) => (
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
          <Layers size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.productTypes.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.productTypes.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setEditingId(null); setIsOpen(true); }}>{t('settings.productTypes.new')}</Button>
        </Can>
      </div>

      <Card>
        <Table<ProductType> data={types} columns={columns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} emptyMessage={t('settings.productTypes.empty')} />
      </Card>

      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('settings.productTypes.deleteTitle')} message={t('settings.productTypes.deleteMessage')} />

      {isOpen && (
        <Modal isOpen={isOpen} title={editingId ? t('settings.productTypes.editTitle') : t('settings.productTypes.newTitle')} onClose={() => setIsOpen(false)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('settings.productTypes.nameAr')} value={form.nameAr || ''} onChange={e => setForm({ ...form, nameAr: e.target.value })} />
              <Input label={t('settings.productTypes.nameEn')} value={form.nameEn || ''} onChange={e => setForm({ ...form, nameEn: e.target.value })} />
              <Input label={t('settings.productTypes.code')} value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive ?? true}
                onChange={e => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="isActive" className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('settings.common.active')}</label>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
              <h4 className="font-semibold text-sm">{t('settings.productTypes.appearanceRules')}</h4>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'appearsInSales', label: t('settings.productTypes.appearsInSales') },
                  { key: 'appearsInPurchases', label: t('settings.productTypes.appearsInPurchases') },
                  { key: 'appearsInInventory', label: t('settings.productTypes.appearsInInventory') },
                  { key: 'appearsInManufacturing', label: t('settings.productTypes.appearsInManufacturing') },
                  { key: 'hasStockTracking', label: t('settings.productTypes.hasStockTracking') },
                  { key: 'hasBOM', label: t('settings.productTypes.hasBOM') },
                ].map((field: { key: string; label: string }) => (
                  <label key={field.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(form as Record<string, unknown>)[field.key] as boolean ?? false}
                      onChange={e => setForm({ ...form, [field.key]: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-200">{field.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
              <h4 className="font-semibold text-sm">{t('settings.productTypes.defaultAccounts')}</h4>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t('settings.productTypes.salesAccount')}</label>
                  <AccountSelect companyId={activeCompany?.id || ''} value={form.defaultSalesAccountId || ''} onChange={v => setForm({ ...form, defaultSalesAccountId: v || undefined })} size="sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t('settings.productTypes.cogsAccount')}</label>
                  <AccountSelect companyId={activeCompany?.id || ''} value={form.defaultCOGSAccountId || ''} onChange={v => setForm({ ...form, defaultCOGSAccountId: v || undefined })} size="sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t('settings.productTypes.inventoryAccount')}</label>
                  <AccountSelect companyId={activeCompany?.id || ''} value={form.defaultInventoryAccountId || ''} onChange={v => setForm({ ...form, defaultInventoryAccountId: v || undefined })} size="sm" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('settings.common.cancel')}</Button>
              <Button onClick={handleSave} leftIcon={<CheckSquare size={16} />}>{editingId ? t('settings.common.saveChanges') : t('settings.common.create')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ProductTypesPage;
