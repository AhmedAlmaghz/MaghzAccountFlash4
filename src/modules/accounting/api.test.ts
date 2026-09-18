import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

vi.mock('@/core/utils/validation', () => {
  const mockSchema = () => ({});
  mockSchema.optional = () => mockSchema;
  mockSchema.min = () => mockSchema;
  mockSchema.uuid = () => mockSchema;
  return {
    validateInput: vi.fn(() => ({ success: true })),
    idCompanySchema: mockSchema,
    companyIdSchema: mockSchema,
    uuidSchema: mockSchema,
    createTransactionSchema: mockSchema,
    createReceiptVoucherSchema: mockSchema,
    createPaymentVoucherSchema: mockSchema,
  };
});

vi.mock('@/core/utils/pagination', () => ({
  clampPageArgs: vi.fn((p: number, ps: number) => ({ page: p, pageSize: ps, offset: (p - 1) * ps })),
  paginatedResult: vi.fn((items: unknown[], total: number, p: number, ps: number) => ({
    items,
    total,
    page: p,
    pageSize: ps,
    totalPages: Math.max(1, Math.ceil(total / ps)),
  })),
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
  getCompanyById: vi.fn(),
  getDefaultAccountId: vi.fn(),
}));

vi.mock('@/core/utils/currencyConverter', () => ({
  YER_CODE: 'YER',
}));

// Phase 0: the service layer is mocked so createTransaction's posted path
// (balance-validated service post) is hermetic; the draft path is asserted
// through the mocked adapter's createTransaction instead.
vi.mock('./services', () => ({
  accountingService: { postTransaction: vi.fn() },
}));

import { accountingApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';
import { accountingService } from './services';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return {
    query: vi.fn(queryImpl),
    // Transactional batch executes each statement through the same mocked
    // query impl so tests keep asserting on SQL/params exactly as before.
    transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
      try {
        const results = [];
        for (const q of queries) {
          const r = await queryImpl(q.sql, q.params || []);
          if (!r.success) return { success: false, error: r.error };
          const rc = (r as { rowCount?: number }).rowCount;
          results.push({ rows: r.rows || [], rowCount: rc ?? r.rows?.length ?? 0 });
        }
        return { success: true, results };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }),
  };
}

describe('accountingApi.applyPaymentToInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates invoice paid_amount and decrements customer balance for receipt', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (/FROM sales_invoices WHERE/.test(sql)) {
        return { success: true, rows: [{ total_amount: 1000, paid_amount: 0, status: 'posted' }] };
      }
      if (sql.startsWith('WITH updated AS')) {
        return { success: true, rows: [{ customer_id: 'cust-1', total_amount: 1000, paid_amount: 250, currency_code: 'YER' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.applyPaymentToInvoice('rv-1', 'comp-1', 'inv-1', 250, 250, 'receipt', 'user-1');
    expect(res.success).toBe(true);
    const cteQuery = queries.find(q => q.startsWith('WITH updated AS'))!;
    expect(cteQuery).toMatch(/paid_amount = COALESCE\(i\.paid_amount, 0\) \+ \$1/);
    expect(cteQuery).toMatch(/base_currency_paid = COALESCE\(i\.base_currency_paid, 0\) \+ \$2/);
    expect(cteQuery).toMatch(/CASE.*paid.*THEN\s+'paid'/is);
    expect(queries.some(q => q.includes('UPDATE customers'))).toBe(true);
  });

  it('sets invoice status to paid when fully paid (via CTE CASE)', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (/FROM sales_invoices WHERE/.test(sql)) {
        return { success: true, rows: [{ total_amount: 1000, paid_amount: 0, status: 'posted' }] };
      }
      if (sql.startsWith('WITH updated AS')) {
        return { success: true, rows: [{ customer_id: 'cust-1', total_amount: 1000, paid_amount: 1000, currency_code: 'YER' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.applyPaymentToInvoice('rv-1', 'comp-1', 'inv-1', 1000, 1000, 'receipt', 'user-1');
    expect(res.success).toBe(true);
    const cteQuery = queries.find(q => q.startsWith('WITH updated AS'))!;
    expect(cteQuery).toMatch(/'paid'/);
  });

  it('sets invoice status to partially_paid when partially paid (via CTE CASE)', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (/FROM sales_invoices WHERE/.test(sql)) {
        return { success: true, rows: [{ total_amount: 1000, paid_amount: 0, status: 'posted' }] };
      }
      if (sql.startsWith('WITH updated AS')) {
        return { success: true, rows: [{ customer_id: 'cust-1', total_amount: 1000, paid_amount: 500, currency_code: 'YER' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.applyPaymentToInvoice('rv-1', 'comp-1', 'inv-1', 500, 500, 'receipt', 'user-1');
    expect(res.success).toBe(true);
    const cteQuery = queries.find(q => q.startsWith('WITH updated AS'))!;
    expect(cteQuery).toMatch(/'partially_paid'/);
  });

  it('decrements supplier balance for payment voucher (Phase 0: sign fix)', async () => {
    // A payment REDUCES what we owe the supplier — the old `+applied`
    // inverted AP (every live path decrements supplier balance on payment).
    const captured: Array<{ sql: string; params?: unknown[] }> = [];
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      queries.push(sql);
      captured.push({ sql, params });
      if (/FROM purchase_invoices WHERE/.test(sql)) {
        return { success: true, rows: [{ total_amount: 1000, paid_amount: 0, status: 'posted' }] };
      }
      // The atomic statement is a single UPDATE — PG reports rowCount 1.
      return { success: true, rows: [], rowCount: sql.includes('WITH updated AS') ? 1 : 0 };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.applyPaymentToInvoice('pv-1', 'comp-1', 'pinv-1', 1000, 1000, 'payment', 'user-1');
    expect(res.success).toBe(true);
    // Atomic contract: invoice CTE + supplier balance update compose into a
    // SINGLE statement so both effects commit or roll back together.
    const stmt = queries.find(q => q.includes('WITH updated AS'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain('UPDATE purchase_invoices');
    expect(stmt).toContain('UPDATE suppliers');
    // balance delta (5th param) must DECREMENT the supplier balance
    const cteParams = captured.find(q => q.sql.includes('WITH updated AS'))?.params;
    expect(cteParams?.[4]).toBe(-1000);
  });

  it('rejects application above the invoice outstanding (Phase 0: cap)', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (/FROM sales_invoices WHERE/.test(sql)) {
        return { success: true, rows: [{ total_amount: 1000, paid_amount: 900, status: 'partially_paid' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.applyPaymentToInvoice('rv-1', 'comp-1', 'inv-1', 500, 500, 'receipt', 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceeds the invoice outstanding/i);
    expect(queries.some(q => q.startsWith('WITH updated AS'))).toBe(false);
  });

  it('returns error if invoice not found', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.applyPaymentToInvoice('rv-1', 'comp-1', 'inv-1', 100, 100, 'receipt', 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe('accountingApi.createReceiptVoucher with payment application', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies payment to invoice when invoiceId and amountApplied are provided', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (sql.startsWith('INSERT INTO receipt_vouchers')) {
        return { success: true, rows: [] };
      }
      if (sql.includes('UPDATE sales_invoices')) {
        return { success: true, rows: [{ total_amount: 1000, paid_amount: 250 }] };
      }
      if (sql.includes('SELECT customer_id')) {
        return { success: true, rows: [{ customer_id: 'cust-1' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: 'comp-1',
      voucherNumber: 'RV-001',
      date: '2026-06-01',
      customerId: 'cust-1',
      customerName: 'Cust 1',
      invoiceId: 'inv-1',
      amount: 250,
      amountApplied: 250,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');

    expect(res.success).toBe(true);
    // Draft vouchers are inert — invoice/balance moves happen only when posted.
    expect(queries.some(q => q.includes('UPDATE sales_invoices'))).toBe(false);
  });

  it('does not apply payment when amountApplied is 0', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (sql.startsWith('INSERT INTO receipt_vouchers')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: 'comp-1',
      voucherNumber: 'RV-001',
      date: '2026-06-01',
      customerId: 'cust-1',
      customerName: 'Cust 1',
      amount: 100,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');

    expect(res.success).toBe(true);
    expect(queries.some(q => q.includes('UPDATE sales_invoices'))).toBe(false);
  });

  it('rejects when amountApplied exceeds amount', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: 'comp-1',
      voucherNumber: 'RV-001',
      date: '2026-06-01',
      customerId: 'cust-1',
      customerName: 'Cust 1',
      amount: 100,
      amountApplied: 200,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/amount applied/i);
  });
});

describe('accountingApi.deleteTransaction — draft-only guard (P1 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of POSTED transactions (reversal workflow, never DELETE)', async () => {
    // P1: deleting a posted transaction cascades its JEs and retroactively
    // changes SUM(journal_entries) while the balance mirror keeps the bump.
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'posted' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deleteTransaction(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/عكسي|مرحّل/);
    expect(adapter.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/^DELETE FROM transactions/),
      expect.anything(),
    );
  });

  it('allows deletion of DRAFT transactions', async () => {
    let deleteCalled = false;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'draft' }] };
      }
      if (sql.startsWith('DELETE')) {
        deleteCalled = true;
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deleteTransaction(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(res.success).toBe(true);
    expect(deleteCalled).toBe(true);
  });
});

describe('accountingApi.deleteReceiptVoucher with applied payment protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of POSTED vouchers outright (Phase 0: reversal only)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ invoice_id: null, amount_applied: 0, base_currency_applied: 0, status: 'posted' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deleteReceiptVoucher('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted voucher/i);
  });

  it('rejects deletion when amountApplied > 0 (would break invoice balance)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ invoice_id: 'inv-1', amount_applied: 250, base_currency_applied: 250, status: 'draft' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deleteReceiptVoucher('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/applied payment/i);
  });

  it('allows deletion when amountApplied is 0 (no payment linked)', async () => {
    let deleteCalled = false;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ invoice_id: null, amount_applied: 0, base_currency_applied: 0, status: 'draft' }] };
      }
      if (sql.startsWith('DELETE')) {
        deleteCalled = true;
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deleteReceiptVoucher('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(true);
    expect(deleteCalled).toBe(true);
  });
});

describe('accountingApi.deletePaymentVoucher with applied payment protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of POSTED vouchers outright (Phase 0: reversal only)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ invoice_id: 'pinv-1', amount_applied: 500, base_currency_applied: 500, status: 'posted' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deletePaymentVoucher('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted voucher/i);
  });

  it('rejects deletion when amountApplied > 0', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ invoice_id: 'pinv-1', amount_applied: 500, base_currency_applied: 500, status: 'draft' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.deletePaymentVoucher('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/applied payment/i);
  });
});

