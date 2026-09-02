import React, { memo } from 'react';
import { cn } from '@/core/utils';

/**
 * Mobile display role for a column in card mode (below md breakpoint).
 *  - 'title'    : primary row title of the card (usually first visible)
 *  - 'subtitle' : secondary line under the title
 *  - 'meta'     : key/value chip rendered in the card meta grid
 *  - 'status'   : badge pinned to the card top corner
 *  - 'actions'  : action buttons pinned to the card footer
 *  - 'hidden'   : not rendered on mobile
 * Columns without a mobile role default to 'meta'.
 */
export type ColumnMobileRole = 'title' | 'subtitle' | 'status' | 'meta' | 'actions' | 'hidden';

export interface TableProps<T> {
  data: T[];
  columns: {
    key: string;
    header: string;
    width?: string;
    align?: 'left' | 'center' | 'right';
    render?: (row: T, index: number) => React.ReactNode;
    mobile?: ColumnMobileRole;
  }[];
  keyExtractor: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  onRowClick?: (row: T) => void;
}

function cellValue<T>(row: T, col: TableProps<T>['columns'][number]): React.ReactNode {
  if (col.render) return col.render(row, 0);
  const val = (row as Record<string, unknown>)[col.key];
  if (val === null || val === undefined) return '-';
  if (val instanceof Date) return val.toLocaleDateString();
  return String(val);
}

/* ---------------- Skeleton loading ---------------- */
function TableSkeleton() {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 p-4 space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="skeleton h-5 w-2/5" />
          <div className="skeleton h-5 w-1/5" />
          <div className="skeleton h-5 w-1/4 ms-auto" />
        </div>
      ))}
    </div>
  );
}

/* ---------------- Mobile card list ---------------- */
function MobileCards<T>({
  data,
  columns,
  keyExtractor,
  onRowClick,
  emptyMessage,
}: Pick<TableProps<T>, 'data' | 'columns' | 'keyExtractor' | 'onRowClick'> & { emptyMessage: string }) {
  const titleCol = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const subtitleCol = columns.find((c) => c.mobile === 'subtitle');
  const statusCol = columns.find((c) => c.mobile === 'status');
  const actionsCol = columns.find((c) => c.mobile === 'actions');
  const metaCols = columns.filter(
    (c) => c.mobile !== 'hidden' && c !== titleCol && c !== subtitleCol && c !== statusCol && c !== actionsCol
  );

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-400 text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((row, rowIndex) => (
        <div
          key={keyExtractor(row, rowIndex)}
          onClick={() => onRowClick?.(row)}
          className={cn(
            'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-card',
            'transition-all duration-150 active:scale-[0.99]',
            onRowClick && 'cursor-pointer hover:shadow-lift hover:border-primary-200 dark:hover:border-primary-800'
          )}
        >
          {/* Card head: title + status badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 font-semibold truncate">
                {titleCol ? cellValue(row, titleCol) : '-'}
              </div>
              {subtitleCol && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                  {cellValue(row, subtitleCol)}
                </div>
              )}
            </div>
            {statusCol && <div className="shrink-0">{cellValue(row, statusCol)}</div>}
          </div>

          {/* Meta grid */}
          {metaCols.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
              {metaCols.map((col) => (
                <div key={col.key} className="min-w-0">
                  <div className="text-[10px] uppercase font-semibold text-zinc-400 dark:text-zinc-500 mb-0.5">
                    {col.header}
                  </div>
                  <div className="text-xs text-zinc-800 dark:text-zinc-200 truncate tabular">
                    {cellValue(row, col)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pinned actions row */}
          {actionsCol && (
            <div
              className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              {cellValue(row, actionsCol)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TableNoMemo<T>({
  data,
  columns,
  keyExtractor,
  isLoading,
  emptyMessage = 'لا توجد بيانات',
  className,
  onRowClick,
}: TableProps<T>) {
  if (isLoading) return <TableSkeleton />;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-400">
        {emptyMessage}
      </div>
    );
  }

  const alignClass = {
    left: 'text-start',
    center: 'text-center',
    right: 'text-end',
  };

  return (
    <>
      {/* Mobile: stacked cards */}
      <div className={cn('md:hidden', className)}>
        <MobileCards
          data={data}
          columns={columns}
          keyExtractor={keyExtractor}
          onRowClick={onRowClick}
          emptyMessage={emptyMessage}
        />
      </div>

      {/* Desktop: classic table */}
      <div
        className={cn(
          'hidden md:block overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900',
          className
        )}
      >
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/70 border-b border-zinc-200 dark:border-zinc-800">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={cn(
                    'px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap',
                    alignClass[col.align || 'left']
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => (
              <tr
                key={keyExtractor(row, rowIndex)}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'border-b border-zinc-200 dark:border-zinc-800 transition-colors',
                  onRowClick && 'cursor-pointer',
                  'hover:bg-primary-50/50 dark:hover:bg-primary-950/30'
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3.5 text-sm text-zinc-700 dark:text-zinc-200 whitespace-nowrap',
                      alignClass[col.align || 'left']
                    )}
                  >
                    {col.render ? col.render(row, rowIndex) : (() => {
                      const val = (row as Record<string, unknown>)[col.key];
                      if (val === null || val === undefined) return '-';
                      if (val instanceof Date) return val.toLocaleDateString();
                      return String(val);
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const Table = memo(TableNoMemo) as typeof TableNoMemo;
