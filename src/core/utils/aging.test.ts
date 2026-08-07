import { describe, it, expect } from 'vitest';
import {
  AGING_BUCKETS,
  aggregateCustomerAging,
  aggregateSupplierAging,
  computeAgingTotals,
  todayIso,
} from './aging';

describe('aging', () => {
  describe('AGING_BUCKETS', () => {
    it('has 4 standard buckets', () => {
      expect(AGING_BUCKETS).toHaveLength(4);
      expect(AGING_BUCKETS[0]).toEqual({ label: '0-30', minDays: 0, maxDays: 30 });
      expect(AGING_BUCKETS[1]).toEqual({ label: '31-60', minDays: 31, maxDays: 60 });
      expect(AGING_BUCKETS[2]).toEqual({ label: '61-90', minDays: 61, maxDays: 90 });
      expect(AGING_BUCKETS[3]).toEqual({ label: '90+', minDays: 91, maxDays: null });
    });
  });

  describe('aggregateCustomerAging', () => {
    const customers = [
      { id: 'c1', name: 'Alice', phone: '111', balance: 0 },
      { id: 'c2', name: 'Bob', phone: '222', balance: 0 },
    ];

    it('returns empty aging when no outstanding rows', () => {
      const result = aggregateCustomerAging([], '2026-06-04', customers);
      expect(result).toHaveLength(2);
      expect(result[0].totalOutstanding).toBe(0);
      expect(result[0].invoiceCount).toBe(0);
    });

    it('buckets invoice to 0-30 when within 30 days of due date', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-05-01', due_date: '2026-05-31', outstanding: 1000 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.bucket0to30).toBe(1000);
      expect(alice.bucket31to60).toBe(0);
      expect(alice.totalOutstanding).toBe(1000);
      expect(alice.invoiceCount).toBe(1);
      expect(alice.lastInvoice).toBe('2026-05-01');
    });

    it('buckets invoice to 31-60 when 31-60 days past due', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-04-15', due_date: '2026-04-20', outstanding: 500 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.bucket31to60).toBe(500);
    });

    it('buckets invoice to 61-90 when 61-90 days past due', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-03-15', due_date: '2026-03-20', outstanding: 750 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.bucket61to90).toBe(750);
    });

    it('buckets invoice to 90+ when over 90 days past due', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2025-01-01', due_date: '2025-01-31', outstanding: 2000 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.bucket90plus).toBe(2000);
    });

    it('skips invoices with non-positive outstanding', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-05-01', due_date: '2026-05-31', outstanding: 0 },
        { customer_id: 'c1', invoice_number: 'INV-2', date: '2026-05-01', due_date: '2026-05-31', outstanding: -100 },
        { customer_id: 'c1', invoice_number: 'INV-3', date: '2026-05-01', due_date: '2026-05-31', outstanding: 500 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.totalOutstanding).toBe(500);
      expect(alice.invoiceCount).toBe(1);
    });

    it('uses date as fallback when due_date is null', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-05-15', due_date: null, outstanding: 100 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.bucket0to30).toBe(100);
    });

    it('aggregates multiple invoices for same customer', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-05-20', due_date: '2026-05-25', outstanding: 100 },
        { customer_id: 'c1', invoice_number: 'INV-2', date: '2025-01-01', due_date: '2025-01-15', outstanding: 200 },
        { customer_id: 'c1', invoice_number: 'INV-3', date: '2026-04-20', due_date: '2026-04-25', outstanding: 50 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      const alice = result.find((c) => c.customerId === 'c1')!;
      expect(alice.bucket0to30).toBe(100);
      expect(alice.bucket90plus).toBe(200);
      expect(alice.bucket31to60).toBe(50);
      expect(alice.totalOutstanding).toBe(350);
      expect(alice.invoiceCount).toBe(3);
      expect(alice.lastInvoice).toBe('2026-05-20');
    });

    it('sorts by totalOutstanding descending', () => {
      const rows = [
        { customer_id: 'c1', invoice_number: 'INV-1', date: '2026-05-01', due_date: '2026-05-15', outstanding: 100 },
        { customer_id: 'c2', invoice_number: 'INV-2', date: '2026-05-01', due_date: '2026-05-15', outstanding: 1000 },
      ];
      const result = aggregateCustomerAging(rows, '2026-06-04', customers);
      expect(result[0].customerId).toBe('c2');
      expect(result[1].customerId).toBe('c1');
    });
  });

  describe('aggregateSupplierAging', () => {
    const suppliers = [
      { id: 's1', name: 'Acme', phone: '111', balance: 0 },
    ];

    it('aggregates supplier outstanding', () => {
      const rows = [
        { supplier_id: 's1', invoice_number: 'PO-1', date: '2026-05-01', due_date: '2026-05-15', outstanding: 800 },
      ];
      const result = aggregateSupplierAging(rows, '2026-06-04', suppliers);
      expect(result[0].supplierId).toBe('s1');
      expect(result[0].totalOutstanding).toBe(800);
      expect(result[0].bucket0to30).toBe(800);
    });
  });

  describe('computeAgingTotals', () => {
    it('sums all buckets', () => {
      const rows = [
        { totalOutstanding: 100, bucket0to30: 100, bucket31to60: 0, bucket61to90: 0, bucket90plus: 0 },
        { totalOutstanding: 200, bucket0to30: 50, bucket31to60: 150, bucket61to90: 0, bucket90plus: 0 },
        { totalOutstanding: 500, bucket0to30: 0, bucket31to60: 0, bucket61to90: 200, bucket90plus: 300 },
      ];
      const totals = computeAgingTotals(rows);
      expect(totals.total0to30).toBe(150);
      expect(totals.total31to60).toBe(150);
      expect(totals.total61to90).toBe(200);
      expect(totals.total90plus).toBe(300);
      expect(totals.totalOutstanding).toBe(800);
      expect(totals.count0to30).toBe(2);
      expect(totals.count31to60).toBe(1);
      expect(totals.count61to90).toBe(1);
      expect(totals.count90plus).toBe(1);
    });

    it('returns zeros for empty input', () => {
      const totals = computeAgingTotals([]);
      expect(totals.totalOutstanding).toBe(0);
      expect(totals.count0to30).toBe(0);
    });
  });

  describe('todayIso', () => {
    it('returns YYYY-MM-DD format', () => {
      const result = todayIso();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