describe('accountingApi.updateReceiptVoucher with posted status protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects modifying invoiceId on posted voucher', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'posted', amount_applied: 100, base_currency_applied: 100, invoice_id: 'inv-1' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updateReceiptVoucher(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'user-1',
      { invoiceId: 'inv-2' } as never
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted voucher/i);
  });

  it('rejects modifying amountApplied on posted voucher', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'posted', amount_applied: 100, base_currency_applied: 100, invoice_id: 'inv-1' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updateReceiptVoucher(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'user-1',
      { amountApplied: 200 } as never
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted voucher/i);
  });

  it('allows modifying other fields on posted voucher', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'posted', amount_applied: 100, base_currency_applied: 100, invoice_id: 'inv-1' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updateReceiptVoucher(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'user-1',
      { notes: 'Updated notes' } as never
    );
    expect(res.success).toBe(true);
    expect(queries.some(q => q.startsWith('UPDATE'))).toBe(true);
  });
});

describe('accountingApi.create vouchers with empty/undefined optional UUIDs (defense-in-depth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createReceiptVoucher: converts undefined invoiceId to null in SQL params', async () => {
    const capturedParams: unknown[][] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      if (sql.startsWith('INSERT INTO receipt_vouchers')) {
        capturedParams.push(params as unknown[]);
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: '00000000-0000-0000-0000-000000000001',
      voucherNumber: 'RV-EMPTY',
      date: '2026-06-29',
      customerId: '00000000-0000-0000-0000-000000000010',
      customerName: 'Cust',
      amount: 50000,
      amountApplied: 0,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');
    expect(res.success).toBe(true);
    expect(capturedParams[0][5]).toBeNull();
  });

  it('createPaymentVoucher: converts empty string supplierId to null (PG uuid error prevention)', async () => {
    const capturedParams: unknown[][] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      if (sql.startsWith('INSERT INTO payment_vouchers')) {
        capturedParams.push(params as unknown[]);
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createPaymentVoucher({
      companyId: '00000000-0000-0000-0000-000000000001',
      voucherNumber: 'PV-EMPTY',
      date: '2026-06-29',
      supplierId: '' as never,
      expenseAccountId: '00000000-0000-0000-0000-000000000099',
      amount: 50000,
      amountApplied: 0,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');
    expect(res.success).toBe(true);
    expect(capturedParams[0][4]).toBeNull();
    expect(capturedParams[0][6]).toBe('00000000-0000-0000-0000-000000000099');
  });

  it('createPaymentVoucher: rejects when both supplierId and expenseAccountId are missing', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createPaymentVoucher({
      companyId: '00000000-0000-0000-0000-000000000001',
      voucherNumber: 'PV-NO-PARTY',
      date: '2026-06-29',
      amount: 50000,
      amountApplied: 0,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/supplier or expense account/i);
  });

  it('createReceiptVoucher: accepts voucher with no invoice and amountApplied=0 (on-account payment)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: '00000000-0000-0000-0000-000000000001',
      voucherNumber: 'RV-NO-INV',
      date: '2026-06-29',
      customerId: '00000000-0000-0000-0000-000000000010',
      customerName: 'Cust',
      amount: 50000,
      amountApplied: 0,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');
    expect(res.success).toBe(true);
  });

  it('createReceiptVoucher: still rejects when no invoice and amountApplied > 0', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: '00000000-0000-0000-0000-000000000001',
      voucherNumber: 'RV-NO-INV-APP',
      date: '2026-06-29',
      customerId: '00000000-0000-0000-0000-000000000010',
      customerName: 'Cust',
      amount: 50000,
      amountApplied: 50000,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/requires an invoice/i);
  });

  it('createReceiptVoucher: still rejects when amountApplied > amount', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: '00000000-0000-0000-0000-000000000001',
      voucherNumber: 'RV-OVER',
      date: '2026-06-29',
      customerId: '00000000-0000-0000-0000-000000000010',
      customerName: 'Cust',
      invoiceId: 'inv-1',
      amount: 50000,
      amountApplied: 60000,
      paymentMethod: 'cash',
      status: 'draft',
    } as never, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceed/i);
  });
});

