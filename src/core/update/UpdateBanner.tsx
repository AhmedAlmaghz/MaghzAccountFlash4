import React from 'react';
import { Download, RefreshCw, X, ExternalLink, Sparkles } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useUpdateCheck, type UpdateInfo } from './useUpdateCheck';
import { APP_VERSION } from '@/core/brand';

const RELEASES_URL = 'https://github.com/AhmedAlmaghz/MaghzAccountFlash4/releases';

interface ElectronUpdaterBridge {
  quitAndInstall: () => void;
  downloadUpdate?: () => Promise<{ success?: boolean; already?: boolean; downloaded?: boolean; error?: string } | undefined>;
  getUpdateCaps?: () => Promise<{ canAutoUpdate?: boolean } | undefined>;
  openExternal?: (url: string) => void;
  onUpdateDownloaded?: (cb: () => void) => () => void;
  onUpdateAvailable?: (cb: (info: { version?: string }) => void) => () => void;
  onProgress?: (cb: (p: { percent?: number }) => void) => () => void;
  onError?: (cb: (msg: string) => void) => () => void;
}

function getBridge(): ElectronUpdaterBridge | null {
  try {
    const w = window as unknown as { electronUpdater?: ElectronUpdaterBridge };
    return w.electronUpdater ?? null;
  } catch {
    return null;
  }
}

/** Desktop lifecycle of one update: badge → silent download → restart. */
type DesktopPhase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const { hasUpdate, info, checking, dismiss, channel } = useUpdateCheck();
  const [desktopPhase, setDesktopPhase] = React.useState<DesktopPhase>('idle');
  const [desktopInfo, setDesktopInfo] = React.useState<UpdateInfo | null>(null);
  const [percent, setPercent] = React.useState(0);
  const [portable, setPortable] = React.useState(false);
  const isElectron = typeof window !== 'undefined' && !!(window as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron;

  // Desktop event wiring — the main process owns check/download/install;
  // the renderer only mirrors state. Auto-download usually starts on its
  // own; these listeners catch it mid-flight even if the badge mounts late.
  React.useEffect(() => {
    if (!isElectron) return;
    const eu = getBridge();
    if (!eu) return;
    let alive = true;
    void eu.getUpdateCaps?.()?.then((caps) => {
      if (alive && caps && caps.canAutoUpdate === false) setPortable(true);
    }).catch(() => { /* fail-open: assume capable, fall back on error */ });
    const offs: Array<() => void> = [];
    try {
      const offAv = eu.onUpdateAvailable?.((ev) => {
        if (!alive) return;
        const raw = String(ev?.version ?? '').trim().replace(/^v/, '');
        if (!raw) return;
        setDesktopInfo({
          latest: raw,
          current: APP_VERSION,
          url: RELEASES_URL,
          channel,
          isBeta: /-beta|alpha|rc/i.test(raw),
        });
        setDesktopPhase((prev) => (prev === 'downloaded' || prev === 'downloading' ? prev : 'available'));
      });
      if (offAv) offs.push(offAv as () => void);
      const offPr = eu.onProgress?.((p) => {
        if (!alive) return;
        const pct = Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0)));
        setPercent(pct);
        setDesktopPhase('downloading');
      });
      if (offPr) offs.push(offPr as () => void);
      const offDl = eu.onUpdateDownloaded?.(() => {
        if (!alive) return;
        setPercent(100);
        setDesktopPhase('downloaded');
      });
      if (offDl) offs.push(offDl as () => void);
      const offEr = eu.onError?.(() => {
        if (!alive) return;
        setDesktopPhase((prev) => (prev === 'downloaded' ? prev : 'error'));
      });
      if (offEr) offs.push(offEr as () => void);
    } catch { /* bridge without event surface — web poll still drives the badge */ }
    return () => {
      alive = false;
      for (const off of offs) {
        try { off(); } catch { /* ignore */ }
      }
    };
  }, [isElectron, channel]);

  const effInfo = info ?? desktopInfo;
  if ((!hasUpdate && !desktopInfo) || !effInfo) return null;

  const handleDismiss = () => {
    dismiss();
    setDesktopInfo(null);
    setDesktopPhase('idle');
  };

  const openReleases = () => {
    const eu = getBridge();
    if (isElectron && eu?.openExternal) eu.openExternal(effInfo.url);
    else window.open(effInfo.url, '_blank');
  };

  const handleUpdate = () => {
    const eu = getBridge();
    // Downloaded → restart into the staged update (user-confirmed).
    if (isElectron && desktopPhase === 'downloaded' && eu?.quitAndInstall) {
      eu.quitAndInstall();
      return;
    }
    if (!isElectron) {
      // Web: hard reload fetches fresh index.html (vercel no-cache) + new hashed chunks
      window.location.reload();
      return;
    }
    // Portable / store builds have no installed updater — releases page.
    if (portable) {
      openReleases();
      return;
    }
    // Silent background download: progress + completion arrive as events.
    // Fail-open to the releases page if the download cannot start.
    setDesktopPhase('downloading');
    void eu?.downloadUpdate?.()?.then((r) => {
      if (!r) return;
      if (r.downloaded) {
        setPercent(100);
        setDesktopPhase('downloaded');
      } else if (r.success === false) {
        openReleases();
      }
    }).catch(() => openReleases());
  };

  const isBeta = effInfo.isBeta;
  const downloading = isElectron && desktopPhase === 'downloading';
  const downloaded = isElectron && desktopPhase === 'downloaded';
  const mainButtonLabel = downloading
    ? t('update.downloading', { percent })
    : downloaded
      ? t('update.restartNow')
      : t('update.updateNow');

  return (
    <div className="w-full bg-gradient-to-r from-primary-600 to-primary-500 text-white px-3 sm:px-4 py-2.5 text-sm shadow-sm" dir="auto">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isBeta ? <Sparkles size={16} className="shrink-0" /> : <Download size={16} className="shrink-0" />}
          <span className="truncate">
            {t('update.available', { latest: effInfo.latest, current: effInfo.current })} {isBeta && `(${t('update.channelBeta')})`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleUpdate}
            disabled={downloading}
            className="px-3 py-1.5 rounded-lg bg-white text-primary-700 font-bold text-xs hover:bg-zinc-100 transition-colors flex items-center gap-1 disabled:opacity-80"
          >
            <RefreshCw size={12} className={checking || downloading ? 'animate-spin' : ''} />
            {mainButtonLabel}
          </button>
          <a
            href={effInfo.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              // Desktop blocks window.open (setWindowOpenHandler deny) —
              // route through the shell bridge instead.
              if (isElectron && getBridge()?.openExternal) {
                e.preventDefault();
                openReleases();
              }
            }}
            className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
            title={t('update.whatsNew')}
            aria-label={t('update.whatsNew')}
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
            title={t('update.later')}
            aria-label={t('update.later')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {downloading && (
        <div
          className="mt-2 h-1.5 rounded-full bg-white/25 overflow-hidden"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('update.downloading', { percent })}
        >
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
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
