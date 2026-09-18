import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Building2, Save, Upload, RefreshCw } from 'lucide-react';
import { Card, Button, Input, Can } from '@/core/ui/components';
import { SettingsHeader } from './SettingsHeader';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { getDbAdapter } from '@/core/database/adapters';
import { logAudit } from '@/core/utils/auditLogger';
import { TaxJurisdictionCard } from '@/modules/tax/components/TaxJurisdictionCard';
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

  // ── Phase 1: inventory valuation policy (settings key, not a company
  // column — changing it never migrates the companies table).
  const [valuation, setValuation] = useState<string>('moving_average');
  const [valuationBaseline, setValuationBaseline] = useState<string>('');
  const [hasStock, setHasStock] = useState(false);
  const [isSavingValuation, setIsSavingValuation] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    getDbAdapter()
      .then((adapter) => Promise.all([
        adapter.query<{ value: string }>(
          "SELECT value FROM settings WHERE company_id = $1 AND key = 'inventory.valuation_method' LIMIT 1",
          [companyId]
        ),
        adapter.query<{ n: string }>(
          'SELECT COUNT(*)::int AS n FROM stock WHERE company_id = $1::uuid AND quantity > 0',
          [companyId]
        ),
      ]))
      .then(([vRes, sRes]) => {
        if (cancelled) return;
        const v = String(vRes.rows?.[0]?.value || 'moving_average');
        const valid = ['moving_average', 'fifo', 'standard'].includes(v) ? v : 'moving_average';
        setValuation(valid);
        setValuationBaseline(valid);
        setHasStock(Number(sRes.rows?.[0]?.n) > 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId]);

  // ── Phase 3: company tax jurisdiction (country + timezone drive the
  // tax engine profile: rates, filing, e-invoicing requirements).
  const [taxCountry, setTaxCountry] = useState<string>('YE');
  const [taxTimezone, setTaxTimezone] = useState<string>('Asia/Aden');
  const [taxBaseline, setTaxBaseline] = useState<string>('');
  const [isSavingTax, setIsSavingTax] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    import('@/modules/tax/engine').then(({ getCompanyTaxContext }) =>
      getCompanyTaxContext(companyId).then((ctx) => {
        if (cancelled) return;
        setTaxCountry(ctx.countryCode);
        setTaxTimezone(ctx.timezone);
        setTaxBaseline(JSON.stringify([ctx.countryCode, ctx.timezone]));
      }).catch(() => {})
    );
    return () => { cancelled = true; };
  }, [companyId]);

  // ── Phase 4: stock/treasury/credit guardrails (secure-by-default).
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [defWh, setDefWh] = useState('');
  const [defFgWh, setDefFgWh] = useState('');
  const [negSale, setNegSale] = useState(false);
  const [negPRet, setNegPRet] = useState(false);
  const [negIssue, setNegIssue] = useState(false);
  const [negCash, setNegCash] = useState(false);
  const [creditMode, setCreditMode] = useState<'block' | 'warn' | 'allow'>('block');
  const [policyBaseline, setPolicyBaseline] = useState('');
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const adapter = await getDbAdapter();
        const whRes = await adapter.query<{ id: string; name: string }>(
          'SELECT id, name FROM warehouses WHERE company_id = $1 AND COALESCE(is_active, true) = true ORDER BY name',
          [companyId]
        );
        const { getStockPolicies } = await import('@/core/utils/stockPolicy');
        const pol = await getStockPolicies(companyId, adapter);
        if (cancelled) return;
        if (whRes.success) setWarehouses((whRes.rows || []).map((r) => ({ id: String(r.id), name: String(r.name) })));
        setDefWh(pol.defaultWarehouseId || '');
        setDefFgWh(pol.defaultFgWarehouseId || '');
        setNegSale(pol.allowNegativeSale);
        setNegPRet(pol.allowNegativePurchaseReturn);
        setNegIssue(pol.allowNegativeIssue);
        setNegCash(pol.allowNegativeCashbox);
        setCreditMode(pol.creditOverlimit);
        setPolicyBaseline(JSON.stringify([pol.defaultWarehouseId || '', pol.defaultFgWarehouseId || '', pol.allowNegativeSale, pol.allowNegativePurchaseReturn, pol.allowNegativeIssue, pol.allowNegativeCashbox, pol.creditOverlimit]));
      } catch {
        /* policy card stays at secure defaults */
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const handleSavePolicy = async () => {
    if (!companyId) return;
    setIsSavingPolicy(true);
    try {
      const { writeSetting } = await import('@/core/utils/stockPolicy');
      const entries: Array<[string, string]> = [
        ['inventory.default_warehouse_id', defWh],
        ['manufacturing.default_fg_warehouse_id', defFgWh],
        ['policy.allow_negative_sale', String(negSale)],
        ['policy.allow_negative_purchase_return', String(negPRet)],
        ['policy.allow_negative_issue', String(negIssue)],
        ['policy.allow_negative_cashbox', String(negCash)],
        ['policy.credit_overlimit', creditMode],
      ];
      for (const [key, value] of entries) {
        const res = await writeSetting(companyId, key, value, key.startsWith('policy.') ? 'policy' : key.startsWith('manufacturing.') ? 'manufacturing' : 'inventory');
        if (!res.success) {
          addToast('error', res.error || t('settings.company.saveError'));
          return;
        }
      }
      setPolicyBaseline(JSON.stringify([defWh, defFgWh, negSale, negPRet, negIssue, negCash, creditMode]));
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'settings',
        recordId: 'stock-policies',
        recordLabel: t('settings.policy.title'),
        companyId,
      });
      addToast('success', t('settings.policy.saved'));
    } catch {
      addToast('error', t('settings.company.saveError'));
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const handleSaveTax = async () => {
    if (!companyId) return;
    setIsSavingTax(true);
    try {
      const { setCompanyTaxContext } = await import('@/modules/tax/engine');
      const res = await setCompanyTaxContext(companyId, taxCountry, taxTimezone);
      if (!res.success) {
        addToast('error', res.error || t('settings.company.saveError'));
        return;
      }
      setTaxBaseline(JSON.stringify([taxCountry, taxTimezone]));
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'settings',
        recordId: `tax.country_code=${taxCountry}`,
        recordLabel: t('settings.tax.title'),
        companyId,
      });
      addToast('success', t('settings.tax.saved'));
    } catch {
      addToast('error', t('settings.company.saveError'));
    } finally {
      setIsSavingTax(false);
    }
  };

  const handleSaveValuation = async () => {
    if (!companyId) return;
    setIsSavingValuation(true);
    try {
      const { setValuationMethod, ensureFifoOpeningLayers } = await import('@/core/utils/valuation');
      const res = await setValuationMethod(companyId, valuation as 'moving_average' | 'fifo' | 'standard');
      if (!res.success) {
        addToast('error', res.error || t('settings.company.saveError'));
        return;
      }
      // Switching TO fifo with on-hand stock: synthesize opening layers from
      // current balances at current average (documented, idempotent) so the
      // first FIFO sale prices real costs instead of failing.
      if (valuation === 'fifo') {
        const adapter = await getDbAdapter();
        const layers = await ensureFifoOpeningLayers(companyId, new Date().toISOString().split('T')[0], adapter);
        if (layers.success && layers.created > 0) {
          addToast('success', t('settings.inventory.openingLayersCreated'));
        }
      }
      setValuationBaseline(valuation);
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'settings',
        recordId: `inventory.valuation_method=${valuation}`,
        recordLabel: t('settings.inventory.title'),
        companyId,
      });
      addToast('success', t('settings.inventory.saved'));
    } catch {
      addToast('error', t('settings.company.saveError'));
    } finally {
      setIsSavingValuation(false);
    }
  };

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

      {/* Phase 3: tax jurisdiction */}
      <TaxJurisdictionCard
        t={t}
        taxCountry={taxCountry}
        setTaxCountry={setTaxCountry}
        taxTimezone={taxTimezone}
        setTaxTimezone={setTaxTimezone}
        isDirty={taxBaseline !== '' && JSON.stringify([taxCountry, taxTimezone]) !== taxBaseline}
        isSaving={isSavingTax}
        onSave={handleSaveTax}
      />

      {/* Phase 4: stock/treasury/credit guardrails */}
      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('settings.policy.title')}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.policy.subtitle')}</p>
          </div>
          <Can action="edit" module="settings">
            <Button
              variant="secondary"
              leftIcon={<Save size={16} />}
              onClick={handleSavePolicy}
              isLoading={isSavingPolicy}
              disabled={policyBaseline === '' || JSON.stringify([defWh, defFgWh, negSale, negPRet, negIssue, negCash, creditMode]) === policyBaseline}
            >
              {t('settings.company.save')}
            </Button>
          </Can>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="form-label block mb-1.5">{t('settings.policy.defaultWarehouse')}</label>
            <select value={defWh} onChange={(e) => setDefWh(e.target.value)} className="form-control">
              <option value="">{t('settings.policy.noDefault')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.policy.defaultWarehouseHint')}</p>
          </div>
          <div>
            <label className="form-label block mb-1.5">{t('settings.policy.defaultFgWarehouse')}</label>
            <select value={defFgWh} onChange={(e) => setDefFgWh(e.target.value)} className="form-control">
              <option value="">{t('settings.policy.noDefault')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.policy.defaultFgWarehouseHint')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([
            { key: 'negSale', value: negSale, set: setNegSale, label: t('settings.policy.allowNegativeSale'), hint: t('settings.policy.allowNegativeSaleHint') },
            { key: 'negPRet', value: negPRet, set: setNegPRet, label: t('settings.policy.allowNegativePurchaseReturn'), hint: t('settings.policy.allowNegativePurchaseReturnHint') },
            { key: 'negIssue', value: negIssue, set: setNegIssue, label: t('settings.policy.allowNegativeIssue'), hint: t('settings.policy.allowNegativeIssueHint') },
            { key: 'negCash', value: negCash, set: setNegCash, label: t('settings.policy.allowNegativeCashbox'), hint: t('settings.policy.allowNegativeCashboxHint') },
          ] as const).map((row) => (
            <label key={row.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{row.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{row.hint}</p>
              </div>
              <input
                type="checkbox"
                checked={row.value}
                onChange={(e) => row.set(e.target.checked)}
                className="mt-1 h-5 w-5 accent-amber-600"
              />
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="form-label block mb-1.5">{t('settings.policy.creditOverlimit')}</label>
            <select value={creditMode} onChange={(e) => setCreditMode(e.target.value as 'block' | 'warn' | 'allow')} className="form-control">
              <option value="block">{t('settings.policy.overlimitBlock')}</option>
              <option value="warn">{t('settings.policy.overlimitWarn')}</option>
              <option value="allow">{t('settings.policy.overlimitAllow')}</option>
            </select>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.policy.creditOverlimitHint')}</p>
          </div>
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.policy.overrideTrailHint')}</p>
      </Card>

      {/* Phase 1: inventory valuation policy */}
      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('settings.inventory.title')}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.inventory.subtitle')}</p>
          </div>
          <Can action="edit" module="settings">
            <Button
              variant="secondary"
              leftIcon={<Save size={16} />}
              onClick={handleSaveValuation}
              isLoading={isSavingValuation}
              disabled={valuation === valuationBaseline}
            >
              {t('settings.company.save')}
            </Button>
          </Can>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['moving_average', 'fifo', 'standard'] as const).map((m) => (
            <label
              key={m}
              className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                valuation === m
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="valuation-method"
                  checked={valuation === m}
                  onChange={() => setValuation(m)}
                  className="accent-primary-600"
                />
                <span className="font-semibold text-slate-900 dark:text-slate-50">{t(`settings.inventory.${m}`)}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t(`settings.inventory.${m}_desc`)}</p>
            </label>
          ))}
        </div>
        {hasStock && valuation !== valuationBaseline && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.inventory.changeWarning')}</p>
        )}
        {hasStock && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('settings.inventory.hasStock')} • {t('settings.inventory.currentMethod')}: {t(`settings.inventory.${valuationBaseline || 'moving_average'}`)}
          </p>
        )}
      </Card>
    </div>
  );
};

export default CompanySetupPage;
