import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    getInvoiceById: vi.fn(),
    createReturn: vi.fn(),
    postReturn: vi.fn(),
  },
}));

vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: {
    getInvoiceById: vi.fn(),
    createReturn: vi.fn(),
    postReturn: vi.fn(),
  },
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { getNextDocumentNumber } from '@/core/api';
import {
  reverseTransaction,
  reverseSalesInvoice,
  reversePurchaseInvoice,
  reverseVoucher,
} from './reversal';

// Real zod validation runs here — valid v4 UUIDs required.
const COMPANY_ID = '11111111-2222-4333-8444-555555555555';
const TX_ID = '22222222-3333-4444-9555-666666666666';
const INV_ID = '33333333-4444-4555-8666-777777777777';
const VOUCHER_ID = '44444444-5555-4666-9777-888888888888';
const USER_ID = '55555555-6666-4777-9888-999999999999';

type Row = Record<string, unknown>;
type Impl = (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: Row[]; error?: string }>;

function mockDb(impl: Impl) {
  const tx: Array<{ sql: string; params?: unknown[] }> = [];
  const adapter = {
    query: vi.fn(impl),
    transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
      for (const q of queries) {
        const r = await impl(q.sql, q.params || []);
        if (!r.success) return { success: false, error: r.error };
        tx.push(q);
      }
      return { success: true, results: tx.map(() => ({ rows: [], rowCount: 0 })) };
    }),
  };
  vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
  return { adapter, tx };
}

describe('reverseTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors every leg (Dr↔Cr) under a REV reference', async () => {
    const { tx } = mockDb(async (sql) => {
      if (sql.includes('FROM transactions') && sql.includes('reference =')) {
        return { success: true, rows: [] };
      }
      if (sql.includes('FROM transactions')) {
        return { success: true, rows: [{ id: TX_ID, reference: 'JE-1', description: 'd', total_amount: 1000, status: 'posted' }] };
      }
      if (sql.includes('FROM journal_entries')) {
        return {
          success: true,
          rows: [
            { account_id: 'a-cash', debit: 1000, credit: 0, memo: 'm1' },
            { account_id: 'a-sales', debit: 0, credit: 1000, memo: 'm2' },
          ],
        };
      }
      return { success: true, rows: [] };
    });

    const res = await reverseTransaction(COMPANY_ID, TX_ID, { reason: 'wrong date entered' }, USER_ID);
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.data.reference).toBe('REV-JE-1');
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    expect(je).toBeDefined();
    const flat = je.params || [];
    const n = (flat.length - 6) / 4;
    const legs = Array.from({ length: n }, (_, i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    // Swapped vs the original.
    expect(legs.find((l) => l.acc === 'a-cash')).toMatchObject({ debit: 0, credit: 1000 });
    expect(legs.find((l) => l.acc === 'a-sales')).toMatchObject({ debit: 1000, credit: 0 });
    const dr = legs.reduce((s, l) => s + l.debit, 0);
    expect(dr).toBe(legs.reduce((s, l) => s + l.credit, 0));
  });

  it('refuses drafts and second reversals', async () => {
    mockDb(async (sql) => {
      if (sql.includes('FROM transactions') && sql.includes('reference =')) {
        return { success: true, rows: [{ id: 't-rev' }] };
      }
      if (sql.includes('FROM transactions')) {
        return { success: true, rows: [{ id: TX_ID, reference: 'JE-1', description: 'd', total_amount: 100, status: 'posted' }] };
      }
      return { success: true, rows: [] };
    });
    const dup = await reverseTransaction(COMPANY_ID, TX_ID, { reason: 'duplicate attempt here' }, USER_ID);
    expect(dup.success).toBe(false);
    expect((dup as { error: string }).error).toMatch(/already reversed/);

    mockDb(async (sql) => {
      if (sql.includes('FROM transactions')) {
        return { success: true, rows: [{ id: TX_ID, reference: 'JE-9', description: 'd', total_amount: 100, status: 'draft' }] };
      }
      return { success: true, rows: [] };
    });
    const draft = await reverseTransaction(COMPANY_ID, TX_ID, { reason: 'draft reversal attempt' }, USER_ID);
    expect(draft.success).toBe(false);
    expect((draft as { error: string }).error).toMatch(/Only posted/);
  });

  it('rejects short reasons', async () => {
    mockDb(async () => ({ success: true, rows: [] }));
    const res = await reverseTransaction(COMPANY_ID, TX_ID, { reason: 'x' }, USER_ID);
    expect(res.success).toBe(false);
  });
});

