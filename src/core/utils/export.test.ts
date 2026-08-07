import { describe, it, expect, vi } from 'vitest';
import { exportToExcel, exportToPdf, dataToHtmlTable } from '@/core/utils/export';

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
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

  describe('exportToPdf', () => {
    it('shows alert when element not found', () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      exportToPdf('nonexistent', 'report');
      expect(alertSpy).toHaveBeenCalledWith('عنصر التصدير غير موجود');
      alertSpy.mockRestore();
    });

    it('shows alert when popup blocked', () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const container = document.createElement('div');
      container.id = 'export-target';
      document.body.appendChild(container);

      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

      exportToPdf('export-target', 'report');
      expect(alertSpy).toHaveBeenCalledWith('يرجى السماح بفتح النوافذ المنبثقة للتصدير');

      openSpy.mockRestore();
      alertSpy.mockRestore();
      document.body.removeChild(container);
    });

    it('writes HTML content to new window', () => {
      const container = document.createElement('div');
      container.id = 'pdf-export';
      container.innerHTML = '<p>Report content</p>';
      document.body.appendChild(container);

      const mockDoc = {
        write: vi.fn(),
        close: vi.fn(),
      };
      const mockWindow = { document: mockDoc } as unknown as Window;
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow);

      exportToPdf('pdf-export', 'my-report', 'تقرير المبيعات');

      expect(mockDoc.write).toHaveBeenCalled();
      const writtenHtml = mockDoc.write.mock.calls[0][0] as string;
      expect(writtenHtml).toContain('تقرير المبيعات');
      expect(writtenHtml).toContain('Report content');
      expect(writtenHtml).toContain('dir="rtl"');
      expect(writtenHtml).toContain('Cairo');
      expect(mockDoc.close).toHaveBeenCalled();

      openSpy.mockRestore();
      document.body.removeChild(container);
    });

    it('uses filename as title when no title provided', () => {
      const container = document.createElement('div');
      container.id = 'pdf-export-2';
      document.body.appendChild(container);

      const mockDoc = { write: vi.fn(), close: vi.fn() };
      const mockWindow = { document: mockDoc } as unknown as Window;
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow);

      exportToPdf('pdf-export-2', 'invoice-report');

      const writtenHtml = mockDoc.write.mock.calls[0][0] as string;
      expect(writtenHtml).toContain('invoice-report');

      openSpy.mockRestore();
      document.body.removeChild(container);
    });
  });
});
