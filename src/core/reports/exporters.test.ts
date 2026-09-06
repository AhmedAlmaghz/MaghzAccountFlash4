import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/store', () => ({
  useAppStore: {
    getState: vi.fn(() => ({ activeCompany: { id: 'c-1', decimalPlaces: 2 } })),
  },
}));

vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

vi.mock('jspdf', () => {
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
  return {
    default: vi.fn(function () {
      return instance;
    }),
  };
});

vi.mock('jspdf-autotable', () => ({
  default: vi.fn(),
}));

import { exportReportCsv, exportReportExcel, exportReportHtml, exportReportPdf } from './exporters';
import type { ReportSpec } from './types';

function makeSpec(): ReportSpec {
  return {
    columns: [
      { key: 'name', header: 'الاسم', width: 20 },
      { key: 'amount', header: 'المبلغ', format: 'money', width: 15 },
    ],
    rows: [{ name: 'بند أ', amount: 1500.5 }],
    meta: { title: 'تقرير اختبار', subtitle: 'شركة الاختبار', periodLabel: '2026' },
    branding: { companyName: 'شركة الاختبار', currency: 'YER' },
    filename: 'test-report',
    totals: { label: 'الإجمالي', values: { amount: 1500.5 } },
  };
}

describe('report exporters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports Excel with title block, headers, body, and totals', async () => {
    const { utils, writeFile } = await import('xlsx');
    await exportReportExcel(makeSpec());
    expect(utils.aoa_to_sheet).toHaveBeenCalled();
    const sheetData = vi.mocked(utils.aoa_to_sheet).mock.calls[0][0] as string[][];
    expect(sheetData[0]).toEqual(['شركة الاختبار']);
    expect(sheetData[1]).toEqual(['تقرير اختبار']);
    const headerRow = sheetData.find((r) => r[0] === 'الاسم');
    expect(headerRow?.[1]).toBe('المبلغ');
    const totalsRow = sheetData[sheetData.length - 1];
    expect(totalsRow[0]).toBe('الإجمالي');
    expect(totalsRow[1]).toBe('1,500.50');
    expect(utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Data');
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'test-report.xlsx');
  });

  it('exports PDF with title block and grid', async () => {
    const { default: autoTable } = await import('jspdf-autotable');
    const { default: JsPDF } = await import('jspdf');
    await exportReportPdf(makeSpec());
    expect(JsPDF).toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalled();
    const opts = vi.mocked(autoTable).mock.calls[0][1] as Record<string, unknown>;
    expect(opts.theme).toBe('grid');
    expect(opts.direction).toBe('rtl');
    // Bundled Tajawal is always available: headers ship pre-shaped
    // (visual order), never raw logical Arabic.
    expect((opts.head as string[][])[0]).toEqual(['ﻢﺳﻻﺍ', 'ﻎﻠﺒﻤﻟﺍ']);
  });

  it('embeds Tajawal and shapes Arabic when the font loads', async () => {
    const { clearArabicFontCache } = await import('./arabicPdf');
    clearArabicFontCache();
    const { default: autoTable } = await import('jspdf-autotable');
    const { default: JsPDF } = await import('jspdf');
    vi.clearAllMocks();
    await exportReportPdf(makeSpec());
    const instance = vi.mocked(JsPDF).mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(instance.setFont).toHaveBeenCalledWith('IBMPlexSansArabic');
    const opts = vi.mocked(autoTable).mock.calls[0][1] as Record<string, unknown>;
    expect(opts.styles).toMatchObject({ font: 'IBMPlexSansArabic' });
    // Headers are pre-shaped visual-order text, not raw logical Arabic.
    expect((opts.head as string[][])[0][0]).not.toBe('الاسم');
    clearArabicFontCache();
  });

  it('exports a standalone branded HTML file', async () => {
    const createObjectURL = vi.fn(() => 'blob:html');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue({ click, href: '', download: '' } as unknown as HTMLAnchorElement);
    const blobs: Blob[] = [];
    vi.stubGlobal('Blob', class {
      parts: unknown[];
      options: unknown;
      constructor(parts: unknown[], options: unknown) {
        this.parts = parts;
        this.options = options;
        blobs.push(this as unknown as Blob);
      }
    } as unknown as typeof Blob);

    await exportReportHtml(makeSpec());

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    const html = String((blobs[0] as unknown as { parts: unknown[] }).parts[0]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('تقرير اختبار');
    expect(html).toContain('الإجمالي');
    createElement.mockRestore();
    vi.unstubAllGlobals();
  });

  it('exports CSV with BOM and quoted commas', async () => {
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue({ click, href: '', download: '' } as unknown as HTMLAnchorElement);
    const blobs: Blob[] = [];
    vi.stubGlobal('Blob', class {
      parts: unknown[];
      constructor(parts: unknown[], _options: unknown) {
        this.parts = parts;
        blobs.push(this as unknown as Blob);
      }
    } as unknown as typeof Blob);

    await exportReportCsv({
      ...makeSpec(),
      // Arabic comma (،) never splits CSV columns; only ASCII comma forces quoting.
      rows: [{ name: 'بند، بفاصلة', amount: 10 }, { name: 'a,b', amount: 20 }],
    });

    const csv = String((blobs[0] as unknown as { parts: unknown[] }).parts[0]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('بند، بفاصلة,10.00');
    expect(csv).toContain('"a,b"');
    createElement.mockRestore();
    vi.unstubAllGlobals();
  });
});