describe('reverseSalesInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const postedInvoice = {
    id: INV_ID,
    companyId: COMPANY_ID,
    invoiceNumber: 'INV-77',
    customerId: 'cust-1',
    date: '2026-03-01',
    subtotal: 1000,
    vatAmount: 150,
    totalAmount: 1150,
    paidAmount: 0,
    status: 'posted',
    paymentType: 'credit',
    lines: [{
      productId: 'p1', quantity: 10, unitPrice: 100, discountPercent: 0,
      vatPercent: 15, lineTotal: 1150, unitFactor: 1, baseQuantity: 10,
    }],
  };

  function mockFlow(linkedQty: number) {
    vi.mocked(salesApi.getInvoiceById).mockResolvedValue({ success: true, data: postedInvoice } as never);
    vi.mocked(getNextDocumentNumber).mockResolvedValue({ success: true, number: 'SRT-99' } as never);
    vi.mocked(salesApi.createReturn).mockResolvedValue({ success: true, id: 'ret-1' } as never);
    vi.mocked(salesApi.postReturn).mockResolvedValue({ success: true } as never);
    mockDb(async (sql) => {
      if (sql.includes('FROM sales_return_lines')) {
        return { success: true, rows: linkedQty > 0 ? [{ product_id: 'p1', qty: linkedQty }] : [] };
      }
      return { success: true, rows: [] };
    });
  }

  it('reverses the full remainder through a real return (create + post)', async () => {
    mockFlow(0);
    const res = await reverseSalesInvoice(COMPANY_ID, INV_ID, { reason: 'customer cancelled the order' }, USER_ID);
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.data.reference).toBe('SRT-99');
    const payload = vi.mocked(salesApi.createReturn).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.invoiceId).toBe(INV_ID);
    expect(payload.status).toBe('draft');
    expect(String(payload.reason)).toMatch(/INV-77/);
    const lines = payload.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(10);
    expect(vi.mocked(salesApi.postReturn)).toHaveBeenCalledWith('ret-1', COMPANY_ID, USER_ID);
  });

  it('reverses only the not-yet-returned remainder', async () => {
    mockFlow(4);
    const res = await reverseSalesInvoice(COMPANY_ID, INV_ID, { reason: 'rest of the order cancelled' }, USER_ID);
    expect(res.success).toBe(true);
    const payload = vi.mocked(salesApi.createReturn).mock.calls[0][0] as Record<string, unknown>;
    expect((payload.lines as Array<Record<string, unknown>>)[0].quantity).toBe(6);
  });

  it('refuses when nothing remains (already fully reversed)', async () => {
    mockFlow(10);
    const res = await reverseSalesInvoice(COMPANY_ID, INV_ID, { reason: 'second reversal attempt' }, USER_ID);
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toMatch(/already fully reversed/);
    expect(vi.mocked(salesApi.createReturn)).not.toHaveBeenCalled();
  });

  it('refuses drafts', async () => {
    vi.mocked(salesApi.getInvoiceById).mockResolvedValue({ success: true, data: { ...postedInvoice, status: 'draft' } } as never);
    mockDb(async () => ({ success: true, rows: [] }));
    const res = await reverseSalesInvoice(COMPANY_ID, INV_ID, { reason: 'draft reversal attempt' }, USER_ID);
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toMatch(/Only posted/);
  });
});

describe('reversePurchaseInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors the sales flow on the supplier side', async () => {
    vi.mocked(purchasesApi.getInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: INV_ID, companyId: COMPANY_ID, invoiceNumber: 'PINV-5', supplierId: 'sup-1',
        date: '2026-03-01', subtotal: 500, vatAmount: 75, totalAmount: 575,
        status: 'posted', paymentType: 'credit',
        lines: [{ productId: 'p1', quantity: 5, unitPrice: 100, discountPercent: 0, vatPercent: 15, lineTotal: 575, unitFactor: 1, baseQuantity: 5 }],
      },
    } as never);
    vi.mocked(getNextDocumentNumber).mockResolvedValue({ success: true, number: 'PRT-7' } as never);
    vi.mocked(purchasesApi.createReturn).mockResolvedValue({ success: true, id: 'pret-1' } as never);
    vi.mocked(purchasesApi.postReturn).mockResolvedValue({ success: true } as never);
    mockDb(async (sql) => {
      if (sql.includes('FROM purchase_return_lines')) return { success: true, rows: [] };
      return { success: true, rows: [] };
    });

    const res = await reversePurchaseInvoice(COMPANY_ID, INV_ID, { reason: 'goods never arrived' }, USER_ID);
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.data.reference).toBe('PRT-7');
    const payload = vi.mocked(purchasesApi.createReturn).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.invoiceId).toBe(INV_ID);
    expect(vi.mocked(purchasesApi.postReturn)).toHaveBeenCalledWith('pret-1', COMPANY_ID, USER_ID);
  });
});

