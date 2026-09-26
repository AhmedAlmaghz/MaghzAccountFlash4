import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/validation', () => {
  const makeSchema = () => {
    const schema = () => ({});
    schema.optional = () => schema;
    schema.min = () => schema;
    schema.uuid = () => schema;
    schema.email = () => schema;
    schema.max = () => schema;
    return schema;
  };
  const schema = makeSchema();
  return {
    validateInput: vi.fn(() => ({ success: true })),
    idCompanySchema: schema,
    companyIdSchema: schema,
    uuidSchema: schema,
    numberSchema: schema,
    createCustomerSchema: schema,
    createInvoiceSchema: schema,
    createQuotationSchema: schema,
    createSalesReturnSchema: schema,
  };
});

vi.mock('@/core/utils/pagination', () => ({
  clampPageArgs: vi.fn((page: number, pageSize: number) => ({
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  })),
  paginatedResult: vi.fn((items: unknown[], total: number, page: number, pageSize: number) => ({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })),
}));

// NOTE: journalEntryGenerator is NOT mocked anymore — its posting-statement
// builders are pure SQL composers exercised through the mocked adapter, which
// lets these tests verify the full atomic batch end-to-end.

import { salesApi } from './api';
import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { clearUserIdCache } from '@/core/utils/userIdValidator';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  const wrappedQuery = async (sql: string, params: unknown[]) => {
    const result = await queryImpl(sql, params);
    if (/FROM sales_invoices|FROM sales_returns/.test(sql) && result.rows) {
      result.rows = result.rows.map((row) => (row && typeof row === 'object' ? { date: '2026-01-01', ...row } : row));
    }
    return result;
  };
  return {
    query: vi.fn(wrappedQuery),
    // The transaction mock runs each query through queryImpl so tests see the
    // same behavior (the actual PGlite transaction wraps each in BEGIN/COMMIT).
    transaction: vi.fn(async (queries: { sql: string; params?: unknown[] }[]) => {
      for (const q of queries) {
        await wrappedQuery(q.sql, (q.params || []) as unknown[]);
      }
      return { success: true, results: [] };
    }),
  };
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000010';
const INVOICE_ID = '00000000-0000-0000-0000-000000000020';

describe('salesApi.getCustomerStatement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always scopes the statement to the caller company', async () => {
    const adapter = makeMockAdapter(async (_sql, params) => {
      if (params[0] === CUSTOMER_ID) {
        return {
          success: true,
          rows: [
            { date: '2026-05-15', document_type: 'فاتورة', document_number: 'INV-001', debit: 1000, credit: 0, balance: 1000, notes: null },
            { date: '2026-05-10', document_type: 'سند قبض', document_number: 'RV-001', debit: 0, credit: 500, balance: 0, notes: null },
          ],
        };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerStatement(CUSTOMER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2);
    expect(adapter.query).toHaveBeenCalledTimes(1);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM sales_invoices/);
    expect(sql).toMatch(/FROM receipt_vouchers/);
    expect(sql).toMatch(/FROM sales_returns/);
    expect(sql).toMatch(/voucher_number as document_number/);
    // the opening-balance branch must exist and fall outside the movement rows
    expect(sql).toMatch(/FROM customers c/);
    expect(sql).toMatch(/رصيد افتتاحي/);
    // all five UNION branches (opening + invoices + POS-cash + returns + receipts) must filter by the caller's company
    expect(sql.match(/company_id = \$2::uuid/g)).toHaveLength(6);
    expect(params).toEqual([CUSTOMER_ID, COMPANY_ID]);
  });

  it('excludes cash invoices from the statement but keeps a POS-cash credit leg', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerStatement(CUSTOMER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    // cash sales are settled at once — they are not receivables
    expect(sql).toMatch(/COALESCE\(payment_type, 'credit'\) <> 'cash'/);
    // mixed POS sales: the cash part arrives as a statement credit leg
    expect(sql).toMatch(/FROM pos_payments pp/);
    expect(sql).toMatch(/pp\.method = 'cash'/);
    expect(sql).toMatch(/نقدية نقطة بيع/);
  });

  it('returns empty array when no transactions exist', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerStatement(CUSTOMER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('rejects a missing companyId (cross-tenant protection)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerStatement(CUSTOMER_ID, '');
    expect(res.success).toBe(false);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('propagates adapter errors', async () => {
    const adapter = makeMockAdapter(async () => ({ success: false, error: 'db down' }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerStatement(CUSTOMER_ID, COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toBe('db down');
  });
});

describe('salesApi.getCustomerArAging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups invoices by customer and bucket using due_date when present', async () => {
    const today = new Date().toISOString().split('T')[0];
    const ago = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString().split('T')[0];
    };
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { customer_id: CUSTOMER_ID, customer_name: 'عميل 1', due_amount: 1000, aging_date: ago(10) },
        { customer_id: CUSTOMER_ID, customer_name: 'عميل 1', due_amount: 2000, aging_date: ago(45) },
        { customer_id: CUSTOMER_ID, customer_name: 'عميل 1', due_amount: 500, aging_date: ago(120) },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerArAging(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    const row = res.data![0];
    expect(row.customerId).toBe(CUSTOMER_ID);
    expect(row.totalDue).toBe(3500);
    expect(row.buckets.find(b => b.period === '0-30')?.amount).toBe(1000);
    expect(row.buckets.find(b => b.period === '31-60')?.amount).toBe(2000);
    expect(row.buckets.find(b => b.period === '>90')?.amount).toBe(500);
    void today;
  });

  it('falls back to invoice date when due_date is null', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { customer_id: CUSTOMER_ID, customer_name: 'عميل 1', due_amount: 800, aging_date: '2020-01-01' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerArAging(COMPANY_ID);
    expect(res.success).toBe(true);
    const row = res.data![0];
    expect(row.buckets.find(b => b.period === '>90')?.amount).toBe(800);
  });

  it('ignores zero-amount rows (paid invoices)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { customer_id: CUSTOMER_ID, customer_name: 'عميل 1', due_amount: 0, aging_date: '2025-01-01' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerArAging(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data![0].totalDue).toBe(0);
  });

  it('filters by company_id', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getCustomerArAging(COMPANY_ID);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/c\.company_id = \$1/);
    expect(sql).toMatch(/status IN \('posted', 'partially_paid'\)/);
    expect(sql).toMatch(/total_amount - COALESCE\(i\.paid_amount,0\)\) > 0/);
    expect(params[0]).toBe(COMPANY_ID);
  });

  it('includes each customer opening balance in the aging SQL (oldest bucket)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getCustomerArAging(COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    // Opening-balance branch: undated (or explicitly dated) opening rows
    // always land in the oldest bucket via the 1900-01-01 fallback.
    expect(sql).toMatch(/UNION ALL/);
    expect(sql).toMatch(/c\.opening_balance as due_amount/);
    expect(sql).toMatch(/COALESCE\(c\.opening_date, DATE '1900-01-01'\)/);
    expect(sql).toMatch(/c\.opening_balance > 0/);
  });

  it('buckets an opening-balance row into >90', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { customer_id: CUSTOMER_ID, customer_name: 'عميل قديم', due_amount: 700, aging_date: '1900-01-01' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getCustomerArAging(COMPANY_ID);
    expect(res.success).toBe(true);
    const row = res.data![0];
    expect(row.totalDue).toBe(700);
    expect(row.buckets.find(b => b.period === '>90')?.amount).toBe(700);
  });

  it('excludes cash invoices from the aging invoice leg', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getCustomerArAging(COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(i\.payment_type, 'credit'\) <> 'cash'/);
  });
});

