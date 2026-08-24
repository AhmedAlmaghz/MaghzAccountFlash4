import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Schema contract tests — single consolidated baseline world.
 *
 * Since the project is pre-production, ALL migrations are squashed into one
 * idempotent baseline (0000_init.sql) generated from the Drizzle schemas
 * (single source of truth) plus a small hand-maintained index appendix.
 *
 * These tests enforce the contract so future schema work stays safe:
 *   1. Exactly ONE migration file + ONE journal entry (squash discipline).
 *   2. The baseline contains every business table and critical column.
 *   3. Hand-maintained performance/partial indexes are present.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const baselineFile = '0000_init.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, baselineFile), 'utf-8');

describe('Migration layout: single squashed baseline', () => {
  it('has exactly one SQL migration file named 0000_init.sql', () => {
    expect(files).toEqual([baselineFile]);
  });

  it('journal has a single entry pointing at the baseline', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    expect(journal.entries.length).toBe(1);
    expect(journal.entries[0].tag).toBe('0000_init');
    expect(journal.entries[0].idx).toBe(0);
    expect(journal.dialect).toBe('postgresql');
    // Snapshot must exist for future drizzle-kit generate diffs.
    expect(existsSync(join(MIGRATIONS_DIR, 'meta', '0000_snapshot.json'))).toBe(true);
  });

  it('baseline is non-trivial in size (>40KB of DDL)', () => {
    expect(sql.length).toBeGreaterThan(40_000);
  });
});

describe('Baseline covers all core business tables', () => {
  const TABLES = [
    // core
    'companies', 'branches', 'users', 'roles', 'currencies', 'settings',
    'product_types', 'units', 'banks', 'cash_boxes', 'cost_centers',
    'default_accounts', 'document_sequences',
    // accounting
    'accounts', 'transactions', 'journal_entries',
    // sales
    'customers', 'sales_invoices', 'sales_invoice_lines', 'quotations',
    'quotation_lines', 'sales_returns', 'sales_return_lines', 'receipt_vouchers',
    // purchases
    'suppliers', 'purchase_invoices', 'purchase_invoice_lines',
    'purchase_orders', 'purchase_order_lines', 'purchase_returns',
    'purchase_return_lines', 'payment_vouchers',
    // inventory
    'products', 'product_categories', 'product_product_categories',
    'warehouses', 'stock', 'stock_movements', 'stock_adjustments',
    // manufacturing
    'boms', 'bom_lines', 'work_orders', 'work_order_consumptions',
    // hr (actual table names in schema)
    'employees', 'departments', 'attendance', 'payroll_runs',
    'payroll_lines', 'leaves', 'end_of_service', 'payroll_components',
    // crm
    'leads', 'opportunities', 'tasks', 'activities', 'calls', 'crm_activities',
    // warehouse transfers
    'warehouse_transfers', 'warehouse_transfer_lines',
    // system / audit / ai
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
  ];

  for (const t of TABLES) {
    it(`creates table "${t}"`, () => {
      const re = new RegExp(`CREATE TABLE (IF NOT EXISTS )?"${t}"`);
      expect(sql).toMatch(re);
    });
  }
});

describe('Baseline includes critical feature columns', () => {
  const CASES: Array<[string, RegExp]> = [
    // multi-currency
    ['invoices currency_code', /"currency_code" varchar\(3\)/],
    ['invoices exchange_rate', /"exchange_rate" numeric/],
    // payment allocation
    ['receipt_vouchers.invoice_id', /"invoice_id" uuid/],
    ['payment_vouchers.invoice_id', /"invoice_id" uuid/],
    ['amount_applied', /"amount_applied"/],
    ['base_currency_applied', /"base_currency_applied"/],
    // attachments
    ['sales_invoices.attachments jsonb', /"attachments" jsonb/],
    // opening balances
    ['customers.opening_balance', /"opening_balance"/],
    ['accounts.opening_amount', /"opening_amount"/],
    ['accounts.opening_direction', /"opening_direction"/],
    ['products.opening_stock_qty', /"opening_stock_qty"/],
    ['products.opening_warehouse_id', /"opening_warehouse_id"/],
    // hr extras
    ['employees.photo_url', /"photo_url"/],
    ['employees.attachments', /"attachments"/],
    // manufacturing fixes
    ['work_order_consumptions.actual_unit_cost', /"actual_unit_cost"/],
    // payment type
    ['sales_invoices.payment_type', /"payment_type"/],
  ];

  for (const [name, re] of CASES) {
    it(`has ${name}`, () => {
      expect(sql).toMatch(re);
    });
  }
});

describe('Baseline includes hand-maintained performance/partial indexes', () => {
  it('journal_entries composite index (company_id, account_id)', () => {
    expect(sql).toMatch(/idx_journal_entries_company_id.*ON.*journal_entries[\s\S]*?company_id.{0,5},[\s\S]*?account_id/i);
  });

  it('partial invoice indexes on both voucher tables', () => {
    expect(sql).toMatch(/idx_receipt_vouchers_invoice[\s\S]*?WHERE invoice_id IS NOT NULL/i);
    expect(sql).toMatch(/idx_payment_vouchers_invoice[\s\S]*?WHERE invoice_id IS NOT NULL/i);
  });

  it('attachments expression index', () => {
    expect(sql).toMatch(/idx_sales_invoices_attachments/);
  });
});

describe('FK integrity spot-checks', () => {
  it('invoice lines cascade from their invoices (ALTER-form FK)', () => {
    expect(sql).toMatch(
      /ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY \("invoice_id"\) REFERENCES "public"\."sales_invoices"\("id"\) ON DELETE cascade/i
    );
    expect(sql).toMatch(
      /ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_purchase_invoices_id_fk" FOREIGN KEY \("invoice_id"\) REFERENCES "public"\."purchase_invoices"\("id"\) ON DELETE cascade/i
    );
  });

  it('stock movements are company-scoped with cascade', () => {
    expect(sql).toMatch(
      /ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY \("company_id"\) REFERENCES "public"\."companies"\("id"\) ON DELETE cascade/i
    );
  });
});
