import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showSizeChanger?: boolean;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  showSizeChanger = true,
  className = '',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const { t } = useTranslation();
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const navBtn =
    'flex items-center justify-center w-10 h-10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-700/60',
        className
      )}
    >
      <div className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 tabular">
        {total === 0
          ? t('common.noResults')
          : t('pagination.range', { start: String(start), end: String(end), total: String(total) })}
      </div>

      <div className="flex items-center gap-1">
        <button className={cn(navBtn, 'hidden sm:flex')} onClick={() => onPageChange(1)} disabled={!canPrev} title={t('pagination.first')} aria-label="First page">
          <ChevronsRight size={18} />
        </button>
        <button className={navBtn} onClick={() => onPageChange(page - 1)} disabled={!canPrev} title={t('pagination.previous')} aria-label="Previous page">
          <ChevronRight size={18} />
        </button>
        <span className="text-xs sm:text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-2 tabular rounded-xl bg-zinc-100 dark:bg-zinc-800 min-w-16 text-center py-1.5">
          {t('pagination.pageOf', { page: String(page), total: String(totalPages) })}
        </span>
        <button className={navBtn} onClick={() => onPageChange(page + 1)} disabled={!canNext} title={t('pagination.next')} aria-label="Next page">
          <ChevronLeft size={18} />
        </button>
        <button className={cn(navBtn, 'hidden sm:flex')} onClick={() => onPageChange(totalPages)} disabled={!canNext} title={t('pagination.last')} aria-label="Last page">
          <ChevronsLeft size={18} />
        </button>
      </div>

      {showSizeChanger && onPageSizeChange && (
        <div className="flex items-center gap-2">
          <label className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">{t('pagination.pageSize')}</label>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="text-xs sm:text-sm border border-zinc-300 dark:border-zinc-600 rounded-xl px-2 py-2 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 min-h-9"
            aria-label="Page size"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default Pagination;
