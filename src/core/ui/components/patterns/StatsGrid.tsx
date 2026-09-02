import React from 'react';
import { cn } from '@/core/utils';

export interface StatItem {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  /** Tailwind gradient classes for the icon tile, e.g. 'from-emerald-500 to-teal-600' */
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'gold';
  onClick?: () => void;
}

const TONES: Record<NonNullable<StatItem['tone']>, string> = {
  primary: 'from-primary-500 to-primary-700',
  success: 'from-emerald-500 to-teal-700',
  warning: 'from-amber-400 to-amber-600',
  danger: 'from-rose-500 to-red-700',
  info: 'from-sky-500 to-blue-700',
  gold: 'from-gold-400 to-gold-600',
};

export interface StatsGridProps {
  items: StatItem[];
  /** Column count at lg breakpoint — default 4 */
  columns?: 2 | 3 | 4;
  className?: string;
}

/**
 * Responsive KPI grid. 1 → 2 (sm) → 3/4 (lg) columns with hover lift.
 */
export const StatsGrid: React.FC<StatsGridProps> = ({ items, columns = 4, className }) => {
  const lgCols = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[columns];

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4', lgCols, className)}>
      {items.map((item, i) => {
        const Wrapper: React.ElementType = item.onClick ? 'button' : 'div';
        return (
          <Wrapper
            key={i}
            onClick={item.onClick}
            className={cn(
              'group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-card',
              'transition-all duration-200 text-start w-full',
              item.onClick && 'cursor-pointer hover:shadow-lift hover:border-primary-200 dark:hover:border-primary-800 active:scale-[0.99]',
              'animate-fade-in'
            )}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate">{item.label}</div>
                <div className="text-xl sm:text-2xl font-bold mt-1.5 tabular text-zinc-900 dark:text-zinc-50 truncate">
                  {item.value}
                </div>
                {item.hint && (
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 truncate">{item.hint}</div>
                )}
              </div>
              {item.icon && (
                <div
                  className={cn(
                    'w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br text-white flex items-center justify-center shadow-card transition-transform duration-200',
                    'group-hover:scale-105',
                    TONES[item.tone ?? 'primary']
                  )}
                >
                  {item.icon}
                </div>
              )}
            </div>
          </Wrapper>
        );
      })}
    </div>
  );
};

export default StatsGrid;
