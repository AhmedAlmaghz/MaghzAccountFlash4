import { describe, it, expect, vi, beforeEach } from 'vitest';

const printed: Array<{ html: string; filename: string }> = [];
vi.mock('@/core/reports/pdf/reportPdfExporter', () => ({
  printHtmlDocument: vi.fn((html: string, filename: string) => { printed.push({ html, filename }); }),
}));

import { exportToPDF } from './exportEngine';

describe('native PDF export (no jsPDF shaping)', () => {
  beforeEach(() => { printed.length = 0; });

  it('emits logical Arabic RTL HTML for a report', async () => {
    await exportToPDF(
      [{ name: 'شركة الأمل', amount: '1,500' }],
      [{ key: 'name', header: 'العميل' }, { key: 'amount', header: 'المبلغ' }],
      'report',
      { title: 'تقرير المبيعات', subtitle: 'شركة الاختبار', rtl: true, currency: 'YER' }
    );
    expect(printed).toHaveLength(1);
    const { html, filename } = printed[0];
    expect(filename).toBe('report.pdf');
    expect(html).toContain('dir="rtl"');
    // Logical (not presentation-form) Arabic reaches the browser untouched.
    expect(html).toContain('شركة الأمل');
    expect(html).toContain('العميل');
    expect(html).not.toMatch(/[\uFE70-\uFEFF]/);
  });

  it('honours an explicit LTR request', async () => {
    await exportToPDF([{ name: 'Acme' }], [{ key: 'name', header: 'Customer' }], 'en', { rtl: false });
    expect(printed[0].html).toContain('dir="ltr"');
  });
});
