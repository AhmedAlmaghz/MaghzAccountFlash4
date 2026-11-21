import { describe, it, expect, vi } from 'vitest';
import { exportToExcel, exportToPdf, dataToHtmlTable } from '@/core/utils/export';
import { exportToPdfFromHtml } from '@/core/reports/pdf/reportPdfExporter';

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

vi.mock('@/core/reports/pdf/reportPdfExporter', () => ({
  exportToPdfFromHtml: vi.fn(async () => ({ success: true, filename: 'mock.pdf' })),
}));

describe('export utilities', () => {
  describe('dataToHtmlTable', () => {
    it('converts array of objects to HTML table', () => {
      const data = [
        { name: 'Product A', price: 100 },
        { name: 'Product B', price: 200 },
      ];
      const columns = [
        { key: 'name', label: 'Name' },
        { key: 'price', label: 'Price' },
      ];

      const html = dataToHtmlTable(data, columns);
      expect(html).toContain('<table>');
      expect(html).toContain('Product A');
      expect(html).toContain('١٠٠');
      expect(html).toContain('Product B');
      expect(html).toContain('٢٠٠');
    });

    it('handles empty data', () => {
      const html = dataToHtmlTable([], [{ key: 'name', label: 'Name' }]);
      expect(html).toContain('<p>لا توجد بيانات</p>');
    });

    it('handles null data argument', () => {
      const html = dataToHtmlTable(null as never, [{ key: 'name', label: 'Name' }]);
      expect(html).toContain('<p>لا توجد بيانات</p>');
    });

    it('handles null values', () => {
      const data = [{ name: 'Test', value: null }];
      const html = dataToHtmlTable(data, [
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
      ]);
      expect(html).toContain('-');
    });

    it('handles undefined values', () => {
      const data = [{ name: 'Test', value: undefined }];
      const html = dataToHtmlTable(data, [
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
      ]);
      expect(html).toContain('-');
    });

    it('formats numbers with locale', () => {
      const data = [{ amount: 1234567 }];
      const html = dataToHtmlTable(data, [{ key: 'amount', label: 'Amount' }]);
      expect(html).toContain('class="number"');
    });

    it('escapes HTML in labels', () => {
      const data = [{ val: 'test' }];
      const columns = [{ key: 'val', label: '<script>alert("xss")</script>' }];
      const html = dataToHtmlTable(data, columns);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in string values', () => {
      const data = [{ val: '<b>bold</b>' }];
      const columns = [{ key: 'val', label: 'Value' }];
      const html = dataToHtmlTable(data, columns);
      expect(html).not.toContain('<b>bold</b>');
      expect(html).toContain('&lt;b&gt;');
    });

    it('renders thead and tbody', () => {
      const data = [{ a: '1' }];
      const columns = [{ key: 'a', label: 'A' }];
      const html = dataToHtmlTable(data, columns);
      expect(html).toContain('<thead>');
      expect(html).toContain('<tbody>');
      expect(html).toContain('</thead>');
      expect(html).toContain('</tbody>');
    });
  });

  describe('exportToExcel', () => {
    it('shows alert when no data', () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      exportToExcel([], 'test');
      expect(alertSpy).toHaveBeenCalledWith('لا توجد بيانات للتصدير');
      alertSpy.mockRestore();
    });

    it('shows alert when data is null', () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      exportToExcel(null as never, 'test');
      expect(alertSpy).toHaveBeenCalledWith('لا توجد بيانات للتصدير');
      alertSpy.mockRestore();
    });

    it('calls xlsx utils with data and filename', async () => {
      const { utils, writeFile } = await import('xlsx');
      const data = [{ name: 'Test', value: 42 }];

      await exportToExcel(data, 'report', 'MySheet');

      expect(utils.json_to_sheet).toHaveBeenCalledWith(data);
      expect(utils.book_new).toHaveBeenCalled();
      expect(utils.book_append_sheet).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'report.xlsx');
    });

    it('uses default sheet name Sheet1', async () => {
      const { utils } = await import('xlsx');
      const data = [{ x: 1 }];

      await exportToExcel(data, 'test');

      expect(utils.book_append_sheet).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'Sheet1'
      );
    });
  });

  describe('exportToPdf (universal engine)', () => {
    it('shows alert when element not found', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const res = await exportToPdf('nonexistent', 'report');
      expect(alertSpy).toHaveBeenCalledWith('عنصر التصدير غير موجود');
      expect(res.success).toBe(false);
      alertSpy.mockRestore();
    });

    it('delegates to the universal engine with the element HTML', async () => {
      const container = document.createElement('div');
      container.id = 'pdf-export';
      container.innerHTML = '<p>Report content</p>';
      document.body.appendChild(container);

      const mockExport = vi.mocked(exportToPdfFromHtml);
      mockExport.mockClear();

      const res = await exportToPdf('pdf-export', 'my-report', 'تقرير المبيعات');

      expect(mockExport).toHaveBeenCalledTimes(1);
      expect(mockExport.mock.calls[0][0]).toContain('Report content');
      expect(mockExport.mock.calls[0][1]).toEqual({ filename: 'my-report', title: 'تقرير المبيعات' });
      expect(res.success).toBe(true);

      document.body.removeChild(container);
    });

    it('uses filename as title when no title provided', async () => {
      const container = document.createElement('div');
      container.id = 'pdf-export-2';
      document.body.appendChild(container);

      const mockExport = vi.mocked(exportToPdfFromHtml);
      mockExport.mockClear();

      await exportToPdf('pdf-export-2', 'invoice-report');

      expect(mockExport.mock.calls[0][1]).toEqual({ filename: 'invoice-report', title: 'invoice-report' });

      document.body.removeChild(container);
    });
  });
});
