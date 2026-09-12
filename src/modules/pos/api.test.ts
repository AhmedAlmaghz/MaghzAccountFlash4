import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/validation', () => {
  const makeSchema = () => {
    const schema = (() => ({})) as unknown as Record<string, unknown>;
    return schema;
  };
  const schema = makeSchema();
  return {
    validateInput: vi.fn(() => ({ success: true })),
    companyIdSchema: schema,
    uuidSchema: schema,
    idCompanySchema: schema,
    openPosShiftSchema: schema,
    closePosShiftSchema: schema,
    posCheckoutSchema: schema,
  };
});

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'POS-000042' })),
}));

// NOTE: journalEntryGenerator + tx helpers are NOT mocked — the posting
// builders are pure SQL composers exercised through the mocked adapter, so
// these tests verify the full atomic checkout batch end-to-end.

import { posApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';
import { clearUserIdCache } from '@/core/utils/userIdValidator';
import { runTransaction } from '@/core/database/tx';
import type { PosCheckoutInput } from './types';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return {
    query: vi.fn(queryImpl),
    transaction: vi.fn(async (queries: { sql: string; params?: unknown[] }[]) => {
      for (const q of queries) {
        const r = await queryImpl(q.sql, (q.params || []) as unknown[]);
        if (!r.success) return { success: false, error: r.error };
      }
      return { success: true, results: [] };
    }),
  };
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000010';
const SHIFT_ID = '00000000-0000-0000-0000-000000000030';
const CASH_BOX_ID = '00000000-0000-0000-0000-000000000040';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000050';
const DEBTORS_ID = '00000000-0000-0000-0000-000000000060';
const SALES_ID = '00000000-0000-0000-0000-000000000061';
const VAT_ID = '00000000-0000-0000-0000-000000000062';
const CASH_ACCOUNT_ID = '00000000-0000-0000-0000-000000000063';

/** Adapter that answers the posting-account + cash-box lookups checkout makes. */
function makeCheckoutAdapter() {
  const executed: { sql: string; params: unknown[] }[] = [];
  const adapter = makeMockAdapter(async (sql, params) => {
    executed.push({ sql, params });
    if (/FROM default_accounts/.test(sql)) {
      // resolvePostingAccounts — one id per function key in request order
      const key = String(params[1] || '');
      const map: Record<string, string> = {
        default_debtors: DEBTORS_ID,
        default_sales: SALES_ID,
        default_vat_output: VAT_ID,
      };
      return { success: true, rows: [{ account_id: map[key] || SALES_ID }] };
    }
    if (/FROM cash_boxes/.test(sql)) {
      return { success: true, rows: [{ account_id: CASH_ACCOUNT_ID }] };
    }
    if (/FROM pos_shifts WHERE id = /.test(sql)) {
      return { success: true, rows: [{ id: SHIFT_ID, cash_box_id: CASH_BOX_ID, status: 'open', user_id: USER_ID }] };
    }
    if (/FROM users WHERE id = /.test(sql) || /SELECT 1 FROM users/.test(sql)) {
      return { success: true, rows: [{ id: USER_ID }] };
    }
    return { success: true, rows: [] };
  });
  return { adapter, executed };
}

function makeCheckoutInput(overrides: Partial<PosCheckoutInput> = {}): PosCheckoutInput {
  return {
    companyId: COMPANY_ID,
    shiftId: SHIFT_ID,
    customerId: CUSTOMER_ID,
    cashBoxId: CASH_BOX_ID,
    lines: [{
      productId: PRODUCT_ID,
      quantity: 2,
      unitPrice: 100,
      discountPercent: 0,
      vatPercent: 15,
      lineTotal: 200,
      unitId: null,
      unitFactor: null,
      baseQuantity: null,
    }],
    subtotal: 200,
    discountAmount: 0,
    vatAmount: 0,
    totalAmount: 200,
    cashAmount: 200,
    creditAmount: 0,
    ...overrides,
  };
}

describe('posApi.checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdCache();
  });

  it('commits invoice + payments + JE + stock + status flip in ONE transaction', async () => {
    const { adapter } = makeCheckoutAdapter();
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.checkout(makeCheckoutInput(), USER_ID);
    expect(res.success).toBe(true);
    expect(res.receiptNumber).toBe('POS-000042');
    expect(adapter.transaction).toHaveBeenCalledTimes(1);

    const batch = adapter.transaction.mock.calls[0][0] as { sql: string; params?: unknown[] }[];
    const sqls = batch.map((q) => q.sql);

    // Statement 0 — TOCTOU guard (locks the shift row)
    expect(sqls[0]).toMatch(/WITH guard AS.*pos_shifts.*FOR UPDATE/);
    expect(sqls[0]).toMatch(/1 \/ \(SELECT COUNT\(\*\) FROM guard\)/);
    // Statement A — invoice header with POS marker + shift link
    expect(sqls[1]).toMatch(/INSERT INTO sales_invoices/);
    expect(sqls[1]).toMatch(/is_pos, shift_id/);
    expect(sqls[1]).toMatch(/true, \$20::uuid/); // is_pos = true + shift_id param
    // Lines CTE
    expect(sqls[1]).toMatch(/lines_ins AS \(INSERT INTO sales_invoice_lines/);
    expect(sqls[1]).toMatch(/unit_id, unit_factor, base_quantity/);
    // Company scoping on the header insert
    expect(batch[1].params?.[1]).toBe(COMPANY_ID);

    // Statement B — POS payments (cash row for a full-cash sale)
    expect(sqls[2]).toMatch(/INSERT INTO pos_payments/);
    expect(sqls[2]).toMatch(/'cash'/);
    expect(sqls[2]).not.toMatch(/'credit'/);
    expect(batch[2].params?.[0]).toBe(COMPANY_ID);
    expect(typeof batch[2].params?.[2]).toBe('string'); // invoiceId

    // Statement C — journal entry: Dr cash-box account / Cr sales / Cr VAT
    expect(sqls[3]).toMatch(/INSERT INTO transactions/);
    expect(sqls[3]).toMatch(/INSERT INTO journal_entries/);
    expect(batch[3].params).toContain(CASH_ACCOUNT_ID);
    expect(batch[3].params).toContain(SALES_ID);
    expect(batch[3].params).toContain(VAT_ID);
    expect(batch[3].params).not.toContain(DEBTORS_ID);
    // Arabic memo carries the POS receipt number + cash wording
    expect(batch[3].params).toContain('نقدية نقطة بيع POS-000042');
    expect(batch[3].params).toContain('قيد تلقائي - إيصال نقطة بيع POS-000042');

    // Statements D/E/F — stock ensure + movements + decrement (same SQL as salesApi)
    expect(sqls[4]).toMatch(/INSERT INTO stock \(/);
    expect(sqls[5]).toMatch(/INSERT INTO stock_movements/);
    expect(sqls[5]).toMatch(/'out'/);
    expect(sqls[6]).toMatch(/UPDATE stock s SET quantity = s.quantity - sub\.qty/);

    // Statement G — full cash → status 'paid'
    expect(sqls[7]).toMatch(/SET status = 'paid'/);
  });

  it('mixed sale: Dr cash part + Dr debtors part, status posted, customer balance grows', async () => {
    const { adapter } = makeCheckoutAdapter();
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.checkout(makeCheckoutInput({
      totalAmount: 300,
      cashAmount: 100,
      creditAmount: 200,
    }), USER_ID);
    expect(res.success).toBe(true);

    const batch = adapter.transaction.mock.calls[0][0] as { sql: string; params?: unknown[] }[];
    const sqls = batch.map((q) => q.sql);

    // Both payment rows are inserted (now at index 2 due to guard)
    expect(sqls[2]).toMatch(/'cash'/);
    expect(sqls[2]).toMatch(/'credit'/);

    // JE carries BOTH debit legs: box account + debtors
    expect(batch[3].params).toContain(CASH_ACCOUNT_ID);
    expect(batch[3].params).toContain(DEBTORS_ID);

    // Status stays 'posted' (outstanding credit) + balance update runs
    expect(sqls[7]).toMatch(/SET status = 'posted'/);
    expect(sqls[8]).toMatch(/UPDATE customers SET balance = balance \+/);

    // payment_type column = 'credit' for a mixed sale (existing lists)
    expect(batch[1].params?.[14]).toBe('credit');
  });

  it('refuses checkout when no shift is open', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (/FROM pos_shifts WHERE id = /.test(sql)) return { success: true, rows: [] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.checkout(makeCheckoutInput(), USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/open shift/i);
    expect(adapter.transaction).not.toHaveBeenCalled();
  });

  it('propagates a failed transaction (nothing partial)', async () => {
    const { adapter } = makeCheckoutAdapter();
    adapter.transaction = vi.fn(async () => ({ success: false, error: 'deadlock detected' }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.checkout(makeCheckoutInput(), USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/deadlock/);
  });
});

describe('posApi.openShift / closeShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdCache();
  });

  it('openShift refuses when the cashier already holds an open shift', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (/FROM users/.test(sql)) {
        return { success: true, rows: [{ id: USER_ID }] };
      }
      if (/SELECT id FROM pos_shifts WHERE company_id/.test(sql)) {
        return { success: true, rows: [{ id: SHIFT_ID }] };
      }
      // Fallback for the atomic INSERT ... SELECT WHERE NOT EXISTS guard
      if (/INSERT INTO pos_shifts/.test(sql)) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.openShift(COMPANY_ID, CASH_BOX_ID, 5000, USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already have an open shift/i);
  });

  it('openShift inserts with status open and audit columns', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (/INSERT INTO pos_shifts/.test(sql)) {
        return { success: true, rows: [{ id: SHIFT_ID }] };
      }
      if (/SELECT 1 FROM users|FROM users WHERE id = /.test(sql)) {
        return { success: true, rows: [{ id: USER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.openShift(COMPANY_ID, CASH_BOX_ID, 5000, USER_ID);
    expect(res.success).toBe(true);
    expect(res.id).toBe(SHIFT_ID);
    const insertCall = adapter.query.mock.calls.find(([sql]) => /INSERT INTO pos_shifts/.test(sql as string));
    expect(insertCall).toBeDefined();
    expect(insertCall![0]).toMatch(/'open'/);
    expect(insertCall![0]).toMatch(/opened_at/);
    expect(insertCall![1]).toEqual([COMPANY_ID, CASH_BOX_ID, USER_ID, 5000]);
  });

  it('closeShift stores expected (opening + cash) and difference, then flips to closed', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (/SELECT 1 FROM users|FROM users WHERE id = /.test(sql)) {
        return { success: true, rows: [{ id: USER_ID }] };
      }
      if (/COALESCE\(inv\.invoices_count/.test(sql)) {
        // getShiftSummary aggregate row
        return {
          success: true,
          rows: [{
            opening_amount: 5000, invoices_count: 3, gross_total: 14500,
            discount_amount: 200, vat_amount: 0, net_total: 14300,
            cash_total: 12300, credit_total: 2000,
          }],
        };
      }
      if (/UPDATE pos_shifts/.test(sql)) {
        return { success: true, rows: [{ id: SHIFT_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.closeShift(COMPANY_ID, SHIFT_ID, 17000, 'counted', USER_ID);
    expect(res.success).toBe(true);
    // expected = 5000 opening + 12300 cash payments = 17300; counted 17000 → -300
    expect(res.data?.expectedAmount).toBe(17300);
    expect(res.data?.difference).toBe(-300);
    const updateCall = adapter.query.mock.calls.find(([sql]) => /UPDATE pos_shifts/.test(sql as string));
    expect(updateCall![0]).toMatch(/status = 'closed'/);
    expect(updateCall![1]).toEqual([SHIFT_ID, COMPANY_ID, 17000, 17300, -300, 'counted', USER_ID]);
  });

  it('closeShift rejects an unknown/already-closed shift', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (/COALESCE\(inv\.invoices_count/.test(sql)) {
        return { success: true, rows: [{ opening_amount: 5000, invoices_count: 0, gross_total: 0, discount_amount: 0, vat_amount: 0, net_total: 0, cash_total: 0, credit_total: 0 }] };
      }
      return { success: true, rows: [] }; // UPDATE matches nothing
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.closeShift(COMPANY_ID, SHIFT_ID, 5000, undefined, USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already closed|not found/i);
  });
});

describe('posApi.getProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins live stock totals and scopes to the company', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        id: PRODUCT_ID, code: 'P-1', name_ar: 'شاي', name_en: 'Tea', barcode: '123',
        sku: 'SKU1', unit: 'علبة', sale_price: '150.0000', product_type_id: null,
        product_type_name: null, stock_qty: '42', category_ids: null,
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.getProducts(COMPANY_ID, 'شاي');
    expect(res.success).toBe(true);
    expect(res.data?.[0].salePrice).toBe(150);
    expect(res.data?.[0].stockQty).toBe(42);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(s\.total_qty, 0\) AS stock_qty/);
    expect(sql).toMatch(/p\.barcode ILIKE \$2/);
    expect(params).toEqual([COMPANY_ID, '%شاي%']);
  });

  it('findProductByCode prefers an exact barcode match', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { id: PRODUCT_ID, code: 'P-1', name_ar: 'شاي', barcode: '62901234', sku: 'SKU1', unit: 'علبة', sale_price: '150', stock_qty: '10', category_ids: null },
        { id: '00000000-0000-0000-0000-000000000051', code: '62901234', name_ar: 'قهوة', barcode: '9999', sku: 'X', unit: 'كيس', sale_price: '250', stock_qty: '5', category_ids: null },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.findProductByCode(COMPANY_ID, '62901234');
    expect(res.success).toBe(true);
    expect(res.data?.id).toBe(PRODUCT_ID);
  });
});

describe('posApi.shift summary math (Z-report)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates invoice + payment totals and derives expected cash', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        opening_amount: '10000', invoices_count: '5', gross_total: '24500',
        discount_amount: '500', vat_amount: '0', net_total: '24000',
        cash_total: '20000', credit_total: '4000',
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await posApi.getShiftSummary(COMPANY_ID, SHIFT_ID);
    expect(res.success).toBe(true);
    expect(res.data?.invoicesCount).toBe(5);
    expect(res.data?.netTotal).toBe(24000);
    expect(res.data?.creditTotal).toBe(4000);
    expect(res.data?.expectedAmount).toBe(30000); // opening 10000 + cash 20000
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/si\.is_pos = true/);
    expect(sql).toMatch(/status <> 'cancelled'/);
    expect(params).toEqual([COMPANY_ID, SHIFT_ID]);
  });
});

describe('runTransaction contract (posApi dependency)', () => {
  it('returns the adapter error envelope on failure', async () => {
    const adapter = makeMockAdapter(async () => ({ success: false, error: 'rollback' }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await runTransaction([{ sql: 'SELECT 1', params: [] }]);
    expect(res.success).toBe(false);
  });
});
