import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, CopyCheck, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useAuthStore } from '../store';
import { useTranslation } from '@/core/i18n/useTranslation';

interface SessionRow {
  token: string;
  userId: string;
  username: string;
  fullName?: string | null;
  role?: string | null;
  isActive?: boolean | null;
  createdAt: number | null;
  expiresAt: number | null;
  lastActivityAt: number | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  isExpired: boolean;
  isCurrent: boolean;
}

function formatDevice(ua: string | null | undefined): string {
  const s = (ua || '').toLowerCase();
  if (/mobile|android|iphone|ipad|windows phone/i.test(s)) {
    if (/iphone/i.test(s)) return 'iOS';
    if (/ipad/i.test(s)) return 'iPadOS';
    if (/windows phone/i.test(s)) return 'Windows Phone';
    if (/android/i.test(s)) return 'Android';
    return 'Mobile';
  }
  if (/windows/i.test(s)) return 'Windows';
  if (/macintosh|mac os/i.test(s)) return 'macOS';
  if (/linux/i.test(s)) return 'Linux';
  return 'Browser';
}

function formatDateTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function formatExpires(ts: number | null): string {
  if (!ts) return '∞';
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function DeviceIcon({ ua }: { ua?: string | null }) {
  const device = formatDevice(ua);
  if (device === 'Mobile' || device.endsWith('Phone') || device === 'Android' || device === 'iOS' || device === 'iPadOS') {
    return <Smartphone size={14} className="text-zinc-400" />;
  }
  if (device === 'Windows' || device === 'macOS' || device === 'Linux') return <Monitor size={14} className="text-zinc-400" />;
  return <Tablet size={14} className="text-zinc-400" />;
}

/**
 * SessionsModal — Ь« Dialog revue "Sessions" возможности 1 + его): сейчас вывод списка всех сессий для реализации.
 */
export const SessionsModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const listSessions = useAuthStore((s) => s.listSessions);

  const dialogTitle = t('sessions.title');
  const tS = (key: string) => t(`sessions.${key}`);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await listSessions();
    setRows(Array.isArray(res?.sessions) ? res.sessions as SessionRow[] : []);
    setLoading(false);
  }, [listSessions]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleRevoke = async (token: string) => {
    setRevoking(token);
    const res = await window.electronAuth?.revokeSession?.(token);
    if (res?.success) {
      setRows((r) => r.filter((x) => x.token !== token));
      void refresh();
    }
    setRevoking(null);
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 3000);
    });
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6 bg-black/40 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        className="w-full max-w-md rounded-2xl surface-pop border border-zinc-200 dark:border-zinc-700 shadow-float animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{dialogTitle}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-3">
          {loading && rows.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">{t('common.loading')}</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">{tS('none')}</p>}

          {rows.map((s) => {
            return (
              <div
                key={s.token}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-3.5 flex items-center gap-3"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                    {s.fullName || s.username || '—'}
                    {s.isCurrent && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-semibold">
                        {tS('current')}
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <DeviceIcon ua={s.userAgent} />
                    {s.ipAddress && <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">· {s.ipAddress}</span>}
                  </p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {tS('created')}: {formatDateTime(s.createdAt)} · {tS('lastActive')}: {formatDateTime(s.lastActivityAt)} · {tS('expiresIn')}: {formatExpires(s.expiresAt)}
                  </p>
                  {s.role && <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{s.role}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.isCurrent ? (
                    <span className="text-[11px] px-2.5 py-2 rounded-xl font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                      {tS('current')}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleRevoke(s.token)}
                      disabled={revoking === s.token}
                      className="px-2.5 py-2 rounded-xl text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
                      aria-label={tS('revoke')}
                    >
                      {revoking === s.token ? <span className="animate-spin text-[10px]">⏳</span> : tS('revoke')}
                    </button>
                  )}
                  <button
                    onClick={() => copyToken(s.token)}
                    className="p-2 rounded-lg text-zinc-400 hover:text-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    title={t('common.copy')}
                    aria-label={t('common.copy')}
                  >
                    {copiedToken === s.token ? <CopyCheck size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 pt-2">
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SessionsModal;
