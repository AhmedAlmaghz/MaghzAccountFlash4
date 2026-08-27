import React, { useState, useEffect } from 'react';
import { Receipt, Plus, Pencil, Trash2, Save } from 'lucide-react';
import { Card, Button, Input, Table, ConfirmDialog, Can } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { SettingsHeader } from './SettingsHeader';
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
  const [invoiceShowDiscount, setInvoiceShowDiscount] = useState(true);
  const [invoiceShowVat, setInvoiceShowVat] = useState(true);
  const [invoiceSettingsLoading, setInvoiceSettingsLoading] = useState(false);

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

  const loadInvoiceSettings = async () => {
    if (!activeCompany?.id) return;
    setInvoiceSettingsLoading(true);
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE company_id = $1 AND key IN ('invoice.showDiscount', 'invoice.showVat')`,
        [activeCompany.id]
      );
      if (result.success && result.rows) {
        for (const row of result.rows) {
          if (row.key === 'invoice.showDiscount') setInvoiceShowDiscount(row.value === 'true');
          if (row.key === 'invoice.showVat') setInvoiceShowVat(row.value === 'true');
        }
      }
    } catch {
      // ignore, defaults remain true
    } finally {
      setInvoiceSettingsLoading(false);
    }
  };

  useEffect(() => { loadInvoiceSettings(); }, [activeCompany?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveInvoiceSetting = async (key: string, value: boolean) => {
    if (!activeCompany?.id) return;
    try {
      const adapter = await getDbAdapter();
      await adapter.query(
        `INSERT INTO settings (id, company_id, key, value, category) VALUES ($1, $2, $3, $4, 'invoice')
         ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [crypto.randomUUID(), activeCompany.id, key, String(value)]
      );
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'settings',
        recordId: key,
        recordLabel: `${key}=${value}`,
        companyId: activeCompany.id,
      });
      addToast('success', t('settings.vat.invoiceSettingsSaved'));
    } catch {
      addToast('error', t('settings.vat.saveError'));
    }
  };

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
    <div className="space-y-5 animate-fade-in">
      <SettingsHeader
        title={t('settings.vat.title')}
        subtitle={t('settings.vat.subtitle')}
        icon={Receipt}
        color="from-rose-600 via-rose-500 to-pink-600"
        action={
          <Can action="create" module="settings">
            <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={() => { setEditingId(null); setFormData({ name: '', rate: 15, isActive: true }); }} className="bg-white/10 hover:bg-white/20 text-white border-white/20">
              {t('settings.vat.new')}
            </Button>
          </Can>
        }
      />

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

      <Card className="border-t-4 border-t-primary-500">
        <div className="p-1">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2 mb-1">
            <Receipt size={18} className="text-primary-600" />
            {t('settings.vat.invoiceDisplayTitle')}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('settings.vat.invoiceDisplaySubtitle')}</p>
          {invoiceSettingsLoading ? (
            <div className="space-y-3">
              <div className="h-16 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              <div className="h-16 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${invoiceShowDiscount ? 'border-primary-200 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-800' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'}`}>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{t('settings.vat.showDiscount')}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.vat.showDiscountDesc')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={invoiceShowDiscount}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setInvoiceShowDiscount(v);
                    saveInvoiceSetting('invoice.showDiscount', v);
                  }}
                  className="w-11 h-6 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 checked:bg-primary-600 relative before:content-[''] before:absolute before:w-5 before:h-5 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 checked:before:translate-x-5 transition-all cursor-pointer"
                />
              </label>
              <label className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${invoiceShowVat ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'}`}>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{t('settings.vat.showVat')}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.vat.showVatDesc')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={invoiceShowVat}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setInvoiceShowVat(v);
                    saveInvoiceSetting('invoice.showVat', v);
                  }}
                  className="w-11 h-6 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 checked:bg-emerald-600 relative before:content-[''] before:absolute before:w-5 before:h-5 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 checked:before:translate-x-5 transition-all cursor-pointer"
                />
              </label>
            </div>
          )}
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex gap-2">
            <Receipt size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{t('settings.vat.invoiceSettingsHint')}</p>
          </div>
        </div>
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
