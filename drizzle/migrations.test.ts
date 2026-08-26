import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Schema contract tests — consolidated baseline + additive migrations.
 *
 * The project starts from ONE squashed idempotent baseline (0000_init.sql)
 * generated from the Drizzle schemas (single source of truth), followed by
 * small hand-written ADDITIVE migrations (ALTER TABLE ... IF NOT EXISTS).
 *
 * These tests enforce the contract so future schema work stays safe:
 *   1. Baseline file exists and is first; later migrations are additive only.
 *   2. The journal mirrors the migration files in order.
 *   3. The baseline contains every business table and critical column.
 *   4. Hand-maintained performance/partial indexes are present.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const baselineFile = '0000_init.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, baselineFile), 'utf-8');

describe('Migration layout: baseline + additive migrations', () => {
  it('baseline is the first migration file', () => {
    expect(files[0]).toBe(baselineFile);
    expect(files).toContain('0001_invoice_payment_columns.sql');
  });

  it('later migrations are additive except the documented banks retirement', () => {
    // 0002 is a deliberate, documented removal: banks unify into cash boxes
    // ("النقدية والخزائن"). Nothing ELSE may be dropped.
    const RETIRED = new Set(['banks']);
    for (const f of files.filter((f) => f !== baselineFile)) {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
      // No table drops outside the retired set
      const droppedTables = [...content.matchAll(/DROP TABLE IF EXISTS "([^"]+)"/gi)].map((m) => m[1]);
      expect(droppedTables.every((t) => RETIRED.has(t))).toBe(true);
      // No index/constraint drops at all
      expect(content).not.toMatch(/\bDROP\s+(INDEX|CONSTRAINT)\b/i);
    }
  });

  it('journal mirrors the migration files in order', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    expect(journal.entries.length).toBe(files.length);
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

describe('Migration 0001: invoice payment-location columns', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0001_invoice_payment_columns.sql'), 'utf-8');
  const PAYMENT_TABLES = [
    'sales_invoices', 'quotations', 'sales_returns',
    'purchase_invoices', 'purchase_orders', 'purchase_returns',
  ];

  it('adds cash_box_id and bank_account_id to all 6 document tables', () => {
    for (const t of PAYMENT_TABLES) {
      expect(migrationSql).toMatch(new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid`));
      expect(migrationSql).toMatch(new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid`));
    }
  });

  it('is idempotent (IF NOT EXISTS on every ALTER)', () => {
    const alters = migrationSql.match(/ALTER TABLE/g) ?? [];
    const guarded = migrationSql.match(/ADD COLUMN IF NOT EXISTS/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    expect(alters.length).toBe(guarded.length);
  });

  it('Drizzle schemas expose the new columns', async () => {
    const sales = readFileSync(join(process.cwd(), 'src/core/database/schema/sales.ts'), 'utf-8');
    const purchases = readFileSync(join(process.cwd(), 'src/core/database/schema/purchases.ts'), 'utf-8');
    // sales_invoices + quotations + sales_returns = 3 in sales.ts
    expect(sales.match(/cashBoxId: uuid\('cash_box_id'\)/g)?.length).toBe(3);
    // purchase_invoices + purchase_orders + purchase_returns = 3 in purchases.ts
    expect(purchases.match(/cashBoxId: uuid\('cash_box_id'\)/g)?.length).toBe(3);
  });
});

describe('Migration 0002: banks unified into النقدية والخزائن (cash boxes)', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0002_drop_banks_unify_cash.sql'), 'utf-8');
  const PAYMENT_TABLES = [
    'sales_invoices', 'quotations', 'sales_returns',
    'purchase_invoices', 'purchase_orders', 'purchase_returns',
  ];

  it('drops the banks table', () => {
    expect(migrationSql).toMatch(/DROP TABLE IF EXISTS "banks"/);
  });

  it('drops bank_account_id from all payment-location tables (8 tables)', () => {
    for (const t of [...PAYMENT_TABLES, 'receipt_vouchers', 'payment_vouchers']) {
      expect(migrationSql).toMatch(new RegExp(`ALTER TABLE "${t}" DROP COLUMN IF EXISTS "bank_account_id"`));
    }
  });

  it('backfills bank-transfer vouchers with a cash box location before dropping', () => {
    expect(migrationSql).toMatch(/UPDATE receipt_vouchers[\s\S]*?payment_method = 'bank'/);
    expect(migrationSql).toMatch(/UPDATE payment_vouchers[\s\S]*?payment_method = 'bank'/);
  });

  it('Drizzle schemas no longer reference banks or bankAccountId', () => {
    const settings = readFileSync(join(process.cwd(), 'src/core/database/schema/settings.ts'), 'utf-8');
    const vouchers = readFileSync(join(process.cwd(), 'src/core/database/schema/vouchers.ts'), 'utf-8');
    expect(settings).not.toMatch(/export const banks/);
    expect(vouchers).not.toMatch(/bankAccountId/);
  });
});

describe('Migration 0003: work-order output warehouse', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0003_wo_output_warehouse.sql'), 'utf-8');

  it('adds output_warehouse_id to work_orders (finished-goods destination)', () => {
    expect(migrationSql).toMatch(/ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "output_warehouse_id" uuid/);
  });

  it('is idempotent', () => {
    expect(migrationSql.match(/ADD COLUMN IF NOT EXISTS/g)?.length).toBe(1);
  });

  it('Drizzle schema exposes outputWarehouseId on workOrders', () => {
    const schema = readFileSync(join(process.cwd(), 'src/core/database/schema/manufacturing.ts'), 'utf-8');
    expect(schema).toMatch(/outputWarehouseId: uuid\('output_warehouse_id'\)/);
  });
});