describe('salesApi customer computed_balance excludes cash sales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCustomers filters cash invoices and subtracts POS-cash legs', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getCustomers(COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(i\.payment_type, 'credit'\) <> 'cash'/);
    expect(sql).toMatch(/FROM pos_payments pp/);
    expect(sql).toMatch(/pp\.method = 'cash'/);
  });

  it('getCustomersPaginated applies the same cash exclusion', async () => {
    const adapter = makeMockAdapter(async (sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return { success: true, rows: [{ total: 0 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getCustomersPaginated(COMPANY_ID, 1, 25);
    const dataSql = adapter.query.mock.calls.map((c) => c[0] as string).find((s) => /computed_balance/.test(s));
    expect(dataSql).toMatch(/COALESCE\(i\.payment_type, 'credit'\) <> 'cash'/);
    expect(dataSql).toMatch(/FROM pos_payments pp/);
  });

  it('getCustomerById applies the same cash exclusion', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getCustomerById(CUSTOMER_ID, COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(i\.payment_type, 'credit'\) <> 'cash'/);
    expect(sql).toMatch(/FROM pos_payments pp/);
  });
});

describe('salesApi.getPostedInvoicesWithLines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns posted invoices joined with their lines', async () => {
    const adapter = makeMockAdapter(async (_sql, _params) => {
      if ((_sql as string).includes('FROM sales_invoices i')) {
        return {
          success: true,
          rows: [
            {
              id: INVOICE_ID, company_id: COMPANY_ID, invoice_number: 'INV-100',
              customer_id: CUSTOMER_ID, customer_name: 'عميل 1', date: '2026-05-01',
              subtotal: 1000, discount_amount: 0, vat_amount: 150, total_amount: 1150,
              paid_amount: 0, currency_code: 'YER', exchange_rate: 1,
              base_currency_amount: 1150, base_currency_paid: 0,
              status: 'posted', notes: null,
            },
          ],
        };
      }
      return {
        success: true,
        rows: [
          { id: 'l1', invoice_id: INVOICE_ID, product_id: 'p1', product_name: 'منتج 1', quantity: 2, unit_price: 500, discount_percent: 0, vat_percent: 15, line_total: 1150, currency_code: 'YER', exchange_rate: 1, base_currency_line_total: 1150 },
        ],
      };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getPostedInvoicesWithLines(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data![0].lines).toHaveLength(1);
    expect(res.data![0].lines[0].productName).toBe('منتج 1');
  });

  it('only returns invoices with status posted/partially_paid/paid', async () => {
    const adapter = makeMockAdapter(async (_sql) => {
      if ((_sql as string).includes('FROM sales_invoices i')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.getPostedInvoicesWithLines(COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/status IN \('posted', 'partially_paid', 'paid'\)/);
  });

  it('returns empty array when no posted invoices exist', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getPostedInvoicesWithLines(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });
});

describe('salesApi.createInvoice (currency auto-compute)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-computes baseCurrencyAmount when not provided', async () => {
    const adapter = makeMockAdapter(async (sql, params) => {
      if (sql.startsWith('WITH inv AS')) {
        // invoiceId[0] companyId[1] invoiceNumber[2] customerId[3] date[4] dueDate[5]
        // subtotal[6] discountAmount[7] vatAmount[8] totalAmount[9] paidAmount[10]
        // currencyCode[11] exchangeRate[12] baseCurrencyAmount[13] baseCurrencyPaid[14]
        // status[15] paymentType[16] cashBoxId[17] bankAccountId[18] notes[19]
        expect(params[13]).toBe(5000);
        return { success: true, rows: [{ id: 'inv-1' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.createInvoice({
      companyId: COMPANY_ID,
      invoiceNumber: 'INV-001',
      customerId: CUSTOMER_ID,
      date: '2026-06-01',
      dueDate: undefined,
      subtotal: 1000,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 1000,
      paidAmount: 0,
      currencyCode: 'USD',
      exchangeRate: 5,
      status: 'draft',
      notes: '',
      lines: [],
    } as never);
    expect(res.success).toBe(true);
  });

  it('inserts all 20 columns for the invoice header (incl. multi-currency + payment_type + cash/bank)', async () => {
    const adapter = makeMockAdapter(async (sql, _params) => {
      if (sql.startsWith('WITH inv AS')) {
        expect(sql).toMatch(/currency_code,exchange_rate,base_currency_amount,base_currency_paid/);
        expect(sql).toMatch(/payment_type,cash_box_id,bank_account_id,notes/);
        return { success: true, rows: [{ id: 'inv-1' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await salesApi.createInvoice({
      companyId: COMPANY_ID,
      invoiceNumber: 'INV-002',
      customerId: CUSTOMER_ID,
      date: '2026-06-01',
      dueDate: undefined,
      subtotal: 1000,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 1000,
      paidAmount: 0,
      currencyCode: 'YER',
      exchangeRate: 1,
      paymentType: 'credit',
      cashBoxId: null,
      bankAccountId: null,
      status: 'draft',
      notes: '',
      lines: [],
    } as never);
  });
});

describe('salesApi.deleteInvoice protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of posted invoice (cannot delete after posting)', async () => {
    const adapter = makeMockAdapter(async (_sql, _params) => ({
      success: true,
      rows: [{ status: 'posted', paid_amount: 0 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteInvoice('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted/i);
  });

  it('rejects deletion of draft invoice with payments', async () => {
    const adapter = makeMockAdapter(async (_sql, _params) => ({
      success: true,
      rows: [{ status: 'draft', paid_amount: 100 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteInvoice('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/payment/i);
  });

  it('allows deletion of empty draft invoice', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'draft', paid_amount: 0 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteInvoice('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001');
    expect(res.success).toBe(true);
  });
});

describe('salesApi.createInvoice protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects overpayment (paidAmount > totalAmount)', async () => {
    const res = await salesApi.createInvoice({
      companyId: '00000000-0000-0000-0000-000000000001',
      invoiceNumber: 'INV-OVER',
      customerId: '00000000-0000-0000-0000-000000000010',
      date: '2026-06-01',
      dueDate: undefined,
      subtotal: 1000,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 1000,
      paidAmount: 1500,
      currencyCode: 'YER',
      exchangeRate: 1,
      status: 'draft',
      notes: '',
      lines: [{ productId: '00000000-0000-0000-0000-000000000050', quantity: 1, unitPrice: 1000, discountPercent: 0, vatPercent: 0, lineTotal: 1000 } as never],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/paid amount/i);
  });

  it('rejects creating an invoice directly in a posted state', async () => {
    const res = await salesApi.createInvoice({
      companyId: '00000000-0000-0000-0000-000000000001',
      invoiceNumber: 'INV-POSTED-CREATE',
      customerId: '00000000-0000-0000-0000-000000000010',
      date: '2026-06-01',
      subtotal: 1000,
      totalAmount: 1000,
      paidAmount: 0,
      exchangeRate: 1,
      status: 'posted',
      lines: [],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/draft/i);
  });

  it('rejects non-positive exchange rate', async () => {
    const res = await salesApi.createInvoice({
      companyId: '00000000-0000-0000-0000-000000000001',
      invoiceNumber: 'INV-RATE',
      customerId: '00000000-0000-0000-0000-000000000010',
      date: '2026-06-01',
      dueDate: undefined,
      subtotal: 1000,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 1000,
      paidAmount: 0,
      currencyCode: 'USD',
      exchangeRate: -1,
      status: 'draft',
      notes: '',
      lines: [],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exchange rate/i);
  });
});

describe('salesApi.postInvoice customer balance tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdCache();
  });

  it('increments customer balance by outstanding amount on posting', async () => {
    const queries: string[] = [];
    const params: unknown[][] = [];
    const adapter = makeMockAdapter(async (sql, p) => {
      queries.push(sql);
      params.push(p as unknown[]);
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1000, paid_amount: 250 }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', 'comp-1');
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    // Atomic contract: JE + flip + balance run in ONE transaction batch.
    expect(adapter.transaction).toHaveBeenCalledTimes(1);
    const txStmts = (adapter.transaction.mock.calls[0]?.[0] as Array<{ sql: string; params?: unknown[] }>);
    const custStmt = txStmts.find(q => q.sql.includes('UPDATE customers'));
    expect(custStmt).toBeDefined();
    expect(custStmt!.sql).toMatch(/balance = balance \+ \$1/);
    expect(Number(custStmt!.params![0])).toBe(750);
  });

  it('does not update customer balance when invoice is fully paid', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql, p) => {
      queries.push(sql);
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1000, paid_amount: 1000 }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', 'comp-1');
    expect(res.success).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string }>);
    expect(txStmts.some(q => q.sql.includes('UPDATE customers'))).toBe(false);
  });

  it('resolves a stale userId (valid UUID, missing from users) to null instead of failing the FK constraint', async () => {
    const staleUuid = '3776241e-a274-434b-9dc5-6e6798531eca';
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1000, paid_amount: 0 }] };
      }
      if (sql.includes('FROM users')) {
        // The UUID is valid-format but the user row no longer exists in the DB
        return { success: true, rows: [] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', 'comp-1', staleUuid);
    expect(res.success).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    const invUpdate = txStmts.find(q => q.sql.includes('UPDATE sales_invoices'));
    expect(invUpdate).toBeDefined();
    // updated_by must be null, never the stale UUID (avoids sales_invoices_updated_by_fkey)
    expect(invUpdate!.params![2]).toBeNull();
    const balUpdate = txStmts.find(q => q.sql.includes('UPDATE customers'));
    expect(balUpdate).toBeDefined();
    expect(balUpdate!.params![3]).toBeNull();
  });

  it('CASH invoice: posts to the treasury account (not Debtors), marks paid, never touches the customer', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1150, paid_amount: 0, subtotal: 1000, vat_amount: 150, payment_type: 'cash', cash_box_id: 'box-1' }] };
      }
      if (sql.includes('FROM cash_boxes')) {
        // getCashBoxAccountId: the cash box's own GL account
        return { success: true, rows: [{ account_id: 'cash-gl-acc' }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-cash', 'comp-1');
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    // 1) Debit side of the JE = the cash box GL account, NOT Debtors.
    // buildJournalEntryStatement params layout: [companyId, date, ref, desc,
    // total, companyId, ...entries.flatMap(l => [accountId, debit, credit, memo])]
    const jeInsert = txStmts.find(q => q.sql.includes('INSERT INTO journal_entries'));
    expect(jeInsert).toBeDefined();
    const flat = (jeInsert!.params || []).slice(6);
    expect(String(flat[0])).toBe('cash-gl-acc');
    expect(Number(flat[1])).toBe(1150);
    expect(Number(flat[2])).toBe(0);
    // 2) The invoice is recorded as fully paid + status 'paid'
    const paidUpdate = txStmts.find(q => q.sql.includes("paid_amount = total_amount") && q.sql.includes("status = 'paid'"));
    expect(paidUpdate).toBeDefined();
    // 3) The customer balance is NEVER touched
    expect(txStmts.some(q => q.sql.includes('UPDATE customers'))).toBe(false);
  });

  it('CREDIT invoice (default): posts to Debtors as before', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1150, paid_amount: 0, subtotal: 1000, vat_amount: 150, payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-credit', 'comp-1');
    expect(res.success).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    const jeInsert = txStmts.find(q => q.sql.includes('INSERT INTO journal_entries'));
    const flat = (jeInsert!.params || []).slice(6);
    expect(String(flat[0])).toBe('acc-default_debtors');
    expect(Number(flat[1])).toBe(1150);
    // No cash-box lookup happened at all
    expect(txStmts.some(q => q.sql.includes('paid_amount = total_amount'))).toBe(false);
    // Customer balance IS updated (outstanding 1150)
    const balUpdate = txStmts.find(q => q.sql.includes('UPDATE customers'));
    expect(balUpdate).toBeDefined();
    expect(Number(balUpdate!.params![0])).toBe(1150);
  });

  it('posts an explicit discount leg: Dr Debtors + Dr Discount = Cr Gross + Cr VAT', async () => {
    // subtotal 1000 (net of lines) + line discount 50 + header 100 = 150;
    // VAT 15% on net 900 = 135; total 1035; gross 1050.
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('WITH backfill')) {
        return { success: true, rows: [{ line_disc: 50, cogs: 0, zero_lines: 0 }] };
      }
      if (sql.includes('FROM sales_invoice_lines') && sql.includes('SUM(quantity')) {
        return { success: true, rows: [{ line_disc: 50 }] };
      }
      if (sql.includes('FROM sales_invoice_lines')) {
        return { success: true, rows: [] };
      }
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1035, paid_amount: 0, subtotal: 1000, discount_amount: 150, vat_amount: 135, payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-disc', 'comp-1');
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    expect(res.cogsAmount).toBe(0);
    expect(res.zeroCostLines).toBe(0);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    const jeInsert = txStmts.find(q => q.sql.includes('INSERT INTO journal_entries'));
    expect(jeInsert).toBeDefined();
    const flat = (jeInsert!.params || []).slice(6);
    const legs: Array<{ account: unknown; debit: number; credit: number }> = [];
    for (let i = 0; i < flat.length; i += 4) {
      legs.push({ account: flat[i], debit: Number(flat[i + 1]), credit: Number(flat[i + 2]) });
    }
    // 4 legs: debtors + discount + sales + VAT (no COGS — cogs is 0).
    expect(legs).toHaveLength(4);
    expect(legs[0]).toMatchObject({ account: 'acc-default_debtors', debit: 1035, credit: 0 });
    expect(legs[1]).toMatchObject({ account: 'acc-default_discount_allowed', debit: 150, credit: 0 });
    expect(legs[2]).toMatchObject({ account: 'acc-default_sales', debit: 0, credit: 1050 });
    expect(legs[3]).toMatchObject({ account: 'acc-default_vat_output', debit: 0, credit: 135 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBeCloseTo(cr, 2);
  });

  it('fails closed when a discount exists but the discount account is missing', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1035, paid_amount: 0, subtotal: 1000, discount_amount: 150, vat_amount: 135, payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('FROM sales_invoice_lines')) {
        return { success: true, rows: [{ line_disc: 50, cogs: 0, zero_lines: 0 }] };
      }
      if (sql.includes('default_accounts')) {
        if (String(p[1]) === 'default_discount_allowed') return { success: true, rows: [] };
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-disc-noacct', 'comp-1');
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('الخصم المسموح به');
  });
});

describe('salesApi.postReturn customer balance tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decrements customer balance by return amount on posting', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('FROM sales_returns')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 200 }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postReturn('ret-1', 'comp-1');
    expect(res.success).toBe(true);
    // Atomic contract: JE + stock movements + flip + balance in ONE batch.
    expect(adapter.transaction).toHaveBeenCalledTimes(1);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    // JE + stock movement + status flip + customer balance
    expect(txStmts.some(q => q.sql.includes('WITH new_tx'))).toBe(true);
    expect(txStmts.some(q => q.sql.includes('stock_movements') && q.sql.includes("'in'"))).toBe(true);
    const custStmt = txStmts.find(q => q.sql.includes('UPDATE customers'));
    expect(custStmt).toBeDefined();
    expect(custStmt!.sql).toMatch(/balance = balance - \$1/);
    expect(Number(custStmt!.params![0])).toBe(200);
  });
});

describe('salesApi perpetual COGS (IAS 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdCache();
  });

  it('postInvoice backfills cost snapshots and books Dr COGS / Cr Inventory', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('WITH backfill')) {
        return { success: true, rows: [{ cogs: 0, zero_lines: 0, line_disc: 0 }] };
      }
      if (sql.includes('FROM sales_invoice_lines') && sql.includes('COALESCE')) {
        return { success: true, rows: [{ product_id: 'p1', bq: 10 }] };
      }
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1150, paid_amount: 0, subtotal: 1000, vat_amount: 150, invoice_number: 'INV-901', date: '2026-01-01', payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('FROM settings') && sql.includes('inventory.valuation_method')) {
        return { success: true, rows: [{ value: 'moving_average' }] };
      }
      if (sql.includes('FROM products') && sql.includes('cost_price')) {
        return { success: true, rows: [{ id: 'p1', cost_price: 64, standard_cost: null }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      if (sql.includes('FROM stock') || sql.includes('FROM customers')) {
        return { success: true, rows: [{ product_id: 'p1', have: 100 }] };
      }
      if (sql.includes('FROM accounting_periods')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-901', 'comp-1');
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    const jes = txStmts.filter((q) => q.sql.includes('WITH new_tx'));
    expect(jes.length).toBeGreaterThanOrEqual(2);
    const cogsJe = jes.find((q) => (q.params as unknown[]).includes('INV-901-COGS')) || jes[1];
    expect(cogsJe).toBeDefined();
    // COGS companion: 640 Dr COGS / 640 Cr Inventory (10 * 64)
    expect(cogsJe!.params).toContain('acc-default_cogs');
    expect(cogsJe!.params).toContain('acc-default_inventory');
    const cogsIdx = (cogsJe!.params as unknown[]).indexOf('acc-default_cogs');
    expect(cogsJe!.params![cogsIdx + 1]).toBe(640);
    expect(cogsJe!.params![cogsIdx + 2]).toBe(0);
  });

  it('postInvoice skips COGS legs when nothing was taken out of stock', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('WITH backfill')) {
        return { success: true, rows: [{ cogs: 0 }] };
      }
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 115, paid_amount: 0, subtotal: 100, vat_amount: 15, invoice_number: 'INV-902', date: '2026-01-01', payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-902', 'comp-1');
    expect(res.success).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    const je = txStmts.find((q) => q.sql.includes('WITH new_tx'));
    expect(je).toBeDefined();
    // revenue legs only: 3 entries x 4 params + 6 header params
    expect(je!.params!.length).toBe(6 + 3 * 4);
  });

  it('postReturn reverses the actual sale-time cost, not a ratio', async () => {
    const adapter = makeMockAdapter(async (sql, p) => {
      if (sql.includes('AS reversal')) {
        return { success: true, rows: [{ reversal: 320 }] };
      }
      if (sql.includes('FROM sales_returns')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 500, subtotal: 500, vat_amount: 0, return_number: 'SR-901', date: '2026-01-02', customer_name: 'عميل', invoice_id: null }] };
      }
      if (sql.includes('FROM sales_return_lines') && sql.includes('WHERE return_id')) {
        return { success: true, rows: [{ product_id: 'p1', bq: 5 }] };
      }
      if (sql.includes('FROM sales_return_lines')) {
        return { success: true, rows: [{ product_id: 'p1', quantity: 5, unit_price: 100, line_total: 500, bq: 5 }] };
      }
      if (sql.includes('FROM sales_invoice_lines')) {
        return { success: true, rows: [{ product_id: 'p1', bq: 5, cost: 64, unit_cost: 64 }] };
      }
      if (sql.includes('FROM products') || sql.includes('FROM settings') || sql.includes('FROM stock')) {
        if (sql.includes('FROM settings')) return { success: true, rows: [{ value: 'moving_average' }] };
        if (sql.includes('FROM products')) return { success: true, rows: [{ id: 'p1', cost_price: 64, standard_cost: null }] };
        return { success: true, rows: [{ product_id: 'p1', have: 100 }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      if (sql.includes('FROM accounting_periods')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postReturn('ret-901', 'comp-1');
    expect(res.success, 'postReturn failed: ' + (res.error || '')).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>);
    const je = txStmts.find((q) => q.sql.includes('WITH new_tx'));
    expect(je).toBeDefined();
    expect(je!.params).toContain('acc-default_inventory');
    expect(je!.params).toContain('acc-default_cogs');
    const amounts = (je!.params as unknown[]).filter((x) => typeof x === 'number');
    expect(amounts).toContain(320);
    expect(amounts).not.toContain(Math.floor(500 * 0.7));
  });
});

describe('salesApi.deleteQuotation protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of converted quotation', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'converted' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteQuotation('q-1', 'comp-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/converted/i);
  });

  it('rejects deletion of accepted quotation', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'accepted' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteQuotation('q-1', 'comp-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/accepted/i);
  });

  it('allows deletion of draft/rejected quotation', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'draft' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteQuotation('q-1', 'comp-1');
    expect(res.success).toBe(true);
  });
});

describe('salesApi.deleteReturn protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of posted return', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'posted' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.deleteReturn('r-1', 'comp-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted/i);
  });
});

describe('salesApi.updateInvoice protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects modifying lines of posted invoice', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'posted', paid_amount: 0 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.updateInvoice('inv-1', 'comp-1', {
      lines: [{ productId: 'p1', quantity: 1, unitPrice: 100, discountPercent: 0, vatPercent: 0, lineTotal: 100 }],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted/i);
  });

  it('rejects reducing paid amount below current payments', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ status: 'posted', paid_amount: 500 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.updateInvoice('inv-1', 'comp-1', { paidAmount: 100 } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/paid amount/i);
  });

  it('allows increasing paid amount on posted invoice', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'posted', paid_amount: 500 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.updateInvoice('inv-1', 'comp-1', { paidAmount: 1000 } as never);
    expect(res.success).toBe(true);
  });
});

describe('salesApi.getOutstandingInvoicesForCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only posted/partially_paid invoices with outstanding balance', async () => {
    const adapter = makeMockAdapter(async (_sql, _params) => ({
      success: true,
      rows: [
        { id: 'inv-1', company_id: 'comp-1', invoice_number: 'INV-001', customer_id: 'cust-1', customer_name: 'Cust 1', total_amount: 1000, paid_amount: 0, status: 'posted' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getOutstandingInvoicesForCustomer('comp-1', 'cust-1');
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data![0].invoiceNumber).toBe('INV-001');

    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/i\.status IN \('posted', 'partially_paid'\)/);
    expect(sql).toMatch(/i\.total_amount - COALESCE\(i\.paid_amount, 0\)\) > 0/);
    expect(sql).toMatch(/i\.company_id = \$1::uuid/);
    expect(sql).toMatch(/i\.customer_id = \$2::uuid/);
  });

  it('returns empty array when no outstanding invoices', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getOutstandingInvoicesForCustomer('comp-1', 'cust-1');
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('returns error for empty customerId (validation rejects)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getOutstandingInvoicesForCustomer('comp-1', '');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});

describe('salesApi.createCustomer - auto-number generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates customer code from sequence when code is not provided', async () => {
    const adapter = makeMockAdapter(async (sql: string, _params: unknown[]) => {
      if (sql.includes('RETURNING id')) {
        return { success: true, rows: [{ id: CUSTOMER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await import('@/core/api');
    vi.spyOn(await import('@/core/api'), 'getNextDocumentNumber').mockResolvedValue({
      success: true,
      number: 'CUST-0001',
    });

    const res = await salesApi.createCustomer({
      companyId: COMPANY_ID,
      code: '',
      name: 'Test Customer',
      phone: '',
      email: '',
      address: '',
      taxNumber: '',
      creditLimit: 0,
      balance: 0,
      isActive: true,
    });

    expect(res.success).toBe(true);
    expect(res.id).toBe(CUSTOMER_ID);
  });

  it('uses provided code when caller supplies one', async () => {
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql: string, params: unknown[]) => {
      capturedParams = params;
      if (sql.includes('RETURNING id')) {
        return { success: true, rows: [{ id: CUSTOMER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.createCustomer({
      companyId: COMPANY_ID,
      code: 'CUSTOM-CODE-123',
      name: 'Test Customer',
      phone: '',
      email: '',
      address: '',
      taxNumber: '',
      creditLimit: 0,
      balance: 0,
      isActive: true,
    });

    expect(res.success).toBe(true);
    expect(capturedParams[1]).toBe('CUSTOM-CODE-123');
  });
});

describe('salesApi.getInvoicesPaginated owner filter', () => {
  const USER_ID = '00000000-0000-0000-0000-000000000030';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes agent-created rows (created_by IS NULL) when createdBy filter is applied', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      if (sql.startsWith('SELECT COUNT')) {
        return { success: true, rows: [{ total: 3 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getInvoicesPaginated(COMPANY_ID, 1, 25, { createdBy: USER_ID });

    expect(res.success).toBe(true);
    expect(captured.length).toBe(2);
    const countSql = captured[0].sql;
    expect(countSql).toMatch(/\(i\.created_by = \$\d+ OR i\.created_by IS NULL\)/);
    expect(countSql).toMatch(/WHERE i\.company_id = \$1/);
  });
});

describe('salesApi line unit snapshots (multi-unit)', () => {
  const PRODUCT_ID = '00000000-0000-0000-0000-000000000040';
  const UNIT_ROW_ID = '00000000-0000-0000-0000-000000000041';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function baseInvoice(lines: unknown[]) {
    return {
      companyId: COMPANY_ID,
      invoiceNumber: 'INV-U1',
      customerId: CUSTOMER_ID,
      date: '2026-06-01',
      dueDate: undefined,
      subtotal: 24000,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 24000,
      paidAmount: 0,
      currencyCode: 'YER',
      exchangeRate: 1,
      status: 'draft',
      notes: '',
      lines,
    } as never;
  }

  it('persists unit triple appended at the end of line params (2 cartons x12)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { success: true, rows: [{ id: 'inv-1' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.createInvoice(baseInvoice([{
      productId: PRODUCT_ID, quantity: 2, unitPrice: 12000,
      discountPercent: 0, vatPercent: 0, lineTotal: 24000,
      unitId: UNIT_ROW_ID, unitFactor: 12, baseQuantity: 24,
    }]));
    expect(res.success).toBe(true);
    const cte = captured.find((c) => c.sql.startsWith('WITH inv AS'));
    expect(cte).toBeDefined();
    expect(cte!.sql).toMatch(/unit_id,unit_factor,base_quantity/);
    // append-at-end: last three params are the unit triple
    const p = cte!.params;
    expect(p.slice(-3)).toEqual([UNIT_ROW_ID, 12, 24]);
  });

  it('server recomputes baseQuantity when the caller omits it (3 x 12 = 36)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { success: true, rows: [{ id: 'inv-1' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.createInvoice(baseInvoice([{
      productId: PRODUCT_ID, quantity: 3, unitPrice: 12000,
      discountPercent: 0, vatPercent: 0, lineTotal: 36000,
      unitId: UNIT_ROW_ID, unitFactor: 12,
    }]));
    expect(res.success).toBe(true);
    const cte = captured.find((c) => c.sql.startsWith('WITH inv AS'));
    expect(cte!.params.slice(-3)).toEqual([UNIT_ROW_ID, 12, 36]);
  });

  it('legacy lines without units keep factor 1 and base = qty', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { success: true, rows: [{ id: 'inv-1' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.createInvoice(baseInvoice([{
      productId: PRODUCT_ID, quantity: 5, unitPrice: 1000,
      discountPercent: 0, vatPercent: 0, lineTotal: 5000,
    }]));
    expect(res.success).toBe(true);
    const cte = captured.find((c) => c.sql.startsWith('WITH inv AS'));
    expect(cte!.params.slice(-3)).toEqual([null, 1, 5]);
  });

  it('stock posting consumes base_quantity with legacy fallback', async () => {
    const captured: { sql: string }[] = [];
    const adapter = makeMockAdapter(async (sql: string) => {
      captured.push({ sql });
      if (sql.startsWith('SELECT customer_id')) {
        return {
          success: true,
          rows: [{ customer_id: CUSTOMER_ID, total_amount: 24000, paid_amount: 0, subtotal: 24000, vat_amount: 0, invoice_number: 'INV-U1', date: '2026-06-01', payment_type: 'credit', cash_box_id: null }],
        };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: '00000000-0000-0000-0000-000000000050' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    // resolveExistingUserId + resolvePostingAccounts hit the adapter too —
    // keep them quiet by returning empty rows for anything else.
    const res = await salesApi.postInvoice(INVOICE_ID, COMPANY_ID);
    expect(captured.some((c) => c.sql.includes('COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity)'))).toBe(true);
    expect(res.success).toBe(true);
  });
});

describe('salesApi.postInvoice perpetual COGS (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdCache();
  });

  function cogsAdapter(method: string, products: Array<{ id: string; cost: number }>, layers: Array<{ id: string; pid: string; qty: number; cost: number }>) {
    return makeMockAdapter(async (sql, p) => {
      if (sql.includes('WITH backfill')) {
        return { success: true, rows: [{ cogs: 0, zero_lines: 0, line_disc: 0 }] };
      }
      if (sql.includes('FROM sales_invoice_lines')) {
        return {
          success: true,
          rows: [
            { product_id: 'p1', bq: 2 },
            { product_id: 'p2', bq: 3 },
          ],
        };
      }
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1150, paid_amount: 0, subtotal: 1000, vat_amount: 150, invoice_number: 'INV-COGS', date: '2026-09-01', payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('FROM settings')) {
        return { success: true, rows: [{ value: method }] };
      }
      // Phase 4 gate: ample richest-warehouse stock (policy tests cover shortage).
      if (sql.includes('FROM stock')) {
        return {
          success: true,
          rows: products.map((x) => ({ product_id: x.id, have: 1000000 })),
        };
      }
      if (sql.includes('FROM products WHERE')) {
        return {
          success: true,
          rows: products.map((x) => ({ id: x.id, cost_price: x.cost, standard_cost: null, name_ar: x.id })),
        };
      }
      if (sql.includes('FROM inventory_layers')) {
        return {
          success: true,
          rows: layers.map((l) => ({ id: l.id, product_id: l.pid, qty_remaining: l.qty, unit_cost: l.cost })),
        };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
      }
      if (sql.includes('FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-code' }] };
      }
      return { success: true, rows: [] };
    });
  }

  it('books Dr COGS / Cr Inventory at moving average + freezes line unit_cost', async () => {
    const adapter = cogsAdapter('moving_average', [{ id: 'p1', cost: 100 }, { id: 'p2', cost: 50 }], []);
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', 'comp-1');
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const txStmts = (adapter.transaction.mock.calls[0]?.[0] as Array<{ sql: string; params?: unknown[] }>);
    // COGS companion JE: 2×100 + 3×50 = 350
    const cogsJe = txStmts.filter((q) => q.sql.includes('WITH new_tx'));
    expect(cogsJe).toHaveLength(2);
    expect(cogsJe[1].params?.[2]).toBe('INV-COGS-COGS');
    expect(Number(cogsJe[1].params?.[4])).toBe(350);
    // posting-time costs frozen on the lines
    const freeze = txStmts.find((q) => q.sql.includes('SET unit_cost ='));
    expect(freeze).toBeDefined();
    expect(freeze!.params).toContain('p1');
    expect(freeze!.params).toContain(100);
    expect(freeze!.params).toContain('p2');
    expect(freeze!.params).toContain(50);
  });

  it('fifo consumes oldest layers and fails honestly on shortage', async () => {
    const adapter = cogsAdapter(
      'fifo',
      [{ id: 'p1', cost: 100 }, { id: 'p2', cost: 50 }],
      [{ id: 'l1', pid: 'p1', qty: 1, cost: 80 }]
    );
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    // p1 needs 2 but only 1 layer unit exists → honest failure, nothing posts
    const res = await salesApi.postInvoice('inv-1', 'comp-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Insufficient FIFO stock/);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });
});

describe('salesApi.postReturn reverses VAT + original cost (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reverses output VAT on its own leg and COGS at posting-time cost (never 70%)', async () => {
    const tx: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM sales_returns')) {
          return {
            success: true,
            rows: [{
              customer_id: 'c1', total_amount: 1150, subtotal: 1000, vat_amount: 150,
              invoice_id: 'inv-1', return_number: 'SRT-V', date: '2026-09-01', customer_name: 'عميل',
            }],
          };
        }
        if (sql.includes('FROM sales_return_lines')) {
          return { success: true, rows: [{ product_id: 'p1', bq: 2 }] };
        }
        if (sql.includes('FROM sales_invoice_lines')) {
          return { success: true, rows: [{ product_id: 'p1', unit_cost: 400 }] };
        }
        if (sql.includes('FROM settings')) return { success: true, rows: [{ value: 'moving_average' }] };
        if (sql.includes('default_accounts')) {
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

    const res = await salesApi.postReturn('ret-1', 'comp-1');
    expect(res.success, 'postReturn failed: ' + (res.error || '')).toBe(true);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    // revenue reverses at NET, VAT on its own leg, COGS at original 2×400
    expect(legs.find((l) => l.acc === 'acc-default_sales_returns')).toMatchObject({ debit: 1000 });
    expect(legs.find((l) => l.acc === 'acc-default_vat_output')).toMatchObject({ debit: 150 });
    expect(legs.find((l) => l.acc === 'acc-default_debtors')).toMatchObject({ credit: 1150 });
    expect(legs.find((l) => l.acc === 'acc-default_inventory')).toMatchObject({ debit: 800 });
    expect(legs.find((l) => l.acc === 'acc-default_cogs')).toMatchObject({ credit: 800 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(1950);
  });
});

describe('salesApi period guard (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects posting into a closed tax period', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1000, paid_amount: 0, date: '2026-08-15' }] };
      }
      if (sql.includes('FROM tax_periods')) {
        return {
          success: true,
          rows: [{ id: 'p1', company_id: COMPANY_ID, country_code: 'SA', period_type: 'monthly', start_date: '2026-08-01', end_date: '2026-08-31', status: 'closed', filed_at: null }],
        };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مغلقة/);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });
});

