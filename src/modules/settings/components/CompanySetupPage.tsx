import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Building2, Save, Upload, RefreshCw } from 'lucide-react';
import { Card, Button, Input, Can } from '@/core/ui/components';
import { SettingsHeader } from './SettingsHeader';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { getDbAdapter } from '@/core/database/adapters';
import { logAudit } from '@/core/utils/auditLogger';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { PageLoader } from '@/core/ui/components/PageLoader';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useAsyncData } from '@/core/hooks/useAsyncData';
import { getCompany, updateCompany, LOGO_MAX_BYTES } from '@/core/api/company';
import type { Company } from '@/modules/core/types';

interface CompanyFormData {
  name: string;
  nameEn: string;
  taxNumber: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
  fiscalYearStart: string;
  currency: string;
  dateFormat: string;
  decimalPlaces: number;
  calendar: 'gregorian' | 'hijri';
}

const EMPTY_FORM: CompanyFormData = {
  name: '',
  nameEn: '',
  taxNumber: '',
  address: '',
  phone: '',
  email: '',
  logoUrl: '',
  fiscalYearStart: '',
  currency: YER_CODE,
  dateFormat: 'yyyy-MM-dd',
  decimalPlaces: 2,
  calendar: 'gregorian',
};

function toForm(c: Company): CompanyFormData {
  return {
    name: c.name || '',
    nameEn: c.nameEn || '',
    taxNumber: c.taxNumber || '',
    address: c.address || '',
    phone: c.phone || '',
    email: c.email || '',
    logoUrl: c.logoUrl || '',
    fiscalYearStart: c.fiscalYearStart || '',
    currency: c.currency || YER_CODE,
    dateFormat: c.dateFormat || 'yyyy-MM-dd',
    decimalPlaces: c.decimalPlaces ?? 2,
    calendar: c.calendar || 'gregorian',
  };
}

