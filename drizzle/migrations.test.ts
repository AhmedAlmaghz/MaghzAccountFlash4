import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Schema contract tests — unified squashed baseline.
 *
 * The project keeps ONE idempotent baseline (0000_init.sql): the squash of the
 * original 0000–0042 migration chain, generated from the exact PostgreSQL state
 * that chain produced on a fresh database (verified by a full catalog diff:
 * tables, columns, constraints and indexes are byte-for-byte equivalent).
 *
 * These tests enforce the contract so future schema work stays safe:
 *   1. The baseline is the only migration file; the journal mirrors it.
 *   2. The baseline contains every business table and critical column.
 *   3. Hand-maintained performance/partial indexes are present.
 *   4. The cascade/restrict/set-null decisions from migrations 0038–0042
 *      survive in the baseline, and the Drizzle schema mirrors them.
 *   5. The file stays replayable (statement breakpoints + IF NOT EXISTS
 *      conventions — the runner and PGlite add existence guards at load time).
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const baselineFile = '0000_init.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, baselineFile), 'utf-8');

describe('Migration layout: single squashed baseline', () => {
  it('the baseline is the ONLY migration file', () => {
    expect(files).toEqual([baselineFile]);
  });

  it('journal mirrors the baseline exactly', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'));
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].tag).toBe('0000_init');
    expect(journal.entries[0].idx).toBe(0);
    expect(journal.dialect).toBe('postgresql');
    // Snapshot must exist for future drizzle-kit generate diffs.
    expect(existsSync(join(MIGRATIONS_DIR, 'meta', '0000_snapshot.json'))).toBe(true);
  });

  it('baseline is non-trivial in size (>40KB of DDL)', () => {
    expect(sql.length).toBeGreaterThan(40_000);
  });

  it('retired tables stay retired (banks 0002; crm_activities + calls 0015)', () => {
    for (const t of ['banks', 'crm_activities', 'calls']) {
      expect(sql).not.toMatch(new RegExp(`CREATE TABLE (IF NOT EXISTS )?"${t}"`));
    }
    // the unified baseline must also carry no trace of the retired columns
    expect(sql).not.toMatch(/bank_account_id/);
  });

  it('statement count is exact (69 tables + 232 FKs + 48 indexes = 349 breakpoints)', () => {
    expect((sql.match(/CREATE TABLE /g) ?? []).length).toBe(69);
    expect((sql.match(/ALTER TABLE "[^"]+" ADD CONSTRAINT/g) ?? []).length).toBe(232);
    expect((sql.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length).toBe(48);
    expect((sql.match(/--> statement-breakpoint/g) ?? []).length).toBe(349);
  });

  it('every statement is breakpoint-terminated (runner/PGlite split on the marker)', () => {
    const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(349);
    for (const stmt of statements) {
      expect(stmt.endsWith(';'), `statement without trailing ;: ${stmt.slice(0, 60)}`).toBe(true);
    }
  });

  it('stays replay-safe: indexes are IF NOT EXISTS, FK guards come from the runner', () => {
    // baseline convention (mirrored by the original file): bare CREATE TABLE +
    // bare ADD CONSTRAINT — normalizeIdempotent() adds the guards at load time
    // in BOTH electron/migrationRunner.js and pgliteAdapter.ts. The file itself
    // must therefore carry no hand-inlined DO blocks…
    expect(sql).not.toMatch(/DO \$\$/);
    // …while every index is already IF NOT EXISTS on disk.
    const all = sql.match(/CREATE (UNIQUE )?INDEX/g) ?? [];
    const guarded = sql.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? [];
    expect(all.length).toBe(48);
    expect(guarded.length).toBe(all.length);
  });

  it('PGlite ships the same single baseline (hand-maintained registry)', () => {
    const pglite = readFileSync(join(process.cwd(), 'src/core/database/adapters/pgliteAdapter.ts'), 'utf8');
    expect(pglite).toMatch(/import schemaInit from '@root\/drizzle\/0000_init\.sql\?raw'/);
    expect(pglite).toMatch(/\{ name: '0000_init', sql: schemaInit \}/);
    // and nothing else is registered
    expect(pglite).not.toMatch(/000[1-9]_|00[1-4][0-9]_/);
  });
});

describe('Baseline covers all core business tables', () => {
  const TABLES = [
    // core
    'companies', 'branches', 'users', 'roles', 'currencies', 'settings',
    'product_types', 'units', 'cash_boxes', 'cost_centers',
    'default_accounts', 'document_sequences', 'vat_settings',
    // accounting
    'accounts', 'transactions', 'journal_entries', 'accounting_periods', 'fixed_assets',
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
    'product_units', 'inventory_layers',
    // manufacturing
    'boms', 'bom_lines', 'work_orders', 'work_order_consumptions',
    // hr
    'employees', 'departments', 'attendance', 'payroll_runs',
    'payroll_lines', 'leaves', 'end_of_service', 'payroll_components',
    // crm
    'leads', 'opportunities', 'tasks', 'activities',
    // warehouse transfers
    'warehouse_transfers', 'warehouse_transfer_lines',
    // tax (SQL-only table — intentionally not in the Drizzle schema)
    'tax_periods',
    // system / audit / ai
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
    'ai_job_batches', 'ai_job_items',
    // pos
    'pos_shifts', 'pos_payments',
  ];

  it('the list is complete (no missing, no typo)', () => {
    expect(TABLES).toHaveLength(69);
    const created = [...sql.matchAll(/CREATE TABLE "([a-z_0-9]+)"/g)].map((m) => m[1]);
    expect(created).toHaveLength(69);
    expect(TABLES.filter((t) => !created.includes(t))).toEqual([]);
  });

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
    ['sales_invoices.attachments jsonb', /"attachments" jsonb DEFAULT '\[\]'::jsonb NOT NULL/],
    // opening balances (0013 dates)
    ['customers.opening_balance', /"opening_balance"/],
    ['accounts.opening_amount', /"opening_amount"/],
    ['accounts.opening_direction', /"opening_direction"/],
    ['opening_date on 4 party tables', /"opening_date" date/],
    ['products.opening_stock_qty', /"opening_stock_qty"/],
    ['products.opening_warehouse_id', /"opening_warehouse_id"/],
    // hr extras
    ['employees.photo_url', /"photo_url"/],
    ['attendance.check_in nullable (0016)', /"check_in" timestamp,\n/],
    // manufacturing
    ['work_order_consumptions.actual_unit_cost', /"actual_unit_cost"/],
    ['work_orders.supervisor_id', /"supervisor_id" uuid/],
    // payment type
    ['sales_invoices.payment_type', /"payment_type"/],
    // POS (0027)
    ['sales_invoices.is_pos', /"is_pos" boolean DEFAULT false NOT NULL/],
    ['sales_invoices.shift_id', /"shift_id" uuid/],
    // inventory valuation (0032)
    ['products.standard_cost', /"standard_cost" numeric\(18, 4\)/],
    ['sales_invoice_lines.unit_cost NOT NULL DEFAULT 0', /"unit_cost" numeric\(18, 4\) DEFAULT 0 NOT NULL/],
    // FX revaluation (0033)
    ['sales_invoices.last_reval_rate', /"last_reval_rate" numeric\(18, 6\)/],
    ['purchase_invoices.last_reval_rate', /"last_reval_rate" numeric\(18, 6\)/],
    // multi-unit products (0021)
    ['product_units.factor', /"factor" numeric\(18, 6\) DEFAULT 1 NOT NULL/],
    ['product_units.is_base', /"is_base" boolean DEFAULT false NOT NULL/],
    // AI queue (0022/0024/0025/0028)
    ['ai_job_items.idempotency_key', /"idempotency_key" varchar\(200\)/],
    ['ai_job_items.label', /"label" varchar\(200\)/],
    ['ai_job_items.ref', /"ref" varchar\(100\)/],
    ['ai_job_items.result_data', /"result_data" jsonb/],
    ['ai_job_items.claimed_by', /"claimed_by" varchar\(64\)/],
    ['ai_job_items.claim_expires_at', /"claim_expires_at" timestamp with time zone/],
    ['ai_chat_messages.attachments', /"attachments" jsonb DEFAULT '\[\]'::jsonb NOT NULL/],
    // tax periods (0034 — multi-country VAT)
    ['tax_periods.country_code', /"country_code" varchar\(2\) DEFAULT 'YE' NOT NULL/],
    ['tax_periods.period_type', /"period_type" varchar\(20\) DEFAULT 'manual' NOT NULL/],
    ['tax_periods.filed_at', /"filed_at" timestamp with time zone/],
    // accounting periods + fixed assets (0035)
    ['accounting_periods.year', /"year" integer/],
    ['fixed_assets.accumulated_depreciation', /"accumulated_depreciation" numeric/],
    // inventory layers (0032)
    ['inventory_layers.qty_remaining', /"qty_remaining" numeric\(18, 4\) DEFAULT 0 NOT NULL/],
  ];

  for (const [name, re] of CASES) {
    it(`has ${name}`, () => {
      expect(sql).toMatch(re);
    });
  }

  it('0041 relaxed audit_logs.user_id (nullable — survives on the baseline)', () => {
    const block = /CREATE TABLE "audit_logs" \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    expect(block).toMatch(/"user_id" uuid,\n/);
    expect(block).not.toMatch(/"user_id" uuid NOT NULL/);
  });
});

