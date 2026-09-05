import { useAppStore } from '@/core/store';
import { formatReportDate, formatReportNumber } from '@/core/reports/formatters';
import { exportReportHtml } from '@/core/reports/exporters';
import { getReportBranding } from '@/core/reports/branding';
import { ARABIC_FONT_NAME, ensureArabicFont, shapeForPdf } from '@/core/reports/arabicPdf';

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
  const rows = data as Record<string, unknown>[];
  const [jsPDFModule, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const jsPDF = jsPDFModule.default;
  const autoTable = autoTableModule.default;

  const doc = new jsPDF(options?.rtl ? { orientation: 'portrait', unit: 'mm', format: 'a4' } : {});

  // Arabic pipeline (see core/reports/arabicPdf): embedded Amiri plus
  // pre-shaped visual-order text. No setR2L — it would double-reverse.
  // The legacy 'Cairo' font name never had an embedded file behind it.
  const arabic = await ensureArabicFont(doc);
  if (arabic) doc.setFont(ARABIC_FONT_NAME);
  const shape = (s: string): string => (arabic ? shapeForPdf(s) : s);

  if (options?.title) {
    doc.setFontSize(18);
    doc.text(shape(options.title), options?.rtl ? doc.internal.pageSize.width - 14 : 14, 20, { align: options?.rtl ? 'right' : 'left' });
  }

  if (options?.subtitle) {
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(shape(options.subtitle), options?.rtl ? doc.internal.pageSize.width - 14 : 14, 28, { align: options?.rtl ? 'right' : 'left' });
  } else if (options?.currency) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(shape(`العملة: ${options.currency}`), options?.rtl ? doc.internal.pageSize.width - 14 : 14, 28, { align: options?.rtl ? 'right' : 'left' });
  }

  autoTable(doc, {
    startY: options?.title ? 35 : 20,
    head: [columns.map((c) => shape(c.header))],
    body: rows.map((row) => columns.map((c) => shape(formatCellValue(row[c.key], c)))),
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    styles: { font: arabic ? ARABIC_FONT_NAME : 'helvetica', fontSize: 9, cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    direction: options?.rtl ? 'rtl' : 'ltr',
  } as unknown as Parameters<typeof autoTable>[1]);

  doc.save(`${filename}.pdf`);
}

export { formatDate as formatDateForExport, formatDateTime as formatDateTimeForExport, formatNumber as formatNumberForExport };