export const CompanySetupPage: React.FC = () => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<CompanyFormData>(EMPTY_FORM);
  const [baseline, setBaseline] = useState('');
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const initializedFor = useRef<string | null>(null);

  // Fresh row from the database — the single source of truth. The store
  // snapshot is only a fallback when the database cannot be reached.
  const { data: dbCompany, isLoading, error: loadError, reload } = useAsyncData(
    async () => {
      const res = await getCompany();
      if (!res.success || !res.data) throw new Error(res.error || 'No company found');
      return res.data;
    },
    [],
    true,
  );

  // The store snapshot is already camelCase — no row mapping needed.
  const source: Company | null = dbCompany
    ?? (loadError && activeCompany ? (activeCompany as Company) : null);

  useEffect(() => {
    if (source && initializedFor.current !== source.id) {
      initializedFor.current = source.id;
      const next = toForm(source);
      setFormData(next);
      setBaseline(JSON.stringify(next));
    }
  }, [source]);

  // Active currency codes for the dropdown (graceful fallback: free text).
  useEffect(() => {
    const companyId = dbCompany?.id || activeCompany?.id;
    if (!companyId) return;
    let cancelled = false;
    getDbAdapter()
      .then((adapter) => adapter.query<{ code: string }>(
        'SELECT code FROM currencies WHERE company_id = $1 AND is_active = true ORDER BY is_default DESC, code',
        [companyId],
      ))
      .then((res) => {
        if (!cancelled && res.success && res.rows) {
          setCurrencyOptions(res.rows.map((r) => String(r.code)).filter(Boolean));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dbCompany?.id, activeCompany?.id]);

  const isDirty = baseline !== '' && JSON.stringify(formData) !== baseline;
  const companyId = dbCompany?.id || activeCompany?.id;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      addToast('error', t('settings.company.logoTooLarge'));
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setFormData((prev) => ({ ...prev, logoUrl: event.target?.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const syncStore = useCallback((c: Company) => {
    useAppStore.getState().setActiveCompany(c.name, c.id, c.currency || YER_CODE, {
      nameEn: c.nameEn,
      taxNumber: c.taxNumber,
      address: c.address,
      phone: c.phone,
      email: c.email,
      logoUrl: c.logoUrl,
      dateFormat: c.dateFormat,
      decimalPlaces: c.decimalPlaces,
      calendar: c.calendar,
      fiscalYearStart: c.fiscalYearStart,
    });
  }, []);

  const handleSave = async () => {
    if (!companyId) {
      addToast('error', t('settings.company.noCompany'));
      return;
    }
    if (!formData.name || formData.name.trim().length === 0) {
      addToast('error', t('settings.company.nameRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const res = await updateCompany(
        companyId,
        {
          ...formData,
          name: formData.name.trim(),
          decimalPlaces: Math.min(6, Math.max(0, Number(formData.decimalPlaces) || 0)),
          fiscalYearStart: formData.fiscalYearStart || undefined,
        },
        user?.id,
      );
      if (!res.success) {
        addToast('error', res.error || t('settings.company.saveError'));
        return;
      }

      const fresh = await getCompany();
      const saved = fresh.success && fresh.data ? fresh.data : null;
      if (saved) {
        syncStore(saved);
        const next = toForm(saved);
        setFormData(next);
        setBaseline(JSON.stringify(next));
      }

      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'companies',
        recordId: companyId,
        recordLabel: formData.name,
        companyId,
      });

      addToast('success', t('settings.company.saved'));
    } catch {
      addToast('error', t('settings.company.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <PageLoader text={t('settings.company.title')} />;
  }

  if (!source) {
    return (
      <div className="space-y-4">
        <EmptyState title={t('settings.company.noCompany')} description={loadError?.message || t('settings.company.noCompanyDesc')} />
        <div className="flex justify-center">
          <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <SettingsHeader
        title={t('settings.company.title')}
        subtitle={t('settings.company.subtitle')}
        icon={Building2}
        color="from-primary-600 via-primary-500 to-blue-600"
        action={
          <Can action="edit" module="settings">
            <Button
              variant="secondary"
              leftIcon={<Save size={16} />}
              onClick={handleSave}
              isLoading={isSaving}
              disabled={!isDirty}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 disabled:opacity-50"
            >
              {t('settings.company.save')}
            </Button>
          </Can>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Logo & Visual Identity */}
        <Card className="lg:col-span-1 space-y-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('settings.company.visualIdentity')}</h3>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">{t('settings.company.companyLogo')}</label>
            <div className="flex flex-col items-center gap-3">
              {formData.logoUrl ? (
                <img src={formData.logoUrl} alt="Logo" className="w-32 h-32 object-contain border rounded-lg" />
              ) : (
                <div className="w-32 h-32 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                  <Building2 className="w-12 h-12 text-slate-400" />
                </div>
              )}
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <span className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700">
                  <Upload size={14} /> {t('settings.company.uploadLogo')}
                </span>
              </label>
            </div>
          </div>
        </Card>

        {/* Company Info */}
        <Card className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('settings.company.basicInfo')}</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('settings.company.nameAr')}
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
            <Input
              label={t('settings.company.nameEn')}
              value={formData.nameEn}
              onChange={(e) => setFormData((prev) => ({ ...prev, nameEn: e.target.value }))}
            />
            <Input
              label={t('settings.company.taxNumber')}
              value={formData.taxNumber}
              onChange={(e) => setFormData((prev) => ({ ...prev, taxNumber: e.target.value }))}
            />
            {currencyOptions.length > 0 ? (
              <div>
                <label className="form-label block mb-1.5">{t('settings.company.defaultCurrency')}</label>
                <select
                  value={currencyOptions.includes(formData.currency) ? formData.currency : ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, currency: e.target.value }))}
                  className="form-control"
                >
                  {!currencyOptions.includes(formData.currency) && (
                    <option value="">{formData.currency}</option>
                  )}
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            ) : (
              <Input
                label={t('settings.company.defaultCurrency')}
                value={formData.currency}
                onChange={(e) => setFormData((prev) => ({ ...prev, currency: e.target.value }))}
              />
            )}
            <div>
              <label className="form-label block mb-1.5">{t('settings.company.calendar')}</label>
              <select
                value={formData.calendar}
                onChange={(e) => setFormData((prev) => ({ ...prev, calendar: e.target.value as 'gregorian' | 'hijri' }))}
                className="form-control"
              >
                <option value="gregorian">{t('settings.company.gregorian')}</option>
                <option value="hijri">{t('settings.company.hijri')}</option>
              </select>
            </div>
            <div>
              <label className="form-label block mb-1.5">{t('settings.company.dateFormat')}</label>
              <select
                value={formData.dateFormat}
                onChange={(e) => setFormData((prev) => ({ ...prev, dateFormat: e.target.value }))}
                className="form-control"
              >
                {formData.calendar === 'hijri' ? (
                  <>
                    <option value="yyyy/MM/dd">{t('settings.company.dateFormatHijri')}</option>
                    <option value="dd/MM/yyyy">DD/MM/YYYY</option>
                    <option value="yyyy-MM-dd">YYYY-MM-DD</option>
                  </>
                ) : (
                  <>
                    <option value="yyyy-MM-dd">{t('settings.company.dateFormatGregorian')}</option>
                    <option value="dd/MM/yyyy">DD/MM/YYYY</option>
                    <option value="yyyy/MM/dd">YYYY/MM/DD</option>
                  </>
                )}
              </select>
            </div>
            <Input
              label={t('settings.company.decimalPlaces')}
              type="number"
              min={0}
              max={6}
              value={String(formData.decimalPlaces)}
              onChange={(e) => setFormData((prev) => ({ ...prev, decimalPlaces: Number(e.target.value) }))}
            />
            <Input
              label={t('settings.company.fiscalYearStart')}
              type="date"
              value={formData.fiscalYearStart}
              onChange={(e) => setFormData((prev) => ({ ...prev, fiscalYearStart: e.target.value }))}
            />
            <Input
              label={t('settings.company.phone')}
              value={formData.phone}
              onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
            />
            <Input
              label={t('settings.company.email')}
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
            />
            <div className="md:col-span-2">
              <label className="form-label block mb-1.5">{t('settings.company.address')}</label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                className="form-control min-h-[80px] resize-none"
                rows={3}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default CompanySetupPage;