describe('salesApi Phase 4 guardrails (negative stock + credit limit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function policyAdapter(opts: {
    lines?: Array<{ pid: string; bq: number }>;
    stock?: Array<{ pid: string; have: number }>;
    policies?: Record<string, string>;
    customer?: { balance: number; limit: number };
  }) {
    return makeMockAdapter(async (sql, p) => {
      if (sql.includes('WITH backfill')) {
        return { success: true, rows: [{ cogs: 0, zero_lines: 0, line_disc: 0 }] };
      }
      if (sql.includes('FROM sales_invoice_lines')) {
        return { success: true, rows: (opts.lines || []).map((l) => ({ product_id: l.pid, bq: l.bq })) };
      }
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1000, paid_amount: 0, subtotal: 1000, vat_amount: 0, invoice_number: 'INV-P', date: '2026-09-01', payment_type: 'credit', cash_box_id: null }] };
      }
      // No settings rows → fail-closed defaults (block negatives, block overlimit).
      if (sql.includes('FROM settings')) {
        return { success: true, rows: [] };
      }
      if (sql.includes('FROM stock')) {
        return { success: true, rows: (opts.stock || []).map((s) => ({ product_id: s.pid, have: s.have })) };
      }
      if (sql.includes('FROM products WHERE')) {
        const ids = ((p as unknown[]).slice(1) as string[]).map(String);
        return { success: true, rows: ids.map((id) => ({ id, name_ar: id })) };
      }
      if (sql.includes('FROM customers WHERE')) {
        const c = opts.customer || { balance: 0, limit: 0 };
        return { success: true, rows: [{ balance: c.balance, credit_limit: c.limit }] };
      }
      if (sql.includes('default_accounts')) {
        return { success: true, rows: [{ account_id: 'acc-' + String((p as unknown[])[1]) }] };
      }
      return { success: true, rows: [] };
    });
  }

  it('blocks posting below zero when the policy denies it', async () => {
    const adapter = policyAdapter({ lines: [{ pid: 'p1', bq: 5 }], stock: [{ pid: 'p1', have: 2 }] });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/المخزون لا يكفي/);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });

  it('blocks a credit invoice that breaches the customer limit', async () => {
    const adapter = policyAdapter({
      lines: [{ pid: 'p1', bq: 1 }],
      stock: [{ pid: 'p1', have: 100 }],
      customer: { balance: 9000, limit: 9500 },
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    // outstanding 1000 → would-be 10000 > 9500
    const res = await salesApi.postInvoice('inv-1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/الحد الائتماني/);
  });

  it('treats limit 0 as unlimited', async () => {
    const adapter = policyAdapter({
      lines: [{ pid: 'p1', bq: 1 }],
      stock: [{ pid: 'p1', have: 100 }],
      customer: { balance: 999999, limit: 0 },
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', COMPANY_ID);
    expect(res.success).toBe(true);
  });
});

describe('salesApi Phase 5 fiscal lock (closed year refuses posting)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CLOSED_YEAR = {
    success: true,
    rows: [{
      id: 'p1', company_id: 'c1', year: 2024,
      start_date: '2024-01-01', end_date: '2024-12-31',
      status: 'closed', closed_at: '2025-01-05',
    }],
  };

  it('postInvoice refuses a date inside a closed fiscal year', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM sales_invoices')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 1000, paid_amount: 0, subtotal: 1000, vat_amount: 0, invoice_number: 'INV-1', date: '2024-06-01', payment_type: 'credit', cash_box_id: null }] };
      }
      if (sql.includes('FROM accounting_periods')) return CLOSED_YEAR;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postInvoice('inv-1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مقفلة/);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });

  it('postReturn refuses a date inside a closed fiscal year', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM sales_returns')) {
        return { success: true, rows: [{ customer_id: 'c1', total_amount: 100, subtotal: 100, vat_amount: 0, return_number: 'SRT-1', date: '2024-06-01' }] };
      }
      if (sql.includes('FROM accounting_periods')) return CLOSED_YEAR;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.postReturn('ret-1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مقفلة/);
  });
});

describe('salesApi.mapReturnRow — NULL invoice link (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a return without a source invoice to undefined (never the string "null")', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        id: 'ret-1', company_id: COMPANY_ID, return_number: 'SRT-1',
        invoice_id: null, invoice_number_ref: null,
        customer_id: CUSTOMER_ID, customer_name: 'عميل',
        date: '2026-09-01', subtotal: 1000, vat_amount: 150, total_amount: 1150,
        reason: 'test', payment_type: 'credit', cash_box_id: null,
        status: 'draft', notes: null,
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await salesApi.getReturns(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data![0].invoiceId).toBeUndefined();
    expect(res.data![0].invoice).toBeUndefined();
  });
});

