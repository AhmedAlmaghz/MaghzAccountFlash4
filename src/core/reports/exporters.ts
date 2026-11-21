import { buildReportHtml } from './document';
import type { ReportSpec } from './types';
import {
  cellMatrix,
  downloadBlob,
  exportReportToPdf as exportReportPdf,
  printReportDocument,
  titleBlock,
} from './pdf/reportPdfExporter';

export { cellMatrix, downloadBlob, exportReportPdf, printReportDocument, titleBlock };
export type { UniversalExportResult } from './pdf/reportPdfExporter';

/**
 * Unified file exporters — Excel / PDF / HTML / CSV from one ReportSpec.
 * Heavy libraries (xlsx, jspdf) stay lazy-loaded via dynamic import so the
 * main bundle never pays for them. The PDF path (exportReportPdf) is the
 * universal engine: Electron → printToPDF (no popups), Web/mobile → jsPDF.
 */

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

export function exportReportHtml(spec: ReportSpec): void {
  const html = buildReportHtml(spec);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${spec.filename}.html`);
}

/** Print the branded document — Electron: PDF export, Web/mobile: print dialog. */
export function printReportHtml(spec: ReportSpec): void {
  void printReportDocument(spec);
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
