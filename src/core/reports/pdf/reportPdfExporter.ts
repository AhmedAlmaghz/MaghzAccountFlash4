import type { ReportSpec } from '../types';
import { buildReportHtml } from '../document';
import { ARABIC_FONT_NAME, ensureArabicFont, shapeForPdf } from '../arabicPdf';
import { formatReportCell } from '../formatters';

/**
 * Universal report PDF exporter — ONE entry point for every platform.
 *
 * Electron (desktop): `webContents.printToPDF()` via IPC (`db:print-to-pdf`)
 * → blob download. Chromium's own PDF renderer: no popups, no native
 * print dialogs, works the same as web.
 *
 * Web / mobile browsers: jsPDF + autoTable (the proven path), with the
 * bundled IBM Plex Sans Arabic pipeline (shaped visual-order text).
 */

export type UniversalExportResult = { success: true; filename: string } | { success: false; error: string };

export function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { electronEnv?: { isElectron?: boolean } }).electronEnv?.isElectron;
}

function electronPdfBridge():
  | ((payload: { html: string; filename: string }) => Promise<{ success: boolean; pdf?: string; error?: string }>)
  | null {
  const bridge = (
    window as unknown as {
      electronDB?: { printToPdf?: (p: { html: string; filename: string }) => Promise<{ success: boolean; pdf?: string; error?: string }> };
    }
  ).electronDB;
  return bridge?.printToPdf ?? null;
}

async function exportElectronPdf(html: string, filename: string): Promise<UniversalExportResult> {
  try {
    const bridge = electronPdfBridge();
    if (!bridge) return { success: false, error: 'desktop-pdf-unavailable' };
    const res = await bridge({ html, filename });
    if (!res.success || !res.pdf) return { success: false, error: res.error || 'desktop-pdf-failed' };
    const bytes = Uint8Array.from(atob(res.pdf), (c) => c.charCodeAt(0));
    downloadBlob(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), filename);
    return { success: true, filename };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'desktop-pdf-failed' };
  }
}

// ---------------------------------------------------------------------------
// Web / mobile path: jsPDF + autoTable (moved from exporters.ts)
// ---------------------------------------------------------------------------

export function cellMatrix(spec: ReportSpec): string[][] {
  const body = (spec.rows as Record<string, unknown>[]).map((row) => spec.columns.map((c) => formatReportCell(row[c.key], c, row)));
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

export function titleBlock(spec: ReportSpec): string[][] {
  const lines: string[][] = [];
  if (spec.branding?.companyName) lines.push([spec.branding.companyName]);
  lines.push([spec.meta.title]);
  if (spec.meta.subtitle) lines.push([spec.meta.subtitle]);
  if (spec.meta.periodLabel) lines.push([spec.meta.periodLabel]);
  if (lines.length > 0) lines.push([]);
  return lines;
}

async function exportWebPdf(spec: ReportSpec): Promise<void> {
  const [jsPDFModule, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const jsPDF = jsPDFModule.default;
  const autoTable = autoTableModule.default;
  const direction = spec.meta.direction ?? 'rtl';

  const landscape = spec.landscape ?? spec.columns.length > 6;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const arabic = await ensureArabicFont(doc);
  if (arabic) {
    doc.setFont(ARABIC_FONT_NAME);
  } else if (direction === 'rtl') {
    doc.setR2L(true);
  }
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
    styles: { font: arabic ? ARABIC_FONT_NAME : 'helvetica', fontSize: 9, cellPadding: 2 },
    alternateRowStyles: { fillColor: [247, 250, 248] },
    direction,
  } as unknown as Parameters<typeof autoTable>[1]);

  doc.save(`${spec.filename}.pdf`);
}

// ---------------------------------------------------------------------------
// Universal entry points
// ---------------------------------------------------------------------------

export async function exportReportToPdf(spec: ReportSpec): Promise<UniversalExportResult> {
  const filename = `${spec.filename}.pdf`;
  const html = buildReportHtml(spec);
  if (isDesktopApp()) {
    const res = await exportElectronPdf(html, filename);
    if (res.success) return { success: true, filename };
    // Desktop bridge unavailable → fall through to the web path.
  }
  await exportWebPdf(spec);
  return { success: true, filename };
}

export async function printReportDocument(spec: ReportSpec): Promise<void> {
  printHtmlDocument(buildReportHtml(spec), `${spec.filename}.pdf`);
}

/** Universal print: Electron → printToPDF → blob download; Web/mobile → print dialog. */
export function printHtmlDocument(html: string, filename: string): void {
  if (isDesktopApp()) {
    void exportElectronPdf(html, filename);
    return;
  }
  window.print();
}

interface ElementSpecOptions {
  filename: string;
  title: string;
}

function specFromElement(host: HTMLElement, { filename, title }: ElementSpecOptions): ReportSpec | null {
  const table = host.querySelector('table') ?? (host.tagName === 'TABLE' ? (host as HTMLTableElement) : null);
  if (!table) return null;
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()),
  );
  const columns =
    headers.length > 0
      ? headers.map((h, i) => ({ key: `c${i}`, header: h || `col${i + 1}`, format: 'text' as const }))
      : [{ key: 'c0', header: '1', format: 'text' as const }];
  const body = rows.map((cells) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => { obj[c.key] = cells[i] ?? ''; });
    return obj;
  });
  return {
    filename,
    meta: { title, direction: 'rtl' },
    columns,
    rows: body,
  };
}

export async function exportToPdfFromHtml(html: string, { filename, title }: ElementSpecOptions): Promise<UniversalExportResult> {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    if (isDesktopApp()) {
      return await exportElectronPdf(html, `${filename}.pdf`);
    }
    const spec = specFromElement(host, { filename, title });
    if (spec) return await exportReportToPdf(spec);
    const { default: JsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    autoTable(doc, { head: [[title]], body: [[(host.textContent || filename).trim()]], theme: 'grid' });
    doc.save(`${filename}.pdf`);
    return { success: true, filename };
  } finally {
    host.remove();
  }
}
