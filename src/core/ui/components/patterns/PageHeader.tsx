import React from 'react';
import { cn } from '@/core/utils';

export interface PageHeaderProps {
  /** Gradient tile icon */
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Action buttons (create/export) — stack full-width on mobile */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Unified page header: icon tile + title + actions.
 * Responsive: stacks vertically with full-width actions on mobile.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ icon, title, subtitle, actions, className }) => (
  <div className={cn('flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6', className)}>
    <div className="flex items-center gap-3 min-w-0 flex-1">
      {icon && (
        <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center shadow-lift">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50 truncate">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">{subtitle}</p>}
      </div>
    </div>
    {actions && (
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:shrink-0">
        {actions}
      </div>
    )}
  </div>
);

export default PageHeader;
