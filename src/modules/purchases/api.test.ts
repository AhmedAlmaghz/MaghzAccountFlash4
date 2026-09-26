import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  // Default: the renderer fallback path. Typed-RPC suites flip this to true.
  isElectronPg: vi.fn(() => false),
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
    createSupplierSchema: mockSchema,
    createPurchaseInvoiceSchema: mockSchema,
    createPurchaseOrderSchema: mockSchema,
    createPurchaseReturnSchema: mockSchema,
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
import { purchasesApi } from './api';
import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return { query: vi.fn(queryImpl) };
}
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const SUPPLIER_ID = '00000000-0000-0000-0000-000000000010';
const ORDER_ID = '00000000-0000-0000-0000-000000000020';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000030';
describe('purchasesApi.createOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('inserts order with correct placeholder count and ::uuid casts', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      if (sql.includes('RETURNING id')) {
        return { success: true, rows: [{ id: ORDER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const result = await purchasesApi.createOrder({
      companyId: COMPANY_ID,
      orderNumber: 'PO-0001',
      supplierId: SUPPLIER_ID,
      date: '2026-07-13',
      expectedDate: '2026-07-20',
      totalAmount: 1000,
      status: 'draft',
      notes: 'Test order',
      lines: [
        { productId: PRODUCT_ID, quantity: 5, unitPrice: 200, lineTotal: 1000 },
      ],
    });
    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0];
    expect(sql).toContain('INSERT INTO purchase_orders');
    expect(sql).toContain('INSERT INTO purchase_order_lines');
    expect(sql).toContain('::uuid');
    expect(sql).toContain('::numeric');
    expect(sql).toContain('::date');
    expect(sql).toContain('::varchar');
    expect(sql).not.toMatch(/\$\d+(?!.*::)/);
    // 13 header + 5 line + 3 unit snapshot = 21
    expect(params.length).toBe(21);
    expect(typeof params[0]).toBe('string');
    expect((params[0] as string).length).toBeGreaterThan(0);
    expect(params[1]).toBe(COMPANY_ID);
    expect(params[2]).toBe('PO-0001');
    expect(params[3]).toBe(SUPPLIER_ID);
    expect(params[4]).toBe('2026-07-13');
    expect(params[5]).toBe('2026-07-20');
    expect(params[6]).toBe(1000);
    expect(params[7]).toBe('draft');
    expect(params[8]).toBe('credit');
    expect(params[9]).toBeNull(); // cash box
    expect(params[10]).toBe('Test order');
    expect(params[11]).toBeNull(); // created_by
    expect(params[12]).toBeNull(); // updated_by
    expect(typeof params[13]).toBe('string'); // orderId for lines
    expect(params[14]).toBe(PRODUCT_ID);
    expect(params[15]).toBe(5);
    expect(params[16]).toBe(200);
    expect(params[17]).toBe(1000);
    // multi-unit snapshot appended at the end (unitId, factor, base qty)
    expect(params.length).toBe(21);
    expect(params[18]).toBeNull();
    expect(params[19]).toBe(1);
    expect(params[20]).toBe(5);
  });
  it('does not include non-existent description/received_quantity columns in line insert', async () => {
    const captured: { sql: string }[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      captured.push({ sql });
      if (sql.includes('RETURNING id')) {
        return { success: true, rows: [{ id: ORDER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    await purchasesApi.createOrder({
      companyId: COMPANY_ID,
      orderNumber: 'PO-0002',
      supplierId: SUPPLIER_ID,
      date: '2026-07-13',
      totalAmount: 500,
      status: 'draft',
      notes: '',
      lines: [
        { productId: PRODUCT_ID, quantity: 2, unitPrice: 250, lineTotal: 500, description: 'should be ignored', receivedQuantity: 999 } as never,
      ],
    });
    const linesInsert = captured.find(c => c.sql.includes('INSERT INTO purchase_order_lines'));
    expect(linesInsert).toBeDefined();
    expect(linesInsert!.sql).toContain('INSERT INTO purchase_order_lines (order_id,product_id,quantity,unit_price,line_total,unit_id,unit_factor,base_quantity)');
    expect(linesInsert!.sql).not.toContain('description');
    expect(linesInsert!.sql).not.toContain('received_quantity');
  });
});
describe('purchasesApi.getOrderById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('uses ::uuid cast on order_id and company_id in lookup queries', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      if (sql.includes('FROM purchase_orders po')) {
        return { success: true, rows: [{ id: ORDER_ID, company_id: COMPANY_ID, order_number: 'PO-0001', supplier_id: SUPPLIER_ID, date: '2026-07-13', total_amount: '1000', status: 'draft', notes: '', created_by: null, updated_by: null, created_at: '2026-07-13', updated_at: '2026-07-13' }] };
      }
      if (sql.includes('FROM purchase_order_lines')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    await purchasesApi.getOrderById(ORDER_ID, COMPANY_ID);
    const headerQuery = captured.find(c => c.sql.includes('FROM purchase_orders po'));
    const linesQuery = captured.find(c => c.sql.includes('FROM purchase_order_lines'));
    expect(headerQuery).toBeDefined();
    expect(headerQuery!.sql).toContain('po.id = $1::uuid');
    expect(headerQuery!.sql).toContain('po.company_id = $2::uuid');
    expect(linesQuery).toBeDefined();
    expect(linesQuery!.sql).toContain('l.order_id = $1::uuid');
  });

  it('scopes the product join in the lines query to the company (defense in depth)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      if (sql.includes('FROM purchase_orders po')) {
        return { success: true, rows: [{ id: ORDER_ID, company_id: COMPANY_ID, order_number: 'PO-0001', supplier_id: SUPPLIER_ID, date: '2026-07-13', total_amount: '1000', status: 'draft', notes: '', created_by: null, updated_by: null, created_at: '2026-07-13', updated_at: '2026-07-13' }] };
      }
      if (sql.includes('FROM purchase_order_lines')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    await purchasesApi.getOrderById(ORDER_ID, COMPANY_ID);
    const linesQuery = captured.find(c => c.sql.includes('FROM purchase_order_lines'))!;
    // The product display columns must never come from another tenant, even if
    // a line ever pointed at a foreign product (broken FK discipline).
    expect(linesQuery.sql).toContain('p.company_id = $2::uuid');
    expect(linesQuery.params).toEqual([ORDER_ID, COMPANY_ID]);
  });
});

