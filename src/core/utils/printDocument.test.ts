import { describe, it, expect, vi } from 'vitest';
import { printDocument } from './printDocument';

describe('printDocument', () => {
  it('opens a print window with document data', () => {
    const mockWrite = vi.fn();
    const mockClose = vi.fn();
    const mockOpen = vi.fn();
    const mockWindow = {
      document: { open: mockOpen, write: mockWrite, close: mockClose },
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printDocument({
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
    });

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(mockWrite).toHaveBeenCalled();
    const html = mockWrite.mock.calls[0][0];
    expect(html).toContain('INV-001');
    expect(html).toContain('شركة اليمن');
    expect(html).toContain('٢٠٠');
    expect(html).toContain('المغزى');
    expect(mockClose).toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it('escapes HTML from party name to prevent XSS', () => {
    const mockWrite = vi.fn();
    const mockWindow = {
      document: { open: vi.fn(), write: mockWrite, close: vi.fn() },
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printDocument({
      type: 'sales-invoice',
      docNumber: 'INV-002',
      date: '2024-06-01',
      partyName: '<img src=x onerror=alert(1)>',
      partyLabel: '<script>alert</script>',
      lines: [{ description: '<img src=x onerror=alert(1)>', quantity: 1, unitPrice: 50, total: 50 }],
      subtotal: 50,
      vatAmount: 0,
      totalAmount: 50,
      companyName: '<svg onload=alert(1)>',
    });

    const html = mockWrite.mock.calls[0][0] as string;
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<svg onload');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;alert');
    expect(html).toContain('&lt;svg onload');

    openSpy.mockRestore();
  });

  it('renders premium chrome: accent bar, logo frame, and status ribbon', () => {
    const mockWrite = vi.fn();
    const mockWindow = {
      document: { open: vi.fn(), write: mockWrite, close: vi.fn() },
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printDocument({
      type: 'sales-invoice',
      docNumber: 'INV-009',
      date: '2024-06-01',
      partyName: 'عميل',
      partyLabel: 'العميل',
      lines: [{ description: 'صنف', quantity: 1, unitPrice: 100, total: 100 }],
      subtotal: 100,
      vatAmount: 15,
      totalAmount: 115,
      companyName: 'شركتي',
      companyLogoUrl: 'data:image/png;base64,AAA',
      statusBadge: 'مدفوعة',
      statusTone: 'success',
    });

    const html = mockWrite.mock.calls[0][0] as string;
    expect(html).toContain('page-accent-bar');
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('مدفوعة');
    expect(html).toContain('@page');

    openSpy.mockRestore();
  });

  it('renders a voucher amount centerpiece with amount in words', () => {
    const mockWrite = vi.fn();
    const mockWindow = {
      document: { open: vi.fn(), write: mockWrite, close: vi.fn() },
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    printDocument({
      type: 'receipt-voucher',
      docNumber: 'RV-001',
      date: '2024-06-01',
      partyName: 'عميل',
      partyLabel: 'العميل',
      lines: [{ description: 'قبض', total: 1000 }],
      subtotal: 1000,
      vatAmount: 0,
      totalAmount: 1000,
      companyName: 'شركتي',
    });

    const html = mockWrite.mock.calls[0][0] as string;
    expect(html).toContain('المبلغ');
    expect(html).toContain('بيان السند');

    openSpy.mockRestore();
  });

  it('shows alert when popup blocked', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    printDocument({
      type: 'receipt-voucher',
      docNumber: 'RV-001',
      date: '2024-06-01',
      partyName: 'شركة اليمن',
      partyLabel: 'العميل',
      lines: [{ description: 'قبض', total: 1000 }],
      subtotal: 1000,
      vatAmount: 0,
      totalAmount: 1000,
    });

    expect(alertSpy).toHaveBeenCalledWith('يرجى السماح بفتح النوافذ المنبثقة للطباعة');

    openSpy.mockRestore();
    alertSpy.mockRestore();
  });
});