describe('accountingApi.createAccount — FK safety for created_by/updated_by', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const VALID_UUID = '11111111-2222-3333-4444-555555555555';

  it('passes a valid UUID userId as created_by and updated_by', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createAccount(
      {
        companyId: '00000000-0000-0000-0000-000000000001',
        code: '11103',
        nameAr: 'محفظة جييب',
        nameEn: '',
        parentId: 'parent-uuid',
        type: 'asset',
        nature: 'debit',
        isGroup: false,
        balance: 0,
        isActive: true,
      },
      VALID_UUID,
    );
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/\$12::uuid/);
    expect(capturedSql).toMatch(/\$13::uuid/);
    expect(capturedParams[11]).toBe(VALID_UUID);
    expect(capturedParams[12]).toBe(VALID_UUID);
  });

  it('replaces empty-string userId with NULL (avoids PG uuid parse error)', async () => {
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createAccount(
      {
        companyId: '00000000-0000-0000-0000-000000000001',
        code: '11104',
        nameAr: 'حساب اختبار',
        nameEn: '',
        parentId: 'parent-uuid',
        type: 'asset',
        nature: 'debit',
        isGroup: false,
        balance: 0,
        isActive: true,
      },
      '',  // Empty userId should NOT cause FK failure
    );
    expect(res.success).toBe(true);
    expect(capturedParams[11]).toBeNull();
    expect(capturedParams[12]).toBeNull();
  });

  it('replaces malformed UUID userId with NULL', async () => {
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createAccount(
      {
        companyId: '00000000-0000-0000-0000-000000000001',
        code: '11105',
        nameAr: 'حساب اختبار',
        nameEn: '',
        parentId: 'parent-uuid',
        type: 'asset',
        nature: 'debit',
        isGroup: false,
        balance: 0,
        isActive: true,
      },
      'not-a-valid-uuid',
    );
    expect(res.success).toBe(true);
    expect(capturedParams[11]).toBeNull();
  });

  it('updateAccount also normalizes userId (cast ::uuid + null fallback)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await accountingApi.updateAccount(
      'acc-uuid',
      '00000000-0000-0000-0000-000000000001',
      '',
      { nameAr: 'حساب محدث' },
    );
    // P1: dynamic-SET — only the provided column is SET (plus audit cols);
    // omitted columns (code/type/…) are never nulled.
    expect(capturedSql).toMatch(/name_ar = \$1/);
    expect(capturedSql).not.toMatch(/code = \$/);
    expect(capturedSql).not.toMatch(/type = \$/);
    expect(capturedSql).toMatch(/updated_by = \$\d+::uuid/);
    expect(capturedParams).toContain(null); // userIdOrNull
    expect(capturedParams).toContain('حساب محدث');
  });

  it('updateAccount rejects empty updates instead of writing NULLs everywhere', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await accountingApi.updateAccount(
      'acc-uuid',
      '00000000-0000-0000-0000-000000000001',
      '',
      {},
    );
    expect(res.success).toBe(false);
  });
});

describe('accountingApi.postVoucher — raw pg date normalization (v0.4.5 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes the raw DATE-column Date object before building the JE statement', async () => {
    // node-postgres parses DATE columns as new Date('YYYY-MM-DD') = UTC
    // midnight. String(v.date) used to yield "Tue Aug 25 2026 03:00:00
    // GMT+0300 (...)" which PG rejects with "invalid input syntax for type
    // timestamp with time zone" when the JE is inserted.
    const captured: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      if (/FROM\s+receipt_vouchers/.test(sql)) {
        return {
          success: true,
          rows: [
            {
              id: 'rv-1',
              company_id: 'c1',
              voucher_number: 'RV-001',
              date: new Date('2026-08-25'),
              amount: 500,
              status: 'draft',
              payment_method: 'cash',
              customer_id: 'cust-1',
            },
          ],
        };
      }
      if (/FROM\s+default_accounts/.test(sql)) {
        // resolvePostingAccounts → getDefaultAccountId lookups
        return { success: true, rows: [{ account_id: 'acc-default' }] };
      }
      captured.push({ sql, params });
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postVoucher('rv-1', 'c1', 'receipt', '');

    expect(res.success).toBe(true);
    const je = captured.find((q) => q.sql.includes('INSERT INTO transactions'));
    expect(je).toBeTruthy();
    // The date param must be a strict YYYY-MM-DD string — never a locale Date
    expect(je?.params?.[1]).toBe('2026-08-25');
  });
});

