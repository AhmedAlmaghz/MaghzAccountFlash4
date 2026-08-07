import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { cn } from '@/core/utils';
import {
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Search,
  FileSpreadsheet,
  FileText,
  Printer,
} from 'lucide-react';
import { Button } from './Button';

interface DataTableProProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  keyExtractor: (row: TData) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  pageSizeOptions?: number[];
  onRowClick?: (row: TData) => void;
  onExportExcel?: () => void;
  onExportPdf?: () => void;
  onPrint?: () => void;
  className?: string;
  title?: string;
}

export function DataTablePro<TData>({
  data,
  columns,
  keyExtractor,
  isLoading,
  emptyMessage = 'لا توجد بيانات',
  searchable = true,
  searchPlaceholder = 'بحث...',
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  onRowClick,
  onExportExcel,
  onExportPdf,
  onPrint,
  className,
  title,
}: DataTableProProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => keyExtractor(row as TData),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
        <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
        <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
        <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
        <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="empty-state">
        <p className="text-lg font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {title && <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h3>}
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {searchable && (
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="form-control pr-9 w-full sm:w-64"
              />
            </div>
          )}
          
          <div className="flex items-center gap-1">
            {onExportExcel && (
              <Button size="sm" variant="ghost" onClick={onExportExcel} title="تصدير Excel">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              </Button>
            )}
            {onExportPdf && (
              <Button size="sm" variant="ghost" onClick={onExportPdf} title="تصدير PDF">
                <FileText className="w-4 h-4 text-rose-600" />
              </Button>
            )}
            {onPrint && (
              <Button size="sm" variant="ghost" onClick={onPrint} title="طباعة">
                <Printer className="w-4 h-4 text-slate-600" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      'cursor-pointer select-none',
                      header.column.getIsSorted() && 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{ width: header.getSize() }}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && (
                        <ChevronUp className="w-3 h-3" />
                      )}
                      {header.column.getIsSorted() === 'desc' && (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={cn(
                  'transition-colors',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span>عرض</span>
          <select
            value={table.getState().pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="form-control w-16 py-1"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <span>من {table.getFilteredRowModel().rows.length} سجل</span>
        </div>
        
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-md font-medium tabular">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
