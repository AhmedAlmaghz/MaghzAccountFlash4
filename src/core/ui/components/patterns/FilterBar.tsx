import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';

export interface FilterOption {
  key: string;
  label: string;
  count?: number;
}

export interface FilterBarProps {
  /** Search value (controlled) */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Pill filter options; activeKey highlights one */
  filterOptions?: FilterOption[];
  activeFilter?: string;
  onFilterChange?: (key: string) => void;
  /** Export/actions — hidden into a row below on mobile */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Unified filter bar: search + pill filters + actions.
 * Stacks vertically on mobile; horizontal scroll for pills.
 */
export const FilterBar: React.FC<FilterBarProps> = ({
  search,
  onSearchChange,
  searchPlaceholder,
  filterOptions,
  activeFilter,
  onFilterChange,
  actions,
  className,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 sm:p-4 shadow-card',
        className
      )}
    >
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Search */}
        {onSearchChange && (
          <div className="relative flex-1 min-w-0">
            <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-zinc-400">
              <Search size={16} />
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder ?? t('common.search')}
              className="w-full min-h-11 ps-10 pe-10 text-base sm:text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
              aria-label={searchPlaceholder ?? t('common.search')}
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute inset-y-0 end-0 pe-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                aria-label={t('common.clear')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* Pills */}
        {filterOptions && filterOptions.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0">
            {filterOptions.map((opt) => {
              const active = activeFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => onFilterChange?.(opt.key)}
                  className={cn(
                    'shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold min-h-9 whitespace-nowrap transition-all active:scale-95',
                    active
                      ? 'bg-primary-600 text-white shadow-lift'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  )}
                  aria-pressed={active}
                >
                  {opt.label}
                  {opt.count !== undefined && (
                    <span
                      className={cn(
                        'ms-1.5 px-1.5 py-0.5 rounded-full text-[10px] tabular',
                        active ? 'bg-white/20 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                      )}
                    >
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Actions */}
        {actions && (
          <div className="flex items-center gap-2 sm:shrink-0 overflow-x-auto no-scrollbar">{actions}</div>
        )}
      </div>
    </div>
  );
};

export default FilterBar;