describe('accountingApi.getAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('coerces numeric-looking account codes back to strings (startsWith regression)', async () => {
    // PG returns codes as varchar strings, but snakeToCamel auto-converts
    // purely numeric strings to numbers — which crashes code.startsWith()
    // in the chart of accounts UI. The API must hand back strings.
    const adapter = {
      getAccounts: vi.fn(async () => ({
        success: true,
        data: [
          { id: 'a1', company_id: 'c1', code: '1', name_ar: 'الأصول', name_en: 'Assets', type: 'asset', nature: 'debit', balance: '0', is_group: true, parent_id: null, is_active: true },
          { id: 'a2', company_id: 'c1', code: '11101', name_ar: 'الصندوق', name_en: 'Cash', type: 'asset', nature: 'debit', balance: '1500.00', is_group: false, parent_id: 'a1', is_active: true },
        ],
      })),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.getAccounts('c1');

    expect(res.success).toBe(true);
    const root = res.data?.[0];
    expect(typeof root?.code).toBe('string');
    expect(root?.code).toBe('1');
    const child = root?.children?.[0];
    expect(typeof child?.code).toBe('string');
    expect(child?.code).toBe('11101');
    expect(typeof child?.code === 'string' && child.code.startsWith('1')).toBe(true);
  });

  it('financial balance comes from running_balance (opening + movement), not the legacy column', async () => {
    // running_balance = SUM of ALL posted JEs (opening included); the legacy
    // `balance` column only carries the opening stamp — using it would hide
    // all JE movement and double-count openings elsewhere.
    const adapter = {
      getAccounts: vi.fn(async () => ({
        success: true,
        data: [
          { id: 'a1', company_id: 'c1', code: '1', name_ar: 'الأصول', name_en: 'Assets', type: 'asset', nature: 'debit', balance: '0', is_group: true, parent_id: null, is_active: true, running_balance: '0' },
          // legacy balance column says 1500 (opening only) but JEs total 8200
          { id: 'a2', company_id: 'c1', code: '11101', name_ar: 'الصندوق', name_en: 'Cash', type: 'asset', nature: 'debit', balance: '1500.00', is_group: false, parent_id: 'a1', is_active: true, running_balance: '8200.00' },
        ],
      })),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.getAccounts('c1');
    expect(res.success).toBe(true);
    const child = res.data?.[0]?.children?.[0];
    expect(Number(child?.balance)).toBe(8200);
  });

  it('falls back to the legacy balance column when running_balance is absent', async () => {
    const adapter = {
      getAccounts: vi.fn(async () => ({
        success: true,
        data: [
          { id: 'a1', company_id: 'c1', code: '1', name_ar: 'الأصول', name_en: 'Assets', type: 'asset', nature: 'debit', balance: '0', is_group: true, parent_id: null, is_active: true },
          { id: 'a2', company_id: 'c1', code: '11101', name_ar: 'الصندوق', name_en: 'Cash', type: 'asset', nature: 'debit', balance: '1500.00', is_group: false, parent_id: 'a1', is_active: true },
        ],
      })),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.getAccounts('c1');
    const child = res.data?.[0]?.children?.[0];
    expect(Number(child?.balance)).toBe(1500);
  });
});

describe('accountingApi.getAccountLedger — opening balance integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
  const COMPANY_ID = '22222222-2222-2222-2222-222222222222';

  function makeLedgerAdapter(rows: unknown[]) {
    return {
      query: vi.fn(async () => ({ success: true, rows })),
      transaction: vi.fn(async () => ({ success: true, results: [] })),
    };
  }

  it('without startDate: plain movement rows only — no duplicate opening row', async () => {
    const adapter = {
      query: vi.fn(async () => ({
        success: true,
        rows: [
          { id: 'tx-1', date: '2026-01-05', reference: 'OPENING', description: 'رصيد افتتاحي', debit: 5000, credit: 0 },
          { id: 'tx-2', date: '2026-08-05', reference: 'INV-1', description: 'فاتورة', debit: 1200, credit: 0 },
        ],
      })),
      transaction: vi.fn(async () => ({ success: true, results: [] })),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.getAccountLedger(ACCOUNT_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    const rows = res.data!;
    // no separate opening row — the OPENING JE itself is a movement row
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('tx-1');
    expect(rows[0].balance).toBe(5000);
    expect(rows[1].balance).toBe(6200);
    // simple query, no prior CTE
    const sql = (adapter.query.mock.calls as unknown[][])[0]?.[0] as string;
    expect(sql).not.toMatch(/prior AS/);
    expect(sql).toMatch(/ORDER BY t\.date, t\.created_at/);
  });

  it('with startDate: SQL builds movement + prior CTEs with correct param shifting', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async () => ({ success: true, results: [] })),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await accountingApi.getAccountLedger(ACCOUNT_ID, COMPANY_ID, '2026-08-01', '2026-08-31');
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0];
    // movement window
    expect(sql).toMatch(/WITH movement AS/);
    expect(sql).toMatch(/t\.date >= \$3/);
    expect(sql).toMatch(/t\.date <= \$4/);
    // prior window: same account/company but BEFORE the start boundary,
    // with params shifted by priorParams.length (3) → $1..$3 become $4..$6
    expect(sql).toMatch(/prior AS/);
    expect(sql).toMatch(/t\.date < \$6/);
    // opening row first (sort_type 0) via the trailing OPENING label param
    expect(sql).toMatch(/رصيد افتتاحي/);
    expect(sql).toMatch(/ORDER BY sort_type, date, id/);
    // param order: [accountId, companyId, start, end, accountId, companyId, start, 'OPENING']
    expect(params).toEqual([ACCOUNT_ID, COMPANY_ID, '2026-08-01', '2026-08-31', ACCOUNT_ID, COMPANY_ID, '2026-08-01', 'OPENING']);
  });

  it('maps the opening row first and runs the balance from it', async () => {
    const adapter = makeLedgerAdapter([
      { id: 'OPENING', date: null, reference: null, description: 'رصيد افتتاحي', debit: 0, credit: 0, opening: 5000, sort_type: 0 },
      { id: 'tx-1', date: '2026-08-05', reference: 'INV-1', description: 'فاتورة', debit: 1200, credit: 0, opening: null, sort_type: 1 },
      { id: 'tx-2', date: '2026-08-20', reference: 'RV-1', description: 'سند قبض', debit: 0, credit: 700, opening: null, sort_type: 1 },
    ]);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.getAccountLedger(ACCOUNT_ID, COMPANY_ID, '2026-08-01');
    expect(res.success).toBe(true);
    const rows = res.data!;
    expect(rows).toHaveLength(3);
    // opening row: id OPENING, balance = prior sum (5000)
    expect(rows[0].id).toBe('OPENING');
    expect(rows[0].balance).toBe(5000);
    // movements run from the opening balance: 5000+1200=6200, then 6200-700=5500
    expect(rows[1].balance).toBe(6200);
    expect(rows[2].balance).toBe(5500);
    // closing balance = opening + movement (FULL balance)
    expect(rows[rows.length - 1].balance).toBe(5500);
  });
});

