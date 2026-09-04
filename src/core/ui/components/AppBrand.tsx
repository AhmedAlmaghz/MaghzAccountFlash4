import React from 'react';
import { Building2 } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { APP_VERSION_LABEL } from '@/core/brand';
import { cn } from '@/core/utils';

export type AppBrandVariant = 'full' | 'compact' | 'login';

interface AppBrandProps {
  variant?: AppBrandVariant;
  className?: string;
}

/**
 * Unified app brand — the ONLY place that renders the app icon + name.
 *
 * - `full`: sidebar / drawer header — icon + name + dynamic version below.
 * - `compact`: collapsed sidebar — icon only (tooltip carries name + version).
 * - `login`: centered hero — large icon + name + subtitle + version badge.
 */
export const AppBrand: React.FC<AppBrandProps> = ({ variant = 'full', className }) => {
  const { t } = useTranslation();
  const name = t('appName');
  const subtitle = t('appSubtitle');
  const versionTitle = t('appVersion', { version: APP_VERSION_LABEL });

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'brand-gradient w-9 h-9 rounded-xl flex items-center justify-center mx-auto shadow-lift',
          className,
        )}
        title={`${name} ${APP_VERSION_LABEL}`}
        aria-label={`${name} ${APP_VERSION_LABEL}`}
        role="img"
      >
        <Building2 size={18} className="text-white" aria-hidden />
      </div>
    );
  }

  if (variant === 'login') {
    return (
      <div className={cn('text-center', className)}>
        <div className="brand-gradient w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lift">
          <Building2 size={40} className="text-white" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{name}</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">{subtitle}</p>
        <p
          className="mt-2 inline-block text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
          title={versionTitle}
          aria-label={versionTitle}
        >
          {APP_VERSION_LABEL}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2.5 min-w-0', className)}>
      <div className="brand-gradient w-9 h-9 rounded-xl flex items-center justify-center shadow-lift shrink-0">
        <Building2 size={18} className="text-white" aria-hidden />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="font-bold text-base text-zinc-900 dark:text-white truncate">{name}</p>
        <p
          className="text-[11px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500"
          title={versionTitle}
          aria-label={versionTitle}
        >
          {APP_VERSION_LABEL}
        </p>
      </div>
    </div>
  );
};

export default AppBrand;
