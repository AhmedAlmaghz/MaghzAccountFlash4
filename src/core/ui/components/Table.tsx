import React, { memo } from 'react';
import { cn } from '@/core/utils';

export interface TableProps<T> {
  data: T[];
  columns: {
    key: string;
    header: string;
    width?: string;
    align?: 'left' | 'center' | 'right';
    render?: (row: T, index: number) => React.ReactNode;
  }[];
  keyExtractor: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  onRowClick?: (row: T) => void;
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
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
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
    <div className={cn('overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900', className)}>
      <table className="w-full border-collapse text-start">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800">
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={cn(
                  'px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase whitespace-nowrap',
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
                'border-b border-slate-200 dark:border-slate-800 transition-colors',
                onRowClick && 'cursor-pointer',
                'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-3.5 text-sm text-slate-700 dark:text-slate-200 whitespace-nowrap',
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
  );
}

export const Table = memo(TableNoMemo) as typeof TableNoMemo;