describe('accountingApi.createTransaction — draft/posted routing (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseData = {
    companyId: 'comp-1',
    date: '2026-09-01',
    reference: 'JV-1',
    description: 'test',
    totalAmount: 1000,
    entries: [
      { accountId: 'acc-1', debit: 1000, credit: 0 },
      { accountId: 'acc-2', debit: 0, credit: 1000 },
    ],
  };

  it('creates DRAFTs through the adapter (inert until posted) and returns its id', async () => {
    const createTransaction = vi.fn(async () => ({ success: true, id: 'draft-1' }));
    const adapter = { query: vi.fn(), transaction: vi.fn(), createTransaction };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createTransaction({ ...baseData, status: 'draft' } as never, 'user-1');
    expect(res.success).toBe(true);
    expect(res.id).toBe('draft-1');
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect((createTransaction.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>).toMatchObject({ status: 'draft', companyId: 'comp-1' });
    // the service (immediate-post path) must NOT run for drafts
    expect(vi.mocked(accountingService.postTransaction)).not.toHaveBeenCalled();
  });

  it('posts immediately through the balance-validated service and normalizes its id', async () => {
    vi.mocked(accountingService.postTransaction).mockResolvedValue({ success: true, transactionId: 'tx-9' } as never);
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createTransaction({ ...baseData, status: 'posted' } as never, 'user-1');
    expect(res.success).toBe(true);
    expect(res.id).toBe('tx-9');
    expect(vi.mocked(accountingService.postTransaction)).toHaveBeenCalledTimes(1);
  });

  it('surfaces service failures instead of a false success', async () => {
    vi.mocked(accountingService.postTransaction).mockResolvedValue({ success: false, error: 'unbalanced' } as never);
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createTransaction({ ...baseData, status: 'posted' } as never, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toBe('unbalanced');
  });
});

describe('accountingApi.updateTransaction — posted guard + balance check (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TX = '00000000-0000-0000-0000-000000000001';
  const CO = '00000000-0000-0000-0000-000000000001';

  it('rejects editing a POSTED transaction (reversal workflow, never UPDATE)', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'posted' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updateTransaction(TX, CO, 'user-1', { description: 'x' } as never);
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/عكسي|مرحّل/);
    expect(adapter.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/^UPDATE transactions/),
      expect.anything(),
    );
    expect(adapter.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/^DELETE FROM journal_entries/),
      expect.anything(),
    );
  });

  it('rejects unbalanced replacement lines BEFORE deleting the old ones', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'draft' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updateTransaction(TX, CO, 'user-1', {
      entries: [
        { accountId: 'a1', debit: 1000, credit: 0 },
        { accountId: 'a2', debit: 0, credit: 900 },
      ],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not balanced/i);
    expect(queries.some(q => q.startsWith('DELETE FROM journal_entries'))).toBe(false);
  });

  it('allows balanced draft edits with a dynamic header (no NULL wipe)', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'draft' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updateTransaction(TX, CO, 'user-1', {
      description: 'new desc',
      entries: [
        { accountId: 'a1', debit: 500, credit: 0 },
        { accountId: 'a2', debit: 0, credit: 500 },
      ],
    } as never);
    expect(res.success).toBe(true);
    const header = queries.find(q => q.sql.startsWith('UPDATE transactions'))!;
    // partial update: description is set, date is NOT (no NULL wipe)
    expect(header.sql).toMatch(/description = \$/);
    expect(header.sql).not.toMatch(/date = \$/);
    // still scoped to drafts
    expect(header.sql).toMatch(/AND status = 'draft'/);
  });
});

describe('accountingApi.postTransaction — draft-only + balance gate (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TX = '00000000-0000-0000-0000-000000000001';
  const CO = '00000000-0000-0000-0000-000000000001';

  it('rejects posting an already-POSTED transaction (no silent re-post)', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (/FROM transactions t WHERE/.test(sql)) {
        return { success: true, rows: [{ status: 'posted', dr: 100, cr: 100, n: 2 }] };
      }
      return { success: true, rows: [{ id: TX }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postTransaction(TX, CO, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not in draft/i);
    expect(queries.some(q => q.startsWith('UPDATE transactions'))).toBe(false);
  });

  it('rejects posting an unbalanced draft', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (/FROM transactions t WHERE/.test(sql)) {
        return { success: true, rows: [{ status: 'draft', dr: 1000, cr: 900, n: 2 }] };
      }
      return { success: true, rows: [{ id: TX }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postTransaction(TX, CO, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unbalanced/i);
  });

  it('posts a balanced draft with a verifiable flip', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (/FROM transactions t WHERE/.test(sql)) {
        return { success: true, rows: [{ status: 'draft', dr: 1000, cr: 1000, n: 2 }] };
      }
      return { success: true, rows: [{ id: TX }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postTransaction(TX, CO, 'user-1');
    expect(res.success).toBe(true);
    const flip = queries.find(q => q.startsWith('UPDATE transactions'))!;
    expect(flip).toMatch(/AND status = 'draft'/);
    expect(flip).toMatch(/RETURNING id/);
  });
});

describe('accountingApi.postVoucher — linked-invoice application (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function voucherAdapter(voucherRow: Record<string, unknown>, invoiceRow: Record<string, unknown> | null, captured: Array<{ sql: string; params?: unknown[] }>) {
    return makeMockAdapter(async (sql, params) => {
      if (/FROM\s+receipt_vouchers/.test(sql) || /FROM\s+payment_vouchers/.test(sql)) {
        return { success: true, rows: [voucherRow] };
      }
      if (/FROM\s+default_accounts/.test(sql)) {
        return { success: true, rows: [{ account_id: 'acc-default' }] };
      }
      if (/FROM\s+sales_invoices/.test(sql) || /FROM\s+purchase_invoices/.test(sql)) {
        return { success: true, rows: invoiceRow ? [invoiceRow] : [] };
      }
      captured.push({ sql, params });
      return { success: true, rows: [] };
    });
  }

  const draftVoucher = {
    id: 'rv-1', company_id: 'c1', voucher_number: 'RV-001',
    date: '2026-09-01', amount: 500, status: 'draft', payment_method: 'cash',
    customer_id: 'cust-1', cash_box_id: null, invoice_id: 'inv-1',
    amount_applied: 250, base_currency_applied: 250,
  };

  it('bumps the linked invoice paid_amount/status when posting a draft', async () => {
    const captured: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = voucherAdapter(draftVoucher, { total_amount: 1000, paid_amount: 200, status: 'posted' }, captured);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postVoucher('rv-1', 'c1', 'receipt', '');
    expect(res.success).toBe(true);
    const app = captured.find(q => q.sql.includes('UPDATE sales_invoices'))!;
    expect(app).toBeDefined();
    expect(app.params?.[0]).toBe(250);
    expect(app.params?.[1]).toBe(250);
    expect(app.sql).toMatch(/partially_paid/);
  });

  it('rejects posting when the applied amount exceeds the outstanding', async () => {
    const captured: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = voucherAdapter(draftVoucher, { total_amount: 1000, paid_amount: 900, status: 'partially_paid' }, captured);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postVoucher('rv-1', 'c1', 'receipt', '');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceeds the invoice outstanding/i);
    expect(captured.some(q => q.sql.includes('UPDATE sales_invoices'))).toBe(false);
  });
});

