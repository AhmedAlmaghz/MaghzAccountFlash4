import { useAppStore } from '@/core/store';

interface ExportColumn {
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
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof num !== 'number' || isNaN(num)) return String(value);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

function formatDate(value: unknown, calendar: 'gregorian' | 'hijri'): string {
  if (!value) return '';
  const d = new Date(value as string);
  if (isNaN(d.getTime())) return String(value);
  const locale = calendar === 'hijri' ? HIJRI_LOCALE : 'en-US';
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (calendar === 'hijri') {
    (options as Record<string, unknown>).calendar = 'islamic';
  }
  return new Intl.DateTimeFormat(locale, options).format(d);
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

  if (options?.rtl) {
    doc.setR2L(true);
  }

  if (options?.title) {
    doc.setFontSize(18);
    doc.text(options.title, options?.rtl ? doc.internal.pageSize.width - 14 : 14, 20, { align: options?.rtl ? 'right' : 'left' });
  }

  if (options?.subtitle) {
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(options.subtitle, options?.rtl ? doc.internal.pageSize.width - 14 : 14, 28, { align: options?.rtl ? 'right' : 'left' });
  } else if (options?.currency) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`العملة: ${options.currency}`, options?.rtl ? doc.internal.pageSize.width - 14 : 14, 28, { align: options?.rtl ? 'right' : 'left' });
  }

  autoTable(doc, {
    startY: options?.title ? 35 : 20,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => formatCellValue(row[c.key], c))),
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    styles: { font: options?.rtl ? 'Cairo' : 'helvetica', fontSize: 9, cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    direction: options?.rtl ? 'rtl' : 'ltr',
  } as unknown as Parameters<typeof autoTable>[1]);

  doc.save(`${filename}.pdf`);
}

export { formatDate as formatDateForExport, formatDateTime as formatDateTimeForExport, formatNumber as formatNumberForExport };
