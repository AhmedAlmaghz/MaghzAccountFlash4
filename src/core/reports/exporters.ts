import { buildReportHtml } from './document';
import { formatReportCell } from './formatters';
import { ARABIC_FONT_NAME, ensureArabicFont, shapeForPdf } from './arabicPdf';
import type { ReportSpec } from './types';

/**
 * Unified file exporters — Excel / PDF / HTML / CSV from one ReportSpec.
 * Heavy libraries (xlsx, jspdf) stay lazy-loaded via dynamic import so the
 * main bundle never pays for them.
 */

function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

function cellMatrix(spec: ReportSpec): string[][] {
  const body = spec.rows.map((row) => spec.columns.map((c) => formatReportCell(row[c.key], c, row)));
  if (!spec.totals) return body;
  const totalsRow = spec.columns.map((c, idx) => {
    if (idx === 0) return spec.totals!.label;
    const v = spec.totals!.values[c.key];
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'number') return formatReportCell(v, c);
    return String(v);
  });
  return [...body, totalsRow];
}

function titleBlock(spec: ReportSpec): string[][] {
  const lines: string[][] = [];
  if (spec.branding?.companyName) lines.push([spec.branding.companyName]);
  lines.push([spec.meta.title]);
  if (spec.meta.subtitle) lines.push([spec.meta.subtitle]);
  if (spec.meta.periodLabel) lines.push([spec.meta.periodLabel]);
  if (lines.length > 0) lines.push([]);
  return lines;
}

export async function exportReportExcel(spec: ReportSpec): Promise<void> {
  const { utils, writeFile } = await import('xlsx');
  const sheetData = [
    ...titleBlock(spec),
    spec.columns.map((c) => c.header),
    ...cellMatrix(spec),
  ];
  const worksheet = utils.aoa_to_sheet(sheetData);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'Data');
  worksheet['!cols'] = spec.columns.map((c) => ({ wch: c.width || 18 }));
  const direction = spec.meta.direction ?? 'rtl';
  worksheet['!views'] = [{ rightToLeft: direction === 'rtl' }];
  writeFile(workbook, `${spec.filename}.xlsx`);
}

export async function exportReportPdf(spec: ReportSpec): Promise<void> {
  const [jsPDFModule, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const jsPDF = jsPDFModule.default;
  const autoTable = autoTableModule.default;
  const direction = spec.meta.direction ?? 'rtl';

  const doc = new jsPDF({
    orientation: spec.landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Arabic pipeline: embedded Amiri + pre-shaped visual-order text.
  // NOTE: no doc.setR2L — shapeForPdf already reordered the glyphs, and
  // setR2L would reverse them a second time.
  const arabic = await ensureArabicFont(doc);
  if (arabic) doc.setFont(ARABIC_FONT_NAME);
  const shape = (s: string): string => (arabic ? shapeForPdf(s) : s);

  const margin = 14;
  const pageWidth = doc.internal.pageSize.width;
  const x = direction === 'rtl' ? pageWidth - margin : margin;
  const align = (direction === 'rtl' ? 'right' : 'left') as 'right' | 'left';
  let cursorY = 18;

  if (spec.branding?.companyName) {
    doc.setFontSize(13);
    doc.text(shape(spec.branding.companyName), x, cursorY, { align });
    cursorY += 6;
  }
  doc.setFontSize(17);
  doc.text(shape(spec.meta.title), x, cursorY, { align });
  cursorY += 7;
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (spec.meta.subtitle) {
    doc.text(shape(spec.meta.subtitle), x, cursorY, { align });
    cursorY += 5;
  }
  if (spec.meta.periodLabel) {
    doc.text(shape(spec.meta.periodLabel), x, cursorY, { align });
    cursorY += 5;
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: cursorY + 2,
    head: [spec.columns.map((c) => shape(c.header))],
    body: cellMatrix(spec).map((row) => row.map((cell) => shape(cell))),
    theme: 'grid',
    headStyles: { fillColor: [11, 122, 94], textColor: 255, fontStyle: 'bold' },
    styles: { font: arabic ? ARABIC_FONT_NAME : 'helvetica', fontSize: 9, cellPadding: 2 },
    alternateRowStyles: { fillColor: [247, 250, 248] },
    direction,
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `${page}`,
        pageWidth / 2,
        doc.internal.pageSize.height - 8,
        { align: 'center' },
      );
      doc.setTextColor(0);
    },
  } as unknown as Parameters<typeof autoTable>[1]);

  doc.save(`${spec.filename}.pdf`);
}

export async function exportReportHtml(spec: ReportSpec): Promise<void> {
  const html = buildReportHtml(spec);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${spec.filename}.html`);
}

/** Print the branded document via the browser print dialog. */
export function printReportHtml(spec: ReportSpec): void {
  const html = buildReportHtml(spec).replace('window.__autoPrint', 'true');
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export async function exportReportCsv(spec: ReportSpec): Promise<void> {
  const escape = (val: string): string =>
    val.includes(',') || val.includes('"') || val.includes('\n')
      ? `"${val.replace(/"/g, '""')}"`
      : val;
  const lines = [
    ...titleBlock(spec).map((r) => r.map(escape).join(',')),
    spec.columns.map((c) => escape(c.header)).join(','),
    ...cellMatrix(spec).map((r) => r.map(escape).join(',')),
  ];
  downloadBlob(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), `${spec.filename}.csv`);
}