describe('accountingApi.updatePaymentVoucher — posted guard + date placeholder (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const PV = '00000000-0000-0000-0000-000000000001';
  const CO = '00000000-0000-0000-0000-000000000001';

  it('rejects amount changes on a posted voucher (reversal workflow)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'posted', amount_applied: 0, base_currency_applied: 0, invoice_id: null }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updatePaymentVoucher(PV, CO, 'user-1', { amount: 999 } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted voucher/i);
  });

  it('parameterizes the date (no row-number literal in SQL)', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'draft', amount_applied: 0, base_currency_applied: 0, invoice_id: null }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.updatePaymentVoucher(PV, CO, 'user-1', { date: '2026-09-02' } as never);
    expect(res.success).toBe(true);
    const upd = queries.find(q => q.startsWith('UPDATE payment_vouchers'))!;
    expect(upd).toMatch(/date = \$\d+::date/);
    expect(upd).not.toMatch(/date = \d+::date/);
  });
});

describe('Phase 2 (IAS 21) — base-currency posting + realized FX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Invoice USD 1000 @ 1500 (base 1,500,000), paid 0.
  const usdInvoice = { total_amount: 1000, paid_amount: 0, status: 'posted', currency_code: 'USD', exchange_rate: 1500, base_currency_amount: 1500000 };

  function fxAdapter(invoiceRow: Record<string, unknown>) {
    const tx: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (/FROM sales_invoices WHERE/.test(sql) || /FROM purchase_invoices WHERE/.test(sql)) {
          return { success: true, rows: [invoiceRow] };
        }
        if (/FROM default_accounts/.test(sql)) {
          return { success: true, rows: [{ account_id: 'acc-' + String(params[1]) }] };
        }
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        for (const q of queries) tx.push(q);
        return { success: true, results: [] };
      }),
    };
    return { adapter, tx };
  }

  it('receipt JE posts base value, invoice accrues at invoice rate, FX windfall booked', async () => {
    // Voucher USD 500 @ 1600 (base 800,000) against the invoice above:
    // invoice accrues 500×1500 = 750,000; received 800,000 → windfall 50,000.
    const { adapter, tx } = fxAdapter(usdInvoice);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: 'comp-1',
      voucherNumber: 'RV-FX',
      date: '2026-09-01',
      customerId: 'cust-1',
      invoiceId: 'inv-1',
      amount: 500,
      amountApplied: 500,
      currencyCode: 'USD',
      exchangeRate: 1600,
      baseCurrencyAmount: 800000,
      baseCurrencyApplied: 800000,
      paymentMethod: 'cash',
      status: 'posted',
    } as never, 'user-1');
    expect(res.success, res.error || '').toBe(true);

    const jes = tx.filter((q) => q.sql.includes('WITH new_tx'));
    // receipt JE (base 800,000) + FX JE (50,000)
    expect(jes).toHaveLength(2);
    expect(Number(jes[0].params?.[4])).toBe(800000);
    expect(jes[1].params?.[2]).toBe('RV-FX-FX');
    // invoice accrues at ITS rate: base_currency_paid += 750,000
    const app = tx.find((q) => q.sql.includes('UPDATE sales_invoices'))!;
    expect(app.params?.[0]).toBe(500);
    expect(app.params?.[1]).toBe(750000);
    // FX windfall on a receipt: Dr debtors 50,000 / Cr FX 50,000
    const fxFlat = jes[1].params || [];
    const fxLegs = [0, 1].map((i) => ({
      acc: String(fxFlat[6 + i * 4]),
      debit: Number(fxFlat[6 + i * 4 + 1]),
      credit: Number(fxFlat[6 + i * 4 + 2]),
    }));
    expect(fxLegs[0]).toMatchObject({ acc: 'acc-default_debtors', debit: 50000, credit: 0 });
    expect(fxLegs[1]).toMatchObject({ acc: 'acc-default_exchange_difference', debit: 0, credit: 50000 });
  });

  it('create rejects a voucher currency that differs from the invoice', async () => {
    const { adapter, tx } = fxAdapter(usdInvoice);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: 'comp-1',
      voucherNumber: 'RV-MIX',
      date: '2026-09-01',
      customerId: 'cust-1',
      invoiceId: 'inv-1',
      amount: 500,
      amountApplied: 500,
      currencyCode: 'YER',
      exchangeRate: 1,
      baseCurrencyAmount: 500,
      baseCurrencyApplied: 500,
      paymentMethod: 'cash',
      status: 'posted',
    } as never, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/must match the invoice currency/i);
    expect(tx).toHaveLength(0);
  });

  it('create rejects linking above the outstanding (cap at create time)', async () => {
    const { adapter, tx } = fxAdapter({ ...usdInvoice, paid_amount: 900 });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createReceiptVoucher({
      companyId: 'comp-1',
      voucherNumber: 'RV-OVER',
      date: '2026-09-01',
      customerId: 'cust-1',
      invoiceId: 'inv-1',
      amount: 500,
      amountApplied: 500,
      // Same currency as the invoice so the test reaches the outstanding
      // cap (the currency guard fires first by design).
      currencyCode: 'USD',
      exchangeRate: 1500,
      baseCurrencyAmount: 750000,
      baseCurrencyApplied: 750000,
      paymentMethod: 'cash',
      status: 'posted',
    } as never, 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceeds the invoice outstanding/i);
    expect(tx).toHaveLength(0);
  });

  // 500 units relieved at the invoice rate (500×1500 = 750,000) but paid
  // 800,000 at the payment rate → 50,000 paid OVER the liability relieved
  // = an FX loss: Dr FX / Cr creditors (mirror of the receipt windfall,
  // where receiving over the receivable is a gain: Dr debtors / Cr FX).
  it('payment FX mirror: paid more than relieved → Dr FX / Cr creditors (loss)', async () => {
    const tx: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (/FROM purchase_invoices WHERE/.test(sql)) return { success: true, rows: [usdInvoice] };
        if (/FROM default_accounts/.test(sql)) {
          return { success: true, rows: [{ account_id: 'acc-' + String(params[1]) }] };
        }
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        for (const q of queries) tx.push(q);
        return { success: true, results: [] };
      }),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.createPaymentVoucher({
      companyId: 'comp-1',
      voucherNumber: 'PV-FX',
      date: '2026-09-01',
      supplierId: 'sup-1',
      invoiceId: 'pinv-1',
      amount: 500,
      amountApplied: 500,
      currencyCode: 'USD',
      exchangeRate: 1600,
      baseCurrencyAmount: 800000,
      baseCurrencyApplied: 800000,
      paymentMethod: 'cash',
      status: 'posted',
    } as never, 'user-1');
    expect(res.success, res.error || '').toBe(true);
    const jes = tx.filter((q) => q.sql.includes('WITH new_tx'));
    expect(jes).toHaveLength(2);
    const fxFlat = jes[1].params || [];
    const fxLegs = [0, 1].map((i) => ({
      acc: String(fxFlat[6 + i * 4]),
      debit: Number(fxFlat[6 + i * 4 + 1]),
      credit: Number(fxFlat[6 + i * 4 + 2]),
    }));
    expect(fxLegs[0]).toMatchObject({ acc: 'acc-default_exchange_difference', debit: 50000, credit: 0 });
    expect(fxLegs[1]).toMatchObject({ acc: 'acc-default_creditors', debit: 0, credit: 50000 });
  });
});

