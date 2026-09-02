import React from 'react';
import { cn } from '@/core/utils';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Fixed height on mobile, taller on desktop — default 'md' */
  height?: 'sm' | 'md' | 'lg';
  className?: string;
}

const HEIGHTS = {
  sm: 'h-56 sm:h-64',
  md: 'h-64 sm:h-80',
  lg: 'h-72 sm:h-96',
};

/**
 * Chart container card with responsive height.
 * Wrap Recharts <ResponsiveContainer> charts; theme-aware colors come from
 * CSS vars (--chart-1..8) defined in index.css.
 */
export const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, actions, children, height = 'md', className }) => (
  <div
    className={cn(
      'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-card',
      'transition-all duration-200 hover:shadow-lift',
      className
    )}
  >
    <div className="flex items-start justify-between gap-2 px-4 sm:px-5 pt-4 pb-2">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
    </div>
    <div className={cn('px-2 sm:px-4 pb-4', HEIGHTS[height])}>{children}</div>
  </div>
);

/** Reads the theme-aware chart palette from CSS variables. */
export default ChartCard;
