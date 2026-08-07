import React, { useState, useEffect } from 'react';
import { Building2, Save, Upload } from 'lucide-react';
import { Card, Button, Input, Can } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { getDbAdapter } from '@/core/database/adapters';
import { logAudit } from '@/core/utils/auditLogger';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

interface CompanyFormData {
  name: string;
  nameEn: string;
  taxNumber: string;
  address: string;
  phone: string;
  email: string;
  logoUrl?: string;
  stampUrl?: string;
  fiscalYearStart: string;
  currency: string;
  dateFormat: string;
  decimalPlaces: number;
  calendar: 'gregorian' | 'hijri';
}

export const CompanySetupPage: React.FC = () => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<CompanyFormData>({
    name: '',
    nameEn: '',
    taxNumber: '',
    address: '',
    phone: '',
    email: '',
    fiscalYearStart: '',
    currency: YER_CODE,
    dateFormat: 'yyyy-MM-dd',
    decimalPlaces: 2,
    calendar: 'gregorian',
  });

  useEffect(() => {
    if (activeCompany) {
      setFormData({
        name: activeCompany.name || '',
        nameEn: activeCompany.nameEn || '',
        taxNumber: activeCompany.taxNumber || '',
        address: activeCompany.address || '',
        phone: activeCompany.phone || '',
        email: activeCompany.email || '',
        logoUrl: activeCompany.logoUrl || '',
        fiscalYearStart: activeCompany.fiscalYearStart || '',
        currency: activeCompany.currency || YER_CODE,
        dateFormat: activeCompany.dateFormat || 'yyyy-MM-dd',
        decimalPlaces: activeCompany.decimalPlaces || 2,
        calendar: activeCompany.calendar || 'gregorian',
      });
    }
  }, [activeCompany]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData((prev) => ({ ...prev, logoUrl: event.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!activeCompany?.id) {
      addToast('error', t('settings.company.noCompany'));
      return;
    }
    if (!formData.name || formData.name.trim().length === 0) {
      addToast('error', t('settings.company.nameRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const adapter = await getDbAdapter();
      await adapter.query(
        `UPDATE companies SET name = $1, name_en = $2, tax_number = $3, address = $4, phone = $5, email = $6, logo_url = $7, fiscal_year_start = $8, currency = $9, date_format = $10, decimal_places = $11, calendar = $12, updated_at = NOW() WHERE id = $13`,
        [
          formData.name,
          formData.nameEn,
          formData.taxNumber,
          formData.address,
          formData.phone,
          formData.email,
          formData.logoUrl,
          formData.fiscalYearStart || null,
          formData.currency,
          formData.dateFormat,
          formData.decimalPlaces,
          formData.calendar,
          activeCompany.id,
        ]
      );

      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'companies',
        recordId: activeCompany.id,
        recordLabel: formData.name,
        companyId: activeCompany.id,
      });

      addToast('success', t('settings.company.saved'));

      useAppStore.getState().setActiveCompany(formData.name, activeCompany.id, formData.currency, {
        dateFormat: formData.dateFormat,
        decimalPlaces: formData.decimalPlaces,
        calendar: formData.calendar,
      });
    } catch {
      addToast('error', t('settings.company.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeCompany) {
    return <EmptyState title={t('settings.company.noCompany')} description={t('settings.company.noCompanyDesc')} />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Building2 size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.company.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.company.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Can action="edit" module="settings">
            <Button
              variant="primary"
              leftIcon={<Save size={16} />}
              onClick={handleSave}
              isLoading={isSaving}
            >
              {t('settings.company.save')}
            </Button>
          </Can>
        </div>
      </div>

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
            <Input
              label={t('settings.company.defaultCurrency')}
              value={formData.currency}
              onChange={(e) => setFormData((prev) => ({ ...prev, currency: e.target.value }))}
            />
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
