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
