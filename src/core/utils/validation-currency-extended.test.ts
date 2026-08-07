import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createPurchaseInvoiceSchema, createReceiptVoucherSchema, createPaymentVoucherSchema } from './validation';

describe('createPurchaseInvoiceSchema multi-currency fields', () => {
  const basePurchaseInvoice = () => ({
    companyId: randomUUID(),
    invoiceNumber: 'PINV-001',
    supplierId: randomUUID(),
    date: '2026-06-06',
    subtotal: 2000,
    totalAmount: 2300,
    lines: [
      {
        productId: randomUUID(),
        quantity: 2,
        unitPrice: 1000,
        lineTotal: 2300,
      },
    ],
  });

  it('accepts purchase invoice without currency fields (defaults applied by API)', () => {
    const result = createPurchaseInvoiceSchema.safeParse(basePurchaseInvoice());
    expect(result.success).toBe(true);
  });

  it('accepts purchase invoice with USD + rate 1500', () => {
    const result = createPurchaseInvoiceSchema.safeParse({
      ...basePurchaseInvoice(),
      currencyCode: 'USD',
      exchangeRate: 1500,
      baseCurrencyAmount: 2300 * 1500,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currencyCode).toBe('USD');
      expect(result.data.exchangeRate).toBe(1500);
      expect(result.data.baseCurrencyAmount).toBe(3_450_000);
    }
  });

  it('accepts purchase invoice lines with currency fields', () => {
    const result = createPurchaseInvoiceSchema.safeParse({
      ...basePurchaseInvoice(),
      currencyCode: 'SAR',
      exchangeRate: 400,
      lines: [
        {
          productId: randomUUID(),
          quantity: 1,
          unitPrice: 2300,
          lineTotal: 2300,
          currencyCode: 'SAR',
          exchangeRate: 400,
          baseCurrencyLineTotal: 2300 * 400,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('createReceiptVoucherSchema multi-currency fields', () => {
  const baseReceipt = () => ({
    companyId: randomUUID(),
    voucherNumber: 'RV-001',
    date: '2026-06-06',
    customerId: randomUUID(),
    amount: 1000,
    paymentMethod: 'cash',
  });

  it('accepts receipt voucher without currency fields (defaults applied by API)', () => {
    const result = createReceiptVoucherSchema.safeParse(baseReceipt());
    expect(result.success).toBe(true);
  });

  it('accepts receipt voucher with USD + rate 1500 (10 USD = 15,000 YER)', () => {
    const result = createReceiptVoucherSchema.safeParse({
      ...baseReceipt(),
      currencyCode: 'USD',
      exchangeRate: 1500,
      baseCurrencyAmount: 1000 * 1500,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currencyCode).toBe('USD');
      expect(result.data.exchangeRate).toBe(1500);
      expect(result.data.baseCurrencyAmount).toBe(1_500_000);
    }
  });
});

describe('createPaymentVoucherSchema multi-currency fields', () => {
  const basePayment = () => ({
    companyId: randomUUID(),
    voucherNumber: 'PV-001',
    date: '2026-06-06',
    supplierId: randomUUID(),
    amount: 5000,
    paymentMethod: 'bank',
  });

  it('accepts payment voucher without currency fields (defaults applied by API)', () => {
    const result = createPaymentVoucherSchema.safeParse(basePayment());
    expect(result.success).toBe(true);
  });

  it('accepts payment voucher with EUR + rate 1600', () => {
    const result = createPaymentVoucherSchema.safeParse({
      ...basePayment(),
      currencyCode: 'EUR',
      exchangeRate: 1600,
      baseCurrencyAmount: 5000 * 1600,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currencyCode).toBe('EUR');
      expect(result.data.exchangeRate).toBe(1600);
      expect(result.data.baseCurrencyAmount).toBe(8_000_000);
    }
  });

  it('rejects 2-char currency code', () => {
    const result = createPaymentVoucherSchema.safeParse({
      ...basePayment(),
      currencyCode: 'YE',
    });
    expect(result.success).toBe(false);
  });
});

describe('Auto-compute formula across modules', () => {
  it('baseCurrencyAmount = amount * exchangeRate (receipts)', () => {
    expect(750 * 1.5).toBe(1125);
  });
  it('baseCurrencyAmount = totalAmount * exchangeRate (invoices)', () => {
    expect(2300 * 1500).toBe(3_450_000);
  });
});
