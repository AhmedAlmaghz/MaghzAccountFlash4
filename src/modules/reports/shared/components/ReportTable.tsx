import React, { useMemo } from 'react';
import { useFormatters } from '@/core/utils/useFormatters';
import { cn } from '@/core/utils';
import type { ReportColumnDef, ReportRow } from '../types';

export interface ReportTableProps {
  columns: ReportColumnDef[];
  rows: object[];
  totals?: { label: string; values: Record<string, number | string> };
  title?: string;
  maxRows?: number;
  actions?: React.ReactNode;
}

function buildCell(col: ReportColumnDef, row: ReportRow | undefined, formatCurrencyFn: (v: number | string, c?: string) => string): string {
  const value = row?.[col.key];
  if (value === null || value === undefined || value === '') return '-';
  switch (col.format) {
    case 'money':
      return formatCurrencyFn(value as number | string, col.currency);
    case 'number':
    case 'quantity':
      return new Intl.NumberFormat('ar-YE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));
    case 'date': {
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString('ar-YE');
    }
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    default:
      return String(value);
  }
}

export function ReportTable({ columns, rows, totals, actions, maxRows }: ReportTableProps) {
  const { formatCurrency } = useFormatters();
  const displayRows = useMemo(() => (maxRows ? rows.slice(0, maxRows) : rows), [rows, maxRows]);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-300 text-right">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors border-t border-slate-100 dark:border-slate-800">
              {columns.map((col) => (
                <td key={col.key} className={cn('px-4 py-2.5', col.format === 'money' && 'text-rose-600 dark:text-rose-300 font-medium')}>
                  {buildCell(col, row as unknown as ReportRow, formatCurrency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="bg-slate-100 dark:bg-slate-800 font-bold">
              {columns.map((col, idx) => (
                <td key={col.key} className="px-4 py-2.5">
                  {idx === 0 ? 'إجمالي' : (col.key in totals.values ? buildCell(col, totals.values as unknown as ReportRow, formatCurrency) : '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {actions && <div className="px-4 py-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">{actions}</div>}
    </div>
  );
}
