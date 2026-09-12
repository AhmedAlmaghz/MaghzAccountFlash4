import React, { useEffect, useState } from 'react';
import { Settings2, Save } from 'lucide-react';
import { Card, Button as Btn, Input, PageHeader, EmptyState } from '@/core/ui/components';
import { CashBoxSelect, CustomerSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { DEFAULT_POS_SETTINGS, type PosSettings } from '../types';

/** POS terminal settings — stored in the generic settings table under pos.* keys. */
export const PosSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const [form, setForm] = useState<PosSettings>(DEFAULT_POS_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId) return;
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();
        const result = await adapter.query(
          "SELECT key, value FROM settings WHERE company_id = $1 AND key LIKE 'pos.%'",
          [companyId]
        );
        if (!cancelled && result.success) {
          const next: PosSettings = { ...DEFAULT_POS_SETTINGS };
          for (const row of (result.rows || []) as Array<Record<string, unknown>>) {
            const key = String(row.key);
            const value = String(row.value ?? '');
            if (key === 'pos.defaultCashBoxId') next.defaultCashBoxId = value || null;
            if (key === 'pos.defaultWalkInCustomerId') next.defaultWalkInCustomerId = value || null;
            if (key === 'pos.receiptFooter') next.receiptFooter = value;
            if (key === 'pos.allowPriceEdit') next.allowPriceEdit = value === 'true';
            if (key === 'pos.allowDiscount') next.allowDiscount = value === 'true';
            if (key === 'pos.allowNegativeStock') next.allowNegativeStock = value === 'true';
            if (key === 'pos.autoPrint') next.autoPrint = value === 'true';
          }
          setForm(next);
        } else if (!cancelled && result.error) {
          addToast('error', result.error);
        }
      } catch (e) {
        if (!cancelled) addToast('error', String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [companyId]);

  const handleSave = async () => {
    if (!companyId) return;
    setIsSaving(true);
    try {
      const adapter = await getDbAdapter();
      const entries: Array<[string, string]> = [
        ['pos.defaultCashBoxId', form.defaultCashBoxId || ''],
        ['pos.defaultWalkInCustomerId', form.defaultWalkInCustomerId || ''],
        ['pos.receiptFooter', form.receiptFooter || ''],
        ['pos.autoPrint', String(form.autoPrint)],
        ['pos.allowPriceEdit', String(form.allowPriceEdit)],
        ['pos.allowDiscount', String(form.allowDiscount)],
        ['pos.allowNegativeStock', String(form.allowNegativeStock)],
      ];
      // Atomic-ish: if any upsert fails, report and stop — settings are re-read on save
      for (const [key, value] of entries) {
        const res = await adapter.query(
          `INSERT INTO settings (company_id, key, value, category)
           VALUES ($1::uuid, $2, $3, 'pos')
           ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
          [companyId, key, value]
        );
        if (!res.success) throw new Error(res.error || `Failed to save ${key}`);
      }
      addToast('success', t('pos.saved'));
    } catch (e) {
      addToast('error', String(e) || t('common.error', { default: 'خطأ' }));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-6"><EmptyState icon="inbox" title={t('common.loading', { default: '...' })} description="" /></div>;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t('pos.settings')}
        subtitle={t('pos.settingsSubtitle')}
        icon={<Settings2 size={22} />}
        actions={
          <Btn variant="primary" leftIcon={<Save size={16} />} isLoading={isSaving} onClick={handleSave}>
            {t('common.save')}
          </Btn>
        }
      />

      <Card>
        <div className="space-y-5 p-1">
          <div className="max-w-sm">
            <label className="mb-1.5 block text-sm font-medium">{t('pos.defaultCashBox')}</label>
            <CashBoxSelect
              companyId={companyId}
              value={form.defaultCashBoxId ?? undefined}
              onChange={(v) => setForm((f) => ({ ...f, defaultCashBoxId: v }))}
            />
            <p className="mt-1.5 text-xs text-zinc-500">{t('pos.noShiftDesc')}</p>
          </div>

          <div className="max-w-sm">
            <label className="mb-1.5 block text-sm font-medium">{t('pos.defaultWalkInCustomer')}</label>
            <CustomerSelect
              companyId={companyId}
              value={form.defaultWalkInCustomerId ?? undefined}
              onChange={(v) => setForm((f) => ({ ...f, defaultWalkInCustomerId: v || null }))}
            />
            <p className="mt-1.5 text-xs text-zinc-500">{t('pos.defaultWalkInCustomerDesc')}</p>
          </div>

          <div className="max-w-md">
            <Input
              label={t('pos.receiptFooter')}
              placeholder={t('pos.receiptFooterPlaceholder')}
              value={form.receiptFooter}
              onChange={(e) => setForm((f) => ({ ...f, receiptFooter: e.target.value }))}
            />
          </div>

          <div className="space-y-3">
            {([
              ['autoPrint', 'pos.autoPrint'],
              ['allowPriceEdit', 'pos.allowPriceEdit'],
              ['allowDiscount', 'pos.allowDiscount'],
              ['allowNegativeStock', 'pos.allowNegativeStock'],
            ] as const).map(([field, key]) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.checked }))}
                  className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-700 accent-emerald-600"
                />
                <span className="text-sm">{t(key)}</span>
              </label>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default PosSettingsPage;