describe('reverseVoucher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const VOUCHER_ROW = {
    id: VOUCHER_ID, status: 'posted', voucher_number: 'RV-3', date: '2026-04-01',
    amount: 20000, base_currency_amount: 20000, payment_method: 'cash',
    cash_box_id: 'box-1', customer_id: 'cust-1', supplier_id: null,
    expense_account_id: null, invoice_id: null, amount_applied: 0,
  };

  function voucherDb(o: { voucher?: Row; legs?: Row[]; dup?: boolean; flipped?: boolean } = {}) {
    return mockDb(async (sql) => {
      // Verify-SELECT first: it also contains FROM <vouchers>.
      if (sql.includes('SELECT status FROM')) {
        return { success: true, rows: [{ status: o.flipped === false ? 'posted' : 'reversed' }] };
      }
      if (sql.includes('FROM receipt_vouchers') || sql.includes('FROM payment_vouchers')) {
        return { success: true, rows: [o.voucher || VOUCHER_ROW] };
      }
      if (sql.includes('FROM journal_entries')) {
        return {
          success: true,
          rows: o.legs || [
            { account_id: 'a-box', debit: 20000, credit: 0, memo: 'قبض' },
            { account_id: 'a-debtors', debit: 0, credit: 20000, memo: 'تسديد' },
          ],
        };
      }
      if (sql.includes('FROM transactions') && sql.includes('reference =')) {
        return { success: true, rows: o.dup ? [{ id: 't-old' }] : [] };
      }
      return { success: true, rows: [] };
    });
  }

  it('mirrors the actual legs + counters the balance + flips to reversed', async () => {
    const { tx } = voucherDb();
    const res = await reverseVoucher(COMPANY_ID, VOUCHER_ID, 'receipt', { reason: 'duplicate receipt issued' }, USER_ID);
    expect(res.success, res.success ? '' : (res as { error: string }).error).toBe(true);
    if (!res.success) return;
    expect(res.data.reference).toBe('REV-RV-3');
    const je = tx.find((q) => q.sql.includes('WITH new_tx'))!;
    const flat = je.params || [];
    const legs = [0, 1].map((i) => ({
      acc: String(flat[6 + i * 4]),
      debit: Number(flat[6 + i * 4 + 1]),
      credit: Number(flat[6 + i * 4 + 2]),
    }));
    // Swapped vs the original legs.
    expect(legs.find((l) => l.acc === 'a-box')).toMatchObject({ debit: 0, credit: 20000 });
    expect(legs.find((l) => l.acc === 'a-debtors')).toMatchObject({ debit: 20000, credit: 0 });
    // Party counter-entry undoes the original -amount.
    const counter = tx.find((q) => q.sql.includes('UPDATE customers SET balance'))!;
    expect(counter).toBeDefined();
    expect(counter.params?.[0]).toBe(20000);
    // Terminal flip, conditional on still-posted.
    const flip = tx.find((q) => q.sql.includes("SET status = 'reversed'"))!;
    expect(flip).toBeDefined();
  });

  it('refuses drafts, applied vouchers and second reversals', async () => {
    voucherDb({ voucher: { ...VOUCHER_ROW, status: 'draft' } });
    const draft = await reverseVoucher(COMPANY_ID, VOUCHER_ID, 'receipt', { reason: 'draft reversal attempt' }, USER_ID);
    expect(draft.success).toBe(false);

    voucherDb({ voucher: { ...VOUCHER_ROW, amount_applied: 5000, invoice_id: 'inv-1' } });
    const applied = await reverseVoucher(COMPANY_ID, VOUCHER_ID, 'receipt', { reason: 'applied reversal attempt' }, USER_ID);
    expect(applied.success).toBe(false);
    expect((applied as { error: string }).error).toMatch(/unlink/);

    voucherDb({ dup: true });
    const dup = await reverseVoucher(COMPANY_ID, VOUCHER_ID, 'receipt', { reason: 'second reversal attempt' }, USER_ID);
    expect(dup.success).toBe(false);
    expect((dup as { error: string }).error).toMatch(/already reversed/);
  });
});