describe('Phase 2 (IAS 21) — period-end revaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function revalAdapter(salesRows: unknown[], purchRows: unknown[]) {
    const tx: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM currencies')) {
          return {
            success: true,
            rows: [
              { code: 'YER', exchange_rate: 1, is_default: true },
              { code: 'USD', exchange_rate: 1600, is_default: false },
            ],
          };
        }
        if (sql.includes('FROM sales_invoices')) return { success: true, rows: salesRows };
        if (sql.includes('FROM purchase_invoices')) return { success: true, rows: purchRows };
        if (sql.includes('default_accounts')) {
          return { success: true, rows: [{ account_id: 'acc-fx-test' }] };
        }
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        for (const q of queries) tx.push(q);
        return { success: true, results: [] };
      }),
    };
    return { adapter, tx };
  }

  it('books incremental gains/losses and stamps last_reval_rate', async () => {
    const { adapter, tx } = revalAdapter(
      // USD 800 outstanding @ 1500, never revalued → receivable gain 800×100
      [{ id: 's1', invoice_number: 'INV-U', currency_code: 'USD', total_amount: 1000, out: 800, exchange_rate: 1500, base_currency_amount: 1500000, last_reval_rate: null }],
      // USD 500 outstanding, last revalued @ 1550, now 1600 → owe more → loss 500×50
      [{ id: 'p1', invoice_number: 'PINV-U', currency_code: 'USD', total_amount: 500, out: 500, exchange_rate: 1500, base_currency_amount: 750000, last_reval_rate: 1550 }]
    );
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.revalueForeignBalances('comp-1', 'user-1', '2026-09-30');
    expect(res.success, res.error || '').toBe(true);
    expect(res.data?.lines).toBe(2);
    expect(res.data?.reference).toBe('FX-2026-09-30');
    expect(res.data?.gain).toBe(80000);
    expect(res.data?.loss).toBe(25000);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(105000);
    // anchors stamped for next run
    const stamps = tx.filter((q) => q.sql.includes('SET last_reval_rate'));
    expect(stamps).toHaveLength(2);
    expect(stamps.every((q) => Number(q.params?.[0]) === 1600)).toBe(true);
  });

  it('skips base-currency invoices and returns empty when nothing moves', async () => {
    const { adapter } = revalAdapter([], []);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.revalueForeignBalances('comp-1', 'user-1', '2026-09-30');
    expect(res.success).toBe(true);
    expect(res.data?.lines).toBe(0);
  });

  it('books a loss when the receivable lost base value', async () => {
    const { adapter, tx } = revalAdapter(
      // USD 1000 outstanding @ 1700, rate now 1600 → loss 100,000
      [{ id: 's1', invoice_number: 'INV-D', currency_code: 'USD', total_amount: 1000, out: 1000, exchange_rate: 1700, base_currency_amount: 1700000, last_reval_rate: null }],
      []
    );
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.revalueForeignBalances('comp-1', 'user-1', '2026-09-30');
    expect(res.success).toBe(true);
    expect(res.data?.loss).toBe(100000);
    expect(res.data?.gain).toBe(0);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    expect(je).toBeDefined();
  });
});

