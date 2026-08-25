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

import { accountingApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

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

  it('increments supplier balance for payment voucher', async () => {
    const queries: string[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      queries.push(sql);
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
    expect(queries.length).toBe(1);
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
    expect(queries.some(q => q.includes('UPDATE sales_invoices'))).toBe(true);
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

describe('accountingApi.deleteReceiptVoucher with applied payment protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion when amountApplied > 0 (would break invoice balance)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ invoice_id: 'inv-1', amount_applied: 250, base_currency_applied: 250, status: 'posted' }],
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

  it('rejects deletion when amountApplied > 0', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ invoice_id: 'pinv-1', amount_applied: 500, base_currency_applied: 500, status: 'posted' }],
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
    expect(capturedSql).toMatch(/updated_by = \$9::uuid/);
    expect(capturedParams[8]).toBeNull();
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
