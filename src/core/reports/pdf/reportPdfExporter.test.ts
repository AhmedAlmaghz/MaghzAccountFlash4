import { describe, it, expect, vi, beforeEach } from 'vitest';

const pdfMocks = vi.hoisted(() => {
  const instance = {
    setR2L: vi.fn(),
    addFileToVFS: vi.fn(),
    addFont: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    save: vi.fn(),
    getNumberOfPages: vi.fn(() => 1),
    internal: { pageSize: { width: 210, height: 297 } },
  };
  return { instance, JsPDF: vi.fn(function () { return instance; }) };
});
vi.mock('jspdf', () => ({ default: pdfMocks.JsPDF }));
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

import {
  cellMatrix,
  downloadBlob,
  exportReportToPdf,
  exportToPdfFromHtml,
  isDesktopApp,
  printHtmlDocument,
  titleBlock,
} from './reportPdfExporter';
import type { ReportSpec } from './types';

function makeSpec(): ReportSpec {
  return {
    columns: [
      { key: 'name', header: 'الاسم' },
      { key: 'amount', header: 'المبلغ', format: 'money' },
    ],
    rows: [{ name: 'بند أ', amount: 1500.5 }],
    meta: { title: 'T-TEST', direction: 'rtl' },
    filename: 'T-TEST',
  };
}

const setDesktop = (on: boolean, printToPdf?: unknown) => {
  (window as unknown as { electronEnv?: unknown }).electronEnv = on ? { isElectron: true } : undefined;
  (window as unknown as { electronDB?: unknown }).electronDB = on ? { printToPdf } : undefined;
};

describe('reportPdfExporter engine (universal PDF/report)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { electronEnv?: unknown }).electronEnv;
    delete (window as unknown as { electronDB?: unknown }).electronDB;
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  });

  it('isDesktopApp is false in jsdom by default', () => {
    expect(isDesktopApp()).toBe(false);
  });

  it('web: exportReportToPdf → native renderer (iframe with the report HTML)', async () => {
    const append = vi.spyOn(document.body, 'appendChild');
    const res = await exportReportToPdf(makeSpec());
    expect(res).toEqual({ success: true, filename: 'T-TEST.pdf' });
    const iframe = append.mock.calls.map(([n]) => n).find((n): n is HTMLIFrameElement => n instanceof HTMLIFrameElement);
    expect(iframe?.srcdoc).toContain('T-TEST');
    // jsPDF's manual shaping mirrors Arabic — the native renderer is used instead.
    expect(pdfMocks.instance.save).not.toHaveBeenCalled();
    append.mockRestore();
  });

  it('Electron: exportReportToPdf → printToPdf(html, filename) → { success: true }', async () => {
    const printToPdf = vi.fn(async () => ({ success: true, pdf: 'AA==' }));
    setDesktop(true, printToPdf);
    const res = await exportReportToPdf(makeSpec());
    expect(res).toEqual({ success: true, filename: 'T-TEST.pdf' });
    expect(printToPdf).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'T-TEST.pdf', html: expect.stringContaining('T-TEST') }),
    );
    expect(pdfMocks.instance.save).not.toHaveBeenCalled();
  });

  it('Electron: exportToPdfFromHtml delegates to printToPdf', async () => {
    const printToPdf = vi.fn(async () => ({ success: true, pdf: 'AA==' }));
    setDesktop(true, printToPdf);
    const res = await exportToPdfFromHtml('<p>x</p>', { filename: 'F', title: 'فوجد' });
    expect(res.success).toBe(true);
    expect(printToPdf).toHaveBeenCalledWith({ filename: 'F.pdf', html: '<p>x</p>' });
  });

  it('web: exportToPdfFromHtml renders that HTML in the native print frame', async () => {
    const append = vi.spyOn(document.body, 'appendChild');
    const html = '<p>تقرير ويب</p>';
    const res = await exportToPdfFromHtml(html, { filename: 'F', title: 'فوجد' });
    expect(res).toEqual({ success: true, filename: 'F' });
    const iframe = append.mock.calls.map(([n]) => n).find((n): n is HTMLIFrameElement => n instanceof HTMLIFrameElement);
    expect(iframe?.srcdoc).toBe(html);
    expect(pdfMocks.instance.save).not.toHaveBeenCalled();
    append.mockRestore();
  });

  it('printHtmlDocument: web → prints the supplied HTML in a hidden iframe (no popups)', () => {
    const spy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const append = vi.spyOn(document.body, 'appendChild');
    printHtmlDocument('<p>x</p>', 'a.pdf');
    const iframe = append.mock.calls.map(([n]) => n).find((n): n is HTMLIFrameElement => n instanceof HTMLIFrameElement);
    expect(iframe?.srcdoc).toContain('<p>x</p>');
    expect(spy).not.toHaveBeenCalled();
    append.mockRestore();
    spy.mockRestore();
  });

  it('cellMatrix maps spec rows → string rows', () => {
    const cm = cellMatrix(makeSpec());
    expect(cm[0][0]).toBe('بند أ');
    expect(cm[0][1]).toContain('1,500');
  });

  it('titleBlock returns localized title block', () => {
    const tb = titleBlock(makeSpec());
    expect(tb[0]).toEqual(['T-TEST']);
  });

  it('downloadBlob creates + clicks an anchor', () => {
    const click = vi.fn();
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue({ click, href: '', download: '' } as unknown as HTMLAnchorElement);
    try {
      downloadBlob(new Blob(['x'], { type: 'application/pdf' }), 'f.pdf');
      expect(click).toHaveBeenCalled();
    } finally {
      createSpy.mockRestore();
    }
  });
});
