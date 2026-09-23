import React from 'react';
import { Card, Button } from '@/core/ui/components';
import { APP_VERSION, APP_VERSION_LABEL } from '@/core/brand';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useUpdateCheck } from '@/core/update/useUpdateCheck';
import { useAuthStore } from '@/modules/auth/store';
import { ExternalLink, RefreshCw, ShieldCheck, Info } from 'lucide-react';

export const AboutPage: React.FC = () => {
  const { t } = useTranslation();
  const { hasUpdate, info, checking, checkNow, channel, setChannel } = useUpdateCheck();
  const canEditSettings = useAuthStore((s) => s.hasPermission('settings.edit' as unknown as string));
  const isElectron = typeof window !== 'undefined' && !!(window as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron;

  const handleChannelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as 'stable' | 'beta';
    setChannel(v);
    try {
      const eu = (window as unknown as { electronUpdater?: { setChannel?: (c: string) => void } }).electronUpdater;
      eu?.setChannel?.(v);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
          <Info size={20} className="text-primary-600" />
          {t('settings.about.title')}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('settings.about.subtitle')}</p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{t('settings.about.version')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100" dir="ltr">{APP_VERSION_LABEL}</p>
            <p className="text-xs text-slate-400">v{APP_VERSION}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void checkNow()} isLoading={checking} leftIcon={<RefreshCw size={14} />}>
            {t('update.checkNow')}
          </Button>
        </div>

        {hasUpdate && info && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-bold text-amber-800 dark:text-amber-200">{t('update.available', { latest: info.latest, current: info.current })}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{info.isBeta ? t('update.channelBeta') : t('update.channelStable')}</p>
            </div>
            <a href={info.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 flex items-center gap-1">
              {isElectron ? t('update.openReleases') : t('update.updateNow')} <ExternalLink size={12} />
            </a>
          </div>
        )}

        {!hasUpdate && !checking && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{t('update.upToDate')}</p>
        )}

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('update.channel')}</label>
          <select
            value={channel}
            onChange={handleChannelChange}
            disabled={!canEditSettings}
            title={t('update.channel')}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="stable">{t('update.channelStable')}</option>
            <option value="beta">{t('update.channelBeta')}</option>
          </select>
          {!canEditSettings && <span className="text-xs text-amber-600 flex items-center gap-1"><ShieldCheck size={12} /> {t('settings.about.betaRequiresEdit')}</span>}
        </div>
        <p className="text-xs text-slate-500">{t('settings.about.channelHint')}</p>
      </Card>

      <Card className="p-5">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2">{t('settings.about.links')}</h3>
        <div className="flex flex-wrap gap-2">
          <a href="https://github.com/AhmedAlmaghz/MaghzAccountFlash4/releases" target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline flex items-center gap-1">
            <ExternalLink size={14} /> GitHub Releases
          </a>
          <span className="text-slate-300">·</span>
          <a href="https://maghz-account.vercel.app/version.json" target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline">
            version.json
          </a>
        </div>
      </Card>
    </div>
  );
};

export default AboutPage;