describe('purchasesApi.getSupplierStatement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unified statement SQL includes the opening-balance branch and company scoping in every branch', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.getSupplierStatement(SUPPLIER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0];
    // opening + invoices + returns + payments in ONE query with a running balance
    expect(sql).toMatch(/FROM suppliers s/);
    expect(sql).toMatch(/s\.opening_balance <> 0/);
    expect(sql).toMatch(/FROM purchase_invoices/);
    expect(sql).toMatch(/FROM payment_vouchers/);
    expect(sql).toMatch(/FROM purchase_returns/);
    expect(sql).toMatch(/رصيد افتتاحي/);
    expect(sql).toMatch(/SUM\(credit - debit\) OVER/);
    // every UNION branch must scope to the caller's company
    expect(sql.match(/company_id = \$2::uuid/g)).toHaveLength(4);
    expect(params).toEqual([SUPPLIER_ID, COMPANY_ID]);
  });

  it('maps rows to statement items and carries the opening balance into the closing balance', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { id: 'open-1', date: '1900-01-01', type: 'opening', document_number: 'OPENING', description: 'رصيد افتتاحي', debit: 0, credit: 5000, balance: 5000 },
        { id: 'inv-1', date: '2026-06-01', type: 'invoice', document_number: 'PINV-001', description: 'فاتورة مشتريات', debit: 0, credit: 3000, balance: 8000 },
        { id: 'pay-1', date: '2026-06-10', type: 'payment', document_number: 'PV-001', description: 'سند صرف', debit: 2000, credit: 0, balance: 6000 },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.getSupplierStatement(SUPPLIER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(3);
    expect(res.data![0].type).toBe('opening');
    // closing balance = opening + invoices - payments (FULL balance)
    expect(res.data![2].balance).toBe(6000);
  });

  it('excludes cash invoices from the statement (settled at once, not payables)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.getSupplierStatement(SUPPLIER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(payment_type, 'credit'\) <> 'cash'/);
  });
});

describe('purchasesApi invoice/return guards — sales parity (Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const INVOICE_ID = '00000000-0000-0000-0000-000000000040';
  const RETURN_ID = '00000000-0000-0000-0000-000000000050';

  // delete/update paths run multi-statement batches — route them through the
  // same query impl like the sales tests do.
  function makeTxAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
    return {
      query: vi.fn(queryImpl),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        for (const q of queries) {
          const r = await queryImpl(q.sql, (q.params || []) as unknown[]);
          if (!r.success) return { success: false, error: r.error };
        }
        return { success: true, results: [] };
      }),
    };
  }

  it('createInvoice rejects overpayment (paid > total)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ id: INVOICE_ID }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.createInvoice({
      companyId: COMPANY_ID, invoiceNumber: 'PINV-1', supplierId: SUPPLIER_ID,
      date: '2026-09-01', subtotal: 1000, discountAmount: 0, vatAmount: 150,
      totalAmount: 1150, paidAmount: 2000, status: 'draft',
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exceed total/i);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('createInvoice rejects non-positive exchange rates', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ id: INVOICE_ID }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.createInvoice({
      companyId: COMPANY_ID, invoiceNumber: 'PINV-1', supplierId: SUPPLIER_ID,
      date: '2026-09-01', subtotal: 1000, discountAmount: 0, vatAmount: 0,
      totalAmount: 1000, paidAmount: 0, status: 'draft', exchangeRate: 0,
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/positive/i);
  });

  it('createInvoice rejects direct posted status', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ id: INVOICE_ID }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.createInvoice({
      companyId: COMPANY_ID, invoiceNumber: 'PINV-POSTED', supplierId: SUPPLIER_ID,
      date: '2026-09-01', subtotal: 1000, vatAmount: 0,
      totalAmount: 1000, paidAmount: 0, status: 'posted',
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/draft/i);
    expect(adapter.query).not.toHaveBeenCalled();
  });
  it('createInvoice defaults baseCurrencyPaid to paid*rate (no silent zero)', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      return { success: true, rows: [{ id: INVOICE_ID }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.createInvoice({
      companyId: COMPANY_ID, invoiceNumber: 'PINV-1', supplierId: SUPPLIER_ID,
      date: '2026-09-01', subtotal: 1000, discountAmount: 0, vatAmount: 0,
      totalAmount: 1000, paidAmount: 400, status: 'draft',
      currencyCode: 'USD', exchangeRate: 500,
    } as never);
    expect(res.success).toBe(true);
    const insert = captured.find(c => c.sql.includes('INSERT INTO purchase_invoices'))!;
    // params: [..., currency(13), rate(14), baseAmount(15), basePaid(16), ...] (1-based $13..$16)
    expect(insert.params[15]).toBe(400 * 500);
  });

  it('updateInvoice rejects changes to a posted invoice paid floor', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) {
        return { success: true, rows: [{ status: 'posted', paid_amount: 300 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.updateInvoice(INVOICE_ID, COMPANY_ID, { paidAmount: 100 } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/paid amount/i);
  });

  it('deleteInvoice rejects posted invoices and paid drafts', async () => {
    const posted = makeTxAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'posted', paid_amount: 0 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(posted as never);
    const r1 = await purchasesApi.deleteInvoice(INVOICE_ID, COMPANY_ID);
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/posted invoice/i);

    const paidDraft = makeTxAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'draft', paid_amount: 100 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(paidDraft as never);
    const r2 = await purchasesApi.deleteInvoice(INVOICE_ID, COMPANY_ID);
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/payments/i);
  });

  it('deleteReturn rejects posted returns', async () => {
    const adapter = makeTxAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'posted' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.deleteReturn(RETURN_ID, COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted return/i);
  });

  it('updateReturn rejects amount changes on a posted return', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('SELECT')) return { success: true, rows: [{ status: 'posted' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.updateReturn(RETURN_ID, COMPANY_ID, { totalAmount: 1 } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/posted return/i);
  });
});