describe('salesApi line lookups scope the product join to the company (defense in depth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function servedAdapter(headerFrom: string) {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      if (sql.includes(headerFrom)) {
        return {
          success: true,
          rows: [{
            id: INVOICE_ID, company_id: COMPANY_ID, customer_id: CUSTOMER_ID,
            date: '2026-09-01', subtotal: 1000, vat_amount: 150, total_amount: 1150,
            status: 'draft', payment_type: 'credit',
          }],
        };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    return captured;
  }

  it('getInvoiceById passes the company to the lines query', async () => {
    const captured = servedAdapter('FROM sales_invoices');
    await salesApi.getInvoiceById(INVOICE_ID, COMPANY_ID);
    const q = captured.find((c) => c.sql.includes('FROM sales_invoice_lines'))!;
    expect(q.sql).toContain('p.company_id = $2::uuid');
    expect(q.params).toEqual([INVOICE_ID, COMPANY_ID]);
  });

  it('getQuotationById passes the company to the lines query', async () => {
    const captured = servedAdapter('FROM quotations');
    await salesApi.getQuotationById(INVOICE_ID, COMPANY_ID);
    const q = captured.find((c) => c.sql.includes('FROM quotation_lines'))!;
    expect(q.sql).toContain('p.company_id = $2::uuid');
    expect(q.params).toEqual([INVOICE_ID, COMPANY_ID]);
  });

  it('getReturnById passes the company to the lines query', async () => {
    const captured = servedAdapter('FROM sales_returns');
    await salesApi.getReturnById(INVOICE_ID, COMPANY_ID);
    const q = captured.find((c) => c.sql.includes('FROM sales_return_lines'))!;
    expect(q.sql).toContain('p.company_id = $2::uuid');
    expect(q.params).toEqual([INVOICE_ID, COMPANY_ID]);
  });
});

