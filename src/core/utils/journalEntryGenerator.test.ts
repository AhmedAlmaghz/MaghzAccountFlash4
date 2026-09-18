import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  postSalesInvoice,
  postPurchaseInvoice,
  postReceiptVoucher,
  postPaymentVoucher,
  postSalesReturn,
  postPurchaseReturn,
  postInventoryTransaction,
  postStockAdjustment,
  buildSalesInvoicePostingStatements,
  buildPurchaseInvoicePostingStatements,
  buildSalesReturnPostingStatements,
  buildPurchaseReturnPostingStatements,
} from './journalEntryGenerator';

// Mock the database adapter
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';

function createMockAdapter(overrides?: Record<string, unknown>) {
  const accounts = [
    { id: 'acc-cash', company_id: 'comp-1', code: '11101', name: 'Cash' },
    { id: 'acc-bank', company_id: 'comp-1', code: '11102', name: 'Bank' },
    { id: 'acc-debtors', company_id: 'comp-1', code: '11201', name: 'Debtors' },
    { id: 'acc-inventory', company_id: 'comp-1', code: '11301', name: 'Inventory' },
    { id: 'acc-creditors', company_id: 'comp-1', code: '21101', name: 'Creditors' },
    { id: 'acc-vat', company_id: 'comp-1', code: '21301', name: 'VAT' },
    { id: 'acc-sales', company_id: 'comp-1', code: '41101', name: 'Sales' },
    { id: 'acc-sales-ret', company_id: 'comp-1', code: '41103', name: 'Sales Returns' },
    { id: 'acc-cogs', company_id: 'comp-1', code: '51101', name: 'COGS' },
    { id: 'acc-salaries', company_id: 'comp-1', code: '52101', name: 'Salaries' },
    { id: 'acc-rent-wh', company_id: 'comp-1', code: '52201', name: 'Rent WH' },
    { id: 'acc-rent-off', company_id: 'comp-1', code: '52202', name: 'Rent Office' },
    { id: 'acc-elec', company_id: 'comp-1', code: '52301', name: 'Electricity' },
    { id: 'acc-adv', company_id: 'comp-1', code: '52401', name: 'Advertising' },
    { id: 'acc-maint', company_id: 'comp-1', code: '52501', name: 'Maintenance' },
    { id: 'acc-ship', company_id: 'comp-1', code: '52601', name: 'Shipping' },
    // Phase 1 valuation accounts (migration 0029 seed)
    { id: 'acc-ppv', company_id: 'comp-1', code: '51901', name: 'Purchase Price Variance' },
    { id: 'acc-short', company_id: 'comp-1', code: '52901', name: 'Inventory Shortage' },
    { id: 'acc-surplus', company_id: 'comp-1', code: '41901', name: 'Inventory Surplus' },
    // Phase 2 FX differences (migration 0030 seed) + Phase 3 VAT split
    // (migration 0031 seed) — builders resolve these by code fallback.
    { id: 'acc-fx', company_id: 'comp-1', code: '52902', name: 'Exchange Differences' },
    { id: 'acc-vat-in', company_id: 'comp-1', code: '21302', name: 'VAT Input' },
  ];

  const defaultAccounts: Record<string, string> = {};

  const queryFn = vi.fn(async (sql: string, params: unknown[]) => {
    const lower = sql.toLowerCase();

    if (lower.includes('from default_accounts')) {
      const key = params[1] as string;
      const accId = defaultAccounts[key];
      return { success: true, rows: accId ? [{ account_id: accId }] : [] };
    }

    if (lower.includes('from accounts')) {
      const companyId = params[0] as string;
      const code = params[1] as string;
      const match = accounts.find(a => a.company_id === companyId && a.code === code);
      return { success: true, rows: match ? [{ id: match.id }] : [] };
    }

    return { success: true, rows: [] };
  });

  return {
    query: queryFn,
    createTransaction: vi.fn(async (_data: unknown) => {
      return { success: true, id: 'tx-' + Math.random().toString(36).substring(2, 8) };
    }),
    // Atomic batch: executes each statement through the same mocked query impl.
    transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
      try {
        const results = [];
        for (const q of queries) {
          const r = await queryFn(q.sql, q.params || []);
          if (!r.success) return { success: false, error: r.error };
          results.push({ rows: r.rows || [], rowCount: r.rows?.length || 0 });
        }
        return { success: true, results };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }),
    ...overrides,
  };
}

