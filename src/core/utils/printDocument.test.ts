import { describe, it, expect, vi, beforeEach } from 'vitest';
import { printDocument, generateHtml } from './printDocument';
import { printHtmlDocument, isDesktopApp } from '@/core/reports/pdf/reportPdfExporter';
import type { PrintDocumentData } from './printDocument';

const baseData: PrintDocumentData = {
  type: 'sales-invoice',
  docNumber: 'INV-001',
  date: '2024-06-01',
  partyName: 'شركة اليمن',
  partyLabel: 'العميل',
  lines: [{ description: 'منتج أ', quantity: 2, unitPrice: 100, total: 200 }],
  subtotal: 200,
  vatAmount: 10,
  totalAmount: 210,
  companyName: 'المغزى',
  currency: 'YER',
};

describe('generateHtml (universal print doc)', () => {
  it('renders data + escaped party name (XSS guard)', () => {
    const html = generateHtml({ ...baseData, partyName: '<img src=x onerror=alert(1)>' });
    expect(html).toContain('INV-001');
    expect(html).toContain('المغزى');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img');
  });

  it('renders party name', () => {
    expect(generateHtml(baseData)).toContain('شركة اليمن');
  });

  it('renders Arabic-Indic digits', () => {
    expect(generateHtml(baseData)).toContain('٢٠٠');
  });
});

describe('printDocument (universal engine)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { electronEnv?: unknown }).electronEnv;
    delete (window as unknown as { electronDB?: unknown }).electronDB;
  });

  it('on web calls window.print (no popups) and is not desktop', () => {
    expect(isDesktopApp()).toBe(false);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const winOpen = vi.spyOn(window, 'open');
    printDocument(baseData);
    expect(printSpy).toHaveBeenCalled();
    expect(winOpen).not.toHaveBeenCalled();
    winOpen.mockRestore();
    printSpy.mockRestore();
  });

  it('on desktop calls printToPdf via the bridge', async () => {
    (window as unknown as { electronEnv?: unknown }).electronEnv = { isElectron: true };
    const printToPdf = vi.fn().mockResolvedValue({ success: true, pdf: 'AA==' });
    (window as unknown as { electronDB?: unknown }).electronDB = { printToPdf };
    const winPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    printDocument(baseData);
    await new Promise((r) => setTimeout(r, 10));

    expect(printToPdf).toHaveBeenCalledWith(expect.objectContaining({ filename: 'INV-001.pdf' }));
    expect(winPrint).not.toHaveBeenCalled();
    delete (window as unknown as { electronEnv?: unknown }).electronEnv;
    delete (window as unknown as { electronDB?: unknown }).electronDB;
    winPrint.mockRestore();
  });
});

describe('printHtmlDocument', () => {
  it('web → window.print', () => {
    const spy = vi.spyOn(window, 'print').mockImplementation(() => {});
    printHtmlDocument('<p>test</p>', 'f.pdf');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
