import React from 'react';
import { Outlet } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';

export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Settings size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.pageTitle')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.pageSubtitle')}</p>
          </div>
        </div>
      </div>

      {/* All settings sections live in the app sidebar — render the active section full-width. */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <Outlet />
      </div>
    </div>
  );
};

export default SettingsPage;