describe('accountingApi.postVoucher — treasury floor (Phase 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const VOUCHER_ROW = {
    id: 'v-1',
    status: 'draft',
    voucher_number: 'PV-T',
    date: '2026-09-01',
    amount: 50000,
    base_currency_amount: 50000,
    payment_method: 'cash',
    cash_box_id: 'box-1',
    supplier_id: '00000000-0000-0000-0000-000000000020',
    expense_account_id: null,
    invoice_id: null,
    amount_applied: 0,
    base_currency_applied: 0,
  };

  function treasuryAdapter(boxBalance: number, policies: Record<string, string> = {}) {
    return makeMockAdapter(async (sql, params) => {
      if (sql.includes('FROM payment_vouchers')) return { success: true, rows: [VOUCHER_ROW] };
      if (sql.includes('FROM settings')) {
        const key = String(params[1]);
        const v = policies[key];
        return { success: true, rows: v === undefined ? [] : [{ value: v }] };
      }
      if (sql.includes('FROM cash_boxes')) {
        return { success: true, rows: [{ account_id: 'box-acc-1' }] };
      }
      // GL balance of the box account: SUM(debit - credit)
      if (sql.includes('SUM(') && sql.includes('journal_entries')) {
        return { success: true, rows: [{ balance: boxBalance }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(params[1]) }] };
      }
      return { success: true, rows: [] };
    });
  }

  it('blocks posting a payment when the box cannot cover it', async () => {
    const adapter = treasuryAdapter(1000);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postVoucher('v-1', 'comp-1', 'payment', 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/الخزينة/);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });

  it('passes the gate when the override policy allows it', async () => {
    const adapter = treasuryAdapter(1000, { 'policy.allow_negative_cashbox': 'true' });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postVoucher('v-1', 'comp-1', 'payment', 'user-1');
    // The treasury gate must not be the reason for failure anymore — whatever
    // happens downstream (JE builder consults the same mock), it is not a
    // cashbox refusal.
    expect(res.error || '').not.toMatch(/الخزينة/);
  });

  it('posts cleanly when the box covers the amount', async () => {
    const adapter = treasuryAdapter(99999999);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await accountingApi.postVoucher('v-1', 'comp-1', 'payment', 'user-1');
    expect(res.error || '').not.toMatch(/الخزينة/);
  });

  it('refuses posting inside a closed fiscal year (Phase 5)', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM payment_vouchers')) return { success: true, rows: [VOUCHER_ROW] };
      if (sql.includes('FROM accounting_periods')) {
        return {
          success: true,
          rows: [{
            id: 'p1', company_id: 'comp-1', year: 2026,
            start_date: '2026-01-01', end_date: '2026-12-31',
            status: 'closed', closed_at: '2027-01-05',
          }],
        };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    // VOUCHER_ROW is dated 2026-09-01, inside closed 2026.
    const res = await accountingApi.postVoucher('v-1', 'comp-1', 'payment', 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مقفلة/);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });
});

describe('accountingApi.getCashFlow — IAS 7 indirect (Phase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Scenario books (signed balances): AR 1000→1400, AP 500→700,
  // inventory 2000→2300, VAT 100→160, payroll 300→330, cash 5000→5600.
  // Period P&L: revenue 10000 Cr, expenses 8000 Dr → net 2000.
  // Depreciation JE: Dr 52601 400. Capex: Dr 12101 1500.
  function cashAdapter() {
    return makeMockAdapter(async (sql, params) => {
      const has = (s: string) => sql.includes(s);
      const par = (s: string) => (params || []).map(String).includes(s);
      // Movement queries (SUM dr/cr with a date window; prefixes ride params).
      if (has('AS dr')) {
        if (par('4%') && !par('5%')) return { success: true, rows: [{ dr: 0, cr: 10000 }] };
        if (par('5%')) return { success: true, rows: [{ dr: 8000, cr: 0 }] };
        if (par('526%')) return { success: true, rows: [{ dr: 400, cr: 0 }] };
        if (par('12101%')) return { success: true, rows: [{ dr: 1500, cr: 0 }] };
        return { success: true, rows: [{ dr: 0, cr: 0 }] };
      }
      if (has('DSP-%')) return { success: true, rows: [{ inflow: 0 }] };
      // Configured depreciation account: none (falls back to code scan).
      if (has('FROM default_accounts')) return { success: true, rows: [] };
      // Signed BS balances: [112, 211, 113, 213, 215, 3, 111] × begin/end.
      if (has('AS bal')) {
        // Distinguish begin vs end by the asOf param ($2).
        const asOf = String((params || [])[1]);
        const afterPeriod = asOf >= '2026-09-30';
        if (par('112%')) return { success: true, rows: [{ bal: afterPeriod ? 1400 : 1000 }] };
        if (par('211%')) return { success: true, rows: [{ bal: afterPeriod ? 700 : 500 }] };
        if (par('113%')) return { success: true, rows: [{ bal: afterPeriod ? 2300 : 2000 }] };
        if (par('213%')) return { success: true, rows: [{ bal: afterPeriod ? 160 : 100 }] };
        if (par('215%')) return { success: true, rows: [{ bal: afterPeriod ? 330 : 300 }] };
        if (par('3%')) return { success: true, rows: [{ bal: afterPeriod ? 20000 : 20000 }] };
        if (par('111%')) return { success: true, rows: [{ bal: afterPeriod ? 5600 : 5000 }] };
        return { success: true, rows: [{ bal: 0 }] };
      }
      return { success: true, rows: [] };
    });
  }

  it('rejects inverted ranges', async () => {
    const adapter = cashAdapter();
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await accountingApi.getCashFlow('comp-1', '2026-09-30', '2026-09-01');
    expect(res.success).toBe(false);
  });

  it('builds operating/investing/financing from JE movements + BS changes', async () => {
    const adapter = cashAdapter();
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await accountingApi.getCashFlow('comp-1', '2026-09-01', '2026-09-30');
    expect(res.success, res.error || '').toBe(true);
    if (!res.success || !res.data) return;
    const d = res.data;
    const get = (rows: { key: string; amount: number }[], key: string) =>
      rows.find((l) => l.key === key)?.amount ?? NaN;
    // Operating: 2000 profit + 400 dep − 400 AR + 200 AP − 300 inv + 60 VAT + 30 payroll.
    expect(get(d.operating, 'netProfit')).toBe(2000);
    expect(get(d.operating, 'depreciation')).toBe(400);
    expect(get(d.operating, 'receivablesChange')).toBe(-400);
    expect(get(d.operating, 'payablesChange')).toBe(200);
    expect(get(d.operating, 'inventoryChange')).toBe(-300);
    expect(get(d.operating, 'vatChange')).toBe(60);
    expect(get(d.operating, 'payrollChange')).toBe(30);
    expect(d.operatingTotal).toBe(1990);
    // Investing: −1500 capex, no proceeds.
    expect(get(d.investing, 'capex')).toBe(-1500);
    expect(d.investingTotal).toBe(-1500);
    // Financing: equity flat.
    expect(d.financingTotal).toBe(0);
    expect(d.netChange).toBe(490);
    // Reconciliation: actual treasury moved 600 vs computed 490 → +110 unexplained.
    expect(d.cashBegin).toBe(5000);
    expect(d.cashEnd).toBe(5600);
    expect(d.cashChange).toBe(600);
    expect(d.unexplained).toBe(-110);
  });

  it('omits zero lines (empty period = empty sections)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ dr: 0, cr: 0, bal: 0 }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await accountingApi.getCashFlow('comp-1', '2026-09-01', '2026-09-30');
    expect(res.success).toBe(true);
    if (!res.success || !res.data) return;
    expect(res.data.operating).toHaveLength(0);
    expect(res.data.investing).toHaveLength(0);
    expect(res.data.financing).toHaveLength(0);
    expect(res.data.netChange).toBe(0);
    expect(res.data.unexplained).toBe(0);
  });
});