describe('journalEntryGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('postSalesInvoice', () => {
    it('posts a sales invoice successfully', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postSalesInvoice('comp-1', {
        invoiceNumber: 'INV-001',
        date: '2024-06-01',
        customerId: 'cust-1',
        subtotal: 1000,
        vatAmount: 50,
        totalAmount: 1050,
      });

      expect(result.success).toBe(true);
      expect(adapter.createTransaction).toHaveBeenCalled();
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.reference).toBe('INV-001');
      expect(txCall.entries).toHaveLength(3);
      expect(txCall.entries[0].debit).toBe(1050); // Debtors
      expect(txCall.entries[1].credit).toBe(1000); // Sales
      expect(txCall.entries[2].credit).toBe(50); // VAT
    });

    it('normalizes Date objects to YYYY-MM-DD before passing to createTransaction', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      // Simulate what node-postgres returns for a `timestamptz` column: a Date object.
      // Its `toString()` yields a locale-formatted string that PG cannot parse.
      // Constructed from LOCAL components so this assertion is exact on every
      // machine zone (an offset-built instant would resolve to the previous
      // day on UTC runners — see mapPgRow.test.ts).
      const dateAsDateObject = new Date(2026, 6, 13);

      const result = await postSalesInvoice('comp-1', {
        invoiceNumber: 'INV-002',
        date: dateAsDateObject as unknown as string,
        customerId: 'cust-1',
        subtotal: 100,
        vatAmount: 15,
        totalAmount: 115,
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.date).toBe('2026-07-13');
      expect(typeof txCall.date).toBe('string');
      expect(txCall.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('handles locale-formatted date strings without crashing', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      // This is the exact format PG rejected in production:
      // "Mon Jul 13 2026 00:00:00 GMT+0300 (...)"
      const localeDate = new Date('2026-07-13T00:00:00+03:00').toString();

      const result = await postSalesInvoice('comp-1', {
        invoiceNumber: 'INV-003',
        date: localeDate,
        customerId: 'cust-1',
        subtotal: 50,
        vatAmount: 7.5,
        totalAmount: 57.5,
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns error when required accounts missing', async () => {
      const adapter = createMockAdapter({
        query: vi.fn(async () => ({ success: true, rows: [] })),
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postSalesInvoice('comp-1', {
        invoiceNumber: 'INV-001',
        date: '2024-06-01',
        customerId: 'cust-1',
        subtotal: 1000,
        vatAmount: 50,
        totalAmount: 1050,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Required accounts not found');
    });
  });

  describe('postPurchaseInvoice', () => {
    it('posts a purchase invoice successfully', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postPurchaseInvoice('comp-1', {
        invoiceNumber: 'PINV-001',
        date: '2024-06-01',
        supplierId: 'sup-1',
        subtotal: 2000,
        vatAmount: 100,
        totalAmount: 2100,
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries).toHaveLength(3);
      expect(txCall.entries[0].debit).toBe(2000); // Inventory
      expect(txCall.entries[1].debit).toBe(100); // VAT input
      expect(txCall.entries[2].credit).toBe(2100); // Creditors
    });
  });

  describe('postReceiptVoucher', () => {
    it('posts a cash receipt voucher', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postReceiptVoucher('comp-1', {
        voucherNumber: 'RV-001',
        date: '2024-06-01',
        customer: 'شركة اليمن',
        amount: 5000,
        paymentMethod: 'cash',
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].debit).toBe(5000); // Cash
      expect(txCall.entries[1].credit).toBe(5000); // Debtors
    });

    it('posts a bank-method receipt voucher to the treasury account (banks unified)', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postReceiptVoucher('comp-1', {
        voucherNumber: 'RV-002',
        date: '2024-06-01',
        customer: 'شركة اليمن',
        amount: 8000,
        paymentMethod: 'bank',
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      // No banks anymore: the debit lands on default cash (11101)
      expect(txCall.entries[0].accountId).toBe('acc-cash');
    });
  });

  describe('postPaymentVoucher', () => {
    it('posts a payment to supplier', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postPaymentVoucher('comp-1', {
        voucherNumber: 'PV-001',
        date: '2024-06-01',
        supplier: 'مورد تجاري',
        amount: 3000,
        paymentMethod: 'cash',
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].debit).toBe(3000); // Creditors
      expect(txCall.entries[1].credit).toBe(3000); // Cash
    });

    it('posts a rent expense payment', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postPaymentVoucher('comp-1', {
        voucherNumber: 'PV-002',
        date: '2024-06-01',
        supplier: 'مصروفات',
        amount: 2000,
        paymentMethod: 'bank',
        expenseAccount: 'إيجار مستودع',
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].accountId).toBe('acc-rent-wh');
    });
  });

  describe('postSalesReturn', () => {
    it('posts a sales return successfully as one atomic transaction', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postSalesReturn('comp-1', {
        returnNumber: 'SR-001',
        date: '2024-06-01',
        customer: 'شركة اليمن',
        amount: 500,
      });

      expect(result.success).toBe(true);
      // Atomic contract: JE + stock movements run inside one adapter.transaction batch.
      expect(adapter.transaction).toHaveBeenCalledTimes(1);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      // No ret.id -> only the journal entry statement.
      expect(stmts.length).toBe(1);
      expect(stmts[0].sql).toContain('WITH new_tx');
      expect(stmts[0].sql).toContain('journal_entries');
      // Phase 1: without explicit costing the JE carries revenue + debtor
      // legs only (2 entries x 4 params + 6 header params) — the retired
      // 70%-of-amount estimate is gone.
      expect(stmts[0].params!.length).toBe(6 + 2 * 4);
    });

    it('reverses output VAT + original cost when costing is provided (Phase 1)', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postSalesReturn(
        'comp-1',
        { returnNumber: 'SR-002', date: '2024-06-01', customer: 'شركة اليمن', amount: 1150 },
        { subtotal: 1000, vatAmount: 150, costTotal: 700 }
      );

      expect(result.success).toBe(true);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      expect(stmts.length).toBe(1);
      // 5 legs: Dr returns 1000 + Dr VAT 150 + Cr debtors 1150 + Dr inventory 700 + Cr COGS 700
      expect(stmts[0].params!.length).toBe(6 + 5 * 4);
      const flat = stmts[0].params!;
      // entries layout: [acc, debit, credit, memo] × 5 starting at index 6
      const legs = [0, 1, 2, 3, 4].map((i) => ({
        acc: String(flat[6 + i * 4]),
        debit: Number(flat[6 + i * 4 + 1]),
        credit: Number(flat[6 + i * 4 + 2]),
      }));
      expect(legs[0]).toMatchObject({ debit: 1000, credit: 0 });
      expect(legs[1]).toMatchObject({ debit: 150, credit: 0 });
      expect(legs[2]).toMatchObject({ debit: 0, credit: 1150 });
      expect(legs[3]).toMatchObject({ debit: 700, credit: 0 });
      expect(legs[4]).toMatchObject({ debit: 0, credit: 700 });
      // balanced by construction
      const dr = legs.reduce((s, l) => s + l.debit, 0);
      const cr = legs.reduce((s, l) => s + l.credit, 0);
      expect(dr).toBe(cr);
    });
  });

  describe('postPurchaseReturn', () => {
    it('posts a purchase return successfully as one atomic transaction', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postPurchaseReturn('comp-1', {
        returnNumber: 'PR-001',
        date: '2024-06-01',
        supplier: 'مورد تجاري',
        amount: 1000,
      });

      expect(result.success).toBe(true);
      expect(adapter.transaction).toHaveBeenCalledTimes(1);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      expect(stmts.length).toBe(1);
      expect(stmts[0].sql).toContain('WITH new_tx');
    });
  });

  describe('postInventoryTransaction', () => {
    it('posts inventory in transaction', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postInventoryTransaction('comp-1', {
        reference: 'IT-001',
        date: '2024-06-01',
        type: 'in',
        product: 'منتج أ',
        amount: 5000,
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].debit).toBe(5000); // Inventory
      expect(txCall.entries[1].credit).toBe(5000); // Cash
    });

    it('posts inventory out transaction', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postInventoryTransaction('comp-1', {
        reference: 'IT-002',
        date: '2024-06-01',
        type: 'out',
        product: 'منتج أ',
        amount: 3000,
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].debit).toBe(3000); // COGS
      expect(txCall.entries[1].credit).toBe(3000); // Inventory
    });

    it('skips adjustment type', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postInventoryTransaction('comp-1', {
        reference: 'IT-003',
        date: '2024-06-01',
        type: 'adjustment',
        product: 'منتج أ',
        amount: 1000,
      });

      expect(result.success).toBe(true);
      expect(adapter.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('postStockAdjustment', () => {
    it('posts positive adjustment (found) to the surplus account, never COGS', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      // Legacy monetary-difference callers pass unitCost 1 (difference IS money).
      const result = await postStockAdjustment('comp-1', {
        id: 'ADJ-001',
        date: '2024-06-01',
        product: 'منتج أ',
        difference: 50,
        reason: 'عثور',
        unitCost: 1,
      });

      expect(result.success).toBe(true);
      expect(adapter.transaction).toHaveBeenCalledTimes(1);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      expect(stmts.length).toBe(1);
      const flat = stmts[0].params!;
      const legs = [0, 1].map((i) => ({
        acc: String(flat[6 + i * 4]),
        debit: Number(flat[6 + i * 4 + 1]),
        credit: Number(flat[6 + i * 4 + 2]),
      }));
      expect(legs[0]).toMatchObject({ acc: 'acc-inventory', debit: 50, credit: 0 });
      expect(legs[1]).toMatchObject({ acc: 'acc-surplus', debit: 0, credit: 50 });
    });

    it('posts negative adjustment (lost) to the shortage account', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postStockAdjustment('comp-1', {
        id: 'ADJ-002',
        date: '2024-06-01',
        product: 'منتج أ',
        difference: -30,
        reason: 'فاقد',
        unitCost: 1,
      });

      expect(result.success).toBe(true);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      const flat = stmts[0].params!;
      const legs = [0, 1].map((i) => ({
        acc: String(flat[6 + i * 4]),
        debit: Number(flat[6 + i * 4 + 1]),
        credit: Number(flat[6 + i * 4 + 2]),
      }));
      expect(legs[0]).toMatchObject({ acc: 'acc-short', debit: 30, credit: 0 });
      expect(legs[1]).toMatchObject({ acc: 'acc-inventory', debit: 0, credit: 30 });
    });

    it('values quantity differences by unit cost (never raw qty as money)', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postStockAdjustment('comp-1', {
        id: 'ADJ-004',
        date: '2024-06-01',
        product: 'منتج أ',
        difference: 10,
        reason: 'عثور',
        unitCost: 5000,
      });

      expect(result.success).toBe(true);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      const flat = stmts[0].params!;
      // 10 units at 5000 each — the old code would have posted 10 riyals
      expect(Number(flat[6 + 1])).toBe(50000);
      expect(Number(flat[6 + 4 + 2])).toBe(50000);
    });

    it('skips zero difference', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postStockAdjustment('comp-1', {
        id: 'ADJ-003',
        date: '2024-06-01',
        product: 'منتج أ',
        difference: 0,
        reason: 'بدون',
      });

      expect(result.success).toBe(true);
      expect(adapter.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('return posting statements consume base quantities (multi-unit)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('sales return movement + stock update use COALESCE base_quantity', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildSalesReturnPostingStatements('comp-1', {
        id: 'ret-1',
        returnNumber: 'SR-001',
        date: '2024-06-01',
        customer: 'عميل',
        amount: 500,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      const movement = res.statements.find((s) => s.sql.includes('INSERT INTO stock_movements'));
      expect(movement).toBeDefined();
      expect(movement!.sql).toContain("'in', COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity)");
      const update = res.statements.find((s) => s.sql.includes('UPDATE stock s SET'));
      expect(update).toBeDefined();
      expect(update!.sql).toContain('SUM(COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity))');
    });

    it('purchase return movement + stock update use COALESCE base_quantity', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildPurchaseReturnPostingStatements('comp-1', {
        id: 'ret-1',
        returnNumber: 'PR-001',
        date: '2024-06-01',
        supplier: 'مورد',
        amount: 1000,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      const movement = res.statements.find((s) => s.sql.includes('INSERT INTO stock_movements'));
      expect(movement).toBeDefined();
      expect(movement!.sql).toContain("'out', COALESCE(NULLIF(prl.base_quantity, 0), prl.quantity)");
      const update = res.statements.find((s) => s.sql.includes('UPDATE stock s SET'));
      expect(update).toBeDefined();
      expect(update!.sql).toContain('SUM(COALESCE(NULLIF(prl.base_quantity, 0), prl.quantity))');
    });
  });

  describe('Phase 1 valuation postings', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('sales invoice appends a balanced COGS companion JE (separate reference)', async () => {
      const stmts = buildSalesInvoicePostingStatements(
        'comp-1',
        { invoiceNumber: 'INV-9', date: '2026-09-01', subtotal: 1000, vatAmount: 150, totalAmount: 1150 },
        { debtors: 'acc-debtors', sales: 'acc-sales', vat: 'acc-vat' },
        { total: 700, inventoryAccount: 'acc-inventory', cogsAccount: 'acc-cogs' }
      );
      expect(stmts).toHaveLength(2);
      // The reference travels as a bound param (never inlined in SQL).
      expect(stmts[1].params).toContain('INV-9-COGS');
      const flat = stmts[1].params!;
      const legs = [0, 1].map((i) => ({
        acc: String(flat[6 + i * 4]),
        debit: Number(flat[6 + i * 4 + 1]),
        credit: Number(flat[6 + i * 4 + 2]),
      }));
      expect(legs[0]).toMatchObject({ acc: 'acc-cogs', debit: 700, credit: 0 });
      expect(legs[1]).toMatchObject({ acc: 'acc-inventory', debit: 0, credit: 700 });
    });

    it('sales invoice without cogs stays a 3-leg JE (backward compatible)', async () => {
      const stmts = buildSalesInvoicePostingStatements(
        'comp-1',
        { invoiceNumber: 'INV-9', date: '2026-09-01', subtotal: 1000, vatAmount: 150, totalAmount: 1150 },
        { debtors: 'acc-debtors', sales: 'acc-sales', vat: 'acc-vat' }
      );
      expect(stmts).toHaveLength(1);
    });

    it('standard purchase books inventory at standard + PPV legs balance', async () => {
      const stmts = buildPurchaseInvoicePostingStatements(
        'comp-1',
        { invoiceNumber: 'PINV-9', date: '2026-09-01', subtotal: 1100, vatAmount: 0, totalAmount: 1100 },
        { inventory: 'acc-inventory', creditors: 'acc-creditors', vat: 'acc-vat' },
        { inventoryAmount: 1000, varianceAmount: 100, varianceAccount: 'acc-ppv' }
      );
      expect(stmts).toHaveLength(1);
      const flat = stmts[0].params!;
      const n = (flat.length - 6) / 4;
      const legs = Array.from({ length: n }, (_, i) => ({
        acc: String(flat[6 + i * 4]),
        debit: Number(flat[6 + i * 4 + 1]),
        credit: Number(flat[6 + i * 4 + 2]),
      }));
      expect(legs.find((l) => l.acc === 'acc-inventory')).toMatchObject({ debit: 1000 });
      expect(legs.find((l) => l.acc === 'acc-ppv')).toMatchObject({ debit: 100 });
      expect(legs.find((l) => l.acc === 'acc-creditors')).toMatchObject({ credit: 1100 });
      const dr = legs.reduce((s, l) => s + l.debit, 0);
      const cr = legs.reduce((s, l) => s + l.credit, 0);
      expect(dr).toBe(cr);
    });

    it('purchase return reverses input VAT and plugs the price gap to PPV', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildPurchaseReturnPostingStatements(
        'comp-1',
        { returnNumber: 'PR-9', date: '2026-09-01', supplier: 'مورد', amount: 1150 },
        { subtotal: 1000, vatAmount: 150, costBasis: 900 }
      );
      expect(res.success).toBe(true);
      if (!res.success) return;
      const je = res.statements.find((s) => s.sql.includes('WITH new_tx'))!;
      const flat = je.params!;
      const n = (flat.length - 6) / 4;
      const legs = Array.from({ length: n }, (_, i) => ({
        acc: String(flat[6 + i * 4]),
        debit: Number(flat[6 + i * 4 + 1]),
        credit: Number(flat[6 + i * 4 + 2]),
      }));
      // gap = costBasis - subtotal = 900 - 1000 < 0, so Cr PPV 100 (saving).
      // Input VAT reverses to the Phase-3 split account 21302 (acc-vat-in),
      // not the output account 21301.
      expect(legs.find((l) => l.acc === 'acc-creditors')).toMatchObject({ debit: 1150 });
      expect(legs.find((l) => l.acc === 'acc-inventory')).toMatchObject({ credit: 900 });
      expect(legs.find((l) => l.acc === 'acc-vat-in')).toMatchObject({ credit: 150 });
      expect(legs.find((l) => l.acc === 'acc-ppv')).toMatchObject({ credit: 100 });
      const dr = legs.reduce((s, l) => s + l.debit, 0);
      const cr = legs.reduce((s, l) => s + l.credit, 0);
      expect(dr).toBe(cr);
    });
  });
});