describe('Baseline includes hand-maintained performance/partial indexes', () => {
  it('journal_entries composite index (company_id, account_id)', () => {
    expect(sql).toMatch(
      /idx_journal_entries_company_id" ON "journal_entries" \(company_id, account_id\)/
    );
  });

  it('partial invoice indexes on both voucher tables', () => {
    expect(sql).toMatch(
      /idx_receipt_vouchers_invoice" ON "receipt_vouchers" \(company_id, invoice_id\)\s*WHERE \(invoice_id IS NOT NULL\)/
    );
    expect(sql).toMatch(
      /idx_payment_vouchers_invoice" ON "payment_vouchers" \(company_id, invoice_id\)\s*WHERE \(invoice_id IS NOT NULL\)/
    );
  });

  it('attachments expression index', () => {
    expect(sql).toMatch(/idx_sales_invoices_attachments" ON "sales_invoices" \(\(attachments IS NOT NULL\)\)/);
  });

  it('stock one-row-per-product-warehouse unique index (0026)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "stock_company_product_warehouse_uidx" ON "stock" \(company_id, product_id, warehouse_id\)/
    );
  });

  it('one open shift per cashier per company (0027)', () => {
    expect(sql).toMatch(
      /uq_pos_shifts_open_per_user" ON "pos_shifts" \(company_id, user_id\) WHERE/
    );
  });

  it('payroll period uniqueness applies to live periods only (0014)', () => {
    expect(sql).toMatch(
      /uq_payroll_runs_period" ON "payroll_runs" \(company_id, month, year\) WHERE/
    );
  });

  it('AI queue claim-lease + queued pick indexes (0022/0028)', () => {
    expect(sql).toMatch(/idx_ai_job_items_lease" ON "ai_job_items" \(batch_id, status, claim_expires_at\) WHERE/);
    expect(sql).toMatch(/idx_ai_job_items_queued" ON "ai_job_items" \(batch_id, seq\) WHERE/);
  });

  it('product_units one-base/default-per-product partial uniques (0021)', () => {
    for (const idx of ['uq_product_units_base', 'uq_product_units_default_sale', 'uq_product_units_default_purchase']) {
      expect(sql).toMatch(new RegExp(`${idx}" ON "product_units" \\(product_id\\) WHERE`));
    }
  });

  it('work-order batch uniqueness only when set (0004 era)', () => {
    expect(sql).toMatch(
      /idx_work_orders_company_batch" ON "work_orders" \(company_id, batch_number\) WHERE \(batch_number IS NOT NULL\)/
    );
  });

  it('FIFO layers partial index (0032)', () => {
    expect(sql).toMatch(/idx_layers_fifo_order" ON "inventory_layers" \(company_id, product_id, received_date, created_at\) WHERE/);
  });
});

describe('FK integrity spot-checks (baseline + the 0038–0042 hardening)', () => {
  it('invoice lines cascade from their invoices', () => {
    expect(sql).toMatch(
      /ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY \("invoice_id"\) REFERENCES "public"\."sales_invoices"\("id"\) ON DELETE cascade ON UPDATE no action/
    );
    expect(sql).toMatch(
      /ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_purchase_invoices_id_fk" FOREIGN KEY \("invoice_id"\) REFERENCES "public"\."purchase_invoices"\("id"\) ON DELETE cascade ON UPDATE no action/
    );
  });

  it('0038: invoice-line product FKs are CASCADE (engine-level rejection of phantom products)', () => {
    expect(sql).toMatch(
      /ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_products_id_fk" FOREIGN KEY \("product_id"\) REFERENCES "public"\."products"\("id"\) ON DELETE cascade ON UPDATE no action/
    );
    expect(sql).toMatch(
      /ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_product_id_products_id_fk" FOREIGN KEY \("product_id"\) REFERENCES "public"\."products"\("id"\) ON DELETE cascade ON UPDATE no action/
    );
  });

  it('0039: a party that owns documents is never cascaded away (RESTRICT)', () => {
    for (const con of [
      'sales_invoices_customer_id_customers_fk',
      'purchase_invoices_supplier_id_suppliers_fk',
      'receipt_vouchers_customer_id_customers_fk',
      'payment_vouchers_supplier_id_suppliers_fk',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${con}"[\\s\\S]*?ON DELETE restrict ON UPDATE no action`));
    }
  });

  it('0040: a warehouse holding inventory is never cascaded away (RESTRICT)', () => {
    for (const con of [
      'stock_warehouse_id_warehouses_fk',
      'stock_movements_warehouse_id_warehouses_fk',
      'stock_adjustments_warehouse_id_warehouses_fk',
      'warehouse_transfers_from_warehouse_id_warehouses_fk',
      'warehouse_transfers_to_warehouse_id_warehouses_fk',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${con}"[\\s\\S]*?ON DELETE restrict ON UPDATE no action`));
    }
  });

  it('0041: production references RESTRICT, audit attribution is SET NULL', () => {
    expect(sql).toMatch(
      /ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_fk" FOREIGN KEY \("user_id"\) REFERENCES "public"\."users"\("id"\) ON DELETE set null ON UPDATE no action/
    );
    for (const con of ['work_orders_product_id_products_fk', 'boms_product_id_products_fk']) {
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${con}"[\\s\\S]*?ON DELETE restrict ON UPDATE no action`));
    }
  });

  it('0042: hierarchy trees cascade from their root', () => {
    for (const con of [
      'accounts_parent_id_self_fk',
      'product_categories_parent_id_self_fk',
      'cost_centers_parent_id_self_fk',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${con}"[\\s\\S]*?ON DELETE cascade ON UPDATE no action`));
    }
  });

  it('stock movements are company-scoped with cascade', () => {
    expect(sql).toMatch(
      /ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY \("company_id"\) REFERENCES "public"\."companies"\("id"\) ON DELETE cascade ON UPDATE no action/
    );
  });
});

describe('Drizzle schema mirrors the key FK decisions (no SQL drift)', () => {
  it('invoice-line product references are CASCADE in Drizzle too', () => {
    const sales = readFileSync(join(process.cwd(), 'src/core/database/schema/sales.ts'), 'utf8');
    const purchases = readFileSync(join(process.cwd(), 'src/core/database/schema/purchases.ts'), 'utf8');
    const invoiceLines = /export const salesInvoiceLines = pgTable\([\s\S]*?\n\}\);/.exec(sales)?.[0] ?? '';
    const purchaseLines = /export const purchaseInvoiceLines = pgTable\([\s\S]*?\n\}\);/.exec(purchases)?.[0] ?? '';
    expect(invoiceLines).toMatch(/productId: uuid\('product_id'\)\.notNull\(\)\.references\(\(\) => products\.id, \{ onDelete: 'cascade' \}\)/);
    expect(purchaseLines).toMatch(/productId: uuid\('product_id'\)\.references\(\(\) => products\.id, \{ onDelete: 'cascade' \}\)/);
  });

  it('work-order/BOM product references are RESTRICT and audit user is SET NULL', () => {
    const mfg = readFileSync(join(process.cwd(), 'src/core/database/schema/manufacturing.ts'), 'utf8');
    const audit = readFileSync(join(process.cwd(), 'src/core/database/schema/audit.ts'), 'utf8');
    expect((mfg.match(/productId: uuid\('product_id'\)\.notNull\(\)\.references\(\(\) => products\.id, \{ onDelete: 'restrict' \}\)/g) ?? []).length).toBe(2);
    expect(audit).toMatch(/userId: uuid\('user_id'\)\.references\(\(\) => users\.id, \{ onDelete: 'set null' \}\)/);
  });

  it('the three hierarchy self-references are CASCADE in Drizzle', () => {
    const files = {
      'src/core/database/schema/accounting.ts': /parentId: uuid\('parent_id'\)\.references\(\(\): AnyPgColumn => accounts\.id, \{ onDelete: 'cascade' \}\)/,
      'src/core/database/schema/inventory.ts': /parentId: uuid\('parent_id'\)\.references\(\(\): AnyPgColumn => productCategories\.id, \{ onDelete: 'cascade' \}\)/,
      'src/core/database/schema/settings.ts': /parentId: uuid\('parent_id'\)\.references\(\(\): AnyPgColumn => costCenters\.id, \{ onDelete: 'cascade' \}\)/,
    };
    for (const [file, re] of Object.entries(files)) {
      expect(readFileSync(join(process.cwd(), file), 'utf8'), file).toMatch(re);
    }
  });
});
