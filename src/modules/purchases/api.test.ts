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
import { getDbAdapter } from '@/core/database/adapters';
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
    const captured: { sql: string }[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      captured.push({ sql });
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