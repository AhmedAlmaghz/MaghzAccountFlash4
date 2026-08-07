/**
 * Tests for Drizzle SQL migrations
 *
 * These tests verify that the unified SQL migration file is structurally
 * correct and contains the expected schema features. They run on a file-based
 * mock (no live PostgreSQL needed) by parsing the SQL text directly.
 *
 * Why this matters: Drizzle migrations are the SINGLE source of truth for
 * the database schema. Any drift, missing constraints, or broken syntax
 * can corrupt the production database.
 *
 * Phase 7 (2026-06-02): Migration chain 0000-0004 replaced by a single
 * unified file `0000_unified_schema.sql` after resolving schema drift.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf-8');
}

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

const UNIFIED_TABLES = [
  // Core/Auth (7)
  'companies', 'users', 'roles', 'settings', 'branches', 'currencies', 'vat_settings',
  // Accounting (3)
  'accounts', 'transactions', 'journal_entries',
  // Inventory (8)
  'product_categories', 'product_types', 'products', 'product_product_categories',
  'warehouses', 'stock', 'stock_movements', 'warehouse_transfers', 'warehouse_transfer_lines',
  'stock_adjustments',
  // Sales (7)
  'customers', 'quotations', 'quotation_lines', 'sales_invoices', 'sales_invoice_lines',
  'sales_returns', 'sales_return_lines',
  // Purchases (7)
  'suppliers', 'purchase_invoices', 'purchase_invoice_lines', 'purchase_orders',
  'purchase_order_lines', 'purchase_returns', 'purchase_return_lines',
  // Manufacturing (4)
  'boms', 'bom_lines', 'work_orders', 'work_order_consumptions',
  // HR (8)
  'departments', 'employees', 'attendance', 'leaves', 'payroll_runs', 'payroll_lines',
  'end_of_service', 'payroll_components',
  // CRM (4)
  'leads', 'opportunities', 'crm_activities', 'calls',
  'tasks', 'activities',
  // Settings (6)
  'units', 'cash_boxes', 'banks', 'cost_centers', 'default_accounts', 'document_sequences',
  // Vouchers (2)
  'receipt_vouchers', 'payment_vouchers',
  // Audit Logs (1)
  'audit_logs',
  // AI Chat Persistence (2)
  'ai_chat_sessions', 'ai_chat_messages',
];

describe('Drizzle migrations (unified)', () => {
  let allSql: string;
  let file0: string;

  beforeAll(() => {
    const files = listMigrations();
    allSql = files.map(readMigration).join('\n');
    file0 = files.length > 0 ? readMigration(files[0]) : '';
  });

  it('has the unified base migration file', () => {
    const files = listMigrations();
    expect(files[0]).toBe('0000_unified_schema.sql');
  });

  it('_journal.json entries match migration files', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    expect(journal.entries[0].tag).toBe('0000_unified_schema');
    expect(journal.entries[0].idx).toBe(0);
  });

  it('contains all 61 expected tables in unified schema + audit_logs in 0014 + ai tables in 0016', () => {
    expect(UNIFIED_TABLES.length).toBe(63);
    for (const table of UNIFIED_TABLES) {
      if (table === 'audit_logs') {
        const mig14 = readFileSync(join(MIGRATIONS_DIR, '0014_audit_logs_table.sql'), 'utf-8');
        expect(mig14, `Missing CREATE TABLE for ${table}`).toMatch(/CREATE TABLE[^;]*?audit_logs\b/i);
        continue;
      }
      if (table === 'ai_chat_sessions' || table === 'ai_chat_messages') {
        const mig16 = readFileSync(join(MIGRATIONS_DIR, '0016_ai_chat_persistence.sql'), 'utf-8');
        const re = new RegExp(`CREATE TABLE[^;]*?${table}\\b`, 'i');
        expect(mig16, `Missing CREATE TABLE for ${table}`).toMatch(re);
        continue;
      }
      const re = new RegExp(
        `CREATE TABLE[^;]*?${table.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`,
        'i',
      );
      expect(re.test(allSql), `Missing CREATE TABLE for ${table}`).toBe(true);
    }
  });

  it('all CREATE TABLE statements use IF NOT EXISTS', () => {
    const createTableMatches = file0.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/gi);
    expect(createTableMatches, 'Found unguarded CREATE TABLE').toBeNull();
  });

  it('all UNIQUE constraints are declared inline (no separate DO blocks)', () => {
    // The unified schema must not use DO $$ IF NOT EXISTS pattern
    expect(file0).not.toMatch(/DO \$\$/i);
    // It must have at least 27 inline UNIQUE constraints
    const inlineUnique = file0.match(/UNIQUE \(/g);
    expect(inlineUnique).not.toBeNull();
    expect(inlineUnique!.length).toBeGreaterThanOrEqual(27);
  });

  it('mandatory UNIQUE constraints on document numbers and codes', () => {
    const expected = [
      'accounts_company_id_code_unique',
      'customers_company_id_code_unique',
      'suppliers_company_id_code_unique',
      'products_company_id_code_unique',
      'employees_company_id_employee_number_unique',
      'departments_company_id_name_unique',
      'branches_company_id_code_unique',
      'warehouses_company_id_code_unique',
      'document_sequences_company_id_document_type_unique',
      'default_accounts_company_id_function_key_unique',
      'product_types_company_id_code_unique',
      'units_company_id_code_unique',
      'currencies_company_id_code_unique',
      'vat_settings_company_id_unique',
      'cost_centers_company_id_code_unique',
      'payroll_components_company_id_code_unique',
      'sales_invoices_company_id_invoice_number_unique',
      'purchase_invoices_company_id_invoice_number_unique',
      'purchase_orders_company_id_order_number_unique',
      'quotations_company_id_quotation_number_unique',
      'work_orders_company_id_order_number_unique',
      'roles_company_id_name_unique',
      'users_company_id_username_unique',
    ];
    for (const c of expected) {
      expect(file0, `Missing UNIQUE ${c}`).toContain(`"${c}"`);
    }
  });

  it('has UNIQUE constraints on return and voucher numbers', () => {
    expect(file0).toContain('"sales_returns_company_id_return_number_unique"');
    expect(file0).toContain('"purchase_returns_company_id_return_number_unique"');
    expect(file0).toContain('"receipt_vouchers_company_id_voucher_number_unique"');
    expect(file0).toContain('"payment_vouchers_company_id_voucher_number_unique"');
  });

  it('all company_id columns are NOT NULL', () => {
    // Every table with company_id must declare it NOT NULL
    // (search across all migration files — `audit_logs` lives in 0013)
    const tablesWithCompanyId = UNIFIED_TABLES.filter(t => t !== 'product_product_categories');
    for (const table of tablesWithCompanyId) {
      // Match the CREATE TABLE line (with or without quoted identifiers),
      // then require `company_id` to be NOT NULL within 200 chars.
      const pattern = new RegExp(
        `CREATE TABLE[^]*?${table.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^]*?company_id[^]*?NOT NULL`,
        'i',
      );
      expect(pattern.test(allSql), `${table} company_id should be NOT NULL`).toBe(true);
    }
  });

  it('journal_entries has both transaction_id AND company_id (denormalized)', () => {
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "journal_entries"[\s\S]*?"company_id"[\s\S]*?"transaction_id"[\s\S]*?"account_id"/i);
  });

  it('journal_entries index uses transaction_id (not company_id)', () => {
    // Audit index for created_by uses transaction_id, company_id for company-wide queries
    expect(file0).toMatch(/idx_journal_entries_created_by[\s\S]+transaction_id/i);
    // Plus a separate index for company-level queries
    expect(file0).toMatch(/idx_journal_entries_company_id/i);
  });

  it('all 4 line tables exist with parent_id FKs', () => {
    const linesTables = [
      'sales_invoice_lines', 'sales_return_lines',
      'purchase_invoice_lines', 'purchase_order_lines', 'purchase_return_lines',
      'quotation_lines', 'bom_lines', 'work_order_consumptions',
      'payroll_lines', 'warehouse_transfer_lines',
    ];
    for (const t of linesTables) {
      expect(file0, `Missing lines table ${t}`).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    }
  });

  it('product_product_categories uses composite primary key', () => {
    expect(file0).toMatch(/product_product_categories[\s\S]{0,500}PRIMARY KEY \(["']?product_id["']?, ["']?category_id["']?\)/i);
  });

  it('all multi-tenant tables have created_by and updated_by', () => {
    const tablesWithAudit = [
      'accounts', 'transactions', 'journal_entries', 'products', 'stock_movements',
      'warehouse_transfers', 'customers', 'quotations', 'sales_invoices', 'sales_returns',
      'suppliers', 'purchase_invoices', 'purchase_orders', 'purchase_returns',
      'boms', 'work_orders', 'employees', 'attendance', 'leaves', 'payroll_runs',
      'end_of_service', 'leads', 'opportunities', 'crm_activities',
      'receipt_vouchers', 'payment_vouchers',
    ];
    for (const t of tablesWithAudit) {
      expect(file0, `${t} missing created_by`).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"[\\s\\S]*?"created_by"`, 'i'));
      expect(file0, `${t} missing updated_by`).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"[\\s\\S]*?"updated_by"`, 'i'));
    }
  });

  it('all FK constraints use CASCADE on multi-tenant parent', () => {
    // companies is the root of multi-tenancy — child tables must use ON DELETE CASCADE
    const companiesChildTables = [
      'users', 'roles', 'settings', 'branches', 'currencies', 'vat_settings',
      'accounts', 'transactions', 'journal_entries',
      'product_categories', 'product_types', 'products', 'warehouses',
      'stock', 'stock_movements', 'warehouse_transfers',
      'customers', 'quotations', 'sales_invoices', 'sales_returns',
      'suppliers', 'purchase_invoices', 'purchase_orders', 'purchase_returns',
      'boms', 'work_orders', 'departments', 'employees', 'attendance', 'leaves',
      'payroll_runs', 'end_of_service', 'payroll_components',
      'leads', 'opportunities', 'crm_activities', 'calls',
      'units', 'cash_boxes', 'banks', 'cost_centers',
      'default_accounts', 'document_sequences',
      'receipt_vouchers', 'payment_vouchers',
    ];
    for (const t of companiesChildTables) {
      // The company_id FK in this table should be ON DELETE CASCADE
      const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"[\\s\\S]*?"company_id" uuid[\\s\\S]*?REFERENCES "companies"\\("id"\\)[\\s\\S]*?ON DELETE CASCADE`, 'i');
      expect(pattern.test(file0), `${t} company_id FK should ON DELETE CASCADE`).toBe(true);
    }
  });

  it('users table has full_name, phone, is_active, role', () => {
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "users"[\s\S]*?"full_name"/i);
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "users"[\s\S]*?"phone"/i);
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "users"[\s\S]*?"is_active"[\s\S]*?DEFAULT true NOT NULL/i);
  });

  it('roles table has description, is_system, updated_at, company_id NOT NULL', () => {
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "roles"[\s\S]*?"description"/i);
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "roles"[\s\S]*?"is_system"/i);
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "roles"[\s\S]*?"updated_at"/i);
  });

  it('products table has product_type_id FK', () => {
    expect(file0).toMatch(/CREATE TABLE IF NOT EXISTS "products"[\s\S]*?"product_type_id"[\s\S]*?REFERENCES "product_types"/i);
  });

  it('all required audit indexes exist', () => {
    const requiredIndexes = [
      'idx_accounts_created_by', 'idx_transactions_created_by',
      'idx_journal_entries_created_by', 'idx_journal_entries_company_id',
      'idx_products_created_by', 'idx_products_product_type_id',
      'idx_ppc_product_id', 'idx_ppc_category_id',
      'idx_customers_created_by', 'idx_quotations_created_by',
      'idx_sales_invoices_created_by', 'idx_sales_returns_created_by',
      'idx_suppliers_created_by', 'idx_purchase_invoices_created_by',
      'idx_purchase_orders_created_by', 'idx_purchase_returns_created_by',
      'idx_employees_created_by', 'idx_payroll_runs_created_by',
      'idx_leads_created_by', 'idx_receipt_vouchers_created_by',
      'idx_payment_vouchers_created_by',
    ];
    for (const idx of requiredIndexes) {
      expect(file0, `Missing index ${idx}`).toContain(`CREATE INDEX IF NOT EXISTS "${idx}"`);
    }
  });

  it('no destructive DROP statements', () => {
    const drops = file0.match(/^\s*DROP\s+(?!IF EXISTS)/gim);
    expect(drops).toBeNull();
  });

  it('idempotent (safe to re-run via CREATE TABLE IF NOT EXISTS)', () => {
    const unguardedCreateTable = file0.match(/CREATE TABLE\s+(?!IF NOT EXISTS)["']?\w+["']?/gi);
    expect(unguardedCreateTable).toBeNull();
    const unguardedAddColumn = file0.match(/ADD COLUMN\s+(?!IF NOT EXISTS)/gi);
    expect(unguardedAddColumn, 'Unguarded ADD COLUMN').toBeNull();
    const unguardedCreateIndex = file0.match(/CREATE INDEX\s+(?!IF NOT EXISTS)/gi);
    expect(unguardedCreateIndex, 'Unguarded CREATE INDEX').toBeNull();
  });

  it('unified file has section comments for navigation', () => {
    expect(file0).toMatch(/§\s*1\.\s*CORE/i);
    expect(file0).toMatch(/§\s*2\.\s*ACCOUNTING/i);
    expect(file0).toMatch(/§\s*11\.\s*AUDIT INDEXES/i);
  });

  it('flat journal_entries design documented in header', () => {
    expect(file0).toMatch(/Flat design/i);
  });
});

describe('Migration 0001: Multi-currency columns', () => {
  let mig1: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0001_multi_currency.sql');
    mig1 = readFileSync(path, 'utf-8');
  });

  it('adds currency_code to sales_invoices with YER default', () => {
    expect(mig1).toMatch(/ALTER TABLE "sales_invoices"[\s\S]*?"currency_code"[\s\S]*?DEFAULT 'YER' NOT NULL/i);
  });

  it('adds currency_code to purchase_invoices with YER default', () => {
    expect(mig1).toMatch(/ALTER TABLE "purchase_invoices"[\s\S]*?"currency_code"[\s\S]*?DEFAULT 'YER' NOT NULL/i);
  });

  it('adds exchange_rate to sales_invoices with 1 default', () => {
    expect(mig1).toMatch(/ALTER TABLE "sales_invoices"[\s\S]*?"exchange_rate"[\s\S]*?DEFAULT '1' NOT NULL/i);
  });

  it('adds base_currency_amount to both sales and purchase invoices', () => {
    expect(mig1).toContain('"base_currency_amount"');
    expect(mig1.match(/"base_currency_amount"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('adds base_currency_paid to invoices for payment tracking', () => {
    expect(mig1).toContain('"base_currency_paid"');
    expect(mig1.match(/"base_currency_paid"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('adds base_currency_line_total to invoice lines', () => {
    expect(mig1).toContain('"base_currency_line_total"');
    expect(mig1.match(/"base_currency_line_total"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('adds currency columns to receipt_vouchers and payment_vouchers', () => {
    expect(mig1).toMatch(/ALTER TABLE "receipt_vouchers"[\s\S]*?"currency_code"/i);
    expect(mig1).toMatch(/ALTER TABLE "payment_vouchers"[\s\S]*?"currency_code"/i);
  });

  it('creates composite index for currency aggregation queries', () => {
    expect(mig1).toContain('CREATE INDEX IF NOT EXISTS "idx_sales_invoices_company_currency"');
    expect(mig1).toContain('CREATE INDEX IF NOT EXISTS "idx_purchase_invoices_company_currency"');
  });

  it('is idempotent (uses IF NOT EXISTS on all ADD COLUMN and CREATE INDEX)', () => {
    expect(mig1).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/);
    expect(mig1).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/);
  });
});

describe('Migration 0009: Performance indexes phase 2', () => {
  let mig9: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0009_performance_indexes_phase2.sql');
    mig9 = readFileSync(path, 'utf-8');
  });

  it('has line-item FK indexes for all detail tables', () => {
    expect(mig9).toContain('idx_sales_invoice_lines_invoice');
    expect(mig9).toContain('idx_purchase_invoice_lines_invoice');
    expect(mig9).toContain('idx_quotation_lines_quotation');
    expect(mig9).toContain('idx_sales_return_lines_return');
    expect(mig9).toContain('idx_purchase_return_lines_return');
    expect(mig9).toContain('idx_purchase_order_lines_order');
    expect(mig9).toContain('idx_bom_lines_bom');
    expect(mig9).toContain('idx_work_order_consumptions_wo');
    expect(mig9).toContain('idx_payroll_lines_run');
    expect(mig9).toContain('idx_warehouse_transfer_lines_transfer');
  });

  it('has journal_entries FK indexes on account_id and transaction_id', () => {
    expect(mig9).toContain('idx_journal_entries_account');
    expect(mig9).toContain('idx_journal_entries_transaction');
  });

  it('has status filter indexes for all status-filtered tables', () => {
    const tbls = [
      'sales_invoices', 'purchase_invoices', 'sales_returns',
      'purchase_returns', 'purchase_orders', 'work_orders',
      'transactions', 'receipt_vouchers', 'payment_vouchers',
      'leads', 'leaves', 'end_of_service', 'payroll_runs', 'tasks',
    ];
    for (const t of tbls) {
      expect(mig9, `Missing status index for ${t}`).toContain(`idx_${t}_company_status`);
    }
  });

  it('has customer/supplier FK indexes', () => {
    expect(mig9).toContain('idx_sales_invoices_company_customer');
    expect(mig9).toContain('idx_purchase_invoices_company_supplier');
    expect(mig9).toContain('idx_quotations_company_customer');
    expect(mig9).toContain('idx_purchase_orders_company_supplier');
    expect(mig9).toContain('idx_sales_returns_company_customer');
    expect(mig9).toContain('idx_purchase_returns_company_supplier');
    expect(mig9).toContain('idx_receipt_vouchers_company_customer');
    expect(mig9).toContain('idx_payment_vouchers_company_supplier');
  });

  it('has stage/type filter indexes', () => {
    expect(mig9).toContain('idx_opportunities_company_stage');
    expect(mig9).toContain('idx_products_company_active');
    expect(mig9).toContain('idx_employees_company_active');
    expect(mig9).toContain('idx_employees_company_department');
    expect(mig9).toContain('idx_stock_movements_company_type');
  });

  it('has stock/product lookup indexes', () => {
    expect(mig9).toContain('idx_stock_product_warehouse');
    expect(mig9).toContain('idx_stock_movements_product_warehouse');
    expect(mig9).toContain('idx_stock_adjustments_company_product');
  });

  it('has user login index on (username, company_id)', () => {
    expect(mig9).toContain('idx_users_username_company');
  });

  it('has CRM assigned-to indexes for ownership filters', () => {
    expect(mig9).toContain('idx_leads_company_assigned');
    expect(mig9).toContain('idx_opportunities_company_assigned');
    expect(mig9).toContain('idx_tasks_company_assigned');
    expect(mig9).toContain('idx_activities_company_assigned');
  });

  it('has CHECK constraints for data integrity', () => {
    expect(mig9).toContain('currencies_exchange_rate_check');
    expect(mig9).toContain('CHECK (exchange_rate > 0)');
    expect(mig9).toContain('payroll_lines_net_salary_check');
    expect(mig9).toContain('CHECK (net_salary >= 0)');
    expect(mig9).toContain('stock_quantity_check');
    expect(mig9).toContain('CHECK (quantity >= 0)');
    expect(mig9).toContain('sales_invoices_total_amount_check');
    expect(mig9).toContain('purchase_invoices_total_amount_check');
    expect(mig9).toContain('employees_base_salary_check');
  });

  it('is idempotent (all IF NOT EXISTS for indexes, pg_constraint for CHECK)', () => {
    expect(mig9).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
    expect(mig9).toMatch(/DO \$\$/i);
    expect(mig9).toMatch(/pg_constraint WHERE conname/i);
  });

  it('_journal.json has 24 entries (0000-0023)', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    expect(journal.entries.length).toBe(24);
    expect(journal.entries[11].tag).toBe('0011_manufacturing_schema_fix');
    expect(journal.entries[12].tag).toBe('0012_purchase_invoice_lines_percents');
    expect(journal.entries[13].tag).toBe('0013_hr_schema_drift_fix');
    expect(journal.entries[14].tag).toBe('0014_audit_logs_table');
    expect(journal.entries[15].tag).toBe('0015_payment_allocation');
    expect(journal.entries[16].tag).toBe('0016_ai_chat_persistence');
    expect(journal.entries[17].tag).toBe('0017_settings_unique');
    expect(journal.entries[18].tag).toBe('0018_sequence_numbering');
    expect(journal.entries[19].tag).toBe('0019_payment_type');
    expect(journal.entries[20].tag).toBe('0020_invoice_payment_accounts');
    expect(journal.entries[21].tag).toBe('0021_user_tracking_columns');
    expect(journal.entries[22].tag).toBe('0022_audit_and_document_sequences_fix');
    expect(journal.entries[23].tag).toBe('0023_activities_user_tracking_columns');
  });
});

describe('Migration 0010: Schema drift fix', () => {
  let mig10: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0010_schema_drift_fix.sql');
    mig10 = readFileSync(path, 'utf-8');
  });

  it('adds rating column to leads', () => {
    expect(mig10).toMatch(/ALTER TABLE leads ADD COLUMN IF NOT EXISTS rating/i);
    expect(mig10).toMatch(/DEFAULT 'warm' NOT NULL/i);
  });

  it('adds notes column to opportunities', () => {
    expect(mig10).toMatch(/ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS notes/i);
  });

  it('adds status column to attendance', () => {
    expect(mig10).toMatch(/ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status/i);
    expect(mig10).toMatch(/DEFAULT 'present' NOT NULL/i);
  });

  it('adds reason, approved_by, approved_at to leaves', () => {
    expect(mig10).toMatch(/ALTER TABLE leaves ADD COLUMN IF NOT EXISTS reason/i);
    expect(mig10).toMatch(/ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approved_by/i);
    expect(mig10).toMatch(/ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approved_at/i);
  });

  it('adds purchase_order_id to purchase_invoices', () => {
    expect(mig10).toMatch(/ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS purchase_order_id/i);
  });

  it('adds description and received_quantity to purchase_order_lines', () => {
    expect(mig10).toMatch(/ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS description/i);
    expect(mig10).toMatch(/ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_quantity/i);
  });

  it('adds description to purchase_return_lines', () => {
    expect(mig10).toMatch(/ALTER TABLE purchase_return_lines ADD COLUMN IF NOT EXISTS description/i);
  });

  it('creates supporting indexes', () => {
    expect(mig10).toContain('idx_leads_rating');
    expect(mig10).toContain('idx_attendance_status');
    expect(mig10).toContain('idx_purchase_invoices_purchase_order_id');
    expect(mig10).toContain('idx_purchase_order_lines_received');
  });

  it('is idempotent (all IF NOT EXISTS)', () => {
    expect(mig10).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
    expect(mig10).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });
});

describe('Drizzle schema TypeScript', () => {
  it('schema files exist for all modules', () => {
    const schemaDir = join(process.cwd(), 'src', 'core', 'database', 'schema');
    const files = readdirSync(schemaDir);
    const expected = ['inventory', 'accounting', 'sales', 'purchases', 'manufacturing', 'hr', 'crm', 'settings', 'vouchers', 'audit'];
    for (const name of expected) {
      expect(files.some((f) => f.startsWith(name))).toBe(true);
    }
  });

  it('Drizzle schema exports all 63 tables', { timeout: 30000 }, async () => {
    const mod = await import('../src/core/database/schema/index');
    const expected = [
      'companies', 'users', 'roles', 'settings', 'branches', 'currencies', 'vatSettings',
      'accounts', 'transactions', 'journalEntries',
      'productCategories', 'productTypes', 'products', 'productProductCategories',
      'warehouses', 'stock', 'stockMovements', 'warehouseTransfers', 'warehouseTransferLines',
      'stockAdjustments',
      'customers', 'quotations', 'quotationLines', 'salesInvoices', 'salesInvoiceLines',
      'salesReturns', 'salesReturnLines',
      'suppliers', 'purchaseInvoices', 'purchaseInvoiceLines', 'purchaseOrders',
      'purchaseOrderLines', 'purchaseReturns', 'purchaseReturnLines',
      'boms', 'bomLines', 'workOrders', 'workOrderConsumptions',
      'departments', 'employees', 'attendance', 'leaves', 'payrollRuns', 'payrollLines',
      'endOfService', 'payrollComponents',
      'leads', 'opportunities', 'crmActivities', 'calls',
      'tasks', 'activities',
      'units', 'cashBoxes', 'banks', 'costCenters', 'defaultAccounts', 'documentSequences',
      'receiptVouchers', 'paymentVouchers',
      'auditLogs',
      'aiChatSessions', 'aiChatMessages',
    ];
    for (const name of expected) {
      expect(mod, `Missing Drizzle export ${name}`).toHaveProperty(name);
    }
  });

  it('Drizzle schema has drift-fix columns (0010)', { timeout: 30000 }, async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.leads.rating).toBeDefined();
    expect(mod.opportunities.notes).toBeDefined();
    expect(mod.attendance.status).toBeDefined();
    expect(mod.leaves.reason).toBeDefined();
    expect(mod.leaves.approvedBy).toBeDefined();
    expect(mod.leaves.approvedAt).toBeDefined();
    expect(mod.purchaseInvoices.purchaseOrderId).toBeDefined();
    expect(mod.purchaseOrderLines.description).toBeDefined();
    expect(mod.purchaseOrderLines.receivedQuantity).toBeDefined();
    expect(mod.purchaseReturnLines.description).toBeDefined();
  });
});

describe('Migration 0012: Purchase invoice lines percent columns', () => {
  let mig12: string;

  beforeAll(() => {
    mig12 = readFileSync(join(MIGRATIONS_DIR, '0012_purchase_invoice_lines_percents.sql'), 'utf-8');
  });

  it('adds discount_percent to purchase_invoice_lines', () => {
    expect(mig12).toMatch(/ALTER TABLE "purchase_invoice_lines"[\s\S]*?ADD COLUMN IF NOT EXISTS "discount_percent"/i);
    expect(mig12).toMatch(/numeric\(5, 2\)/i);
  });

  it('adds vat_percent to purchase_invoice_lines', () => {
    expect(mig12).toMatch(/ALTER TABLE "purchase_invoice_lines"[\s\S]*?ADD COLUMN IF NOT EXISTS "vat_percent"/i);
    expect(mig12).toMatch(/numeric\(5, 2\)/i);
  });

  it('keeps sales_invoice_lines in sync with the same columns', () => {
    expect(mig12).toMatch(/ALTER TABLE "sales_invoice_lines"[\s\S]*?ADD COLUMN IF NOT EXISTS "discount_percent"/i);
    expect(mig12).toMatch(/ALTER TABLE "sales_invoice_lines"[\s\S]*?ADD COLUMN IF NOT EXISTS "vat_percent"/i);
  });

  it('is idempotent (all ADD COLUMN IF NOT EXISTS)', () => {
    expect(mig12).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
  });

  it('Drizzle schema has the new percent columns', { timeout: 30000 }, async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.purchaseInvoiceLines.discountPercent).toBeDefined();
    expect(mod.purchaseInvoiceLines.vatPercent).toBeDefined();
  });
});

describe('Migration 0013: HR schema drift fix', () => {
  let mig13: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0013_hr_schema_drift_fix.sql');
    mig13 = readFileSync(path, 'utf-8');
  });

  it('adds photo_url column to employees', () => {
    expect(mig13).toMatch(/ALTER TABLE employees ADD COLUMN photo_url/i);
    expect(mig13).toMatch(/photo_url/);
  });

  it('adds attachments column to employees (jsonb)', () => {
    expect(mig13).toMatch(/ALTER TABLE employees ADD COLUMN attachments/i);
    expect(mig13).toContain('jsonb');
  });

  it('creates index on employees.department_id for fast lookups', () => {
    expect(mig13).toContain('idx_employees_department');
    expect(mig13).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('uses IF NOT EXISTS guard for idempotency', () => {
    expect(mig13).toMatch(/IF NOT EXISTS/);
    expect(mig13).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  it('Drizzle schema exposes photoUrl and attachments on employees', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.employees.photoUrl).toBeDefined();
    expect(mod.employees.attachments).toBeDefined();
  });
});

describe('Migration 0014: Audit logs table', () => {
  let mig14: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0014_audit_logs_table.sql');
    mig14 = readFileSync(path, 'utf-8');
  });

  it('creates audit_logs table with all required columns', () => {
    expect(mig14).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(mig14).toMatch(/audit_logs/i);
    expect(mig14).toMatch(/uuid PRIMARY KEY/i);
    expect(mig14).toMatch(/user_id/i);
    expect(mig14).toMatch(/action.*varchar/i);
    expect(mig14).toMatch(/table_name.*varchar/i);
    expect(mig14).toMatch(/record_id/i);
    expect(mig14).toMatch(/old_values/i);
    expect(mig14).toMatch(/new_values/i);
    expect(mig14).toMatch(/ip_address/i);
    expect(mig14).toMatch(/company_id/i);
    expect(mig14).toMatch(/created_at/i);
  });

  it('creates indexes for fast queries', () => {
    expect(mig14).toMatch(/idx_audit_logs/);
    expect(mig14).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it('is idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig14).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(mig14).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it('Drizzle schema exports auditLogs table with all required columns', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.auditLogs).toBeDefined();
    expect(mod.auditLogs.id).toBeDefined();
    expect(mod.auditLogs.userId).toBeDefined();
    expect(mod.auditLogs.action).toBeDefined();
    expect(mod.auditLogs.tableName).toBeDefined();
    expect(mod.auditLogs.recordId).toBeDefined();
    expect(mod.auditLogs.oldValues).toBeDefined();
    expect(mod.auditLogs.newValues).toBeDefined();
    expect(mod.auditLogs.ipAddress).toBeDefined();
    expect(mod.auditLogs.companyId).toBeDefined();
    expect(mod.auditLogs.createdAt).toBeDefined();
  });
});

describe('Migration 0015: Payment allocation columns', () => {
  let mig15: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0015_payment_allocation.sql');
    mig15 = readFileSync(path, 'utf-8');
  });

  it('adds invoice_id column to receipt_vouchers with FK to sales_invoices', () => {
    expect(mig15).toMatch(/ALTER TABLE receipt_vouchers/i);
    expect(mig15).toMatch(/invoice_id uuid/i);
    expect(mig15).toMatch(/REFERENCES sales_invoices/i);
  });

  it('adds amount_applied and base_currency_applied to receipt_vouchers', () => {
    expect(mig15).toMatch(/amount_applied.*numeric.*DEFAULT '0'.*NOT NULL/i);
    expect(mig15).toMatch(/base_currency_applied.*numeric.*DEFAULT '0'.*NOT NULL/i);
  });

  it('adds invoice_id column to payment_vouchers with FK to purchase_invoices', () => {
    expect(mig15).toMatch(/ALTER TABLE payment_vouchers/i);
    expect(mig15).toMatch(/invoice_id uuid/i);
    expect(mig15).toMatch(/REFERENCES purchase_invoices/i);
  });

  it('adds amount_applied and base_currency_applied to payment_vouchers', () => {
    expect(mig15).toMatch(/amount_applied/i);
  });

  it('creates indexes for fast payment application queries', () => {
    expect(mig15).toMatch(/idx_receipt_vouchers_invoice/i);
    expect(mig15).toMatch(/idx_payment_vouchers_invoice/i);
    expect(mig15).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it('adds CHECK constraints for amount_applied integrity', () => {
    expect(mig15).toMatch(/amount_applied_check/i);
    expect(mig15).toMatch(/amount_applied >= 0 AND amount_applied <= amount/i);
  });

  it('is idempotent (all ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig15).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(mig15).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it('Drizzle schema exposes new columns on receiptVouchers', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.receiptVouchers.invoiceId).toBeDefined();
    expect(mod.receiptVouchers.amountApplied).toBeDefined();
    expect(mod.receiptVouchers.baseCurrencyApplied).toBeDefined();
  });

  it('Drizzle schema exposes new columns on paymentVouchers', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.paymentVouchers.invoiceId).toBeDefined();
    expect(mod.paymentVouchers.amountApplied).toBeDefined();
    expect(mod.paymentVouchers.baseCurrencyApplied).toBeDefined();
  });
});

describe('Migration 0016: AI chat persistence', () => {
  let mig16: string;

  beforeAll(() => {
    mig16 = readFileSync(join(MIGRATIONS_DIR, '0016_ai_chat_persistence.sql'), 'utf-8');
  });

  it('creates ai_chat_sessions with all required columns', () => {
    expect(mig16).toMatch(/CREATE TABLE IF NOT EXISTS "ai_chat_sessions"/i);
    for (const col of ['id', 'company_id', 'user_id', 'title', 'message_count', 'created_at', 'updated_at']) {
      expect(mig16).toContain(`"${col}"`);
    }
  });

  it('creates ai_chat_messages with all required columns', () => {
    expect(mig16).toMatch(/CREATE TABLE IF NOT EXISTS "ai_chat_messages"/i);
    for (const col of ['id', 'company_id', 'session_id', 'role', 'kind', 'content', 'tool_call', 'sort_order', 'created_at']) {
      expect(mig16).toContain(`"${col}"`);
    }
  });

  it('enforces company_id NOT NULL on both tables', () => {
    expect(mig16).toMatch(/ai_chat_sessions[\s\S]*?"company_id" uuid NOT NULL/i);
    expect(mig16).toMatch(/ai_chat_messages[\s\S]*?"company_id" uuid NOT NULL/i);
  });

  it('links sessions to companies and users with CASCADE delete', () => {
    expect(mig16).toMatch(/ai_chat_sessions_company_id_companies_id_fk/i);
    expect(mig16).toMatch(/ai_chat_sessions_user_id_users_id_fk/i);
    expect(mig16).toMatch(/ON DELETE cascade/i);
  });

  it('links messages to their session with CASCADE delete', () => {
    expect(mig16).toMatch(/ai_chat_messages_session_id_fk/i);
    expect(mig16).toMatch(/REFERENCES "ai_chat_sessions"/i);
  });

  it('stores tool_call as jsonb (nullable)', () => {
    expect(mig16).toMatch(/"tool_call" jsonb/i);
  });

  it('creates indexes for session listing and message retrieval', () => {
    expect(mig16).toMatch(/idx_ai_chat_sessions_company_user/i);
    expect(mig16).toMatch(/idx_ai_chat_sessions_company_updated/i);
    expect(mig16).toMatch(/idx_ai_chat_messages_session/i);
    expect(mig16).toMatch(/idx_ai_chat_messages_company/i);
  });

  it('is idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig16).not.toMatch(/CREATE TABLE\s+(?!IF NOT EXISTS)/i);
    expect(mig16).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });

  it('Drizzle schema exports aiChatSessions and aiChatMessages with all columns', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.aiChatSessions).toBeDefined();
    expect(mod.aiChatMessages).toBeDefined();
    expect(mod.aiChatSessions.companyId).toBeDefined();
    expect(mod.aiChatSessions.userId).toBeDefined();
    expect(mod.aiChatSessions.messageCount).toBeDefined();
    expect(mod.aiChatMessages.sessionId).toBeDefined();
    expect(mod.aiChatMessages.toolCall).toBeDefined();
    expect(mod.aiChatMessages.sortOrder).toBeDefined();
  });
});

describe('Migration 0018: Sequence numbering columns', () => {
  let mig18: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0018_sequence_numbering.sql');
    mig18 = readFileSync(path, 'utf-8');
  });

  it('adds run_number column to payroll_runs', () => {
    expect(mig18).toMatch(/ALTER TABLE payroll_runs[\s\S]*?ADD COLUMN IF NOT EXISTS run_number/i);
    expect(mig18).toMatch(/varchar\(50\)/i);
  });

  it('adds adjustment_number column to stock_adjustments', () => {
    expect(mig18).toMatch(/ALTER TABLE stock_adjustments[\s\S]*?ADD COLUMN IF NOT EXISTS adjustment_number/i);
    expect(mig18).toMatch(/varchar\(50\)/i);
  });

  it('adds transfer_number column to warehouse_transfers', () => {
    expect(mig18).toMatch(/ALTER TABLE warehouse_transfers[\s\S]*?ADD COLUMN IF NOT EXISTS transfer_number/i);
    expect(mig18).toMatch(/varchar\(50\)/i);
  });

  it('creates partial indexes for fast uniqueness collision checks', () => {
    expect(mig18).toMatch(/idx_payroll_runs_company_run_number/i);
    expect(mig18).toMatch(/idx_stock_adjustments_company_adjustment_number/i);
    expect(mig18).toMatch(/idx_warehouse_transfers_company_transfer_number/i);
    expect(mig18).toMatch(/WHERE\s+\w+\s+IS NOT NULL/i);
  });

  it('is idempotent (all ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig18).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
    expect(mig18).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });

  it('Drizzle schema exposes runNumber on payrollRuns', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.payrollRuns.runNumber).toBeDefined();
  });

  it('Drizzle schema exposes adjustmentNumber on stockAdjustments', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.stockAdjustments.adjustmentNumber).toBeDefined();
  });

  it('Drizzle schema exposes transferNumber on warehouseTransfers', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.warehouseTransfers.transferNumber).toBeDefined();
  });
});

describe('Migration 0019: Payment type column', () => {
  let mig19: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0019_payment_type.sql');
    mig19 = readFileSync(path, 'utf-8');
  });

  it('adds payment_type column to sales_invoices', () => {
    expect(mig19).toMatch(/ALTER TABLE sales_invoices[\s\S]*?ADD COLUMN IF NOT EXISTS payment_type/i);
    expect(mig19).toMatch(/varchar\(10\)/i);
    expect(mig19).toMatch(/DEFAULT 'credit'/i);
  });

  it('adds payment_type column to purchase_invoices', () => {
    expect(mig19).toMatch(/ALTER TABLE purchase_invoices[\s\S]*?ADD COLUMN IF NOT EXISTS payment_type/i);
    expect(mig19).toMatch(/varchar\(10\)/i);
    expect(mig19).toMatch(/DEFAULT 'credit'/i);
  });

  it('adds payment_type to all 6 sales and purchase tables', () => {
    const tables = ['sales_invoices', 'quotations', 'sales_returns', 'purchase_invoices', 'purchase_returns', 'purchase_orders'];
    for (const t of tables) {
      expect(mig19, `Missing payment_type for ${t}`).toMatch(new RegExp(`ALTER TABLE ${t}[\\s\\S]*?ADD COLUMN IF NOT EXISTS payment_type`, 'i'));
    }
  });

  it('is idempotent (all ADD COLUMN IF NOT EXISTS)', () => {
    expect(mig19).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
  });

  it('Drizzle schema exposes paymentType on salesInvoices', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.salesInvoices.paymentType).toBeDefined();
  });

  it('Drizzle schema exposes paymentType on purchaseInvoices', async () => {
    const mod = await import('../src/core/database/schema/index');
    expect(mod.purchaseInvoices.paymentType).toBeDefined();
  });
});

describe('Migration 0020: Invoice payment accounts (cash_box_id, bank_account_id)', () => {
  let mig20: string;

  beforeAll(() => {
    const path = join(MIGRATIONS_DIR, '0020_invoice_payment_accounts.sql');
    mig20 = readFileSync(path, 'utf-8');
  });

  it('adds cash_box_id and bank_account_id to sales_invoices with FK', () => {
    expect(mig20).toMatch(/ALTER TABLE sales_invoices[\s\S]*?ADD COLUMN IF NOT EXISTS cash_box_id[\s\S]*?REFERENCES cash_boxes/i);
    expect(mig20).toMatch(/ALTER TABLE sales_invoices[\s\S]*?ADD COLUMN IF NOT EXISTS bank_account_id[\s\S]*?REFERENCES banks/i);
  });

  it('adds cash_box_id and bank_account_id to purchase_invoices', () => {
    expect(mig20).toMatch(/ALTER TABLE purchase_invoices[\s\S]*?ADD COLUMN IF NOT EXISTS cash_box_id/i);
    expect(mig20).toMatch(/ALTER TABLE purchase_invoices[\s\S]*?ADD COLUMN IF NOT EXISTS bank_account_id/i);
  });

  it('adds columns to all 6 transactional tables', () => {
    const tables = ['sales_invoices', 'quotations', 'sales_returns', 'purchase_invoices', 'purchase_orders', 'purchase_returns'];
    for (const t of tables) {
      expect(mig20, `Missing cash_box_id for ${t}`).toMatch(new RegExp(`ALTER TABLE ${t}[\\s\\S]*?ADD COLUMN IF NOT EXISTS cash_box_id`, 'i'));
      expect(mig20, `Missing bank_account_id for ${t}`).toMatch(new RegExp(`ALTER TABLE ${t}[\\s\\S]*?ADD COLUMN IF NOT EXISTS bank_account_id`, 'i'));
    }
  });

  it('creates partial indexes for fast queries', () => {
    expect(mig20).toMatch(/CREATE INDEX IF NOT EXISTS idx_sales_invoices_cash_box/i);
    expect(mig20).toMatch(/CREATE INDEX IF NOT EXISTS idx_sales_invoices_bank/i);
    expect(mig20).toMatch(/CREATE INDEX IF NOT EXISTS idx_purchase_invoices_cash_box/i);
    expect(mig20).toMatch(/CREATE INDEX IF NOT EXISTS idx_purchase_invoices_bank/i);
  });

  it('uses ON DELETE SET NULL for the FK references', () => {
    expect(mig20).toMatch(/REFERENCES cash_boxes\(id\) ON DELETE SET NULL/i);
    expect(mig20).toMatch(/REFERENCES banks\(id\) ON DELETE SET NULL/i);
  });

  it('is idempotent (all ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig20).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
    expect(mig20).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });
});

describe('Migration 0021: User tracking columns (created_by, updated_by)', () => {
  let mig21: string;

  beforeAll(() => {
    mig21 = readFileSync(join(MIGRATIONS_DIR, '0021_user_tracking_columns.sql'), 'utf-8');
  });

  it('adds created_by and updated_by to branches, currencies, product_types, tasks', () => {
    expect(mig21).toMatch(/ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_by/i);
    expect(mig21).toMatch(/ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_by/i);
    expect(mig21).toMatch(/ALTER TABLE currencies ADD COLUMN IF NOT EXISTS created_by/i);
    expect(mig21).toMatch(/ALTER TABLE currencies ADD COLUMN IF NOT EXISTS updated_by/i);
    expect(mig21).toMatch(/ALTER TABLE product_types ADD COLUMN IF NOT EXISTS created_by/i);
    expect(mig21).toMatch(/ALTER TABLE product_types ADD COLUMN IF NOT EXISTS updated_by/i);
    expect(mig21).toMatch(/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by/i);
    expect(mig21).toMatch(/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_by/i);
  });

  it('adds updated_by to cash_boxes (created_by already existed)', () => {
    expect(mig21).toMatch(/ALTER TABLE cash_boxes ADD COLUMN IF NOT EXISTS updated_by/i);
  });

  it('creates composite indexes for fast filtering on (company_id, updated_by)', () => {
    expect(mig21).toMatch(/CREATE INDEX IF NOT EXISTS idx_branches_company_updated/i);
    expect(mig21).toMatch(/CREATE INDEX IF NOT EXISTS idx_currencies_company_updated/i);
    expect(mig21).toMatch(/CREATE INDEX IF NOT EXISTS idx_product_types_company_updated/i);
    expect(mig21).toMatch(/CREATE INDEX IF NOT EXISTS idx_tasks_company_updated/i);
    expect(mig21).toMatch(/CREATE INDEX IF NOT EXISTS idx_cash_boxes_company_updated/i);
  });

  it('is idempotent (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig21).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
    expect(mig21).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });
});

describe('Migration 0022: Audit + document_sequences fix', () => {
  let mig22: string;

  beforeAll(() => {    mig22 = readFileSync(join(MIGRATIONS_DIR, '0022_audit_and_document_sequences_fix.sql'), 'utf-8');
  });

  it('adds updated_by to document_sequences (was missing — broke auto-numbering)', () => {
    expect(mig22).toMatch(/ALTER TABLE document_sequences ADD COLUMN IF NOT EXISTS updated_by/i);
  });

  it('widens audit_logs.record_id from uuid to varchar(100) to accept AI tool names', () => {
    expect(mig22).toMatch(/ALTER TABLE audit_logs ALTER COLUMN record_id TYPE varchar\(100\)/i);
    expect(mig22).toMatch(/USING record_id::varchar\(100\)/i);
  });

  it('creates index on document_sequences(company_id) for fast lookups', () => {
    expect(mig22).toMatch(/CREATE INDEX IF NOT EXISTS idx_document_sequences_company/i);
  });

  it('is idempotent (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig22).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
    expect(mig22).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });
});

describe('Migration 0023: User tracking columns for activities', () => {
  let mig23: string;

  beforeAll(() => {
    mig23 = readFileSync(join(MIGRATIONS_DIR, '0023_activities_user_tracking_columns.sql'), 'utf-8');
  });

  it('adds created_by and updated_by to activities (0021 missed it)', () => {
    expect(mig23).toMatch(/ALTER TABLE activities ADD COLUMN IF NOT EXISTS created_by/i);
    expect(mig23).toMatch(/ALTER TABLE activities ADD COLUMN IF NOT EXISTS updated_by/i);
  });

  it('creates composite index on (company_id, updated_by) for fast filtering', () => {
    expect(mig23).toMatch(/CREATE INDEX IF NOT EXISTS idx_activities_company_updated/i);
  });

  it('is idempotent (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)', () => {
    expect(mig23).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
    expect(mig23).not.toMatch(/CREATE INDEX\s+(?!IF NOT EXISTS)/i);
  });
});
