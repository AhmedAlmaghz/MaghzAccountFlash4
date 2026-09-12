import { describe, it, expect, beforeAll } from 'vitest';
import type { DbAdapter } from '@/core/database/adapters/types';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';
import { posApi } from './api';

/**
 * Real-database POS checkout integration (PGlite): migration 0027 tables +
 * the atomic batch executed end-to-end — invoice, payments, JE, stock
 * decrement and the paid status flip all commit together.
 */

const query = pgliteAdapter.query as DbAdapter['query'];

const COMPANY_NAME = `POS-IT-${Date.now()}`;

interface Ctx {
  companyId: string;
  userId: string;
  cashBoxId: string;
  productId: string;
  customerId: string;
  shiftId: string;
  stockBefore: number;
}

async function seedContext(): Promise<Ctx> {
  // Company
  const companyRes = await query(
    `INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`,
    [COMPANY_NAME]
  );
  const companyId = String(companyRes.rows![0].id);

  // User + role
  const roleRes = await query(
    `INSERT INTO roles (company_id, name, permissions, is_system) VALUES ($1, 'cashier', '["pos.view","pos.own","pos.create","pos.post"]', true) RETURNING id`,
    [companyId]
  );
  const userRes = await query(
    `INSERT INTO users (company_id, username, role, is_active, password_hash) VALUES ($1, 'pos_cashier', 'cashier', true, 'x:y:z:w') RETURNING id`,
    [companyId]
  );
  const userId = String(userRes.rows![0].id);
  void roleRes;

  // Chart-of-accounts defaults the posting needs
  for (const [code, name] of [['11201', 'العملاء - المدينون'], ['41101', 'إيرادات المبيعات'], ['21301', 'ضريبة القيمة المضافة المستحقة'], ['11101', 'الصندوق']]) {
    await query(`INSERT INTO accounts (company_id, code, name_ar, type, nature, is_active) VALUES ($1, $2, $3, 'asset', 'debit', true)`, [companyId, code, name]);
  }
  const accRes = await query(`SELECT code, id FROM accounts WHERE company_id = $1`, [companyId]);
  const accByCode = new Map((accRes.rows || []).map((r) => [String(r.code), String(r.id)]));
  await query(
    `INSERT INTO default_accounts (company_id, function_key, account_id) VALUES
     ($1, 'default_debtors', $2), ($1, 'default_sales', $3), ($1, 'default_vat_output', $4)`,
    [companyId, accByCode.get('11201'), accByCode.get('41101'), accByCode.get('21301')]
  );

  // Warehouse + product + stock
  const whRes = await query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'الرئيسي') RETURNING id`, [companyId]);
  const prodRes = await query(
    `INSERT INTO products (company_id, code, name_ar, unit, cost_price, sale_price, barcode, is_active) VALUES ($1, 'P-TEA', 'شاي اختبار', 'علبة', 50, 100, '629000000001', true) RETURNING id`,
    [companyId]
  );
  const productId = String(prodRes.rows![0].id);
  await query(
    `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) VALUES ($1, $2, $3, 10)`,
    [companyId, productId, whRes.rows![0].id]
  );

  // Customer + cash box (linked to a GL account)
  const custRes = await query(`INSERT INTO customers (company_id, code, name, is_active) VALUES ($1, 'C-1', 'عميل اختبار', true) RETURNING id`, [companyId]);
  const boxRes = await query(
    `INSERT INTO cash_boxes (company_id, name, code, account_id, is_active, current_balance) VALUES ($1, 'صندوق الكاشير', 'CB-POS', $2, true, 0) RETURNING id`,
    [companyId, accByCode.get('11101')]
  );

  // Document sequence for pos_receipt
  await query(
    `INSERT INTO document_sequences (company_id, document_type, prefix, starting_number, current_number, increment_step, padding_length, is_active)
     VALUES ($1, 'pos_receipt', 'POS-', 1, 0, 1, 6, true)`,
    [companyId]
  );

  return {
    companyId, userId,
    cashBoxId: String(boxRes.rows![0].id),
    productId,
    customerId: String(custRes.rows![0].id),
    shiftId: '',
    stockBefore: 10,
  };
}

describe('posApi.checkout on PGlite (real database)', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    const mig = await runPgliteMigrations();
    expect(mig.success).toBe(true);
    ctx = await seedContext();
  }, 240000);

  it('migration 0027 created pos_shifts/pos_payments + is_pos/shift_id columns', async () => {
    const shifts = await query(`SELECT 1 FROM pos_shifts LIMIT 1`, []);
    const payments = await query(`SELECT 1 FROM pos_payments LIMIT 1`, []);
    expect(shifts.success).toBe(true);
    expect(payments.success).toBe(true);
    const cols = await query(
      `SELECT is_pos, shift_id FROM sales_invoices LIMIT 0`, []
    );
    expect(cols.success).toBe(true);
  });

  it('openShift opens and a second open fails (partial unique index)', async () => {
    const first = await posApi.openShift(ctx.companyId, ctx.cashBoxId, 5000, ctx.userId);
    expect(first.success).toBe(true);
    ctx.shiftId = first.id!;
    const second = await posApi.openShift(ctx.companyId, ctx.cashBoxId, 0, ctx.userId);
    expect(second.success).toBe(false);
  });

  it('cash checkout commits invoice + payments + JE + stock + paid status atomically', async () => {
    const res = await posApi.checkout({
      companyId: ctx.companyId,
      shiftId: ctx.shiftId,
      customerId: ctx.customerId,
      cashBoxId: ctx.cashBoxId,
      lines: [{ productId: ctx.productId, quantity: 2, unitPrice: 100, discountPercent: 0, vatPercent: 0, lineTotal: 200 }],
      subtotal: 200,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 200,
      cashAmount: 200,
      creditAmount: 0,
    }, ctx.userId);
    expect(res.success, res.error || 'no error').toBe(true);
    expect(res.receiptNumber).toMatch(/^POS-/);
    expect(res.invoiceId).toBeDefined();

    // Invoice: paid + is_pos + shift link
    const inv = await query(
      `SELECT status, is_pos, shift_id, paid_amount, payment_type FROM sales_invoices WHERE id = $1`,
      [res.invoiceId]
    );
    const row = inv.rows![0] as Record<string, unknown>;
    expect(String(row.status)).toBe('paid');
    expect(String(row.is_pos)).toBe('true');
    expect(String(row.shift_id)).toBe(ctx.shiftId);
    expect(Number(row.paid_amount)).toBe(200);
    expect(String(row.payment_type)).toBe('cash');

    // POS payment row (cash leg)
    const pay = await query(`SELECT method, amount FROM pos_payments WHERE invoice_id = $1`, [res.invoiceId]);
    expect(pay.rows).toHaveLength(1);
    expect(String(pay.rows![0].method)).toBe('cash');
    expect(Number(pay.rows![0].amount)).toBe(200);

    // Journal entry exists and balances
    const je = await query(
      `SELECT je.debit, je.credit FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id WHERE t.reference = $1`,
      [res.receiptNumber]
    );
    expect((je.rows || []).length).toBeGreaterThanOrEqual(2);
    const debit = (je.rows || []).reduce((s, r) => s + Number(r.debit || 0), 0);
    const credit = (je.rows || []).reduce((s, r) => s + Number(r.credit || 0), 0);
    expect(debit).toBeCloseTo(200, 2);
    expect(credit).toBeCloseTo(200, 2);

    // Stock decremented by 2 (base quantity)
    const stock = await query(`SELECT quantity FROM stock WHERE product_id = $1`, [ctx.productId]);
    expect(Number(stock.rows![0].quantity)).toBe(8);

    // Stock movement recorded
    const mv = await query(`SELECT type, quantity FROM stock_movements WHERE reference = $1`, [res.receiptNumber]);
    expect((mv.rows || []).length).toBeGreaterThan(0);
    expect(String(mv.rows![0].type)).toBe('out');
  });

  it('mixed checkout splits the JE between the box account and Debtors, grows the customer balance', async () => {
    const custBefore = await query(`SELECT balance FROM customers WHERE id = $1`, [ctx.customerId]);
    const balanceBefore = Number(custBefore.rows![0].balance);

    const res = await posApi.checkout({
      companyId: ctx.companyId,
      shiftId: ctx.shiftId,
      customerId: ctx.customerId,
      cashBoxId: ctx.cashBoxId,
      lines: [{ productId: ctx.productId, quantity: 3, unitPrice: 100, discountPercent: 0, vatPercent: 0, lineTotal: 300 }],
      subtotal: 300,
      discountAmount: 0,
      vatAmount: 0,
      totalAmount: 300,
      cashAmount: 100,
      creditAmount: 200,
    }, ctx.userId);
    expect(res.success, res.error || 'no error').toBe(true);

    const inv = await query(`SELECT status, paid_amount, payment_type FROM sales_invoices WHERE id = $1`, [res.invoiceId]);
    const row = inv.rows![0] as Record<string, unknown>;
    expect(String(row.status)).toBe('posted');
    expect(Number(row.paid_amount)).toBe(100);
    expect(String(row.payment_type)).toBe('credit');

    // Customer balance grew by the credit part
    const custAfter = await query(`SELECT balance FROM customers WHERE id = $1`, [ctx.customerId]);
    expect(Number(custAfter.rows![0].balance)).toBeCloseTo(balanceBefore + 200, 2);

    // JE: two debit legs (box 100 + debtors 200)
    const je = await query(
      `SELECT je.debit, je.credit, a.code FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id JOIN accounts a ON a.id = je.account_id WHERE t.reference = $1 ORDER BY je.debit DESC`,
      [res.receiptNumber]
    );
    const debits = (je.rows || []).filter((r) => Number(r.debit) > 0);
    expect(debits).toHaveLength(2);
    expect(Number(debits[0].debit) + Number(debits[1].debit)).toBeCloseTo(300, 2);

    // Both payment legs recorded
    const pay = await query(`SELECT method, amount FROM pos_payments WHERE invoice_id = $1 ORDER BY method`, [res.invoiceId]);
    expect(pay.rows).toHaveLength(2);
  });

  it('getShiftSummary derives expected cash and closeShift stores the difference', async () => {
    const summary = await posApi.getShiftSummary(ctx.companyId, ctx.shiftId);
    expect(summary.success).toBe(true);
    // opening 5000 + cash (200 + 100) = 5300
    expect(summary.data!.expectedAmount).toBeCloseTo(5300, 2);
    expect(summary.data!.cashTotal).toBeCloseTo(300, 2);
    expect(summary.data!.invoicesCount).toBe(2);

    const close = await posApi.closeShift(ctx.companyId, ctx.shiftId, 5200, undefined, ctx.userId);
    expect(close.success).toBe(true);
    expect(close.data!.difference).toBeCloseTo(-100, 2);

    const shiftRow = await query(`SELECT status, closing_amount, expected_amount, difference FROM pos_shifts WHERE id = $1`, [ctx.shiftId]);
    const row = shiftRow.rows![0] as Record<string, unknown>;
    expect(String(row.status)).toBe('closed');
    expect(Number(row.difference)).toBeCloseTo(-100, 2);
  });

  it('getReceipt returns the full receipt for reprint', async () => {
    const invRes = await query(
      `SELECT id FROM sales_invoices WHERE company_id = $1 AND is_pos = true ORDER BY created_at DESC LIMIT 1`,
      [ctx.companyId]
    );
    const receipt = await posApi.getReceipt(ctx.companyId, String(invRes.rows![0].id));
    expect(receipt.success).toBe(true);
    expect(receipt.data!.invoiceNumber).toMatch(/^POS-/);
    expect(receipt.data!.lines).toHaveLength(1);
    expect(receipt.data!.payments.length).toBe(2);
    expect(receipt.data!.cashAmount).toBeCloseTo(100, 2);
    expect(receipt.data!.creditAmount).toBeCloseTo(200, 2);
  });
});
