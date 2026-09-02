import React, { useEffect, useState } from 'react';
import { useToastStore, type ToastType } from '@/core/store/toastStore';
import { X, CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={20} className="text-emerald-500" />,
  error: <XCircle size={20} className="text-red-500" />,
  info: <Info size={20} className="text-blue-500" />,
  warning: <AlertTriangle size={20} className="text-amber-500" />,
};

const BG_CLASSES: Record<ToastType, string> = {
  success: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60',
  error: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60',
  info: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60',
  warning: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60',
};

function ToastItem({ id, type, message, duration }: { id: string; type: ToastType; message: string; duration: number }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [exiting, setExiting] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => removeToast(id), 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, removeToast]);

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => removeToast(id), 300);
  };

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-float
        ${BG_CLASSES[type]}
        ${exiting ? 'animate-toast-down lg:animate-slide-out' : 'animate-toast-up lg:animate-slide-in'}
        max-w-sm w-full pointer-events-auto backdrop-blur-md`}
    >
      <span className="shrink-0 mt-0.5">{ICONS[type]}</span>
      <p className="flex-1 text-sm text-zinc-800 dark:text-zinc-100 leading-relaxed">{message}</p>
      <button
        onClick={handleClose}
        title={t('common.close')}
        aria-label={t('common.close')}
        className="shrink-0 -mt-1 -me-1 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-white/40 dark:hover:bg-black/20 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export const ToastContainer: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    // Mobile: above bottom nav (with safe-area) / Desktop: top-center
    <div
      className="fixed z-[9999] flex flex-col gap-2 pointer-events-none items-center px-3
        bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-auto lg:top-4 lg:inset-x-0 lg:px-0"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} type={t.type} message={t.message} duration={t.duration} />
      ))}
    </div>
  );
};
