import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AppRouter } from './app/router';
import { OnboardingWizard } from './app/onboarding';
import { useAppStore } from './core/store';
import { useOnboardingStore } from './core/store/onboardingStore';
import { getDbAdapter } from './core/database/adapters';
import { initAuth } from './modules/auth/store';
import { AlertTriangle, HardDrive, RefreshCw } from 'lucide-react';
import { Button, ErrorBoundary } from './core/ui/components';
import { useTranslation } from './core/i18n/useTranslation';
import { setDbMode } from './core/database/adapters';

// Set RTL and Arabic as default
document.documentElement.dir = 'rtl';
document.documentElement.lang = 'ar';

// ─── Stale-deploy recovery ─────────────────────────────────────────────────
// After a NEW deploy, a browser holding the OLD index.html lazy-loads chunk
// names that no longer exist ("Failed to fetch dynamically imported module:
// .../assets/SomePage-<oldHash>.js"). Vite fires `vite:preloadError` for
// exactly this case. Recover ONCE by hard-reloading — the fresh index.html
// references the new hashed assets and the user keeps their session
// (localStorage/sessionStorage survive a reload).
let staleDeployReloaded = false;
window.addEventListener('vite:preloadError', (event) => {
  if (staleDeployReloaded) return; // reload already attempted — let it surface
  staleDeployReloaded = true;
  event.preventDefault();
  window.location.reload();
});

/* eslint-disable react-refresh/only-export-components */

// Initialize auth from localStorage
initAuth();

function DbErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle size={32} className="text-rose-600 dark:text-rose-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-2">{t('common.dbError')}</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {t('common.dbErrorDesc')}
          </p>
        </div>
        <div className="flex flex-col gap-3 items-center">
          <Button variant="primary" leftIcon={<RefreshCw size={16} />} onClick={onRetry}>
            {t('common.retry')}
          </Button>
          <Button
            variant="secondary"
            leftIcon={<HardDrive size={16} />}
            onClick={() => {
              setDbMode('pglite');
              window.location.reload();
            }}
          >
            {t('common.usePglite')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const setDbStatus = useAppStore((state) => state.setDbStatus);
  const setActiveCompany = useAppStore((state) => state.setActiveCompany);
  const completed = useOnboardingStore((state) => state.completed);
  const [dbError, setDbError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!completed) return;

    let cancelled = false;

    async function initDb() {
      try {
        setDbStatus('connecting', false);
        setDbError(false);

        const adapter = await getDbAdapter();
        const ping = await adapter.ping();

        if (cancelled) return;

        if (!ping.success) {
          setDbStatus('error', false);
          setDbError(true);
          return;
        }

        setDbStatus('postgresql', true);

        const { mapCompanyRow } = await import('@/core/api/company');
        const companyResult = await adapter.getCompany();
        if (companyResult.success && companyResult.data) {
          // Single mapping point: every company column lands in the store.
          const company = mapCompanyRow(companyResult.data as Record<string, unknown>);
          setActiveCompany(company.name, company.id, company.currency || 'YER', {
            nameEn: company.nameEn,
            taxNumber: company.taxNumber,
            address: company.address,
            phone: company.phone,
            email: company.email,
            logoUrl: company.logoUrl,
            dateFormat: company.dateFormat,
            decimalPlaces: company.decimalPlaces,
            calendar: company.calendar,
            fiscalYearStart: company.fiscalYearStart,
          });
          // Company loaded successfully
        } else {
          console.error('[App] Could not load company');
        }
      } catch (err: unknown) {
        console.error('[App] DB init error:', err);
        if (!cancelled) {
          setDbStatus('error', false);
          setDbError(true);
        }
      }
    }

    initDb();

    return () => { cancelled = true; };
  }, [completed, retryKey, setDbStatus, setActiveCompany]);

  if (!completed) {
    return <OnboardingWizard />;
  }

  if (dbError) {
    return <DbErrorScreen onRetry={() => setRetryKey(k => k + 1)} />;
  }

  return <AppRouter />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
