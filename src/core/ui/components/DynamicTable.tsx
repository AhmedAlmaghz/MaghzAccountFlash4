import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Filter, RotateCcw, Search, X } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import type { TableProps, ColumnMobileRole } from './Table';

/**
 * System-wide dynamic table.
 *
 * One shared header for every list in the app. It keeps the existing `Table`
 * contract (`data` / `columns` with `render(row, index)` / `keyExtractor`) and
 * adds, per `tableKey`, persisted user preferences in `localStorage`:
 *   - column visibility (show/hide any field),
 *   - per-column text filter,
 *   - sorting (asc/desc) by clicking the header,
 *   - page size + filter restore.
 *
 * Storage key: `maghzaccount.table.<tableKey>`. Without `tableKey` nothing is
 * persisted (back-compat with plain `Table` usage).
 */

export type DynamicColumnMobileRole = ColumnMobileRole;

export interface DynamicTableProps<T> extends TableProps<T> {
  /** Unique key used to persist column/sort/filter preferences. */
  tableKey?: string;
  /** Extra toolbar node rendered on the left. */
  toolbarStart?: React.ReactNode;
  /** Extra toolbar node rendered on the right. */
  toolbarEnd?: React.ReactNode;
  /** Hide the built-in column chooser. */
  hideColumnChooser?: boolean;
  /** Hide per-column filter row. */
  hideColumnFilters?: boolean;
  /** Disable client-side sorting. */
  disableSorting?: boolean;
  /** Title shown above the table. */
  title?: string;
}

interface PersistedState {
  hidden?: string[];
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc';
  filters?: Record<string, string>;
}

const STORAGE_PREFIX = 'maghzaccount.table.';

function readPersisted(tableKey?: string): PersistedState {
  if (!tableKey) return {};
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableKey);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

function writePersisted(tableKey: string | undefined, state: PersistedState): void {
  if (!tableKey) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + tableKey, JSON.stringify(state));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

function rawCellValue<T>(row: T, key: string): unknown {
  const val = (row as Record<string, unknown>)[key];
  return val;
}

function cellText<T>(row: T, key: string): string {
  const val = rawCellValue(row, key);
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val); } catch { return ''; }
}

function renderCell<T>(row: T, col: TableProps<T>['columns'][number], index: number): React.ReactNode {
  if (col.render) return col.render(row, index);
  const val = rawCellValue(row, col.key);
  if (val === null || val === undefined) return '-';
  if (val instanceof Date) return val.toLocaleDateString();
  return String(val);
}

