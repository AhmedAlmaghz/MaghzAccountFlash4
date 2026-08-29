import { describe, it, expect } from 'vitest';
import {
  salesInvoiceFingerprint,
  purchaseInvoiceFingerprint,
  receiptVoucherFingerprint,
  journalEntryFingerprint,
  detectSalesInvoiceDuplicate,
  detectVoucherDuplicate,
} from './documentDuplicate';

describe('documentDuplicate', () => {
  it('sales invoice fingerprint is stable (sorted, normalized date/numbers)', () => {
    const a = salesInvoiceFingerprint({
      customerId: 'c1',
      date: '2026-08-10T00:00:00.000Z',
      currencyCode: 'YER',
      totalAmount: 1000,
      discountAmount: 50,
      vatAmount: 142.5,
    });
    const b = salesInvoiceFingerprint({
      customerId: 'c1',
      date: '2026-08-10',
      currencyCode: 'YER',
      totalAmount: 1000.0,
      discountAmount: 50.0,
      vatAmount: 142.5,
    });
    expect(a).toBe(b);
  });

  it('detects exact sales invoice duplicate (header)', () => {
    const input = {
      customerId: 'cust-1',
      date: '2026-08-10',
      currencyCode: 'YER',
      totalAmount: 5000,
      discountAmount: 0,
      vatAmount: 750,
    };
    const existing = [
      { id: 'inv-1', status: 'posted', customerId: 'cust-1', date: '2026-08-10', currencyCode: 'YER', totalAmount: 5000, discountAmount: 0, vatAmount: 750 },
      { id: 'inv-2', status: 'posted', customerId: 'cust-2', date: '2026-08-10', currencyCode: 'YER', totalAmount: 5000, discountAmount: 0, vatAmount: 750 },
    ];
    const res = detectSalesInvoiceDuplicate(input as never, existing as never);
    expect(res.exactMatch).not.toBeNull();
    expect((res.exactMatch as { id: string }).id).toBe('inv-1');
  });

  it('ignores cancelled documents', () => {
    const input = { customerId: 'c1', date: '2026-08-10', currencyCode: 'YER', totalAmount: 100, discountAmount: 0, vatAmount: 15 };
    const existing = [{ id: 'x', status: 'cancelled', customerId: 'c1', date: '2026-08-10', currencyCode: 'YER', totalAmount: 100, discountAmount: 0, vatAmount: 15 }];
    const res = detectSalesInvoiceDuplicate(input as never, existing as never);
    expect(res.hasDuplicates).toBe(false);
  });

  it('excludes self when editing', () => {
    const input = { customerId: 'c1', date: '2026-08-10', currencyCode: 'YER', totalAmount: 100, discountAmount: 0, vatAmount: 15 };
    const existing = [{ id: 'self', status: 'draft', customerId: 'c1', date: '2026-08-10', currencyCode: 'YER', totalAmount: 100, discountAmount: 0, vatAmount: 15 }];
    const res = detectSalesInvoiceDuplicate(input as never, existing as never, 'self');
    expect(res.hasDuplicates).toBe(false);
  });

  it('detects voucher exact (same party/date/amount)', () => {
    const input = { partyId: 'cust-1', date: '2026-08-10', amount: 1000, currencyCode: 'YER', paymentMethod: 'cash' };
    const existing = [
      { id: 'rv-1', status: 'posted', customerId: 'cust-1', date: '2026-08-10', amount: 1000, currencyCode: 'YER', paymentMethod: 'cash' },
    ];
    const res = detectVoucherDuplicate(input, existing as never);
    expect(res.exactMatch).not.toBeNull();
  });

  it('voucher near via total similarity', () => {
    const input = { partyId: 'cust-1', date: '2026-08-10', amount: 1000, currencyCode: 'YER' };
    const existing = [
      { id: 'rv-1', status: 'posted', customerId: 'cust-1', date: '2026-08-10', amount: 1005, currencyCode: 'YER' },
    ];
    const res = detectVoucherDuplicate(input, existing as never);
    // 1000 vs 1005 => 0.995 similarity, plus same party/date => near
    expect(res.exactMatch).toBeNull();
    expect(res.nearMatches.length).toBeGreaterThan(0);
  });

  it('purchase invoice fingerprint ignores currency case', () => {
    const a = purchaseInvoiceFingerprint({ supplierId: 's1', date: '2026-08-10', currencyCode: 'yer', totalAmount: 2000 });
    const b = purchaseInvoiceFingerprint({ supplierId: 's1', date: '2026-08-10', currencyCode: 'YER', totalAmount: 2000 });
    expect(a).toBe(b);
  });

  it('journal fingerprint includes description and lines', () => {
    const a = journalEntryFingerprint({ date: '2026-08-10', description: 'افتتاحي', lines: [{ accountId: 'a1', debit: 100, credit: 0 }] });
    const b = journalEntryFingerprint({ date: '2026-08-10', description: 'افتتاحي', lines: [{ accountId: 'a1', debit: 100, credit: 0 }] });
    const c = journalEntryFingerprint({ date: '2026-08-10', description: 'مختلف', lines: [{ accountId: 'a1', debit: 100, credit: 0 }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('receipt voucher fingerprint stable', () => {
    const a = receiptVoucherFingerprint({ customerId: 'c1', date: '2026-08-10', amount: 500, currencyCode: 'YER', paymentMethod: 'cash' });
    const b = receiptVoucherFingerprint({ customerId: 'c1', date: '2026-08-10', amount: 500.0, currencyCode: 'YER', paymentMethod: 'cash' });
    expect(a).toBe(b);
  });
});
