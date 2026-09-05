/**
 * Unified reporting contracts — every report page, printed document, and
 * file export (Excel / PDF / HTML / CSV) speaks this language.
 *
 * Bilingual/bidirectional design: callers pass already-translated strings
 * (titles, headers, labels); the core owns layout direction, number/date
 * formatting via the company's locale settings, and branding.
 */

/** How a cell value is interpreted for formatting. */
export type ReportCellFormat =
  | 'money'
  | 'number'
  | 'quantity'
  | 'date'
  | 'datetime'
  | 'percent'
  | 'text';

export type ReportAlign = 'start' | 'center' | 'end';

export interface ReportColumnDef {
  key: string;
  /** Already-translated header text. */
  header: string;
  /** Excel column width hint (characters). */
  width?: number;
  align?: ReportAlign;
  format?: ReportCellFormat;
  /** Override for the company's decimal places (money/number). */
  decimals?: number;
  /** ISO currency code override (money). Defaults to the company currency. */
  currency?: string;
  /** Full custom renderer (wins over `format`; receives the raw value + row). */
  render?: (value: unknown, row?: Record<string, unknown>) => string;
}

/** Company identity block printed on every branded document/export. */
export interface ReportBranding {
  companyName: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  currency: string;
}

export interface ReportMeta {
  /** Already-translated report title. */
  title: string;
  /** Already-translated subtitle (company line, filters summary…). */
  subtitle?: string;
  /** Already-translated period label (e.g. "من … إلى …"). */
  periodLabel?: string;
  /** 'rtl' for Arabic, 'ltr' for English. Defaults to 'rtl'. */
  direction?: 'rtl' | 'ltr';
  /** Accent color for headers/footers. Defaults to brand emerald. */
  accent?: string;
}

/** Optional totals footer row, keyed by column key. */
export interface ReportTotals {
  /** Already-translated row label (rendered in the first column). */
  label: string;
  values: Record<string, number | string>;
}

export interface ReportSpec {
  columns: ReportColumnDef[];
  rows: Record<string, unknown>[];
  meta: ReportMeta;
  branding?: ReportBranding;
  /** File base name (without extension). */
  filename: string;
  totals?: ReportTotals;
  /** Landscape orientation for PDF. */
  landscape?: boolean;
}