function DynamicTableNoMemo<T>(props: DynamicTableProps<T>) {
  const {
    data,
    columns,
    keyExtractor,
    isLoading,
    emptyMessage,
    className,
    onRowClick,
    tableKey,
    toolbarStart,
    toolbarEnd,
    hideColumnChooser,
    hideColumnFilters,
    disableSorting,
    title,
  } = props;

  const { t } = useTranslation();
  const resolvedEmptyMessage = emptyMessage ?? t('common.noData');

  const persisted = useMemo(() => readPersisted(tableKey), [tableKey]);
  const [hidden, setHidden] = useState<string[]>(persisted.hidden ?? []);
  const [sortKey, setSortKey] = useState<string | null>(persisted.sortKey ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(persisted.sortDir ?? 'asc');
  const [filters, setFilters] = useState<Record<string, string>>(persisted.filters ?? {});
  const [showChooser, setShowChooser] = useState(false);
  const [showFilters, setShowFilters] = useState(!hideColumnFilters && (persisted.filters && Object.values(persisted.filters).some(Boolean) ? true : false));
  const chooserRef = useRef<HTMLDivElement>(null);

  // Re-sync when tableKey changes.
  useEffect(() => {
    const p = readPersisted(tableKey);
    setHidden(p.hidden ?? []);
    setSortKey(p.sortKey ?? null);
    setSortDir(p.sortDir ?? 'asc');
    setFilters(p.filters ?? {});
    setShowFilters(!hideColumnFilters && !!p.filters && Object.values(p.filters).some(Boolean));
  }, [tableKey, hideColumnFilters]);

  // Persist.
  useEffect(() => {
    writePersisted(tableKey, { hidden, sortKey, sortDir, filters });
  }, [tableKey, hidden, sortKey, sortDir, filters]);

  // Close chooser on outside click.
  useEffect(() => {
    if (!showChooser) return;
    const onDoc = (e: MouseEvent) => {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setShowChooser(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showChooser]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hidden.includes(c.key)),
    [columns, hidden]
  );

  const toggleColumn = useCallback((key: string) => {
    setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const toggleSort = useCallback((key: string) => {
    if (disableSorting) return;
    setSortKey((prevKey) => {
      if (prevKey !== key) { setSortDir('asc'); return key; }
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return prevKey;
    });
  }, [disableSorting]);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetPrefs = useCallback(() => {
    setHidden([]);
    setSortKey(null);
    setSortDir('asc');
    setFilters({});
    setShowFilters(false);
    if (tableKey) { try { localStorage.removeItem(STORAGE_PREFIX + tableKey); } catch { /* ignore */ } }
  }, [tableKey]);

  const processed = useMemo(() => {
    let rows = [...data];
    // filters
    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== '');
    if (activeFilters.length) {
      rows = rows.filter((row) =>
        activeFilters.every(([key, val]) =>
          cellText(row, key).toLowerCase().includes(val.trim().toLowerCase())
        )
      );
    }
    // sorting
    if (sortKey) {
      const key = sortKey;
      rows.sort((a, b) => {
        const av = cellText(a, key).toLowerCase();
        const bv = cellText(b, key).toLowerCase();
        // numeric-aware
        const an = Number(av); const bn = Number(bv);
        let cmp: number;
        if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn;
        else cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, filters, sortKey, sortDir]);

  if (isLoading) {
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

  const alignClass = { left: 'text-start', center: 'text-center', right: 'text-end' };

  return (
    <div className={cn('space-y-3', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {title && <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{title}</h3>}
          {toolbarStart}
        </div>
        <div className="flex items-center gap-1">
          {toolbarEnd}
          {!hideColumnFilters && (
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={cn('min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg border text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800', showFilters ? 'border-primary-300 bg-primary-50 dark:bg-primary-900/20 text-primary-600' : 'border-zinc-200 dark:border-zinc-700')}
              title={t('table.filter', { default: 'فلترة' })}
              aria-label={t('table.filter', { default: 'فلترة' })}
            >
              <Filter className="w-4 h-4" />
            </button>
          )}
          {!hideColumnChooser && (
            <div className="relative" ref={chooserRef}>
              <button
                type="button"
                onClick={() => setShowChooser((v) => !v)}
                className={cn('min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg border text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800', showChooser ? 'border-primary-300 bg-primary-50 dark:bg-primary-900/20 text-primary-600' : 'border-zinc-200 dark:border-zinc-700')}
                title={t('table.columns', { default: 'الأعمدة' })}
                aria-label={t('table.columns', { default: 'الأعمدة' })}
              >
                <Columns3 className="w-4 h-4" />
              </button>
              {showChooser && (
                <div className="absolute z-30 end-0 mt-1 w-56 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-2 max-h-80 overflow-auto">
                  <div className="flex items-center justify-between px-1 pb-2 border-b border-zinc-100 dark:border-zinc-800 mb-1">
                    <span className="text-xs font-semibold text-zinc-500">{t('table.columns', { default: 'الأعمدة' })}</span>
                    <button type="button" onClick={resetPrefs} className="text-[11px] text-primary-600 hover:underline inline-flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" />{t('table.reset', { default: 'إعادة ضبط' })}
                    </button>
                  </div>
                  {columns.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 px-1 py-1.5 text-sm rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer">
                      <input type="checkbox" checked={!hidden.includes(col.key)} onChange={() => toggleColumn(col.key)} className="rounded" />
                      <span className="truncate">{col.header}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {tableKey && (
            <button
              type="button"
              onClick={resetPrefs}
              className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              title={t('table.reset', { default: 'إعادة ضبط' })}
              aria-label={t('table.reset', { default: 'إعادة ضبط' })}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mobile cards (visible columns) */}
      <div className="md:hidden">
        {processed.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-zinc-400 text-sm">{resolvedEmptyMessage}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {processed.map((row, rowIndex) => {
              const titleCol = visibleColumns.find((c) => c.mobile === 'title') ?? visibleColumns[0];
              const statusCol = visibleColumns.find((c) => c.mobile === 'status');
              const actionsCol = visibleColumns.find((c) => c.mobile === 'actions');
              const metaCols = visibleColumns.filter((c) => c.mobile !== 'hidden' && c !== titleCol && c !== statusCol && c !== actionsCol);
              return (
                <div key={keyExtractor(row, rowIndex)} onClick={() => onRowClick?.(row)} className={cn('bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-card', onRowClick && 'cursor-pointer')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{titleCol ? renderCell(row, titleCol, rowIndex) : '-'}</div>
                    {statusCol && <div className="shrink-0">{renderCell(row, statusCol, rowIndex)}</div>}
                  </div>
                  {metaCols.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
                      {metaCols.map((col) => (
                        <div key={col.key} className="min-w-0">
                          <div className="text-[10px] uppercase font-semibold text-zinc-400 mb-0.5">{col.header}</div>
                          <div className="text-xs text-zinc-800 dark:text-zinc-200 truncate tabular">{renderCell(row, col, rowIndex)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {actionsCol && <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800" onClick={(e) => e.stopPropagation()}>{renderCell(row, actionsCol, rowIndex)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/70 border-b border-zinc-200 dark:border-zinc-800">
              {visibleColumns.map((col) => {
                const sorted = sortKey === col.key;
                return (
                  <th key={col.key} style={{ width: col.width }} className={cn('px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap', alignClass[col.align || 'left'])}>
                    <button type="button" onClick={() => toggleSort(col.key)} disabled={disableSorting} className={cn('inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200', !disableSorting && 'cursor-pointer')} title={t('table.sort', { default: 'ترتيب' })}>
                      <span>{col.header}</span>
                      {!disableSorting && (sorted ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
            {showFilters && !hideColumnFilters && (
              <tr className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                {visibleColumns.map((col) => (
                  <th key={col.key} className="px-2 py-1.5">
                    <div className="relative">
                      <Search className="absolute start-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                      <input
                        value={filters[col.key] ?? ''}
                        onChange={(e) => setFilter(col.key, e.target.value)}
                        placeholder={t('table.filter', { default: 'فلترة' })}
                        className="w-full min-h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 ps-7 pe-2 text-xs font-normal"
                      />
                      {(filters[col.key] ?? '') && (
                        <button type="button" onClick={() => setFilter(col.key, '')} className="absolute end-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {processed.length === 0 ? (
              <tr><td colSpan={visibleColumns.length || 1} className="px-4 py-12 text-center text-zinc-400 text-sm">{resolvedEmptyMessage}</td></tr>
            ) : (
              processed.map((row, rowIndex) => (
                <tr key={keyExtractor(row, rowIndex)} onClick={() => onRowClick?.(row)} className={cn('border-b border-zinc-200 dark:border-zinc-800 transition-colors hover:bg-primary-50/50 dark:hover:bg-primary-950/30', onRowClick && 'cursor-pointer')}>
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={cn('px-4 py-3.5 text-sm text-zinc-700 dark:text-zinc-200 whitespace-nowrap', alignClass[col.align || 'left'])}>
                      {renderCell(row, col, rowIndex)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {processed.length !== data.length && (
        <div className="text-xs text-zinc-400 text-end">{processed.length} / {data.length}</div>
      )}
    </div>
  );
}

export const DynamicTable = memo(DynamicTableNoMemo) as typeof DynamicTableNoMemo;
export default DynamicTable;
