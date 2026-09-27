import { describe, it, expect, beforeAll, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { getDbAdapter } from '@/core/database/adapters';
import { salesApi } from './api';

/**
 * Real-engine proof of the document-rewrite atomicity (PGlite).
 *
 * The unit tests assert the STATEMENT LIST (header UPDATE + line DELETE + line
 * INSERT inside one transaction). Only a real engine can prove the consequence:
 * when the re-insert fails, the invoice must still hold its ORIGINAL lines and
 * its ORIGINAL header — never zero lines under a stale total.
 *
 * Before the fix, a failed re-insert left the document self-contradicting and
 * the caller was told `success: true`.
 */

vi.mock('@/core/database/adapters', async (orig) => {
  const actual = await orig<typeof import('@/core/database/adapters')>();
  return { ...actual, isElectronPg: () => false };
});

const query = (await import('@/core/database/adapters/pgliteAdapter')).pgliteAdapter.query as (  sql: string,
  params?: unknown[],
) => Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;

const COMPANY_NAME = `TX-ATOMIC-${Date.now()}`;

let companyId = '';
let productA = '';
let productB = '';
let customerId = '';
let invoiceId = '';

async function seed(): Promise<void> {
  const co = await query(`INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`, [COMPANY_NAME]);
  companyId = String(co.rows![0].id);

  const usr = await query(
    `INSERT INTO users (company_id, username, role, is_active, password_hash) VALUES ($1, 'tx_owner', 'admin', true, 'x:y:z:w') RETURNING id`,
    [companyId],
  );
  const userId = String(usr.rows![0].id);

  const cu = await query(
    `INSERT INTO customers (company_id, code, name) VALUES ($1, 'TX-C1', 'عميل ذرّية') RETURNING id`,
    [companyId],
  );
  customerId = String(cu.rows![0].id);

  for (const [code, name] of [['TX-P1', 'صنف أ'], ['TX-P2', 'صنف ب']]) {
    const p = await query(
      `INSERT INTO products (company_id, code, name_ar, cost_price, sale_price, is_active) VALUES ($1, $2, $3, 10, 100, true) RETURNING id`,
      [companyId, code, name],
    );
    if (code === 'TX-P1') productA = String(p.rows![0].id);
    else productB = String(p.rows![0].id);
  }

  const inv = await salesApi.createInvoice({
    companyId,
    customerId,
    invoiceNumber: 'TX-INV-1',
    date: '2026-09-24',
    dueDate: '2026-10-24',
    subtotal: 100,
    discountAmount: 0,
    vatAmount: 0,
    totalAmount: 100,
    paidAmount: 0,
    status: 'draft',
    paymentType: 'credit',
    lines: [
      { productId: productA, quantity: 1, unitPrice: 100, discountPercent: 0, vatPercent: 0, lineTotal: 100 },
    ],
  } as never, userId);
  expect(inv.success, inv.error).toBe(true);
  invoiceId = String(inv.id);
}

async function snapshot() {
  const head = await query(
    `SELECT total_amount, status FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid`,
    [invoiceId, companyId],
  );
  const lines = await query(
    `SELECT product_id, quantity, line_total FROM sales_invoice_lines WHERE invoice_id = $1::uuid ORDER BY product_id`,
    [invoiceId],
  );
  return { head: head.rows![0] as Record<string, unknown>, lines: (lines.rows || []) as Record<string, unknown>[] };
}

beforeAll(async () => {
  // src/test/setup.ts replaces crypto.randomUUID with a non-UUID string; a real
  // engine rejects it on any uuid column.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  void getDbAdapter;
  await seed();
}, 180_000);

describe('document rewrite atomicity on a real engine (PGlite)', () => {
  it('a successful edit swaps both the header and the lines', async () => {
    const before = await snapshot();
    expect(before.lines).toHaveLength(1);

    const res = await salesApi.updateInvoice(invoiceId, companyId, {
      companyId,
      totalAmount: 250,
      lines: [
        { productId: productB, quantity: 2, unitPrice: 100, discountPercent: 0, vatPercent: 0, lineTotal: 200 },
        { productId: productA, quantity: 1, unitPrice: 50, discountPercent: 0, vatPercent: 0, lineTotal: 50 },
      ],
    } as never);
    expect(res.success, res.error).toBe(true);

    const after = await snapshot();
    expect(Number(after.head.total_amount)).toBe(250);
    expect(after.lines).toHaveLength(2);
    expect(after.lines.every((l) => l.product_id !== productA || Number(l.quantity) === 1)).toBe(true);
  }, 60_000);

  it('migration 0038 installed the product FK as CASCADE on this real engine', async () => {
    const r = await query(
      `SELECT c.conrelid::regclass::text AS tbl, c.confdeltype, c.convalidated
       FROM pg_constraint c
       WHERE c.contype = 'f'
         AND c.conname IN ('sales_invoice_lines_product_id_products_id_fk', 'purchase_invoice_lines_product_id_products_id_fk')
       ORDER BY c.conname`,
    );
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows!) {
      expect(row.confdeltype, `${row.tbl} must cascade`).toBe('c');
    }
  }, 60_000);

  it('a line pointing at a non-existent product is rejected by the engine', async () => {
    const bad = await query(
      `INSERT INTO sales_invoice_lines (invoice_id, product_id, quantity, unit_price, line_total)
       VALUES ($1::uuid, gen_random_uuid(), 1, 1, 1)`,
      [invoiceId],
    );
    expect(bad.success).toBe(false);
    expect(String(bad.error)).toMatch(/foreign key/i);
  }, 60_000);

  it('a failed re-insert leaves the previous header AND lines untouched', async () => {
    const before = await snapshot();
    expect(before.lines).toHaveLength(2);

    // currency_code is varchar(3) — a 4-character code violates the column, so
    // the line insert fails on a real engine (sales_invoice_lines.product_id
    // carries no FK, so a bogus product id would NOT fail here).
    const res = await salesApi.updateInvoice(invoiceId, companyId, {
      companyId,
      totalAmount: 999,
      lines: [
        { productId: productA, quantity: 1, unitPrice: 999, discountPercent: 0, vatPercent: 0, lineTotal: 999, currencyCode: 'YERX' },
      ],
    } as never);
    expect(res.success).toBe(false);

    const after = await snapshot();
    // The document must be exactly as it was — not zero lines under a new total.
    expect(after.lines).toHaveLength(before.lines.length);
    expect(Number(after.head.total_amount)).toBe(Number(before.head.total_amount));
  }, 60_000);
});
