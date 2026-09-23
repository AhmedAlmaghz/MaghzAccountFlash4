import React from 'react';
import { Download, RefreshCw, X, ExternalLink, Sparkles } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useUpdateCheck } from './useUpdateCheck';

declare global {
  interface Window {
    electronUpdater?: {
      quitAndInstall: () => void;
      onUpdateDownloaded?: (cb: () => void) => void;
      onUpdateAvailable?: (cb: (info: unknown) => void) => void;
    };
  }
}

export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const { hasUpdate, info, checking, dismiss } = useUpdateCheck();
  const [desktopDownloaded, setDesktopDownloaded] = React.useState(false);
  const isElectron = typeof window !== 'undefined' && !!(window as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron;

  React.useEffect(() => {
    const eu = window.electronUpdater;
    if (!eu?.onUpdateDownloaded) return;
    const off = eu.onUpdateDownloaded(() => setDesktopDownloaded(true));
    return () => { try { (off as unknown as () => void)?.(); } catch { /* ignore */ } };
  }, []);

  if (!hasUpdate || !info) return null;

  const handleUpdate = () => {
    if (isElectron && desktopDownloaded && window.electronUpdater?.quitAndInstall) {
      window.electronUpdater.quitAndInstall();
      return;
    }
    if (isElectron) {
      // For portable or not-yet-downloaded: open release page
      window.open(info.url, '_blank');
      return;
    }
    // Web: hard reload fetches fresh index.html (vercel no-cache) + new hashed chunks
    window.location.reload();
  };

  const isBeta = info.isBeta;

  return (
    <div className="w-full bg-gradient-to-r from-primary-600 to-primary-500 text-white px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 text-sm shadow-sm" dir="auto">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isBeta ? <Sparkles size={16} className="shrink-0" /> : <Download size={16} className="shrink-0" />}
        <span className="truncate">
          {t('update.available', { latest: info.latest, current: info.current })} {isBeta && `(${t('update.channelBeta')})`}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 rounded-lg bg-white text-primary-700 font-bold text-xs hover:bg-zinc-100 transition-colors flex items-center gap-1"
        >
          <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
          {desktopDownloaded ? t('update.restartNow') : t('update.updateNow')}
        </button>
        <a
          href={info.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          title={t('update.whatsNew')}
          aria-label={t('update.whatsNew')}
        >
          <ExternalLink size={14} />
        </a>
        <button
          onClick={dismiss}
          className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          title={t('update.later')}
          aria-label={t('update.later')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export const UpdateCheckButton: React.FC<{ variant?: 'ghost' | 'primary' }> = ({ variant = 'ghost' }) => {
  const { t } = useTranslation();
  const { checking, checkNow } = useUpdateCheck();
  return (
    <button
      onClick={() => void checkNow()}
      disabled={checking}
      className={variant === 'primary'
        ? 'px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1.5'
        : 'px-2 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1'}
    >
      <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
      {checking ? t('update.checking') : t('update.checkNow')}
    </button>
  );
};
