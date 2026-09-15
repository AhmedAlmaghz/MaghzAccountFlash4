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
  buildPosSalePostingStatements,
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
    { id: 'acc-disc-allowed', company_id: 'comp-1', code: '41201', name: 'Sales Discounts Allowed' },
    { id: 'acc-disc-earned', company_id: 'comp-1', code: '42101', name: 'Purchase Discounts Earned' },
    { id: 'acc-cogs', company_id: 'comp-1', code: '51101', name: 'COGS' },
    { id: 'acc-salaries', company_id: 'comp-1', code: '52101', name: 'Salaries' },
    { id: 'acc-rent-wh', company_id: 'comp-1', code: '52201', name: 'Rent WH' },
    { id: 'acc-rent-off', company_id: 'comp-1', code: '52202', name: 'Rent Office' },
    { id: 'acc-elec', company_id: 'comp-1', code: '52301', name: 'Electricity' },
    { id: 'acc-adv', company_id: 'comp-1', code: '52401', name: 'Advertising' },
    { id: 'acc-maint', company_id: 'comp-1', code: '52501', name: 'Maintenance' },
    { id: 'acc-ship', company_id: 'comp-1', code: '52601', name: 'Shipping' },
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
      // No ret.id and no cogsReversal -> only the 2-leg revenue reversal.
      expect(stmts.length).toBe(1);
      expect(stmts[0].sql).toContain('WITH new_tx');
      expect(stmts[0].sql).toContain('journal_entries');
      // 2 entries x 4 params + 6 header params
      expect(stmts[0].params!.length).toBe(6 + 2 * 4);
    });

    it('books the actual-cost COGS reversal instead of any ratio guess', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postSalesReturn('comp-1', {
        returnNumber: 'SR-002',
        date: '2024-06-01',
        customer: 'شركة اليمن',
        amount: 500,
        cogsReversal: 320,
      });

      expect(result.success).toBe(true);
      const stmts = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params: unknown[] }>;
      expect(stmts.length).toBe(1);
      // 4 entries x 4 params + 6 header params
      expect(stmts[0].params!.length).toBe(6 + 4 * 4);
      const params = stmts[0].params!;
      // entry order: sales-returns Dr, debtors Cr, inventory Dr, COGS Cr
      expect(params).toContain('acc-inventory');
      expect(params).toContain('acc-cogs');
      const amounts = params.filter((p) => typeof p === 'number');
      expect(amounts).toContain(320);
      expect(amounts).not.toContain(Math.floor(500 * 0.7)); // no 70% guess
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
    it('posts positive adjustment (found)', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postStockAdjustment('comp-1', {
        id: 'ADJ-001',
        date: '2024-06-01',
        product: 'منتج أ',
        difference: 50,
        reason: 'عثور',
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].debit).toBe(50); // Inventory
      expect(txCall.entries[1].credit).toBe(50); // COGS / Income
    });

    it('posts negative adjustment (lost)', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const result = await postStockAdjustment('comp-1', {
        id: 'ADJ-002',
        date: '2024-06-01',
        product: 'منتج أ',
        difference: -30,
        reason: 'فاقد',
      });

      expect(result.success).toBe(true);
      const txCall = adapter.createTransaction.mock.calls[0][0];
      expect(txCall.entries[0].debit).toBe(30); // COGS / Loss
      expect(txCall.entries[1].credit).toBe(30); // Inventory
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

  describe('perpetual COGS legs (IAS 2)', () => {
    const ids = { debtors: 'acc-debtors', sales: 'acc-sales', vat: 'acc-vat', cogs: 'acc-cogs', inventory: 'acc-inventory' };

    it('sales invoice builder appends Dr COGS / Cr Inventory when cogsAmount > 0', () => {
      const [stmt] = buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-901',
        date: '2026-01-01',
        subtotal: 1000,
        vatAmount: 150,
        totalAmount: 1150,
        cogsAmount: 640,
      }, ids);
      const params = stmt.params!;
      // 5 entries x 4 params + 6 header params
      expect(params.length).toBe(6 + 5 * 4);
      expect(params).toContain('acc-cogs');
      expect(params).toContain('acc-inventory');
      const cogsIdx = params.indexOf('acc-cogs');
      expect(params[cogsIdx + 1]).toBe(640); // debit
      expect(params[cogsIdx + 2]).toBe(0); // credit
      const invIdx = params.lastIndexOf('acc-inventory');
      expect(params[invIdx + 1]).toBe(0);
      expect(params[invIdx + 2]).toBe(640); // credit
    });

    it('sales invoice builder skips COGS legs when amount is zero or accounts absent', () => {
      const [zero] = buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-902', date: '2026-01-01', subtotal: 100, vatAmount: 15, totalAmount: 115, cogsAmount: 0,
      }, ids);
      expect(zero.params!.length).toBe(6 + 3 * 4);
      const [noAccts] = buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-903', date: '2026-01-01', subtotal: 100, vatAmount: 15, totalAmount: 115, cogsAmount: 70,
      }, { debtors: 'acc-debtors', sales: 'acc-sales', vat: 'acc-vat' });
      expect(noAccts.params!.length).toBe(6 + 3 * 4);
    });

    it('POS builder appends the same COGS legs for mixed sales', () => {
      const [stmt] = buildPosSalePostingStatements('comp-1', {
        invoiceNumber: 'POS-001',
        receiptNumber: 'POS-001',
        date: '2026-01-01',
        subtotal: 200,
        vatAmount: 0,
        totalAmount: 200,
        cashAmount: 120,
        creditAmount: 80,
        cashAccountId: 'acc-cash',
        cogsAmount: 130,
      }, ids);
      const params = stmt.params!;
      expect(params).toContain('acc-cogs');
      expect(params).toContain('acc-inventory');
      const cogsIdx = params.indexOf('acc-cogs');
      expect(params[cogsIdx + 1]).toBe(130);
      expect(params[cogsIdx + 2]).toBe(0);
    });

    it('sales return builder reverses the ACTUAL cost, never a ratio', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildSalesReturnPostingStatements('comp-1', {
        returnNumber: 'SR-901',
        date: '2026-01-01',
        customer: 'عميل',
        amount: 500,
        cogsReversal: 320,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      const je = res.statements[0];
      expect(je.params!.length).toBe(6 + 4 * 4);
      expect(je.params).toContain('acc-inventory');
      expect(je.params).toContain('acc-cogs');
      const amounts = je.params!.filter((p) => typeof p === 'number');
      expect(amounts).toContain(320);
      expect(amounts).not.toContain(Math.floor(500 * 0.7));
    });

    it('sales return builder omits reversal legs when cogsReversal is zero', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildSalesReturnPostingStatements('comp-1', {
        returnNumber: 'SR-902',
        date: '2026-01-01',
        customer: 'عميل',
        amount: 500,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.statements[0].params!.length).toBe(6 + 2 * 4);
    });
  });

  describe('explicit discount legs (gross method)', () => {
    const salesIds = { debtors: 'acc-debtors', sales: 'acc-sales', vat: 'acc-vat', cogs: 'acc-cogs', inventory: 'acc-inventory', discount: 'acc-disc-allowed' };

    function legSums(params: unknown[]) {
      const legs = [];
      for (let i = 6; i < params.length; i += 4) {
        legs.push({ account: params[i], debit: Number(params[i + 1]), credit: Number(params[i + 2]) });
      }
      const dr = legs.reduce((s, l) => s + l.debit, 0);
      const cr = legs.reduce((s, l) => s + l.credit, 0);
      return { legs, dr, cr };
    }

    it('sales invoice books Dr Debtors + Dr Discount = Cr Gross Sales + Cr VAT', () => {
      // subtotal 1000 (net of lines) + header discount 100, VAT 15% on 900.
      const [stmt] = buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-D1', date: '2026-01-01',
        subtotal: 1000, vatAmount: 135, totalAmount: 1035,
        discountAmount: 100, grossSubtotal: 1000,
      }, salesIds);
      const { legs, dr, cr } = legSums(stmt.params!);
      expect(legs).toHaveLength(4);
      expect(dr).toBeCloseTo(cr, 2);
      expect(legs[0]).toMatchObject({ account: 'acc-debtors', debit: 1035, credit: 0 });
      expect(legs[1]).toMatchObject({ account: 'acc-disc-allowed', debit: 100, credit: 0 });
      expect(legs[2]).toMatchObject({ account: 'acc-sales', debit: 0, credit: 1000 });
      expect(legs[3]).toMatchObject({ account: 'acc-vat', debit: 0, credit: 135 });
    });

    it('sales invoice keeps the classic 3-leg shape when discount is zero', () => {
      const [stmt] = buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-D2', date: '2026-01-01',
        subtotal: 1000, vatAmount: 150, totalAmount: 1150,
      }, salesIds);
      expect(stmt.params!.length).toBe(6 + 3 * 4);
    });

    it('sales invoice throws when discount is positive but the account is missing', () => {
      expect(() => buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-D3', date: '2026-01-01',
        subtotal: 1000, vatAmount: 135, totalAmount: 1035,
        discountAmount: 100, grossSubtotal: 1000,
      }, { debtors: 'acc-debtors', sales: 'acc-sales', vat: 'acc-vat' })).toThrow();
    });

    it('sales invoice throws when discount exceeds gross', () => {
      expect(() => buildSalesInvoicePostingStatements('comp-1', {
        invoiceNumber: 'INV-D4', date: '2026-01-01',
        subtotal: 100, vatAmount: 0, totalAmount: 0,
        discountAmount: 150, grossSubtotal: 100,
      }, salesIds)).toThrow();
    });

    it('purchase invoice books Dr Gross + Dr VAT = Cr Creditors + Cr Discount Earned', () => {
      const [stmt] = buildPurchaseInvoicePostingStatements('comp-1', {
        invoiceNumber: 'PINV-D1', date: '2026-01-01',
        subtotal: 1000, vatAmount: 135, totalAmount: 1035,
        discountAmount: 100, grossSubtotal: 1000,
      }, { inventory: 'acc-inventory', creditors: 'acc-creditors', vat: 'acc-vat', discount: 'acc-disc-earned' });
      const { legs, dr, cr } = legSums(stmt.params!);
      expect(legs).toHaveLength(4);
      expect(dr).toBeCloseTo(cr, 2);
      expect(legs[0]).toMatchObject({ account: 'acc-inventory', debit: 1000, credit: 0 });
      expect(legs[2]).toMatchObject({ account: 'acc-creditors', debit: 0, credit: 1035 });
      expect(legs[3]).toMatchObject({ account: 'acc-disc-earned', debit: 0, credit: 100 });
    });

    it('purchase invoice keeps the classic 3-leg shape when discount is zero', () => {
      const [stmt] = buildPurchaseInvoicePostingStatements('comp-1', {
        invoiceNumber: 'PINV-D2', date: '2026-01-01',
        subtotal: 1000, vatAmount: 150, totalAmount: 1150,
      }, { inventory: 'acc-inventory', creditors: 'acc-creditors', vat: 'acc-vat' });
      expect(stmt.params!.length).toBe(6 + 3 * 4);
    });

    it('POS builder splits cash/credit debits and adds the discount leg', () => {
      const [stmt] = buildPosSalePostingStatements('comp-1', {
        invoiceNumber: 'POS-D1', receiptNumber: 'POS-D1', date: '2026-01-01',
        subtotal: 900, vatAmount: 135, totalAmount: 1035,
        cashAmount: 600, creditAmount: 435, cashAccountId: 'acc-cash',
        discountAmount: 100, grossSubtotal: 1000,
      }, salesIds);
      const { legs, dr, cr } = legSums(stmt.params!);
      expect(dr).toBeCloseTo(cr, 2);
      expect(legs.map((l) => l.account)).toEqual(
        expect.arrayContaining(['acc-cash', 'acc-debtors', 'acc-disc-allowed', 'acc-sales', 'acc-vat'])
      );
    });

    it('sales return reverses gross: Dr Returns = Cr Debtors + Cr Discount', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildSalesReturnPostingStatements('comp-1', {
        returnNumber: 'SR-D1', date: '2026-01-01', customer: 'عميل',
        amount: 900, discountAmount: 100, grossAmount: 1000,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      const { legs, dr, cr } = legSums(res.statements[0].params!);
      expect(legs).toHaveLength(3);
      expect(dr).toBeCloseTo(cr, 2);
      expect(legs[0]).toMatchObject({ account: 'acc-sales-ret', debit: 1000, credit: 0 });
      expect(legs[1]).toMatchObject({ account: 'acc-disc-allowed', debit: 0, credit: 100 });
      expect(legs[2]).toMatchObject({ account: 'acc-debtors', debit: 0, credit: 900 });
    });

    it('purchase return reverses gross: Dr Creditors + Dr Discount = Cr Inventory', async () => {
      const adapter = createMockAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildPurchaseReturnPostingStatements('comp-1', {
        returnNumber: 'PR-D1', date: '2026-01-01', supplier: 'مورد',
        amount: 900, discountAmount: 100, grossAmount: 1000,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      const { legs, dr, cr } = legSums(res.statements[0].params!);
      expect(legs).toHaveLength(3);
      expect(dr).toBeCloseTo(cr, 2);
      expect(legs[1]).toMatchObject({ account: 'acc-disc-earned', debit: 100, credit: 0 });
    });

    it('returns builders fail closed when the discount account is missing', async () => {
      const adapter = createMockAdapter({
        query: vi.fn(async (sql: string) => {
          if (String(sql).toLowerCase().includes('from default_accounts')) return { success: true, rows: [] };
          if (String(sql).toLowerCase().includes('from accounts')) return { success: true, rows: [] };
          return { success: true, rows: [] };
        }),
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

      const res = await buildSalesReturnPostingStatements('comp-1', {
        returnNumber: 'SR-D2', date: '2026-01-01', customer: 'عميل',
        amount: 900, discountAmount: 100, grossAmount: 1000,
      });
      expect(res.success).toBe(false);
    });
  });
});

