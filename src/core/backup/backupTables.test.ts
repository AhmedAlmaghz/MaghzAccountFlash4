import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_PLANNED_TABLES,
  CHILD_TABLES,
  DELETE_ORDER,
  INSERT_ORDER,
  RETIRED_TABLES,
  buildBackupFileName,
  isSafeIdentifier,
} from './backupTables';

function drizzleTables(): Set<string> {
  const dir = join(process.cwd(), 'drizzle');
  const tables = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, f), 'utf-8');
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"? \(/g)) {
      tables.add(m[1]);
    }
  }
  return tables;
}

describe('backup plan integrity', () => {
  it('covers every live table exactly once (no retired tables)', () => {
    const live = drizzleTables();
    for (const retired of RETIRED_TABLES) live.delete(retired);
    // __pglite_migrations bookkeeping is not business data
    live.delete('__pglite_migrations');
    const planned = new Set(ALL_PLANNED_TABLES);
    expect(new Set([...planned].filter((t) => RETIRED_TABLES.includes(t))).size).toBe(0);
    const missing = [...live].filter((t) => !planned.has(t));
    const extra = [...planned].filter((t) => !live.has(t));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('child tables reference planned parents with safe identifiers', () => {
    const planned = new Set(ALL_PLANNED_TABLES);
    for (const child of CHILD_TABLES) {
      expect(child.scope.type).toBe('children');
      if (child.scope.type !== 'children') continue;
      expect(planned.has(child.scope.parent)).toBe(true);
      expect(isSafeIdentifier(child.table)).toBe(true);
      expect(isSafeIdentifier(child.scope.parent)).toBe(true);
      expect(isSafeIdentifier(child.scope.fk)).toBe(true);
    }
  });

  it('insert order covers exactly the planned tables, companies first', () => {
    expect(INSERT_ORDER[0].table).toBe('companies');
    expect(DELETE_ORDER[DELETE_ORDER.length - 1].table).toBe('companies');
    expect(new Set(INSERT_ORDER.map((p) => p.table))).toEqual(new Set(ALL_PLANNED_TABLES));
  });

  it('insert order respects live foreign keys (referenced before referencing)', () => {
    const pos = new Map(INSERT_ORDER.map((p, i) => [p.table, i]));
    const before = (first: string, second: string) => {
      expect(pos.get(first)).toBeLessThan(pos.get(second) ?? -1);
    };
    // SET NULL on delete still enforces existence on insert
    before('leads', 'opportunities');
    before('opportunities', 'tasks');
    before('opportunities', 'activities');
    before('customers', 'opportunities');
    before('users', 'leads');
    before('sales_invoices', 'sales_returns');
    before('purchase_orders', 'purchase_invoices');
    before('purchase_invoices', 'purchase_returns');
    before('transactions', 'journal_entries');
    before('ai_chat_sessions', 'ai_chat_messages');
    before('accounts', 'cash_boxes');
    before('accounts', 'default_accounts');
    before('accounts', 'payroll_components');
    before('accounts', 'product_types');
    before('accounts', 'journal_entries');
    before('departments', 'employees');
    before('employees', 'work_orders');
    before('products', 'boms');
    before('boms', 'work_orders');
    before('products', 'sales_invoice_lines');
    before('product_categories', 'products');
    before('product_types', 'products');
    // detail tables go last
    for (const child of [
      'sales_invoice_lines',
      'purchase_order_lines',
      'bom_lines',
      'work_order_consumptions',
      'payroll_lines',
      'product_product_categories',
    ]) {
      expect(pos.get(child)).toBeGreaterThan(pos.get('audit_logs') ?? -1);
    }
  });

  it('journal entries delete before transactions (FK safety)', () => {
    const tables = DELETE_ORDER.map((p) => p.table);
    expect(tables.indexOf('journal_entries')).toBeLessThan(tables.indexOf('transactions'));
  });

  it('documents delete before the masters they reference', () => {
    const tables = DELETE_ORDER.map((p) => p.table);
    for (const [doc, master] of [
      ['sales_invoices', 'customers'],
      ['purchase_invoices', 'suppliers'],
      ['sales_invoice_lines', 'products'],
      ['work_orders', 'boms'],
      ['boms', 'products'],
      ['employees', 'departments'],
      ['stock', 'warehouses'],
    ] as const) {
      expect(tables.indexOf(doc)).toBeLessThan(tables.indexOf(master));
    }
  });

  it('isSafeIdentifier rejects hostile input', () => {
    expect(isSafeIdentifier('customers')).toBe(true);
    expect(isSafeIdentifier('sales_invoice_lines')).toBe(true);
    expect(isSafeIdentifier('users; DROP TABLE users')).toBe(false);
    expect(isSafeIdentifier('a"b')).toBe(false);
    expect(isSafeIdentifier('UPPER')).toBe(false);
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('buildBackupFileName is filesystem-safe and carries the extension', () => {
    const name = buildBackupFileName('شركة الأمل / للتجارة؟', new Date('2026-09-04T10:00:00Z'));
    expect(name.endsWith('.mab')).toBe(true);
    expect(name).not.toMatch(/[/\\?]/);
    expect(name).toContain('2026-09-04');
  });
});

describe('main-process parity (electron/dbHandler.js BACKUP_PLAN)', () => {
  it('covers the same table set in the same delete order', () => {
    const handler = readFileSync(join(process.cwd(), 'electron/dbHandler.js'), 'utf-8');
    // BACKUP_PLAN is a JS literal (unquoted keys) — extract table names.
    const block = handler.match(/const BACKUP_PLAN = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const tables = [...block![1].matchAll(/table: '([\w]+)'/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(50);
    expect(tables).toEqual(DELETE_ORDER.map((p) => p.table));
  });

  it('mirrors the explicit INSERT order too', () => {
    const handler = readFileSync(join(process.cwd(), 'electron/dbHandler.js'), 'utf-8');
    const block = handler.match(/const BACKUP_INSERT_ORDER = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const tables = [...block![1].matchAll(/'([\w]+)'/g)].map((m) => m[1]);
    expect(tables).toEqual(INSERT_ORDER.map((p) => p.table));
  });
});