describe('purchasesApi supplier computed_balance excludes cash purchases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSuppliers filters cash invoices', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await purchasesApi.getSuppliers(COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(pi\.payment_type, 'credit'\) <> 'cash'/);
  });

  it('getSuppliersPaginated applies the same cash exclusion', async () => {
    const adapter = makeMockAdapter(async (sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return { success: true, rows: [{ total: 0 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await purchasesApi.getSuppliersPaginated(COMPANY_ID, 1, 25);
    const dataSql = adapter.query.mock.calls.map((c) => c[0] as string).find((s) => /computed_balance/.test(s));
    expect(dataSql).toMatch(/COALESCE\(pi\.payment_type, 'credit'\) <> 'cash'/);
  });

  it('getSupplierById applies the same cash exclusion', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await purchasesApi.getSupplierById(SUPPLIER_ID, COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(pi\.payment_type, 'credit'\) <> 'cash'/);
  });

  it('getApAging excludes cash invoices from the invoice leg', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await purchasesApi.getApAging(SUPPLIER_ID, COMPANY_ID);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(payment_type, 'credit'\) <> 'cash'/);
  });

  it('getApAgingTotal excludes cash invoices', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.getApAgingTotal(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(payment_type, 'credit'\) <> 'cash'/);
  });
});

describe('purchasesApi.postInvoice explicit discount leg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts Dr Gross + Dr VAT = Cr Creditors + Cr Discount Earned', async () => {
    const txQueries: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, p: unknown[]) => {
        if (sql.includes('FROM purchase_invoices')) {
          return { success: true, rows: [{ supplier_id: SUPPLIER_ID, date: '2026-01-01', total_amount: 1035, paid_amount: 0, subtotal: 1000, discount_amount: 150, vat_amount: 135, payment_type: 'credit', cash_box_id: null }] };
        }
        if (sql.includes('FROM purchase_invoice_lines')) {
          return { success: true, rows: [{ line_disc: 50 }] };
        }
        if (sql.includes('default_accounts')) {
          return { success: true, rows: [{ account_id: 'acc-' + String(p[1]) }] };
        }
        if (sql.includes('FROM accounts')) {
          return { success: true, rows: [{ id: 'acc-code' }] };
        }
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        txQueries.push(...queries);
        return { success: true, results: [] };
      }),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postInvoice('00000000-0000-0000-0000-000000000040', COMPANY_ID);
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const jeInsert = txQueries.find(q => q.sql.includes('INSERT INTO journal_entries'));
    expect(jeInsert).toBeDefined();
    const flat = (jeInsert!.params || []).slice(6);
    const legs: Array<{ account: unknown; debit: number; credit: number }> = [];
    for (let i = 0; i < flat.length; i += 4) {
      legs.push({ account: flat[i], debit: Number(flat[i + 1]), credit: Number(flat[i + 2]) });
    }
    expect(legs).toHaveLength(4);
    expect(legs[0]).toMatchObject({ account: 'acc-default_inventory', debit: 1050, credit: 0 });
    expect(legs[2]).toMatchObject({ account: 'acc-default_creditors', debit: 0, credit: 1035 });
    expect(legs[3]).toMatchObject({ account: 'acc-default_discount_received', debit: 0, credit: 150 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBeCloseTo(cr, 2);
  });
});

