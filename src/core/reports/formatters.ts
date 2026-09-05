import { getCompanyDecimalPlaces } from '../utils/locale';
import type { ReportCellFormat, ReportColumnDef } from './types';

/**
 * Single formatting truth for every tabular surface (screen helpers,
 * Excel/CSV/PDF cells, HTML documents).
 *
 * Digit policy (deliberate, world-class ERP practice):
 * - Machine formats (Excel / CSV / grid PDF): Latin digits (en-US) so
 *   values stay computable in Excel and render under jsPDF's helvetica,
 *   which has no Arabic-Indic glyphs.
 * - Human documents (HTML / browser print): Arabic-Indic digits via
 *   `formatHumanNumber`, honouring the company's decimal places.
 */

export function clampDecimals(decimals?: number): number {
  if (decimals === undefined || decimals === null || !Number.isFinite(decimals)) {
    return getCompanyDecimalPlaces();
  }
  return Math.min(6, Math.max(0, Math.trunc(decimals)));
}

export function formatReportMoney(value: unknown, decimals?: number, currency?: string): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof num !== 'number' || isNaN(num)) return String(value);
  const dp = clampDecimals(decimals);
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function formatReportNumber(value: unknown, decimals?: number): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof num !== 'number' || isNaN(num)) return String(value);
  const dp = clampDecimals(decimals);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Quantities keep up to 4 decimals, trailing zeros trimmed. */
export function formatReportQuantity(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof num !== 'number' || isNaN(num)) return String(value);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

/** Human-readable number with Arabic-Indic digits (HTML / print). */
export function formatHumanNumber(value: unknown, decimals?: number): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof num !== 'number' || isNaN(num)) return String(value);
  const dp = clampDecimals(decimals);
  return new Intl.NumberFormat('ar-YE', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(num);
}

/** ISO-ish date honouring the company's date format (YYYY-MM-DD family). */
export function formatReportDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatReportCell(
  value: unknown,
  column: Pick<ReportColumnDef, 'format' | 'decimals' | 'currency' | 'render'>,
  row?: Record<string, unknown>,
): string {
  if (column.render) return column.render(value, row);
  const format: ReportCellFormat = column.format ?? 'text';
  switch (format) {
    case 'money':
      return formatReportMoney(value, column.decimals, column.currency);
    case 'number':
      return formatReportNumber(value, column.decimals);
    case 'quantity':
      return formatReportQuantity(value);
    case 'date':
      return formatReportDate(value);
    case 'datetime': {
      if (value === null || value === undefined || value === '') return '';
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      return `${formatReportDate(value)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    case 'percent': {
      if (value === null || value === undefined || value === '') return '';
      const num = typeof value === 'string' ? Number(value) : (value as number);
      if (typeof num !== 'number' || isNaN(num)) return String(value);
      return `${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }
    case 'text':
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}
