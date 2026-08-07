/**
 * Tests for seedDemoData.js
 *
 * We mock the pg client with a simple query recorder.
 * Assertions focus on:
 *   - All expected tables appear in INSERTs
 *   - WHERE NOT EXISTS guards are present (idempotency)
 *   - Account code 5-digit pattern (not 6-digit)
 *   - Cross-table IDs are threaded correctly
 *   - The function is safe to call twice (no duplicate rows)
 *
 * For the idempotency test we use a minimal state-tracking mock
 * (just enough to verify guards work).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Simple recording mock ─────────────────────────────────────────────────
function makeRecordingClient() {
  const calls = [];
  let counter = 0;
  return {
    query: vi.fn(async (sql, params = []) => {
      const trimmed = sql.trim();
      calls.push({ sql: trimmed, params });
      // Return an id for INSERT...RETURNING to mimic a real INSERT
      if (/^INSERT\s+INTO/i.test(trimmed) && /RETURNING\s+id/i.test(trimmed)) {
        return { rows: [{ id: `id-rec-${++counter}` }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    _calls: calls,
  };
}

// ─── Minimal state-tracking mock (for idempotency) ─────────────────────────
function makeStatefulClient() {
  const tables = new Map();
  const calls = [];

  function getOrCreate(table) {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  }

  return {
    query: vi.fn(async (sql, params = []) => {
      const trimmed = sql.trim();
      calls.push({ sql: trimmed, params });

      // Detect INSERT INTO <table> [cols] SELECT ... WHERE NOT EXISTS
      const notExists = trimmed.match(
        /INSERT INTO\s+(\w+)[\s\S]+?WHERE NOT EXISTS\s*\(\s*SELECT 1 FROM\s+(\w+)\s+WHERE\s+([^)]+)\)/i,
      );

      if (notExists) {
        if (notExists[1] === 'product_product_categories') {
          // debug
        }
        const target = notExists[1];
        const guardTable = notExists[2];
        const guardWhere = notExists[3];
        const guardCols = [];
        const colRe = /(\w+)\s*=\s*\$(\d+)/g;
        let mm;
        while ((mm = colRe.exec(guardWhere)) !== null) {
          guardCols.push({ col: mm[1], idx: parseInt(mm[2], 10) - 1 });
        }
        const guardRows = getOrCreate(guardTable);
        const exists = guardRows.some((r) =>
          guardCols.every((c) => r[c.col] === params[c.idx]),
        );
        if (exists) {
          return { rows: [], rowCount: 0 };
        }
        // Save the row with the guard column values for future checks
        const id = `id-${Math.random().toString(36).slice(2, 10)}`;
        const row = { id };
        for (const gc of guardCols) {
          row[gc.col] = params[gc.idx];
        }
        getOrCreate(target).push(row);
        return { rows: [{ id }], rowCount: 1 };
      }

      // Plain INSERT
      const ins = trimmed.match(/^INSERT INTO\s+(\w+)/i);
      if (ins) {
        const id = `id-${Math.random().toString(36).slice(2, 10)}`;
        const row = { id };
        // Store column values (params + literals) so later SELECTs can find them
        const colsMatch = trimmed.match(/INSERT INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+?)\)/i);
        if (colsMatch) {
          const cols = colsMatch[1].split(',').map((c) => c.trim());
          let inQuote = false;
          const rawVals = [];
          let cur = '';
          for (const ch of colsMatch[2]) {
            if (ch === "'") inQuote = !inQuote;
            if (ch === ',' && !inQuote) {
              rawVals.push(cur.trim());
              cur = '';
              continue;
            }
            cur += ch;
          }
          rawVals.push(cur.trim());
          rawVals.forEach((v, i) => {
            const col = cols[i];
            if (v.startsWith('$')) {
              const idx = parseInt(v.slice(1), 10) - 1;
              if (idx >= 0 && idx < params.length) row[col] = params[idx];
            } else if (v === 'TRUE') {
              row[col] = true;
            } else if (v === 'FALSE') {
              row[col] = false;
            } else if (v === 'NULL') {
              row[col] = null;
            } else {
              row[col] = v.replace(/^'(.*)'$/, '$1');
            }
          });
        }
        getOrCreate(ins[1]).push(row);
        return { rows: [{ id }], rowCount: 1 };
      }

      // SELECT id, ... FROM <table> WHERE <col> = $1 [AND ...] [ORDER BY ...] [LIMIT N]
      const sel = trimmed.match(/SELECT\s+(?:id,\s*\w+|id)\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
      if (sel) {
        const table = sel[1];
        const col = sel[2];
        const idx = parseInt(sel[3], 10) - 1;
        const rows = getOrCreate(table);
        const found = rows.find((r) => r[col] === params[idx]);
        return { rows: found ? [{ id: found.id, code: found.code }] : [], rowCount: found ? 1 : 0 };
      }

      // SELECT id FROM <table> WHERE company_id = $1 [AND ...]
      const selMulti = trimmed.match(/SELECT\s+id\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
      if (selMulti) {
        const table = selMulti[1];
        const col = selMulti[2];
        const idx = parseInt(selMulti[3], 10) - 1;
        const rows = getOrCreate(table);
        const found = rows.find((r) => r[col] === params[idx]);
        return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    }),
    _calls: calls,
    _tables: tables,
  };
}

let seedModule;

beforeEach(async () => {
  vi.resetModules();
  seedModule = await import('./seedDemoData.js');
});

describe('seedDemoData', () => {
  it('exports a single function', () => {
    expect(typeof seedModule.seedComprehensiveDemoData).toBe('function');
  });

  it('issues INSERTs to all expected tables', async () => {
    const client = makeStatefulClient();
    const companyId = 'c-test-1';
    await seedModule.seedComprehensiveDemoData(client, companyId);

    const calls = client._calls;
    const insertedTables = new Set();
    for (const c of calls) {
      const m = c.sql.match(/^INSERT INTO\s+(\w+)/i);
      if (m) insertedTables.add(m[1].toLowerCase());
    }

    // Master data (always seeded)
    const masterExpected = [
      'branches', 'accounts', 'product_types', 'units',
      'currencies', 'cost_centers', 'banks', 'cash_boxes',
      'product_categories', 'products', 'warehouses', 'customers',
      'suppliers', 'departments', 'employees', 'payroll_components',
      'payroll_lines', 'payroll_runs', 'leads', 'opportunities',
      'stock', 'stock_movements',
      'sales_invoices', 'sales_invoice_lines', 'purchase_orders',
      'purchase_order_lines', 'purchase_invoices', 'purchase_invoice_lines',
      'quotations', 'quotation_lines', 'sales_returns', 'sales_return_lines',
      'purchase_returns', 'purchase_return_lines',
      'receipt_vouchers', 'payment_vouchers', 'boms', 'bom_lines',
      'work_orders',
    ];
    for (const t of masterExpected) {
      expect(insertedTables.has(t), `missing INSERT into ${t}`).toBe(true);
    }
  });

  it('uses WHERE NOT EXISTS guards for idempotency', async () => {
    const client = makeRecordingClient();
    await seedModule.seedComprehensiveDemoData(client, 'c-test-1');

    const guarded = client._calls.filter((c) => /WHERE NOT EXISTS/i.test(c.sql));
    expect(guarded.length).toBeGreaterThan(10);
  });

  it('uses 5-digit account codes (not 6-digit)', async () => {
    const client = makeRecordingClient();
    await seedModule.seedComprehensiveDemoData(client, 'c-test-1');

    // The buggy 6-digit codes that previously appeared in seedDemoData.js
    const sixDigit = ['111001', '411001', '511001'];
    for (const code of sixDigit) {
      const found = client._calls.some(
        (c) => c.sql.includes(`'${code}'`) || c.params.includes(code),
      );
      expect(found, `6-digit code ${code} should NOT be present`).toBe(false);
    }

    // Should have 5-digit codes
    const fiveDigit = ['11101', '41101', '51101'];
    for (const code of fiveDigit) {
      const found = client._calls.some(
        (c) => c.sql.includes(`'${code}'`) || c.params.includes(code),
      );
      expect(found, `5-digit code ${code} should be present`).toBe(true);
    }
  });

  it('links products to categories via product_product_categories', async () => {
    const client = makeRecordingClient();
    await seedModule.seedComprehensiveDemoData(client, 'c-test-1');

    const ppc = client._calls.filter((c) =>
      /INSERT INTO\s+product_product_categories/i.test(c.sql),
    );
    expect(ppc.length).toBeGreaterThan(0);
  });

  it('sets product_type_id on products', async () => {
    const client = makeRecordingClient();
    await seedModule.seedComprehensiveDemoData(client, 'c-test-1');

    const productInserts = client._calls.filter((c) =>
      /INSERT INTO\s+products/i.test(c.sql),
    );
    expect(productInserts.length).toBeGreaterThan(0);

    const hasProductTypeId = productInserts.some((c) => {
      if (!c.sql.includes('product_type_id')) return false;
      return c.params.some((p) => typeof p === 'string' && p.startsWith('id-'));
    });
    expect(hasProductTypeId).toBe(true);
  });

  it('is idempotent: a second run does not create duplicates', async () => {
    const client = makeStatefulClient();
    const companyId = 'c-test-1';
    await seedModule.seedComprehensiveDemoData(client, companyId);
    const first = client._tables.get('accounts')?.length || 0;

    // Reset calls but keep tables
    const firstCalls = client._calls.length;
    await seedModule.seedComprehensiveDemoData(client, companyId);
    const second = client._tables.get('accounts')?.length || 0;

    // Same number of accounts (no new rows added)
    expect(second).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  it('populates a full set of demo data on first run', async () => {
    const client = makeStatefulClient();
    const companyId = 'c-test-1';
    await seedModule.seedComprehensiveDemoData(client, companyId);

    const t = client._tables;
    // Each major domain should have at least 1 row
    expect(t.get('accounts')?.length || 0).toBeGreaterThan(0);
    expect(t.get('customers')?.length || 0).toBeGreaterThan(0);
    expect(t.get('suppliers')?.length || 0).toBeGreaterThan(0);
    expect(t.get('products')?.length || 0).toBeGreaterThan(0);
    expect(t.get('product_types')?.length || 0).toBeGreaterThan(0);
    expect(t.get('product_categories')?.length || 0).toBeGreaterThan(0);
    expect(t.get('product_product_categories')?.length || 0).toBeGreaterThan(0);
    expect(t.get('warehouses')?.length || 0).toBeGreaterThan(0);
    expect(t.get('branches')?.length || 0).toBeGreaterThan(0);
    expect(t.get('banks')?.length || 0).toBeGreaterThan(0);
    // New: HR + transactions + returns + vouchers
    expect(t.get('employees')?.length || 0).toBeGreaterThan(0);
    expect(t.get('leads')?.length || 0).toBeGreaterThan(0);
    expect(t.get('opportunities')?.length || 0).toBeGreaterThan(0);
    expect(t.get('sales_invoices')?.length || 0).toBeGreaterThan(0);
    expect(t.get('quotations')?.length || 0).toBeGreaterThan(0);
    expect(t.get('receipt_vouchers')?.length || 0).toBeGreaterThan(0);
    expect(t.get('payment_vouchers')?.length || 0).toBeGreaterThan(0);
    // New: CRM tasks/activities + stock adjustments
    expect(t.get('tasks')?.length || 0).toBeGreaterThan(0);
    expect(t.get('activities')?.length || 0).toBeGreaterThan(0);
    expect(t.get('stock_adjustments')?.length || 0).toBeGreaterThan(0);
  });

  it('does not attempt CREATE TABLE statements (schema is migrations only)', async () => {
    const client = makeRecordingClient();
    await seedModule.seedComprehensiveDemoData(client, 'c-test-1');

    const ddl = client._calls.filter((c) =>
      /^\s*(CREATE|ALTER|DROP)\s+/i.test(c.sql),
    );
    expect(ddl.length).toBe(0);
  });

  it('returns the operator-supplied admin password when it is long enough', async () => {
    const client = makeStatefulClient();
    const result = await seedModule.seedComprehensiveDemoData(client, 'c-test-1', 'OperatorPass123!');
    expect(result.success).toBe(true);
    expect(result.adminPassword).toBe('OperatorPass123!');
  });

  it('falls back to a generated password (never the weak supplied one)', async () => {
    const client = makeStatefulClient();
    const result = await seedModule.seedComprehensiveDemoData(client, 'c-test-1', 'short');
    expect(result.success).toBe(true);
    // Weak supplied password must not be used — a strong random one is generated.
    expect(result.adminPassword).not.toBe('short');
    expect(typeof result.adminPassword).toBe('string');
    expect(result.adminPassword.length).toBeGreaterThanOrEqual(8);
  });

  it('generates a password when none is supplied', async () => {
    const client = makeStatefulClient();
    const result = await seedModule.seedComprehensiveDemoData(client, 'c-test-1');
    expect(result.success).toBe(true);
    expect(typeof result.adminPassword).toBe('string');
    expect(result.adminPassword.length).toBeGreaterThanOrEqual(8);
  });

  it('does not expose a password when the admin user already exists', async () => {
    const client = makeStatefulClient();
    await seedModule.seedComprehensiveDemoData(client, 'c-test-1');
    // Second run: admin exists → no password created → result has no password.
    const result = await seedModule.seedComprehensiveDemoData(client, 'c-test-1', 'AnotherPass123!');
    expect(result.success).toBe(true);
    expect(result.adminPassword).toBeNull();
  });
});
