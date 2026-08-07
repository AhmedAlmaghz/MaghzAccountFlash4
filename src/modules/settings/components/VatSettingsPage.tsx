import React, { useState, useEffect } from 'react';
import { Receipt, Plus, Pencil, Trash2, Save } from 'lucide-react';
import { Card, Button, Input, Table, ConfirmDialog, Can } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { getDbAdapter } from '@/core/database/adapters';
import { logAudit } from '@/core/utils/auditLogger';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

interface VatType {
  id: string;
  name: string;
  rate: number;
  accountId?: string;
  isActive: boolean;
}

export const VatSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const [vatTypes, setVatTypes] = useState<VatType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<VatType>>({ name: '', rate: 15, isActive: true });

  const loadData = async () => {
    if (!activeCompany?.id) return;
    setIsLoading(true);
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query<{ id: string; name?: string; vat_rate: string | number; account_id: string; is_active: boolean }>(
        `SELECT * FROM vat_settings WHERE company_id = $1`,
        [activeCompany.id]
      );
      if (result.success && result.rows) {
        setVatTypes(result.rows.map((row) => ({
          id: row.id,
          name: row.name || t('settings.vat.defaultName'),
          rate: Number(row.vat_rate),
          accountId: row.account_id,
          isActive: row.is_active,
        })));
      }
    } catch {
      // Error handled by caller
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeCompany?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!activeCompany?.id || !formData.name) {
      addToast('error', t('settings.vat.nameRequired'));
      return;
    }
    if (formData.rate !== undefined && (formData.rate < 0 || formData.rate > 100)) {
      addToast('error', t('settings.vat.rateInvalid'));
      return;
    }
    setIsSaving(true);
    try {
      const adapter = await getDbAdapter();
      
      if (editingId) {
        await adapter.query(
          `UPDATE vat_settings SET name = $1, vat_rate = $2, account_id = $3, is_active = $4, updated_at = NOW() WHERE id = $5 AND company_id = $6`,
          [formData.name, formData.rate, formData.accountId, formData.isActive, editingId, activeCompany.id]
        );
      } else {
        await adapter.query(
          `INSERT INTO vat_settings (id, company_id, name, vat_rate, account_id, is_active, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [crypto.randomUUID(), activeCompany.id, formData.name, formData.rate, formData.accountId, formData.isActive]
        );
      }

      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: editingId ? 'update' : 'create',
        tableName: 'vat_settings',
        recordId: editingId || 'new',
        recordLabel: `${formData.name} (${formData.rate}%)`,
        companyId: activeCompany.id,
      });

      addToast('success', t(editingId ? 'settings.vat.updated' : 'settings.vat.created'));
      setEditingId(null);
      setFormData({ name: '', rate: 15, isActive: true });
      loadData();
    } catch {
      addToast('error', t('settings.vat.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeCompany?.id) return;
    setIsSaving(true);
    try {
      const adapter = await getDbAdapter();
      await adapter.query(`DELETE FROM vat_settings WHERE id = $1 AND company_id = $2`, [id, activeCompany.id]);
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'delete',
        tableName: 'vat_settings',
        recordId: id,
        companyId: activeCompany.id,
      });
      addToast('success', t('settings.vat.deleted'));
      setShowDeleteConfirm(null);
      loadData();
    } catch {
      addToast('error', t('settings.vat.deleteError'));
    } finally {
      setIsSaving(false);
    }
  };

  const columns = [
    { key: 'name', header: t('settings.vat.name') },
    { key: 'rate', header: t('settings.vat.rate'), render: (row: VatType) => `${row.rate}%` },
    { key: 'isActive', header: t('settings.vat.status'), render: (row: VatType) => (
      <span className={row.isActive ? 'badge-posted' : 'badge-draft'}>
        {row.isActive ? t('settings.common.active') : t('settings.common.inactive')}
      </span>
    )},
    { key: 'actions', header: '', render: (row: VatType) => (
      <div className="flex items-center gap-1">
        <Can action="edit" module="settings"><Button size="sm" variant="ghost" onClick={() => { setEditingId(row.id); setFormData(row); }}>
          <Pencil size={14} className="text-amber-600" />
        </Button></Can>
        <Can action="delete" module="settings"><Button size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(row.id)}>
          <Trash2 size={14} className="text-rose-600" />
        </Button></Can>
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Receipt size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.vat.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.vat.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { setEditingId(null); setFormData({ name: '', rate: 15, isActive: true }); }}>
            {t('settings.vat.new')}
          </Button>
        </Can>
      </div>

      <Card>
        {(editingId !== null || (formData.name && formData.name.length > 0)) && (
          <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label={t('settings.vat.name')} value={formData.name || ''} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              <Input label={t('settings.vat.rate')} type="number" min={0} max={100} step={0.01} value={String(formData.rate ?? 15)} onChange={e => setFormData(p => ({ ...p, rate: Number(e.target.value) }))} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.vat.account')}</label>
                <AccountSelect companyId={activeCompany?.id || ''} value={formData.accountId || ''} onChange={v => setFormData(p => ({ ...p, accountId: v || undefined }))} />
              </div>
              <div className="md:col-span-3 flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.isActive ?? true} onChange={e => setFormData(p => ({ ...p, isActive: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-sm">{t('settings.common.active')}</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setEditingId(null); setFormData({ name: '', rate: 15, isActive: true }); }}>{t('settings.common.cancel')}</Button>
              <Button variant="primary" leftIcon={<Save size={16} />} onClick={handleSave} isLoading={isSaving}>{t('settings.common.save')}</Button>
            </div>
          </div>
        )}

        <Table<VatType>
          data={vatTypes}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('settings.vat.empty')}
        />
      </Card>

      <ConfirmDialog
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        title={t('settings.vat.deleteTitle')}
        message={t('settings.vat.deleteMessage')}
        confirmText={t('settings.common.delete')}
        variant="danger"
      />
    </div>
  );
};

export default VatSettingsPage;
