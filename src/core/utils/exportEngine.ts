import { useAppStore } from '@/core/store';
import { formatReportDate, formatReportNumber } from '@/core/reports/formatters';
import { exportReportHtml } from '@/core/reports/exporters';
import { getReportBranding } from '@/core/reports/branding';
import { printHtmlDocument } from '@/core/reports/pdf/reportPdfExporter';

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
  format?: (value: unknown) => string;
}

function getCompanySettings() {
  const company = useAppStore.getState().activeCompany;
  return {
    decimalPlaces: company?.decimalPlaces ?? 2,
    dateFormat: company?.dateFormat ?? 'yyyy-MM-dd',
    calendar: company?.calendar ?? 'gregorian',
    currency: company?.currency ?? 'YER',
  };
}

const HIJRI_LOCALE = 'ar-SA-u-ca-islamic-umalqura';

function formatNumber(value: unknown, decimalPlaces: number): string {
  // Unified implementation — Latin digits, company decimal places.
  return formatReportNumber(value, decimalPlaces);
}

function formatDate(value: unknown, _calendar: 'gregorian' | 'hijri'): string {
  // Unified implementation — honours the company's date format
  // (YYYY-MM-DD family) instead of a hardcoded MM/DD layout.
  return formatReportDate(value);
}

function formatDateTime(value: unknown, calendar: 'gregorian' | 'hijri'): string {
  if (!value) return '';
  const d = new Date(value as string);
  if (isNaN(d.getTime())) return String(value);
  const locale = calendar === 'hijri' ? HIJRI_LOCALE : 'en-US';
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (calendar === 'hijri') {
    (options as Record<string, unknown>).calendar = 'islamic';
  }
  return new Intl.DateTimeFormat(locale, options).format(d);
}

function isDateLike(value: unknown): boolean {
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}/.test(value) && !isNaN(new Date(value).getTime());
  }
  return false;
}

function formatCellValue(value: unknown, column: ExportColumn): string {
  if (column.format) return column.format(value);
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return formatNumber(value, getCompanySettings().decimalPlaces);
  }
  if (isDateLike(value)) {
    return formatDate(value, getCompanySettings().calendar);
  }
  return String(value);
}

export async function exportToExcel(
  data: unknown[],
  columns: ExportColumn[],
  filename: string
): Promise<void> {
  const rows = data as Record<string, unknown>[];
  const worksheetData = [
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => formatCellValue(row[c.key], c))),
  ];

  const { utils, writeFile } = await import('xlsx');
  const worksheet = utils.aoa_to_sheet(worksheetData);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'Data');

  worksheet['!cols'] = columns.map((c) => ({ wch: c.width || 15 }));

  writeFile(workbook, `${filename}.xlsx`);
}

export async function exportToCSV(
  data: unknown[],
  columns: ExportColumn[],
  filename: string
): Promise<void> {
  const rows = data as Record<string, unknown>[];
  const headers = columns.map((c) => c.header).join(',');
  const csvRows = rows
    .map((row) =>
      columns
        .map((c) => {
          const val = formatCellValue(row[c.key], c);
          if (typeof val === 'string' && (val.includes(',') || val.includes('"')))
            return `"${val.replace(/"/g, '""')}"`;
          return val;
        })
        .join(',')
    )
    .join('\n');

  const csvContent = '\uFEFF' + headers + '\n' + csvRows;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
}

/**
 * Branded HTML export for simple list pages — same document builder as the
 * report center (header, table, totals, footer), one call from any page.
 */
export async function exportToHtml(
  data: unknown[],
  columns: ExportColumn[],
  filename: string,
  options?: { title?: string; subtitle?: string },
): Promise<void> {
  const language = useAppStore.getState().language;
  const branding = getReportBranding();
  await exportReportHtml({
    columns: columns.map((c) => ({
      key: c.key,
      header: c.header,
      width: c.width,
      render: c.format ? (v: unknown) => c.format!(v) : undefined,
    })),
    rows: data as Record<string, unknown>[],
    meta: {
      title: options?.title || filename,
      subtitle: options?.subtitle || branding.companyName,
      direction: language === 'en' ? 'ltr' : 'rtl',
    },
    branding,
    filename,
  });
}

/**
 * Standalone RTL-aware HTML for native PDF rendering.
 * Arabic shaping/bidi are the browser engine's job — no manual reshaping.
 */
function buildPdfHtml(
  data: unknown[],
  columns: ExportColumn[],
  options?: { title?: string; subtitle?: string; companyName?: string; rtl?: boolean; currency?: string }
): string {
  const dir = options?.rtl === false ? 'ltr' : 'rtl';
  const lang = dir === 'rtl' ? 'ar' : 'en';
  const escape = (value: unknown): string => {
    const s = value == null ? '' : String(value);
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
  };
  const rows = (data as Record<string, unknown>[]).map((row) =>
    `<tr>${columns.map((c) => `<td>${escape(formatCellValue(row[c.key], c))}</td>`).join('')}</tr>`
  ).join('');
  const head = `
    <meta charset="utf-8">
    <title>${escape(options?.title || 'report')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Cairo', 'Tahoma', 'Segoe UI', sans-serif; margin: 0; color: #1f2937; font-size: 11px; line-height: 1.7; }
      .head { border-bottom: 2px solid #0b7a5e; padding-bottom: 10px; margin-bottom: 14px; }
      .company { font-size: 13px; font-weight: 700; color: #0b7a5e; }
      h1 { font-size: 17px; margin: 4px 0 2px; }
      .sub { color: #6b7280; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #0b7a5e; color: #fff; padding: 7px 8px; text-align: start; font-size: 11px; }
      td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f8fafc; }
      .foot { margin-top: 18px; color: #94a3b8; font-size: 10px; text-align: center; }
    </style>`;
  return `<!DOCTYPE html><html dir="${dir}" lang="${lang}"><head>${head}</head><body>
    <div class="head">
      ${options?.companyName ? `<div class="company">${escape(options.companyName)}</div>` : ''}
      ${options?.title ? `<h1>${escape(options.title)}</h1>` : ''}
      ${options?.subtitle ? `<div class="sub">${escape(options.subtitle)}</div>` : ''}
      ${options?.currency ? `<div class="sub">${escape(lang === 'ar' ? 'العملة' : 'Currency')}: ${escape(options.currency)}</div>` : ''}
    </div>
    <table><thead><tr>${columns.map((c) => `<th>${escape(c.header)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${columns.length}">${escape(lang === 'ar' ? 'لا توجد بيانات' : 'No data')}</td></tr>`}</tbody>
    </table>
    <div class="foot">maghzaccount-pro</div>
  </body></html>`;
}

export async function exportToPDF(
  data: unknown[],
  columns: ExportColumn[],
  filename: string,
  options?: {
    title?: string;
    subtitle?: string;
    companyName?: string;
    logo?: string;
    rtl?: boolean;
    currency?: string;
  }
): Promise<void> {
  // ONE path for desktop and web: native renderer (Chromium printToPDF on
  // desktop, print dialog → Save as PDF on web). No jsPDF/text shaping.
  printHtmlDocument(buildPdfHtml(data, columns, options), `${filename}.pdf`);
}

export { formatDate as formatDateForExport, formatDateTime as formatDateTimeForExport, formatNumber as formatNumberForExport };
