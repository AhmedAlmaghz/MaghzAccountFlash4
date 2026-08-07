import React, { useState } from 'react';
import { RefreshCcw, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, Button, Can } from '@/core/ui/components';
import { useOnboardingStore } from '@/core/store/onboardingStore';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';

export const ResetOnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const resetOnboarding = useOnboardingStore((state) => state.reset);
  const user = useAuthStore((state) => state.user);
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const handleReset = () => {
    resetOnboarding();
    setDone(true);
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  if (!isAdmin) {
    return (
      <div className="text-center space-y-4 py-8">
        <AlertTriangle size={48} className="text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('settings.reset.unauthorized')}</h2>
        <p className="text-slate-500 dark:text-slate-400">{t('settings.reset.unauthorizedDesc')}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center space-y-4 py-8">
        <CheckCircle size={48} className="text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('settings.reset.done')}</h2>
        <p className="text-slate-500 dark:text-slate-400">{t('settings.reset.doneDesc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <RefreshCcw size={24} className="text-primary-600 dark:text-primary-400" />
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('settings.reset.title')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.reset.subtitle')}</p>
        </div>
      </div>

      <Card className="p-6 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
        <div className="flex items-start gap-3">
          <AlertTriangle size={24} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-medium text-amber-800 dark:text-amber-300">{t('settings.reset.warning')}</p>
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('settings.reset.warningDesc')}</p>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="confirm-reset"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor="confirm-reset" className="text-sm text-slate-700 dark:text-slate-200">
          {t('settings.reset.confirm')}
        </label>
      </div>

      <Can action="delete" module="settings">
        <Button
          variant="primary"
          onClick={handleReset}
          disabled={!confirmed}
          leftIcon={<RefreshCcw size={16} />}
        >
          {t('settings.reset.resetNow')}
        </Button>
      </Can>
    </div>
  );
};

export default ResetOnboardingPage;