describe('salesApi.convertQuotationToInvoice (claim before create)', () => {
  const QUO_ID = '00000000-0000-0000-0000-000000000040';

  function installAdapter(claimRows: Array<{ id: string }>, priorStatus = 'converted') {
    const sqls: string[] = [];
    const adapter = makeMockAdapter(async (sql, _params) => {
      sqls.push(sql);
      if (/UPDATE quotations SET status = 'converted'/i.test(sql)) return { success: true, rows: claimRows };
      if (/SELECT status FROM quotations/i.test(sql)) return { success: true, rows: [{ status: priorStatus }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    return sqls;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronDB?: unknown }).electronDB = undefined;
  });

  it('claims the quotation BEFORE creating the invoice', async () => {
    const sqls = installAdapter([{ id: QUO_ID }]);
    const create = vi.spyOn(salesApi, 'createInvoice').mockResolvedValue({ success: true, id: 'inv-77' } as never);

    const res = await salesApi.convertQuotationToInvoice(QUO_ID, COMPANY_ID, { companyId: COMPANY_ID } as never);

    expect(res).toEqual({ success: true, id: 'inv-77' });
    // The claim must be a conditional, row-reporting UPDATE that precedes the
    // invoice insert — otherwise a second conversion duplicates the invoice.
    const claimIdx = sqls.findIndex((s) => /UPDATE quotations SET status = 'converted'/i.test(s));
    expect(claimIdx).toBeGreaterThanOrEqual(0);
    expect(sqls[claimIdx]).toMatch(/status = ANY\(\$4::text\[\]\)/);
    expect(sqls[claimIdx]).toMatch(/RETURNING id/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('aborts WITHOUT creating an invoice when the claim is lost (no duplicate invoice)', async () => {
    installAdapter([]); // zero rows: already converted / rejected / cancelled
    const create = vi.spyOn(salesApi, 'createInvoice');

    const res = await salesApi.convertQuotationToInvoice(QUO_ID, COMPANY_ID, { companyId: COMPANY_ID } as never);

    expect(res.success).toBe(false);
    expect(create, 'a lost claim must never produce an invoice').not.toHaveBeenCalled();
  });

  it('releases the claim to the ORIGINAL status when the invoice fails', async () => {
    const sqls = installAdapter([{ id: QUO_ID }], 'accepted');
    vi.spyOn(salesApi, 'createInvoice').mockResolvedValue({ success: false, error: 'لا يوجد حساب' } as never);

    const res = await salesApi.convertQuotationToInvoice(QUO_ID, COMPANY_ID, { companyId: COMPANY_ID } as never);

    expect(res.success).toBe(false);
    const release = sqls.find((s) => /NOT EXISTS/i.test(s));
    expect(release, 'the claim is released').toBeTruthy();
    expect(release).toMatch(/SET status = \$3/);
    expect(release).toMatch(/NOT EXISTS \(SELECT 1 FROM sales_invoices WHERE quotation_id/);
  });

  it('Electron path uses the dedicated claim channel and CHECKS its result', async () => {
    // The regression: the old code flipped through `updateQuotation`, which
    // refuses any status but 'draft', and never inspected the reply — so
    // Electron created the invoice, left the quotation 'sent', and reported
    // success. Silent duplicate invoices, desktop only.
    const calls: string[] = [];
    (window as unknown as { electronDB: unknown }).electronDB = {
      sales: {
        claimQuotation: async () => {
          calls.push('claimQuotation');
          return { success: true, rows: [{ id: QUO_ID, previous_status: 'sent', quotation_number: 'QOT-1' }] };
        },
        releaseQuotation: async () => {
          calls.push('releaseQuotation');
          return { success: true, rows: [{ id: QUO_ID }] };
        },
        updateQuotation: async () => {
          calls.push('updateQuotation');
          return { success: false, error: 'Use the quotation workflow to change status' };
        },
      },
    };
    vi.mocked(isElectronPg).mockReturnValue(true);
    const create = vi.spyOn(salesApi, 'createInvoice').mockResolvedValue({ success: true, id: 'inv-88' } as never);

    const res = await salesApi.convertQuotationToInvoice(QUO_ID, COMPANY_ID, { companyId: COMPANY_ID } as never);

    expect(res).toEqual({ success: true, id: 'inv-88' });
    expect(calls, 'the conversion must claim through the dedicated channel').toEqual(['claimQuotation']);
    expect(calls, 'updateQuotation cannot set a status and must not be used').not.toContain('updateQuotation');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('Electron path surfaces a rejected claim instead of creating an invoice', async () => {
    (window as unknown as { electronDB: unknown }).electronDB = {
      sales: {
        claimQuotation: async () => ({ success: false, error: 'Quotation not convertible' }),
      },
    };
    vi.mocked(isElectronPg).mockReturnValue(true);
    const create = vi.spyOn(salesApi, 'createInvoice');

    const res = await salesApi.convertQuotationToInvoice(QUO_ID, COMPANY_ID, { companyId: COMPANY_ID } as never);

    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
});
