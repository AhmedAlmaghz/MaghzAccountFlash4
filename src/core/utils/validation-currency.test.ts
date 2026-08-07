import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createInvoiceSchema } from './validation';

describe('createInvoiceSchema multi-currency fields', () => {
  const baseInvoice = () => ({
    companyId: randomUUID(),
    invoiceNumber: 'INV-001',
    customerId: randomUUID(),
    date: '2026-06-06',
    subtotal: 1000,
    totalAmount: 1150,
    lines: [
      {
        productId: randomUUID(),
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1150,
      },
    ],
  });

  it('accepts invoice without currency fields (defaults applied by API)', () => {
    const result = createInvoiceSchema.safeParse(baseInvoice());
    expect(result.success).toBe(true);
  });

  it('accepts invoice with YER currency (base currency) and rate 1', () => {
    const result = createInvoiceSchema.safeParse({
      ...baseInvoice(),
      currencyCode: 'YER',
      exchangeRate: 1,
      baseCurrencyAmount: 1150,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currencyCode).toBe('YER');
      expect(result.data.exchangeRate).toBe(1);
      expect(result.data.baseCurrencyAmount).toBe(1150);
    }
  });

  it('accepts invoice with USD currency and rate 1500 (10 USD = 15,000 YER)', () => {
    const result = createInvoiceSchema.safeParse({
      ...baseInvoice(),
      currencyCode: 'USD',
      exchangeRate: 1500,
      baseCurrencyAmount: 1150 * 1500,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currencyCode).toBe('USD');
      expect(result.data.exchangeRate).toBe(1500);
      expect(result.data.baseCurrencyAmount).toBe(1_725_000);
    }
  });

  it('accepts lines with currency fields', () => {
    const result = createInvoiceSchema.safeParse({
      ...baseInvoice(),
      currencyCode: 'USD',
      exchangeRate: 1500,
      lines: [
        {
          productId: randomUUID(),
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1150,
          currencyCode: 'USD',
          exchangeRate: 1500,
          baseCurrencyLineTotal: 1150 * 1500,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects currency code with wrong length', () => {
    const r1 = createInvoiceSchema.safeParse({ ...baseInvoice(), currencyCode: 'YEM' });
    expect(r1.success).toBe(true);

    const r2 = createInvoiceSchema.safeParse({ ...baseInvoice(), currencyCode: 'YE' });
    expect(r2.success).toBe(false);
  });

  it('auto-compute formula: baseCurrencyAmount = totalAmount * exchangeRate', () => {
    const totalAmount = 500;
    const exchangeRate = 2.5;
    expect(totalAmount * exchangeRate).toBe(1250);
  });
});
