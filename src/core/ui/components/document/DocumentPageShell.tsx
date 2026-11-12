import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../Button';
import { useTranslation } from '@/core/i18n/useTranslation';

export interface DocumentPageShellProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backLabel?: string;
  statusBadge?: React.ReactNode;
  headerActions?: React.ReactNode;
  footerActions?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared chrome for every full-page document editor.
 *
 * Action placement is breakpoint-exclusive so the same buttons are NEVER
 * rendered twice (a duplicate primary action is a trap: the user clicks a
 * stale copy and wonders why nothing happened):
 *
 *   lg+    → inline in the sticky top bar (always visible).
 *   sm–lg  → their own row under the title, so the title is never squeezed
 *            into an ellipsis by three action buttons.
 *   < sm   → the sticky bottom bar (thumb reach) with the totals pinned
 *            above them.
 */
export const DocumentPageShell: React.FC<DocumentPageShellProps> = ({
  title,
  subtitle,
  onBack,
  backLabel,
  statusBadge,
  headerActions,
  footerActions,
  summary,
  children,
}) => {
  const { t } = useTranslation();
  // The bottom bar falls back to the header actions so an editor that only
  // declares one set still gets reachable actions on a phone.
  const mobileActions = footerActions ?? headerActions;

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} aria-label={backLabel ?? t('common.back')}>
            <ArrowRight size={18} className="rtl:rotate-180" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-base sm:text-lg text-zinc-900 dark:text-zinc-50 truncate">{title}</h1>
            {subtitle && <p className="text-xs sm:text-sm text-zinc-500 truncate">{subtitle}</p>}
          </div>
          {statusBadge}
          <div className="hidden lg:flex items-center gap-2 shrink-0">{headerActions}</div>
        </div>
        {/* Tablet: the actions get their own row so the title keeps its width. */}
        {headerActions && (
          <div className="hidden sm:flex lg:hidden flex-wrap items-center gap-2 px-4 sm:px-6 pb-3">
            {headerActions}
          </div>
        )}
      </header>

      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          <div className="lg:col-span-8 space-y-4 min-w-0">{children}</div>
          <aside className="lg:col-span-4">
            {/* On mobile the summary is pinned to the bottom bar — render it
                here only on large screens to avoid a duplicate panel. */}
            <div className="lg:sticky lg:top-20 space-y-4">
              <div className="hidden lg:block">{summary}</div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile: the totals must be visible WHILE editing lines, so the
          summary is pinned to the bottom bar instead of scrolling away
          below the items grid. */}
      {mobileActions && (
        <div className="sm:hidden sticky bottom-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-t border-zinc-200 dark:border-zinc-800 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {summary && (
            <div className="mb-2 [&>div]:border-0 [&>div]:p-0 [&>div]:shadow-none [&>h3]:hidden">
              {summary}
            </div>
          )}
          <div className="flex gap-2 [&>*]:flex-1 [&>*]:min-w-0">{mobileActions}</div>
        </div>
      )}
    </div>
  );
};
