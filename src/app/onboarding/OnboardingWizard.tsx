import React, { useState } from 'react';
import {
  Database,
  Server,
  CheckCircle,
  XCircle,
  Building2,
  Coins,
  FileText,
  Package,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Settings,
  Globe,
  Trash2,
  AlertTriangle,
  KeyRound,
  HardDrive,
} from 'lucide-react';
import { useOnboardingStore } from '@/core/store/onboardingStore';
import { useAppStore } from '@/core/store';
import { Button, Input, Card } from '@/core/ui/components';
import { useTranslation } from '@/core/i18n/useTranslation';
import { getDbAdapter } from '@/core/database/adapters';

const getSteps = (t: (key: string) => string) => [
  { id: 0, title: t('onboarding.welcome'), description: t('onboarding.welcomeDesc') },
  { id: 1, title: t('onboarding.database'), description: t('onboarding.databaseDesc') },
  { id: 2, title: t('onboarding.company'), description: t('onboarding.companyDesc') },
  { id: 3, title: t('onboarding.seedData'), description: t('onboarding.seedDataDesc') },
  { id: 4, title: t('onboarding.complete'), description: t('onboarding.completeDesc') },
];

export const OnboardingWizard: React.FC = () => {
  const { t } = useTranslation();
  const steps = getSteps(t);
  const { currentStep, setCurrentStep, dbConfig, companyConfig, setCompleted, setProcessing, isProcessing, processingMessage, error, setError } = useOnboardingStore();
  const setActiveCompany = useAppStore((state) => state.setActiveCompany);

  const nextStep = () => setCurrentStep(Math.min(currentStep + 1, steps.length - 1));
  const prevStep = () => setCurrentStep(Math.max(currentStep - 1, 0));

  const handleFinish = async () => {
    setProcessing(true, t('onboarding.saving'));
    setError(null);

    try {
      // Update app company state
      setActiveCompany(companyConfig.name, 'comp-1', companyConfig.currency, {
        dateFormat: companyConfig.dateFormat || 'yyyy-MM-dd',
        decimalPlaces: companyConfig.decimalPlaces ?? 2,
        calendar: (companyConfig.calendar as 'gregorian' | 'hijri') || 'gregorian',
        fiscalYearStart: companyConfig.fiscalYearStart || undefined,
      });

      // Persist DB config via the active adapter (works in both web and Electron modes)
      try {
        const adapter = await getDbAdapter();
        await adapter.updateConfig({
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          user: dbConfig.user,
          password: dbConfig.password,
        });
      } catch (configErr) {
        // Non-fatal: PGlite has no external config; Electron adapter may not be wired in dev
        console.warn('updateConfig skipped:', configErr);
      }

      setCompleted(true);
      setProcessing(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.saveError'));
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-3xl">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, idx) => (
              <div key={step.id} className="flex flex-col items-center gap-2 flex-1">
                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all
                  ${idx <= currentStep ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}
                `}>
                  {idx < currentStep ? <CheckCircle size={18} /> : idx + 1}
                </div>
                <div className="text-center hidden sm:block">
                  <p className={`text-xs font-medium ${idx <= currentStep ? 'text-primary-600' : 'text-slate-400'}`}>{step.title}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="relative h-1 bg-slate-200 dark:bg-slate-800 rounded-full mt-2">
            <div
              className="absolute top-0 right-0 h-full bg-primary-600 rounded-full transition-all duration-500"
              style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
            />
          </div>
        </div>

        {/* Content */}
        <Card className="p-6 sm:p-8 shadow-xl border border-slate-200 dark:border-slate-800">
          {currentStep === 0 && <WelcomeStep onNext={nextStep} />}
          {currentStep === 1 && <DatabaseStep onNext={nextStep} onBack={prevStep} />}
          {currentStep === 2 && <CompanyStep onNext={nextStep} onBack={prevStep} />}
          {currentStep === 3 && <SeedStep onNext={nextStep} onBack={prevStep} />}
          {currentStep === 4 && <CompleteStep onFinish={handleFinish} onBack={prevStep} />}
        </Card>

        {error && (
          <div className="mt-4 p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-2 text-rose-700 dark:text-rose-400">
            <XCircle size={20} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {isProcessing && (
          <div className="mt-4 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-primary-600" />
            <span className="text-sm text-primary-700 dark:text-primary-400">{processingMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────
function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetUsername, setResetUsername] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const resetOnboarding = useOnboardingStore((state) => state.reset);

  const handleResetAll = async () => {
    if (!resetConfirmed) {
      setResetError(t('onboarding.resetConfirmRequired'));
      return;
    }
    setIsResetting(true);
    setResetError('');
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.clearAll({
        confirm: true,
        username: resetUsername.trim() || undefined,
        password: resetPassword,
      });
      if (!result.success) {
        throw new Error(result.error || t('onboarding.clearDataError'));
      }
      resetOnboarding();
      setIsResetting(false);
      setShowResetConfirm(false);
      return;
    } catch (err) {
      setResetError(err instanceof Error ? err.message : t('onboarding.clearDataError'));
      setIsResetting(false);
    }
  };

  return (
    <div className="text-center space-y-6">
      <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center mx-auto">
        <Settings size={40} className="text-primary-600 dark:text-primary-400" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 mb-2">{t('onboarding.welcomeTitle')}</h1>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          {t('onboarding.helpDesc')}
        </p>
      </div>
      <div className="flex justify-center gap-4 text-sm text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1"><Database size={16} /> PostgreSQL</div>
        <div className="flex items-center gap-1"><Globe size={16} /> {t('onboarding.multiCurrency')}</div>
        <div className="flex items-center gap-1"><Sparkles size={16} /> {t('onboarding.defaultData')}</div>
      </div>
      <Button variant="primary" size="lg" leftIcon={<ArrowRight size={18} />} onClick={onNext}>
        {t('onboarding.start')}
      </Button>

      {/* Reset All Data */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
        {!showResetConfirm ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 size={14} />}
            onClick={() => setShowResetConfirm(true)}
            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
          >
            {t('onboarding.clearAll')}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
              <AlertTriangle size={18} />
              <span className="text-sm font-medium">{t('onboarding.clearWarning')}</span>
            </div>
            {resetError && (
              <div className="flex items-center gap-2 text-rose-600 bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
                <XCircle size={18} />
                <span className="text-sm">{resetError}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-right">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="reset-username">
                  {t('onboarding.adminUsername')}
                </label>
                <input
                  id="reset-username"
                  value={resetUsername}
                  onChange={(e) => setResetUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="reset-password">
                  {t('onboarding.adminPassword')}
                </label>
                <input
                  id="reset-password"
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={resetConfirmed}
                onChange={(e) => setResetConfirmed(e.target.checked)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              {t('onboarding.resetConfirmLabel')}
            </label>
            <div className="flex gap-2 justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowResetConfirm(false); setResetError(''); setResetConfirmed(false); }}
                disabled={isResetting}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={isResetting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                onClick={handleResetAll}
                isLoading={isResetting}
                disabled={!resetConfirmed}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {isResetting ? t('onboarding.clearing') : t('onboarding.confirmClear')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: Database ────────────────────────────────────────────────────────
function DatabaseStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const { dbConfig, setDbConfig, setError, setProcessing, isProcessing } = useOnboardingStore();
  const [dbMode, setDbMode] = useState<'pglite' | 'pg'>('pglite');
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleTest = async () => {
    setTestStatus('idle');
    setError(null);

    if (dbMode === 'pglite') {
      // Test PGlite (local PostgreSQL WASM)
      setProcessing(true, t('onboarding.testingConnection'));
      try {
        const { getDbAdapter, setDbMode: setStoredMode } = await import('@/core/database/adapters');
        setStoredMode('pglite');
        const adapter = await getDbAdapter();
        const result = await adapter.ping();
        if (result.success) {
          setTestStatus('success');
          setTestMessage(result.db || 'PGlite (local)');
        } else {
          setTestStatus('error');
          setTestMessage(result.message || t('onboarding.connectionFailed'));
        }
      } catch (err) {
        setTestStatus('error');
        setTestMessage(err instanceof Error ? err.message : t('onboarding.connectionFailed'));
      }
      setProcessing(false);
      return;
    }

    if (typeof window !== 'undefined' && window.electronDB?.testConnection) {
      setProcessing(true, t('onboarding.testingConnection'));
      try {
        const result = await window.electronDB.testConnection({
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          user: dbConfig.user,
          password: dbConfig.password,
        });
        if (result.success) {
          setTestStatus('success');
          setTestMessage(`متصل بـ: ${result.db} | النسخة: ${(result.version || '').split(' ')[0]}`);
        } else {
          setTestStatus('error');
          setTestMessage(result.error || t('onboarding.connectionFailed'));
        }
      } catch (err) {
        setTestStatus('error');
        setTestMessage(err instanceof Error ? err.message : t('onboarding.connectionFailed'));
      }
      setProcessing(false);
    } else {
      setTestStatus('error');
      setTestMessage(t('onboarding.pgNotAvailable'));
    }
  };

  const handleNext = async () => {
    // Persist the selected DB mode before continuing
    try {
      const { setDbMode: setStoredMode } = await import('@/core/database/adapters');
      setStoredMode(dbMode);
    } catch { /* ignore */ }
    onNext();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Database size={24} className="text-primary-600 dark:text-primary-400" />
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('onboarding.databaseSetup')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('onboarding.databaseSetupDesc')}</p>
        </div>
      </div>

      {/* DB mode selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setDbMode('pglite')}
          className={`p-4 rounded-xl border-2 text-right transition-all flex items-start gap-3 ${
            dbMode === 'pglite'
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
          }`}
        >
          <div className={`mt-0.5 ${dbMode === 'pglite' ? 'text-primary-600' : 'text-slate-400'}`}>
            <HardDrive size={20} />
          </div>
          <div>
            <p className="font-bold text-slate-900 dark:text-slate-100">{t('settings.database.pglite')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.database.pgliteDesc')}</p>
          </div>
        </button>
        <button
          onClick={() => setDbMode('pg')}
          className={`p-4 rounded-xl border-2 text-right transition-all flex items-start gap-3 ${
            dbMode === 'pg'
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
          }`}
        >
          <div className={`mt-0.5 ${dbMode === 'pg' ? 'text-primary-600' : 'text-slate-400'}`}>
            <Server size={20} />
          </div>
          <div>
            <p className="font-bold text-slate-900 dark:text-slate-100">{t('settings.database.postgres')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.database.postgresDesc')}</p>
          </div>
        </button>
      </div>

      {/* PG connection form (only when PG selected) */}
      {dbMode === 'pg' && (
        <div className="space-y-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 mb-2">
            <Server size={16} />
            <span className="text-sm font-medium">PostgreSQL</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('onboarding.host')} value={dbConfig.host || ''} onChange={e => setDbConfig({ host: e.target.value })} />
            <Input label={t('onboarding.port')} value={dbConfig.port || ''} onChange={e => setDbConfig({ port: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('onboarding.dbName')} value={dbConfig.database || ''} onChange={e => setDbConfig({ database: e.target.value })} />
            <Input label={t('auth.username')} value={dbConfig.user || ''} onChange={e => setDbConfig({ user: e.target.value })} />
          </div>
          <Input label={t('auth.password')} type="password" value={dbConfig.password || ''} onChange={e => setDbConfig({ password: e.target.value })} />
        </div>
      )}

      {testStatus === 'success' && (
        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg">
          <CheckCircle size={18} />
          <span className="text-sm font-medium">{testMessage}</span>
        </div>
      )}
      {testStatus === 'error' && (
        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
          <XCircle size={18} />
          <span className="text-sm font-medium">{testMessage}</span>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="secondary" leftIcon={<ArrowLeft size={16} />} onClick={onBack}>{t('back')}</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleTest} isLoading={isProcessing} leftIcon={<Settings size={16} />}>
            {t('onboarding.testConnection')}
          </Button>
          <Button variant="primary" leftIcon={<ArrowRight size={16} />} onClick={handleNext}>
            {t('next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Company ─────────────────────────────────────────────────────────
function CompanyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const { companyConfig, setCompanyConfig } = useOnboardingStore();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Building2 size={24} className="text-primary-600 dark:text-primary-400" />
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('onboarding.company')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('onboarding.companyInfoDesc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('onboarding.companyName')} value={companyConfig.name} onChange={e => setCompanyConfig({ name: e.target.value })} required />
          <Input label={t('onboarding.companyNameEn')} value={companyConfig.nameEn} onChange={e => setCompanyConfig({ nameEn: e.target.value })} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('settings.company.defaultCurrency')}</label>
            <select
              value={companyConfig.currency}
              title={t('onboarding.selectCurrency')}
              onChange={e => setCompanyConfig({ currency: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="YER">{t('onboarding.currencyYer')}</option>
              <option value="SAR">{t('onboarding.currencySar')}</option>
              <option value="USD">{t('onboarding.currencyUsd')}</option>
              <option value="AED">{t('onboarding.currencyAed')}</option>
              <option value="KWD">{t('onboarding.currencyKwd')}</option>
              <option value="QAR">{t('onboarding.currencyQar')}</option>
            </select>
          </div>
          <Input label={t('settings.company.taxNumber')} value={companyConfig.taxNumber} onChange={e => setCompanyConfig({ taxNumber: e.target.value })} />
          <Input label={t('settings.company.phone')} value={companyConfig.phone} onChange={e => setCompanyConfig({ phone: e.target.value })} />
        </div>

        <Input label={t('settings.company.address')} value={companyConfig.address} onChange={e => setCompanyConfig({ address: e.target.value })} />
        <Input label={t('settings.company.email')} type="email" value={companyConfig.email} onChange={e => setCompanyConfig({ email: e.target.value })} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('settings.calendar')}</label>
            <select
              value={companyConfig.calendar || 'gregorian'}
              title={t('settings.calendar')}
              onChange={e => setCompanyConfig({ calendar: e.target.value as 'gregorian' | 'hijri' })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="gregorian">{t('settings.calendar.gregorian')}</option>
              <option value="hijri">{t('settings.calendar.hijri')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('settings.decimalPlaces')}</label>
            <select
              value={companyConfig.decimalPlaces ?? 2}
              title={t('settings.decimalPlaces')}
              onChange={e => setCompanyConfig({ decimalPlaces: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value={0}>0</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('settings.company.fiscalYearStart')}</label>
            <input
              type="date"
              value={companyConfig.fiscalYearStart || `${new Date().getFullYear()}-01-01`}
              title={t('settings.company.fiscalYearStart')}
              onChange={e => setCompanyConfig({ fiscalYearStart: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="secondary" leftIcon={<ArrowLeft size={16} />} onClick={onBack}>{t('back')}</Button>
        <Button variant="primary" leftIcon={<ArrowRight size={16} />} onClick={onNext}>{t('next')}</Button>
      </div>
    </div>
  );
}

// ─── Step 4: Seed Data ───────────────────────────────────────────────────────
function SeedStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const { seedOption, setSeedOption, adminPassword, setAdminPassword, setError, setProcessing, isProcessing } = useOnboardingStore();
  const [seedStatus, setSeedStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [seedMessage, setSeedMessage] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');

  const handleSeedNow = async () => {
    if (seedOption === 'none') {
      onNext();
      return;
    }

    if (!adminPassword) {
      setSeedStatus('error');
      setSeedMessage(t('onboarding.adminPasswordRequired'));
      return;
    }

    setSeedStatus('idle');
    setError(null);
    setGeneratedPassword('');
    setProcessing(true, seedOption === 'default' ? t('onboarding.seedingDefault') : t('onboarding.seedingDemo'));

    try {
      const adapter = await getDbAdapter();

      if (seedOption === 'default') {
        if (!adapter.seedDefault) {
          throw new Error('seedDefault ' + t('onboarding.seedFailed'));
        }
        const result = await adapter.seedDefault(adminPassword);
        if (result.success) {
          setSeedStatus('success');
          setSeedMessage(t('onboarding.defaultSeeded'));
          if (result.adminPassword) setGeneratedPassword(result.adminPassword);
        } else {
          throw new Error(result.error || t('onboarding.seedFailed'));
        }
      } else if (seedOption === 'demo') {
        if (!adapter.seedDemo) {
          throw new Error('seedDemo ' + t('onboarding.seedFailed'));
        }
        const result = await adapter.seedDemo(adminPassword);
        if (result.success) {
          setSeedStatus('success');
          setSeedMessage(t('onboarding.demoSeeded'));
          if (result.adminPassword) setGeneratedPassword(result.adminPassword);
        } else {
          throw new Error(result.error || t('onboarding.seedFailed'));
        }
      }

      setProcessing(false);
      onNext();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('onboarding.seedError');
      setSeedStatus('error');
      setSeedMessage(msg);
      setError(msg);
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Package size={24} className="text-primary-600 dark:text-primary-400" />
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('onboarding.seedData')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('onboarding.seedDataDesc')}</p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="seed-admin-password">
          {t('onboarding.adminPassword')}
        </label>
        <input
          id="seed-admin-password"
          type="password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('onboarding.adminPasswordHint')}</p>
      </div>

      <div className="space-y-3">
        <SeedOptionCard
          active={seedOption === 'none'}
          icon={<FileText size={20} />}
          title={t('onboarding.noDataOpt')}
          desc={t('onboarding.noDataDesc')}
          onClick={() => setSeedOption('none')}
        />
        <SeedOptionCard
          active={seedOption === 'default'}
          icon={<CheckCircle size={20} />}
          title={t('onboarding.dataDefault')}
          desc={t('onboarding.dataDefaultDesc')}
          onClick={() => setSeedOption('default')}
        />
        <SeedOptionCard
          active={seedOption === 'demo'}
          icon={<Sparkles size={20} />}
          title={t('onboarding.dataDemo')}
          desc={t('onboarding.dataDemoDesc')}
          onClick={() => setSeedOption('demo')}
        />
      </div>

      {seedStatus === 'success' && (
        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg">
          <CheckCircle size={18} />
          <span className="text-sm font-medium">{seedMessage}</span>
        </div>
      )}
      {generatedPassword && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <KeyRound size={18} className="text-amber-600 shrink-0" />
          <div className="text-sm">
            <span className="font-medium text-amber-800 dark:text-amber-300">{t('onboarding.generatedPasswordNotice')}</span>
            <code className="block mt-1 font-mono text-amber-900 dark:text-amber-200 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded px-2 py-1 select-all">
              {t('onboarding.adminUsername')}: admin &nbsp;·&nbsp; {t('onboarding.adminPassword')}: {generatedPassword}
            </code>
          </div>
        </div>
      )}
      {seedStatus === 'error' && (
        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
          <XCircle size={18} />
          <span className="text-sm font-medium">{seedMessage}</span>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="secondary" leftIcon={<ArrowLeft size={16} />} onClick={onBack}>{t('back')}</Button>
        <Button variant="primary" onClick={handleSeedNow} isLoading={isProcessing} leftIcon={<ArrowRight size={16} />}>
          {seedOption === 'none' ? t('onboarding.skip') : t('onboarding.seedAndNext')}
        </Button>
      </div>
    </div>
  );
}

function SeedOptionCard({ active, icon, title, desc, onClick }: { active: boolean; icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full p-4 rounded-lg border-2 text-right transition-all flex items-start gap-3 ${
        active
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
      }`}
    >
      <div className={`mt-0.5 ${active ? 'text-primary-600' : 'text-slate-400'}`}>{icon}</div>
      <div>
        <p className="font-bold text-slate-900 dark:text-slate-100">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{desc}</p>
      </div>
    </button>
  );
}

// ─── Step 5: Complete ────────────────────────────────────────────────────────
function CompleteStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const { companyConfig, seedOption } = useOnboardingStore();

  const seedLabel = seedOption === 'none' ? t('onboarding.noDataOpt') : seedOption === 'default' ? t('onboarding.dataDefault') : t('onboarding.dataDemo');

  return (
    <div className="space-y-6 text-center">
      <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle size={32} className="text-emerald-600 dark:text-emerald-400" />
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-2">{t('onboarding.ready')}</h2>
        <p className="text-slate-500 dark:text-slate-400">{t('onboarding.successDesc')}</p>
      </div>

      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 text-right space-y-2 border border-slate-200 dark:border-slate-800 max-w-md mx-auto">
        <SummaryRow label={t('onboarding.summaryCompany')} value={companyConfig.name} icon={<Building2 size={16} />} />
        <SummaryRow label={t('onboarding.summaryCurrency')} value={companyConfig.currency} icon={<Coins size={16} />} />
        <SummaryRow label={t('onboarding.summaryDatabase')} value="PostgreSQL" icon={<Database size={16} />} />
        <SummaryRow label={t('onboarding.summaryData')} value={seedLabel} icon={<Package size={16} />} />
      </div>

      <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800 max-w-md mx-auto">
        <Button variant="secondary" leftIcon={<ArrowLeft size={16} />} onClick={onBack}>{t('back')}</Button>
        <Button variant="primary" size="lg" onClick={onFinish} leftIcon={<ArrowRight size={16} />}>
          {t('onboarding.enterSystem')}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

export default OnboardingWizard;


