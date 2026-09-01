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

  it('later migrations are additive except the documented retirements', () => {
    // 0002 is a deliberate, documented removal: banks unify into cash boxes
    // ("النقدية والخزائن"). 0015 retires the dead CRM tables (crm_activities +
    // calls — no application code reads or writes them; the codebase settled
    // on `activities` for the event log and `tasks` for work items).
    // Nothing ELSE may be dropped.
    const RETIRED = new Set(['banks', 'crm_activities', 'calls']);
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

describe('Migration 0007: work-order WIP accounting', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0007_wo_wip_accounting.sql'), 'utf-8');

  it('adds wip_materials_cost to work_orders (amount debited to WIP at START)', () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS "wip_materials_cost" numeric\(18,4\) NOT NULL DEFAULT 0/);
  });

  it('creates the WIP account 11302 under inventory group 113 for every company', () => {
    expect(migrationSql).toMatch(/'11302'/);
    expect(migrationSql).toMatch(/p\.code = '113'/);
  });

  it('creates the production-loss account 53501 under group 53 for every company', () => {
    expect(migrationSql).toMatch(/'53501'/);
    expect(migrationSql).toMatch(/p\.code = '53'/);
  });

  it('is idempotent (IF NOT EXISTS everywhere)', () => {
    expect(migrationSql.match(/ADD COLUMN IF NOT EXISTS/g)?.length).toBe(1);
    expect(migrationSql.match(/WHERE NOT EXISTS/g)?.length).toBe(2);
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  it('Drizzle schema exposes wipMaterialsCost on workOrders', () => {
    const schema = readFileSync(join(process.cwd(), 'src/core/database/schema/manufacturing.ts'), 'utf-8');
    expect(schema).toMatch(/wipMaterialsCost: numeric\('wip_materials_cost'/);
  });
});

describe('Migration 0013: opening-balance dates (statements & aging completeness)', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0013_opening_balance_dates.sql'), 'utf-8');

  it('adds opening_date to customers, suppliers, employees and accounts', () => {
    for (const table of ['customers', 'suppliers', 'employees', 'accounts']) {
      expect(migrationSql).toMatch(new RegExp(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "opening_date" date`));
    }
  });

  it('is purely additive and idempotent (IF NOT EXISTS everywhere)', () => {
    expect(migrationSql.match(/ADD COLUMN/g)?.length).toBe(4);
    expect(migrationSql.match(/ADD COLUMN IF NOT EXISTS/g)?.length).toBe(4);
    expect(migrationSql).not.toMatch(/DROP|DELETE/i);
  });

  it('journal entry mirrors the migration files', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    expect(journal.entries.some((e) => e.tag === '0013_opening_balance_dates')).toBe(true);
    expect(journal.entries.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length);
  });

  it('Drizzle schema exposes openingDate on all four tables', () => {
    const sales = readFileSync(join(process.cwd(), 'src/core/database/schema/sales.ts'), 'utf-8');
    const purchases = readFileSync(join(process.cwd(), 'src/core/database/schema/purchases.ts'), 'utf-8');
    const hr = readFileSync(join(process.cwd(), 'src/core/database/schema/hr.ts'), 'utf-8');
    const accounting = readFileSync(join(process.cwd(), 'src/core/database/schema/accounting.ts'), 'utf-8');
    expect(sales).toMatch(/openingDate: date\('opening_date'\)/);
    expect(purchases).toMatch(/openingDate: date\('opening_date'\)/);
    expect(hr).toMatch(/openingDate: date\('opening_date'\)/);
    expect(accounting).toMatch(/openingDate: date\('opening_date'\)/);
  });
});

describe('Migration 0014: HR professional (payroll posting accounts & policies)', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0014_hr_professional.sql'), 'utf-8');

  it('creates payroll/EOS chart accounts for every company', () => {
    // 215 group + children + 52501 expense
    for (const code of ['215', '21501', '21502', '21503', '52501']) {
      expect(migrationSql).toMatch(new RegExp(`'${code}'`));
    }
    // children post to group 215, expense posts to 52
    expect(migrationSql).toMatch(/'215',\s*'مستحقات الموظفين'/);
  });

  it('links default_accounts keys for payroll/EOS posting', () => {
    for (const key of ['default_salaries_payable', 'default_payroll_deductions', 'default_eos_payable', 'default_eos_expense']) {
      expect(migrationSql).toMatch(new RegExp(key));
    }
  });

  it('adds EOS payment columns and payroll overtime-hours traceability', () => {
    expect(migrationSql).toMatch(/end_of_service ADD COLUMN IF NOT EXISTS cash_box_id uuid/);
    expect(migrationSql).toMatch(/end_of_service ADD COLUMN IF NOT EXISTS paid_at timestamptz/);
    expect(migrationSql).toMatch(/payroll_lines ADD COLUMN IF NOT EXISTS overtime_hours numeric\(5,2\) DEFAULT 0/);
  });

  it('adds unique constraints: attendance per employee/day + payroll period', () => {
    expect(migrationSql).toMatch(/uq_attendance_emp_date/);
    expect(migrationSql).toMatch(/uq_payroll_runs_period/);
    // Attendance: constraint form; payroll: PARTIAL unique index (WHERE clause)
    expect(migrationSql).toMatch(/ADD CONSTRAINT uq_attendance_emp_date\s+UNIQUE \(company_id, employee_id, date\)/);
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX uq_payroll_runs_period[\s\S]*?WHERE status IN \('draft', 'posted'\)/);
    // Both guarded by existence checks
    expect(migrationSql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_(?:constraint|indexes) WHERE (?:conname|indexname) = /g)?.length).toBe(2);
  });

  it('dedupes attendance and cancels duplicate payroll periods before constraining', () => {
    expect(migrationSql).toMatch(/DELETE FROM attendance a/);
    expect(migrationSql).toMatch(/SET status = 'cancelled'/);
  });

  it('seeds HR policy settings for every company', () => {
    for (const key of [
      'hr.leave.annualDays', 'hr.leave.sickDays', 'hr.leave.emergencyDays',
      'hr.overtimeRate', 'hr.standardWorkHours', 'hr.lateGraceMinutes',
      'hr.eos.firstYearsMultiplier', 'hr.eos.beyondYearsMultiplier',
      'hr.payroll.grossUpPosting',
    ]) {
      expect(migrationSql).toMatch(new RegExp(key.replace(/\./g, '\\.')));
    }
  });

  it('is idempotent (WHERE NOT EXISTS / IF NOT EXISTS / DO guards)', () => {
    expect(migrationSql.match(/ADD COLUMN IF NOT EXISTS/g)?.length).toBe(3);
    expect(migrationSql.match(/WHERE NOT EXISTS/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
  });

  it('journal mirrors the migration files (0015 is last)', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    const last = journal.entries[journal.entries.length - 1];
    expect(journal.entries.some((e) => e.tag === '0015_crm_professional')).toBe(true);
    expect(journal.entries.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length);
  });

  it('Drizzle schema exposes cashBoxId/paidAt/overtimeHours', () => {
    const hr = readFileSync(join(process.cwd(), 'src/core/database/schema/hr.ts'), 'utf-8');
    expect(hr).toMatch(/overtimeHours: numeric\('overtime_hours', \{ precision: 5, scale: 2 \}\)/);
    expect(hr).toMatch(/cashBoxId: uuid\('cash_box_id'\)/);
    expect(hr).toMatch(/paidAt: timestamp\('paid_at', \{ withTimezone: true \}\)/);
  });
});

describe('Migration 0015: CRM professional (integrity + performance + stage machine)', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0015_crm_professional.sql'), 'utf-8');

  it('drops the dead CRM tables (crm_activities + calls)', () => {
    expect(migrationSql).toMatch(/DROP TABLE IF EXISTS "crm_activities"/);
    expect(migrationSql).toMatch(/DROP TABLE IF EXISTS "calls"/);
  });

  it('cleans orphans BEFORE adding FKs (SET NULL dangling references)', () => {
    const orphanUpdates = migrationSql.match(/^UPDATE "(?:opportunities|tasks|activities)"/gm) ?? [];
    expect(orphanUpdates.length).toBe(8);
    // every cleanup statement nulls the reference only when the target row is missing
    expect(migrationSql).toMatch(/UPDATE "opportunities" o SET "lead_id" = NULL[\s\S]*?NOT EXISTS \(SELECT 1 FROM "leads" l WHERE l\."id" = o\."lead_id"\)/);
  });

  it('adds FKs ON DELETE SET NULL for all 8 cross-entity references', () => {
    const fks: Array<[string, string, string]> = [
      ['opportunities', 'fk_opportunities_lead', 'leads'],
      ['opportunities', 'fk_opportunities_customer', 'customers'],
      ['tasks', 'fk_tasks_opportunity', 'opportunities'],
      ['tasks', 'fk_tasks_lead', 'leads'],
      ['tasks', 'fk_tasks_customer', 'customers'],
      ['activities', 'fk_activities_opportunity', 'opportunities'],
      ['activities', 'fk_activities_lead', 'leads'],
      ['activities', 'fk_activities_customer', 'customers'],
    ];
    for (const [table, conname, ref] of fks) {
      expect(migrationSql).toMatch(
        new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${conname}"[\\s\\S]*?FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "${ref}"\\("id"\\) ON DELETE SET NULL`)
      );
    }
    // all guarded by pg_constraint existence checks
    expect(migrationSql.match(/SELECT 1 FROM pg_constraint WHERE conname = /g)?.length).toBe(8);
  });

  it('creates the 6 performance indexes (company_id composite)', () => {
    for (const idx of [
      'idx_leads_company_status', 'idx_leads_company_created',
      'idx_opportunities_company_stage', 'idx_opportunities_company_close',
      'idx_tasks_company_status_due', 'idx_activities_company_date',
    ]) {
      expect(migrationSql).toMatch(new RegExp(`CREATE INDEX IF NOT EXISTS "${idx}"`));
    }
  });

  it('adds close_date (opportunities) and last_contacted_at (leads)', () => {
    expect(migrationSql).toMatch(/ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "close_date" date/);
    expect(migrationSql).toMatch(/ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_contacted_at" timestamp with time zone/);
  });

  it('is idempotent (IF NOT EXISTS everywhere, FKs in DO guards)', () => {
    expect(migrationSql.match(/ADD COLUMN IF NOT EXISTS/g)?.length).toBe(2);
    expect(migrationSql.match(/CREATE INDEX IF NOT EXISTS/g)?.length).toBe(6);
    expect(migrationSql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)?.length).toBe(8);
  });

  it('journal entry mirrors the migration files (0015 last)', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    const entry = journal.entries.find((e) => e.tag === '0015_crm_professional');
    expect(entry?.idx).toBe(15);
    expect(journal.entries.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length);
  });

  it('Drizzle schema no longer exports the dead tables and exposes the new columns', () => {
    const schema = readFileSync(join(process.cwd(), 'src/core/database/schema/crm.ts'), 'utf-8');
    expect(schema).not.toMatch(/export const crmActivities/);
    expect(schema).not.toMatch(/export const calls/);
    expect(schema).toMatch(/closeDate: date\('close_date'\)/);
    expect(schema).toMatch(/lastContactedAt: timestamp\('last_contacted_at', \{ withTimezone: true \}\)/);
  });

  it('whitelists no longer reference the dead tables', () => {
    const dbHandler = readFileSync(join(process.cwd(), 'electron/dbHandler.js'), 'utf-8');
    const sqlGuard = readFileSync(join(process.cwd(), 'src/modules/ai/security/sqlGuard.ts'), 'utf-8');
    const pglite = readFileSync(join(process.cwd(), 'src/core/database/adapters/pgliteAdapter.ts'), 'utf-8');
    const reset = readFileSync(join(process.cwd(), 'electron/resetDatabase.js'), 'utf-8');
    for (const f of [dbHandler, sqlGuard, pglite, reset]) {
      expect(f).not.toMatch(/['"]crm_activities['"]/);
      expect(f).not.toMatch(/['"]calls['"]/);
    }
  });
});

describe('Migration 0016: HR attendance & payroll notes (v0.8.1)', () => {
  const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0016_hr_attendance_notes.sql'), 'utf-8');

  it('makes attendance.check_in nullable (absent/on_leave days carry no punch)', () => {
    expect(migrationSql).toMatch(/ALTER TABLE attendance ALTER COLUMN check_in DROP NOT NULL/);
    // Guarded on is_nullable — idempotent re-runs are safe
    expect(migrationSql).toMatch(/is_nullable = 'NO'/);
  });

  it('adds payroll_runs.notes', () => {
    expect(migrationSql).toMatch(/ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS notes text/);
  });

  it('is purely additive/idempotent (no DROP TABLE, guards on both steps)', () => {
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
    expect(migrationSql.match(/IF NOT EXISTS|is_nullable/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('Drizzle schema exposes nullable checkIn + payroll notes', () => {
    const hr = readFileSync(join(process.cwd(), 'src/core/database/schema/hr.ts'), 'utf-8');
    // Nullable checkIn: no .notNull() on the checkIn column line
    const checkInLine = hr.split('\n').find((l) => l.includes("timestamp('check_in')"));
    expect(checkInLine).toBeDefined();
    expect(checkInLine).not.toContain('.notNull()');
    expect(hr).toMatch(/notes: text\('notes'\)/);
  });

  it('journal registers 0016 as the last entry', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8'));
    const last = journal.entries[journal.entries.length - 1];
    expect(last.tag).toBe('0016_hr_attendance_notes');
    expect(last.idx).toBe(16);
    expect(journal.entries.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length);
  });

  it('pgliteAdapter registers 0016 in its hand-maintained MIGRATIONS list', () => {
    const pglite = readFileSync(join(process.cwd(), 'src/core/database/adapters/pgliteAdapter.ts'), 'utf-8');
    expect(pglite).toMatch(/0016_hr_attendance_notes\.sql\?raw/);
    expect(pglite).toMatch(/\{ name: '0016_hr_attendance_notes', sql: hrAttendanceNotes \}/);
  });
});
