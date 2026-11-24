/**
 * Shared types for modern professional reports.
 * Every report page builds on this engine.
 */
export interface LiveReportData<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  /** True once data loaded without error (for empty states). */
  isReady: boolean;
}

export interface LiveFilters {
  from?: string;
  to?: string;
  customerId?: string;
  supplierId?: string;
  productId?: string;
  warehouseId?: string;
  currency?: string;
  month?: string;
  employeeId?: string;
  status?: string;
  search?: string;
  type?: string;
  period?: string;
  [key: string]: unknown;
}

export interface ReportRow {
  [key: string]: unknown;
}

export interface ReportColumnDef {
  key: string;
  header: string;
  width?: number;
  align?: 'start' | 'center' | 'end';
  format?: 'money' | 'number' | 'quantity' | 'date' | 'percent' | 'text';
  currency?: string;
  render?: (value: unknown, row?: ReportRow) => string;
}

export type ReportSection = 'finance' | 'inventory' | 'manufacturing' | 'hr' | 'sales' | 'crm' | 'legal';

export interface ReportCatalogEntry {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: React.ComponentType<{ className?: string }>;
  section: ReportSection;
}

declare global {
  interface Window {
    __reportFiltersState?: unknown;
  }
}