describe('purchasesApi.postInvoice perpetual valuation (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const INVOICE_ID = '00000000-0000-0000-0000-000000000040';

  function valuationAdapter(method: string, opts: {
    lines?: Array<{ pid: string; bq: number; total: number }>;
    stock?: Array<{ pid: string; q: number }>;
    products?: Array<{ id: string; cost: number; std: number | null }>;
    warehouse?: string | null;
  }) {
    const tx: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM purchase_invoices')) {
          return {
            success: true,
            rows: [{
              supplier_id: SUPPLIER_ID, total_amount: 1150, paid_amount: 0,
              subtotal: 1000, vat_amount: 150, invoice_number: 'PINV-V',
              date: '2026-09-01', payment_type: 'credit', cash_box_id: null,
            }],
          };
        }
        if (sql.includes('FROM purchase_invoice_lines')) {
          return {
            success: true,
            rows: (opts.lines || []).map((l) => ({ product_id: l.pid, bq: l.bq, line_total: l.total })),
          };
        }
        if (sql.includes('FROM settings')) return { success: true, rows: [{ value: method }] };
        if (sql.includes('FROM stock')) {
          // Both shapes: averaging reads product_id/q, the Phase-4 gate
          // reads product_id/have. Ample when the test omits stock.
          const base = (opts.stock || []).map((s) => ({ product_id: s.pid, q: s.q, have: s.q }));
          if (base.length > 0) return { success: true, rows: base };
          const ids = ((params || []) as unknown[]).slice(1).map((x) => String(x));
          return { success: true, rows: ids.map((id) => ({ product_id: id, q: 1000000, have: 1000000 })) };
        }
        if (sql.includes('FROM products WHERE')) {
          return {
            success: true,
            rows: (opts.products || []).map((x) => ({ id: x.id, cost_price: x.cost, standard_cost: x.std, name_ar: x.id })),
          };
        }
        if (sql.includes('FROM warehouses')) {
          return { success: true, rows: opts.warehouse ? [{ id: opts.warehouse }] : [] };
        }
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
    return { adapter, tx };
  }

  it('moving_average re-blends cost_price: (10×100 + 10×120)/20 = 110', async () => {
    const { adapter, tx } = valuationAdapter('moving_average', {
      lines: [{ pid: 'p1', bq: 10, total: 1200 }],
      stock: [{ pid: 'p1', q: 10 }],
      products: [{ id: 'p1', cost: 100, std: null }],
      warehouse: 'w1',
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postInvoice(INVOICE_ID, COMPANY_ID);
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const avg = tx.find((q) => q.sql.includes('UPDATE products SET cost_price'));
    expect(avg).toBeDefined();
    expect(Number(avg!.params?.[0])).toBe(110);
    // inventory booked at actual subtotal (no PPV in average mode)
    const je = tx.find((q) => q.sql.includes('WITH new_tx'));
    expect(je).toBeDefined();
    expect(je!.params).toContain(1000);
    expect(tx.some((q) => q.sql.includes('51901') || String(q.params || []).includes('acc-default_price_variance'))).toBe(false);
  });

  it('fifo opens one layer per line at base-unit cost', async () => {
    const { adapter, tx } = valuationAdapter('fifo', {
      lines: [{ pid: 'p1', bq: 12, total: 1200 }],
      products: [{ id: 'p1', cost: 0, std: null }],
      warehouse: 'w1',
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postInvoice(INVOICE_ID, COMPANY_ID);
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const layer = tx.find((q) => q.sql.includes('INSERT INTO inventory_layers'));
    expect(layer).toBeDefined();
    // [company, product, warehouse, qty 12, unit 100, date, ref]
    expect(layer!.params?.[3]).toBe(12);
    expect(layer!.params?.[4]).toBe(100);
    // average untouched in fifo mode
    expect(tx.some((q) => q.sql.includes('UPDATE products SET cost_price'))).toBe(false);
  });

  it('rejects posting into a closed tax period (Phase 3)', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM purchase_invoices')) {
        return { success: true, rows: [{ supplier_id: SUPPLIER_ID, total_amount: 1000, paid_amount: 0, date: '2026-08-15' }] };
      }
      if (sql.includes('FROM tax_periods')) {
        return {
          success: true,
          rows: [{ id: 'p1', company_id: COMPANY_ID, country_code: 'SA', period_type: 'monthly', start_date: '2026-08-01', end_date: '2026-08-31', status: 'filed', filed_at: '2026-09-01' }],
        };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postInvoice('00000000-0000-0000-0000-000000000040', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مغلقة/);
  });

  it('refuses posting inside a closed fiscal year (Phase 5)', async () => {
    const closed = {
      success: true,
      rows: [{
        id: 'p1', company_id: COMPANY_ID, year: 2024,
        start_date: '2024-01-01', end_date: '2024-12-31',
        status: 'closed', closed_at: '2025-01-05',
      }],
    };
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM purchase_invoices')) {
        return {
          success: true,
          rows: [{
            supplier_id: SUPPLIER_ID, total_amount: 500, subtotal: 500, vat_amount: 0,
            invoice_number: 'PINV-N', date: '2024-09-01', payment_type: 'credit', cash_box_id: null,
          }],
        };
      }
      if (sql.includes('FROM accounting_periods')) return closed;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postInvoice('00000000-0000-0000-0000-000000000040', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مقفلة/);
    // Refusal happens before any batch is built — adapter.transaction is
    // never even reached (this file's mock has no transaction spy).
    expect(res.error).not.toMatch(/transaction/i);
  });

  it('blocks a purchase return that would drive stock negative (Phase 4)', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM purchase_returns')) {
        return {
          success: true,
          rows: [{
            supplier_id: SUPPLIER_ID, total_amount: 500, subtotal: 500, vat_amount: 0,
            return_number: 'PRT-N', date: '2026-09-01', supplier_name: 'مورد',
          }],
        };
      }
      if (sql.includes('FROM purchase_return_lines')) {
        return { success: true, rows: [{ product_id: 'p1', bq: 10 }] };
      }
      if (sql.includes('FROM settings')) return { success: true, rows: [] };
      if (sql.includes('FROM stock')) {
        return { success: true, rows: [{ product_id: 'p1', have: 3 }] };
      }
      if (sql.includes('FROM products WHERE')) {
        return { success: true, rows: [{ id: 'p1', name_ar: 'صنف' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postReturn('00000000-0000-0000-0000-000000000050', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/المخزون لا يكفي/);
  });

  it('postReturn splits VAT + books inventory at cost with PPV plug (Phase 1)', async () => {
    const tx: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM purchase_returns')) {
          return {
            success: true,
            rows: [{
              supplier_id: SUPPLIER_ID, total_amount: 1150, subtotal: 1000, vat_amount: 150,
              return_number: 'PRT-V', date: '2026-09-01', supplier_name: 'مورد',
            }],
          };
        }
        if (sql.includes('FROM purchase_return_lines')) {
          return { success: true, rows: [{ product_id: 'p1', bq: 10 }] };
        }
        if (sql.includes('FROM settings')) return { success: true, rows: [{ value: 'moving_average' }] };
        if (sql.includes('FROM stock')) {
          return { success: true, rows: [{ product_id: 'p1', have: 1000000 }] };
        }
        if (sql.includes('FROM products WHERE')) {
          return { success: true, rows: [{ id: 'p1', cost_price: 90, standard_cost: null, name_ar: 'p1' }] };
        }
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

    const res = await purchasesApi.postReturn('00000000-0000-0000-0000-000000000050', COMPANY_ID);
    expect(res.success, 'postReturn failed: ' + (res.error || '')).toBe(true);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    // cost basis 10×90 = 900 vs price 1000 → Cr PPV 100; VAT reverses on its own leg
    expect(legs.find((l) => l.acc === 'acc-default_creditors')).toMatchObject({ debit: 1150 });
    expect(legs.find((l) => l.acc === 'acc-default_inventory')).toMatchObject({ credit: 900 });
    expect(legs.find((l) => l.acc === 'acc-default_vat_input')).toMatchObject({ credit: 150 });
    expect(legs.find((l) => l.acc === 'acc-default_price_variance')).toMatchObject({ credit: 100 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it('standard books inventory at frozen cost + PPV for the gap', async () => {
    const { adapter, tx } = valuationAdapter('standard', {
      lines: [{ pid: 'p1', bq: 10, total: 1100 }],
      products: [{ id: 'p1', cost: 95, std: 90 }],
      warehouse: 'w1',
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await purchasesApi.postInvoice(INVOICE_ID, COMPANY_ID);
    expect(res.success, 'postInvoice failed: ' + (res.error || '')).toBe(true);
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    // inventory at 10×90 = 900; header subtotal 1000 → PPV Dr 100; creditors Cr total 1150
    expect(legs.find((l) => l.acc === 'acc-default_inventory')).toMatchObject({ debit: 900 });
    expect(legs.find((l) => l.acc === 'acc-default_price_variance')).toMatchObject({ debit: 100 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    const cr = legs.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });
});

/**
 * Typed-RPC tranche (AP mirror of the sales slice). In Electron these reads
 * ship a structured payload and the main process composes the SQL, so the
 * renderer must NOT touch `adapter.query` for them. The e2e shim and the raw
 * fallback both answer with the same column shape — the mapping below pins
 * that contract.
 */
describe('purchasesApi typed RPC (supplier ledger reads)', () => {
  type Rpc = (payload: Record<string, unknown>) => Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;

  function installRpcSurface(impl: Record<string, Rpc>) {
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    (window as unknown as { electronDB: { purchases: Record<string, Rpc> } }).electronDB = {
      purchases: new Proxy(
        {},
        {
          get(_t, method: string) {
            return async (payload: Record<string, unknown>) => {
              calls.push({ method, payload });
              const fn = impl[method];
              if (!fn) return { success: false, error: `unexpected method ${method}` };
              return fn(payload);
            };
          },
        }
      ),
    };
    return calls;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isElectronPg).mockReturnValue(true);
    (window as unknown as { electronDB?: unknown }).electronDB = undefined;
    const adapter = { query: vi.fn(() => Promise.resolve({ success: true, rows: [] })) };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
  });

  it('getSuppliers routes through the channel and never queries raw', async () => {
    const calls = installRpcSurface({
      getSuppliers: async () => ({
        success: true,
        rows: [
          { id: SUPPLIER_ID, company_id: COMPANY_ID, code: 'SUP-1', name: 'مورد', balance: 5, computed_balance: '4200' },
        ],
      }),
    });

    const res = await purchasesApi.getSuppliers(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0]?.balance, 'computed_balance must win over the stored column').toBe(4200);
    expect(calls.map((c) => c.method)).toEqual(['getSuppliers']);
    expect(await getDbAdapter()).toBeDefined();
    const adapter = (await getDbAdapter()) as unknown as { query: ReturnType<typeof vi.fn> };
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('getSuppliersPaginated reads the window count and forwards filters', async () => {
    const calls = installRpcSurface({
      getSuppliersPaginated: async () => ({
        success: true,
        rows: [{ id: SUPPLIER_ID, name: 'أ', total_count: 37, computed_balance: 0 }],
      }),
    });

    const res = await purchasesApi.getSuppliersPaginated(COMPANY_ID, 2, 10, { isActive: true, search: 'أ' });
    expect(res.success).toBe(true);
    expect(res.data?.total, 'total must come from the SQL window, not the page length').toBe(37);
    expect(res.data?.items).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({ page: 2, pageSize: 10, isActive: true, search: 'أ' });
  });

  it('getSupplierById returns not-found instead of a phantom supplier', async () => {
    installRpcSurface({ getSupplierById: async () => ({ success: true, rows: [] }) });
    const res = await purchasesApi.getSupplierById(SUPPLIER_ID, COMPANY_ID);
    expect(res).toEqual({ success: false, error: 'Supplier not found' });
  });

  it('getSupplierStatement maps every leg type and keeps the running balance', async () => {
    const calls = installRpcSurface({
      getSupplierStatement: async () => ({
        success: true,
        rows: [
          { id: 'a', date: '2026-01-01', type: 'opening', document_number: 'OPENING', description: 'رصيد افتتاحي', debit: 0, credit: 1000, balance: 1000 },
          { id: 'b', date: '2026-01-05', type: 'invoice', document_number: 'PINV-1', description: 'فاتورة مشتريات', debit: 0, credit: 500, balance: 1500 },
          { id: 'c', date: '2026-01-09', type: 'payment', document_number: 'PV-1', description: 'سند صرف', debit: 700, credit: 0, balance: 800 },
          { id: 'd', date: '2026-01-11', type: 'return', document_number: 'PRT-1', description: 'مردود مشتريات', debit: 100, credit: 0, balance: 700 },
        ],
      }),
    });

    const res = await purchasesApi.getSupplierStatement(SUPPLIER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.map((r) => r.type)).toEqual(['opening', 'invoice', 'payment', 'return']);
    // The last row is the supplier's FULL balance (statement is the truth).
    expect(res.data?.[3]?.balance).toBe(700);
    expect(calls[0]?.payload).toEqual({ supplierId: SUPPLIER_ID });
  });

  it('getApAging buckets the leg rows the channel returns', async () => {
    installRpcSurface({
      getApAging: async () => ({
        success: true,
        rows: [
          { aging_date: new Date().toISOString().slice(0, 10), due_amount: 300 },
          { aging_date: '2020-01-01', due_amount: 900 },
          { aging_date: '2020-02-01', due_amount: -400 },
        ],
      }),
    });

    const res = await purchasesApi.getApAging(SUPPLIER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    const byBucket = Object.fromEntries((res.data || []).map((b) => [b.bucket, b.amount]));
    expect(byBucket['0-30']).toBe(300);
    // A 2020 leg is 91+; the negative payment reduces the same bucket.
    expect(byBucket['91+']).toBe(500);
  });

  it('getApAgingTotal sums the four aggregate legs and floors at zero', async () => {
    installRpcSurface({
      getApAgingTotal: async () => ({
        success: true,
        rows: [{ outstanding: 1000 }, { opening_balance: 250 }, { amount: -400 }, { total_amount: -100 }],
      }),
    });

    const res = await purchasesApi.getApAgingTotal(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.total).toBe(750);
  });

  it('surfaces a channel refusal instead of silently reading raw SQL', async () => {
    installRpcSurface({
      getSuppliers: async () => ({ success: false, error: 'Permission denied' }),
    });
    const res = await purchasesApi.getSuppliers(COMPANY_ID);
    expect(res).toEqual({ success: false, error: 'Permission denied' });
    const adapter = (await getDbAdapter()) as unknown as { query: ReturnType<typeof vi.fn> };
    expect(adapter.query, 'a denied channel must not fall back to renderer SQL').not.toHaveBeenCalled();
  });
});

/**
 * Typed-RPC tranche A2 — invoice / order / return document reads. The
 * `*ById` channels fold the line rows into one `lines` json array, so the
 * mapping must survive both shapes the driver can hand back (parsed array or
 * JSON string) — and a document without lines must NOT become a phantom line.
 */
describe('purchasesApi typed RPC (document reads)', () => {
  const INVOICE_ID = '00000000-0000-0000-0000-000000000100';
  const RETURN_ID = '00000000-0000-0000-0000-000000000200';
  type Rpc = (payload: Record<string, unknown>) => Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;

  function installRpc(impl: Record<string, Rpc>) {
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    (window as unknown as { electronDB: { purchases: Record<string, Rpc> } }).electronDB = {
      purchases: new Proxy({}, {
        get(_t, method: string) {
          return async (payload: Record<string, unknown>) => {
            calls.push({ method, payload });
            const fn = impl[method];
            return fn ? fn(payload) : { success: false, error: `unexpected ${method}` };
          };
        },
      }),
    };
    return calls;
  }

  const header = (extra: Record<string, unknown> = {}) => ({
    id: INVOICE_ID, company_id: COMPANY_ID, invoice_number: 'PINV-0001', supplier_id: SUPPLIER_ID,
    supplier_name: 'مورد الاختبار', total_amount: '1150', subtotal: '1000', vat_amount: '150',
    status: 'posted', date: '2026-01-05', ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isElectronPg).mockReturnValue(true);
    (window as unknown as { electronDB?: unknown }).electronDB = undefined;
    vi.mocked(getDbAdapter).mockResolvedValue({ query: vi.fn(() => Promise.resolve({ success: true, rows: [] })) } as never);
  });

  it('getInvoices maps the list without touching raw SQL', async () => {
    const calls = installRpc({ getInvoices: async () => ({ success: true, rows: [header()] }) });
    const res = await purchasesApi.getInvoices(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0]?.invoiceNumber).toBe('PINV-0001');
    // supplier_name must build the nested supplier object (the UI links to it)
    expect(res.data?.[0]?.supplier?.name).toBe('مورد الاختبار');
    expect(res.data?.[0]?.totalAmount).toBe(1150);
    expect(calls.map((c) => c.method)).toEqual(['getInvoices']);
    const adapter = (await getDbAdapter()) as unknown as { query: ReturnType<typeof vi.fn> };
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('getInvoicesPaginated forwards filters and reads the window count', async () => {
    const calls = installRpc({
      getInvoicesPaginated: async () => ({ success: true, rows: [header({ total_count: 12 })] }),
    });
    const res = await purchasesApi.getInvoicesPaginated(COMPANY_ID, 2, 5, { status: 'posted', supplierId: SUPPLIER_ID, invoiceNumber: 'PINV' });
    expect(res.data?.total).toBe(12);
    expect(calls[0]?.payload).toMatchObject({ page: 2, pageSize: 5, status: 'posted', supplierId: SUPPLIER_ID, invoiceNumber: 'PINV' });
  });

  it('getInvoiceById maps the json lines array (parsed shape)', async () => {
    installRpc({
      getInvoiceById: async () => ({
        success: true,
        rows: [header({
          lines: [
            { id: 'l1', invoice_id: INVOICE_ID, product_id: PRODUCT_ID, product_name: 'صنف', quantity: '2', unit_price: '500', line_total: '1000', unit_factor: '12', base_quantity: '24' },
          ],
        })],
      }),
    });
    const res = await purchasesApi.getInvoiceById(INVOICE_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.lines).toHaveLength(1);
    expect(res.data?.lines[0]?.productName).toBe('صنف');
    // unit snapshot must survive the json hop (multi-unit documents)
    expect(res.data?.lines[0]?.unitFactor).toBe(12);
    expect(res.data?.lines[0]?.baseQuantity).toBe(24);
  });

  it('getInvoiceById accepts a JSON-string lines column and tolerates none', async () => {
    installRpc({
      getInvoiceById: async () => ({ success: true, rows: [header({ lines: '[{"id":"l1","quantity":1}]' })] }),
    });
    const parsed = await purchasesApi.getInvoiceById(INVOICE_ID, COMPANY_ID);
    expect(parsed.data?.lines).toHaveLength(1);

    installRpc({ getInvoiceById: async () => ({ success: true, rows: [header({ lines: [] })] }) });
    const empty = await purchasesApi.getInvoiceById(INVOICE_ID, COMPANY_ID);
    expect(empty.data?.lines).toEqual([]);
  });

  it('getInvoiceById reports Not found instead of an empty invoice', async () => {
    installRpc({ getInvoiceById: async () => ({ success: true, rows: [] }) });
    const res = await purchasesApi.getInvoiceById(INVOICE_ID, COMPANY_ID);
    expect(res).toEqual({ success: false, error: 'Not found' });
  });

  it('getOutstandingInvoicesForSupplier scopes to the supplier', async () => {
    const calls = installRpc({
      getOutstandingInvoicesForSupplier: async () => ({ success: true, rows: [header()] }),
    });
    const res = await purchasesApi.getOutstandingInvoicesForSupplier(COMPANY_ID, SUPPLIER_ID);
    expect(res.data).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({ supplierId: SUPPLIER_ID });
  });

  it('order and return reads route through their own channels', async () => {
    const calls = installRpc({
      getOrders: async () => ({ success: true, rows: [{ id: ORDER_ID, order_number: 'PO-1', total_amount: 10, lines: [] }] }),
      getOrdersPaginated: async () => ({ success: true, rows: [{ id: ORDER_ID, order_number: 'PO-1', total_count: 3, lines: [] }] }),
      getOrderById: async () => ({ success: true, rows: [{ id: ORDER_ID, order_number: 'PO-1', lines: [{ id: 'ol1', order_id: ORDER_ID, quantity: 3 }] }] }),
      getReturns: async () => ({ success: true, rows: [{ id: RETURN_ID, return_number: 'PRT-1', total_amount: 20, lines: [] }] }),
      getReturnsPaginated: async () => ({ success: true, rows: [{ id: RETURN_ID, return_number: 'PRT-1', total_count: 1, lines: [] }] }),
      getReturnById: async () => ({ success: true, rows: [{ id: RETURN_ID, return_number: 'PRT-1', lines: [{ id: 'rl1', return_id: RETURN_ID, quantity: 1 }] }] }),
    });

    expect((await purchasesApi.getOrders(COMPANY_ID)).data?.[0]?.orderNumber).toBe('PO-1');
    expect((await purchasesApi.getOrdersPaginated(COMPANY_ID, 1, 10)).data?.total).toBe(3);
    expect((await purchasesApi.getOrderById(ORDER_ID, COMPANY_ID)).data?.lines?.[0]?.quantity).toBe(3);
    expect((await purchasesApi.getReturns(COMPANY_ID)).data?.[0]?.returnNumber).toBe('PRT-1');
    expect((await purchasesApi.getReturnsPaginated(COMPANY_ID, 1, 10)).data?.total).toBe(1);
    expect((await purchasesApi.getReturnById(RETURN_ID, COMPANY_ID)).data?.lines?.[0]?.quantity).toBe(1);
    expect(calls.map((c) => c.method)).toEqual([
      'getOrders', 'getOrdersPaginated', 'getOrderById', 'getReturns', 'getReturnsPaginated', 'getReturnById',
    ]);
  });

  it('getPurchasesKpis maps the single-row aggregate', async () => {
    installRpc({
      getPurchasesKpis: async () => ({
        success: true,
        rows: [{ total_orders: 7, pending_orders: '2', total_invoices_value: '900.50', ap_outstanding: '150.25' }],
      }),
    });
    const res = await purchasesApi.getPurchasesKpis(COMPANY_ID);
    expect(res.success).toBe(true);
    // numeric strings must not leak through as strings into the KPI cards
    expect(res.data).toEqual({ totalOrders: 7, pendingOrders: 2, totalInvoicesValue: 900.5, apOutstanding: 150.25 });
    const adapter = (await getDbAdapter()) as unknown as { query: ReturnType<typeof vi.fn> };
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('getPurchasesKpis returns zeros (not NaN) when the row is empty', async () => {
    installRpc({ getPurchasesKpis: async () => ({ success: true, rows: [] }) });
    const res = await purchasesApi.getPurchasesKpis(COMPANY_ID);
    expect(res.data).toEqual({ totalOrders: 0, pendingOrders: 0, totalInvoicesValue: 0, apOutstanding: 0 });
  });
});

/**
 * Typed-RPC tranche B — supplier writes.
 *
 * The channel performs the INSERT only; document-number generation
 * (`document_sequences`) and the opening-balance journal entry stay in the
 * renderer so the money logic keeps a single implementation. These tests pin
 * that split: the write goes through the channel, and neither the sequence
 * call nor the journal posting is duplicated main-side.
 */
describe('purchasesApi typed RPC (supplier writes)', () => {
  const seqMock = vi.fn(() => Promise.resolve({ success: true, number: 'SUP-0007' }));
  const openingMock = vi.fn(() => Promise.resolve({ success: true }));

  type Rpc = (payload: Record<string, unknown>) => Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;

  function installRpc(impl: Record<string, Rpc>) {
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    (window as unknown as { electronDB: { purchases: Record<string, Rpc> } }).electronDB = {
      purchases: new Proxy({}, {
        get(_t, method: string) {
          return async (payload: Record<string, unknown>) => {
            calls.push({ method, payload });
            const fn = impl[method];
            return fn ? fn(payload) : { success: false, error: `unexpected ${method}` };
          };
        },
      }),
    };
    return calls;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isElectronPg).mockReturnValue(true);
    (window as unknown as { electronDB?: unknown }).electronDB = undefined;
    vi.mocked(getDbAdapter).mockResolvedValue({ query: vi.fn(() => Promise.resolve({ success: true, rows: [] })) } as never);
    vi.doMock('@/core/api', () => ({ getNextDocumentNumber: seqMock }));
    vi.doMock('@/core/utils/openingBalance', () => ({ postSupplierOpening: openingMock }));
  });

  it('createSupplier sends only scalar fields and returns the new id', async () => {
    const calls = installRpc({ createSupplier: async () => ({ success: true, rows: [{ id: SUPPLIER_ID }] }) });
    const res = await purchasesApi.createSupplier({
      companyId: COMPANY_ID, code: 'SUP-0001', name: 'مورد جديد', phone: '700', isActive: true,
    } as never);
    expect(res).toEqual({ success: true, id: SUPPLIER_ID });
    expect(calls[0]?.method).toBe('createSupplier');
    // No lines/objects cross the wire — and no companyId: it comes from session.
    expect(calls[0]?.payload).toEqual({
      code: 'SUP-0001', name: 'مورد جديد', phone: '700', email: null, address: null, taxNumber: null, balance: 0, isActive: true,
    });
    const adapter = (await getDbAdapter()) as unknown as { query: ReturnType<typeof vi.fn> };
    expect(adapter.query, 'the INSERT must not run as renderer SQL').not.toHaveBeenCalled();
  });

  it('createSupplier still asks the renderer for a missing document number', async () => {
    const calls = installRpc({ createSupplier: async () => ({ success: true, rows: [{ id: SUPPLIER_ID }] }) });
    vi.resetModules();
    const { purchasesApi: fresh } = await import('./api');
    const res = await fresh.createSupplier({ companyId: COMPANY_ID, code: '', name: 'بلا رقم' } as never);
    expect(res.success).toBe(true);
    // The generated number travels in the payload — the main process never
    // touches document_sequences.
    expect(calls[0]?.payload.code).toBe('SUP-0007');
  });

  it('createSupplier refuses when the channel rejects it', async () => {
    installRpc({ createSupplier: async () => ({ success: false, error: 'Permission denied' }) });
    const res = await purchasesApi.createSupplier({ companyId: COMPANY_ID, code: 'SUP-9', name: 'س' } as never);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Permission denied');
  });

  it('updateSupplier forwards a partial patch (no companyId in the payload)', async () => {
    const calls = installRpc({ updateSupplier: async () => ({ success: true, rows: [{ id: SUPPLIER_ID }] }) });
    const res = await purchasesApi.updateSupplier(SUPPLIER_ID, COMPANY_ID, { name: 'الاسم الجديد', phone: '' });
    expect(res.success).toBe(true);
    expect(calls[0]?.payload).toEqual({ id: SUPPLIER_ID, name: 'الاسم الجديد', phone: '' });
    expect(calls[0]?.payload).not.toHaveProperty('companyId');
  });

  it('deleteSupplier deactivates through the channel (never a raw DELETE)', async () => {
    const calls = installRpc({ deleteSupplier: async () => ({ success: true, rows: [{ id: SUPPLIER_ID }] }) });
    const res = await purchasesApi.deleteSupplier(SUPPLIER_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(calls[0]).toEqual({ method: 'deleteSupplier', payload: { id: SUPPLIER_ID } });
    const adapter = (await getDbAdapter()) as unknown as { query: ReturnType<typeof vi.fn> };
    expect(adapter.query).not.toHaveBeenCalled();
  });
});

describe('purchasesApi.convertOrderToInvoice (claim before create)', () => {
  // This path calls the real getNextDocumentNumber (renderer-composed) plus
  // two UPDATEs, so both collaborators are injected through doMock holders and
  // the module is imported fresh — spying on the top-level object would miss
  // the fresh module's own bindings.
  const adapterHolder: { current: { query: ReturnType<typeof vi.fn> } } = {
    current: { query: vi.fn() },
  };
  const seqMock = vi.fn(() => Promise.resolve({ success: true, number: 'PINV-0009' }));

  async function freshApi() {
    vi.resetModules();
    const mod = await import('./api');
    return mod.purchasesApi;
  }

  /** An order as getOrderById returns it (mapped, camelCase, lines resolved). */
  function orderWith(status: string) {
    return {
      success: true as const,
      data: {
        id: ORDER_ID,
        companyId: COMPANY_ID,
        orderNumber: 'PO-0001',
        supplierId: SUPPLIER_ID,
        date: '2026-01-01',
        expectedDate: '2026-02-01',
        totalAmount: 1000,
        paidAmount: 0,
        status,
        paymentType: 'credit' as const,
        notes: null,
        lines: [],
      },
    };
  }

  /**
   * Only the two UPDATEs this path issues reach the adapter (getOrderById and
   * createInvoice are stubbed) — so the adapter mock IS the contract.
   */
  function installAdapter(claimRows: Array<{ id: string }>) {
    const sqls: string[] = [];
    adapterHolder.current = {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        if (/UPDATE purchase_orders SET status = 'invoiced'/i.test(sql)) return { success: true, rows: claimRows };
        return { success: true, rows: [] };
      }),
    };
    return sqls;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronDB?: unknown }).electronDB = undefined;
    vi.doMock('@/core/database/adapters', () => ({
      getDbAdapter: vi.fn(async () => adapterHolder.current),
      isElectronPg: vi.fn(() => false),
    }));
    vi.doMock('@/core/api', () => ({ getNextDocumentNumber: seqMock }));
    vi.doMock('@/core/utils/openingBalance', () => ({ postSupplierOpening: vi.fn(() => Promise.resolve({ success: true })) }));
  });

  it('refuses a cancelled order and never burns a document number', async () => {
    const sqls = installAdapter([{ id: ORDER_ID }]);
    const api = await freshApi();
    vi.spyOn(api, 'getOrderById').mockResolvedValue(orderWith('cancelled') as never);
    const create = vi.spyOn(api, 'createInvoice');

    const res = await api.convertOrderToInvoice(ORDER_ID, COMPANY_ID, 'user-1');

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cancelled/);
    expect(seqMock, 'no number is consumed for a rejected conversion').not.toHaveBeenCalled();
    expect(create, 'no invoice is created').not.toHaveBeenCalled();
    expect(sqls, 'no claim is attempted').toHaveLength(0);
  });

  it('refuses an already-invoiced order (no second invoice from one order)', async () => {
    installAdapter([{ id: ORDER_ID }]);
    const api = await freshApi();
    vi.spyOn(api, 'getOrderById').mockResolvedValue(orderWith('invoiced') as never);
    const create = vi.spyOn(api, 'createInvoice');

    const res = await api.convertOrderToInvoice(ORDER_ID, COMPANY_ID, 'user-1');

    expect(res.success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('claims the order BEFORE creating the invoice, then returns the create result', async () => {
    const sqls = installAdapter([{ id: ORDER_ID }]);
    const api = await freshApi();
    vi.spyOn(api, 'getOrderById').mockResolvedValue(orderWith('sent') as never);
    const create = vi.spyOn(api, 'createInvoice').mockResolvedValue({ success: true, id: 'inv-9' } as never);

    const res = await api.convertOrderToInvoice(ORDER_ID, COMPANY_ID, 'user-1');

    expect(res).toEqual({ success: true, id: 'inv-9' });
    // The claim is the mutual exclusion: a conditional UPDATE that reports
    // rows, scoped to the company, and no number is burned before it.
    const claimIdx = sqls.findIndex((s) => /RETURNING id/i.test(s));
    expect(claimIdx, 'a conditional claim with RETURNING exists').toBeGreaterThanOrEqual(0);
    expect(sqls[claimIdx]).toMatch(/status = ANY\(\$4::text\[\]\)/);
    expect(sqls[claimIdx]).toMatch(/company_id = \$2::uuid/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it('aborts without creating an invoice when the claim loses the race', async () => {
    const sqls = installAdapter([]); // zero rows = another session claimed it first
    const api = await freshApi();
    vi.spyOn(api, 'getOrderById').mockResolvedValue(orderWith('sent') as never);
    const create = vi.spyOn(api, 'createInvoice');

    const res = await api.convertOrderToInvoice(ORDER_ID, COMPANY_ID, 'user-1');

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/حجز/);
    expect(create, 'a lost claim must not produce an invoice').not.toHaveBeenCalled();
    expect(sqls.some((s) => /NOT EXISTS/i.test(s)), 'no compensating release is needed').toBe(false);
  });

  it('releases the claim to the ORIGINAL status when the invoice fails, never behind a real invoice', async () => {
    const sqls = installAdapter([{ id: ORDER_ID }]);
    const api = await freshApi();
    vi.spyOn(api, 'getOrderById').mockResolvedValue(orderWith('partially_received') as never);
    vi.spyOn(api, 'createInvoice').mockResolvedValue({ success: false, error: 'لا يوجد حساب' } as never);

    const res = await api.convertOrderToInvoice(ORDER_ID, COMPANY_ID, 'user-1');

    expect(res.success).toBe(false);
    const release = sqls.find((s) => /NOT EXISTS/i.test(s));
    expect(release, 'the claim is released').toBeTruthy();
    // Restoring a hardcoded 'confirmed' would silently rewrite a
    // partially_received order into a state it never had.
    expect(release).toMatch(/SET status = \$3/);
    expect(release).toMatch(/NOT EXISTS \(SELECT 1 FROM purchase_invoices WHERE purchase_order_id/);
  });
});
