import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every reference column must either carry a foreign key, or be a documented
 * exception.
 *
 * This gate is the durable form of a census that found four P0 defects in one
 * afternoon: sales_invoice_lines/purchase_invoice_lines had no product FK,
 * customers and suppliers had NO incoming FK at all (so `deleteCustomer`
 * happily deleted a customer with invoices while its friendly "deactivate
 * instead" message could never fire), warehouse_id had none either (deleting a
 * warehouse orphaned stock), and work_orders/boms had none (completing an order
 * received finished goods into a product that no longer existed).
 *
 * Without this gate the next session rediscovers them from scratch, because a
 * one-off script is not a control. Adding a reference column now means either
 * declaring the key or writing down why it stays free.
 *
 * Parsing notes (each of these was a real false result before):
 *  - Tables come from CREATE TABLE, then ADD/DROP COLUMN is replayed in file
 *    order, and DROP TABLE marks a table RETIRED (excluded with a reason).
 *  - Foreign keys are detected in THREE shapes: the Drizzle style
 *    `REFERENCES "public"."customers"("id")`, the hand-written migrations'
 *    `REFERENCES customers(id)`, and the `format()`-composed ones driven by a
 *    `'table|column|target|on-delete'` spec literal.
 *  - 0039's audit loop (created_by/updated_by/approved_by across every table)
 *    is resolved by reading the DDL for which tables declare those columns.
 */
const DRIZZLE = join(process.cwd(), 'drizzle');
const FILES = readdirSync(DRIZZLE).filter((f) => f.endsWith('.sql')).sort();
const SQL = FILES.map((f) => ({ f, text: readFileSync(join(DRIZZLE, f), 'utf8') }));

// ── tables, columns, retired tables ──────────────────────────────────────────
const tables = new Map<string, Set<string>>();
const retired = new Set<string>();
for (const { text } of SQL) {
  for (const m of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\);/gi)) {
    const [, t, body] = m;
    if (!tables.has(t)) tables.set(t, new Set());
    for (const c of body.matchAll(/^\s*"([a-z_0-9]+)"\s+[a-z]/gim)) tables.get(t)!.add(c[1].toLowerCase());
  }
  for (const m of text.matchAll(/ALTER\s+TABLE\s+"?([a-z_0-9]+)"?\s+(ADD|DROP)\s+COLUMN\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z_0-9]+)"?/gi)) {
    const [, t, op, c] = m;
    if (!tables.has(t)) continue;
    if (op.toUpperCase() === 'ADD') tables.get(t)!.add(c.toLowerCase());
    else tables.get(t)!.delete(c.toLowerCase());
  }
  for (const m of text.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi)) {
    retired.add(m[1].toLowerCase());
    tables.delete(m[1].toLowerCase());
  }
}

// ── declared foreign keys ───────────────────────────────────────────────────
const fks = new Set<string>();
const key = (t: string, c: string) => `${t}.${c}`.toLowerCase();

for (const { text } of SQL) {
  // shape 1 — Drizzle style
  for (const m of text.matchAll(
    /ALTER\s+TABLE\s+"?([a-z_0-9]+)"?\s+ADD\s+CONSTRAINT\s+\S+\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+"?([a-z_0-9]+)"?/gi,
  )) {
    for (const c of m[2].split(',')) fks.add(key(m[1], c.trim().replace(/"/g, '')));
  }
  // shape 2 — hand-written migrations: REFERENCES x(id) inside a format() call
  //          driven by a spec literal. Two shapes are in use:
  //            'table|column|target|on-delete'   (0039, 0041)
  //            'table|column'                     (0040, 0042 trees)
  // A format()-composed FOREIGN KEY whose column and/or target come from a
  // spec literal. Both spellings appear: REFERENCES %I(id) and
  // REFERENCES warehouses(id).
  if (/FOREIGN KEY \(%I\)\s*REFERENCES/.test(text)) {
    for (const s of text.matchAll(/'([a-z_0-9]+)\|([a-z_0-9]+)\|([a-z_0-9]+)\|([a-z ]+)'/gi)) {
      fks.add(key(s[1], s[2]));
    }
    for (const s of text.matchAll(/'([a-z_0-9]+)\|([a-z_0-9]+)'/g)) {
      fks.add(key(s[1], s[2]));
    }
    for (const s of text.matchAll(/v_specs := ARRAY\[([^\]]+)\]/gi)) {
      const pc = /v_column := '(\w+)'/.exec(text);
      if (!pc) continue;
      for (const t of s[1].matchAll(/'([a-z_0-9]+)'/gi)) fks.add(key(t[1], pc[1]));
    }
  }
  // shape 2b — 0038 pairs two parallel arrays (v_tables / v_names); the COLUMN
  // is stated literally in the statement (`FOREIGN KEY (product_id)`) because it
  // is the same for every table in the loop. Read it from the statement text —
  // inferring it from the constraint name would be guessing where the underscores
  // fall.
  if (/v_tables\s+text\[\]\s*:=\s*ARRAY\[/.test(text)) {
    const tablesArr = /v_tables\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(text);
    const col = /FOREIGN KEY \((\w+)\)/.exec(text);
    if (tablesArr && col) {
      for (const t of tablesArr[1].matchAll(/'([a-z_0-9]+)'/gi)) fks.add(key(t[1], col[1]));
    }
  }

  // shape 3 — 0039's dynamic audit loop (it covers every table that declares
  // these columns, including the ones that got them via ALTER TABLE ADD COLUMN
  // in 0011/0019/0020, not just via CREATE TABLE)
  if (/column_name IN \('created_by', 'updated_by', 'approved_by'\)/i.test(text)) {
    for (const [t, cols] of tables) {
      for (const col of ['created_by', 'updated_by', 'approved_by']) {
        if (cols.has(col)) fks.add(key(t, col));
      }
    }
  }
}

// ── column → expected target ────────────────────────────────────────────────
const ALIAS: Record<string, string> = {
  company_id: 'companies', user_id: 'users', created_by: 'users', updated_by: 'users',
  approved_by: 'users', assigned_to: 'users', account_id: 'accounts', default_account_id: 'accounts',
  product_id: 'products', unit_id: 'units', product_type_id: 'product_types', category_id: 'product_categories',
  parent_id: '@self', warehouse_id: 'warehouses', from_warehouse_id: 'warehouses', to_warehouse_id: 'warehouses',
  cash_box_id: 'cash_boxes', cost_center_id: 'cost_centers', department_id: 'departments', branch_id: 'branches',
  customer_id: 'customers', supplier_id: 'suppliers', employee_id: 'employees', role_id: 'roles',
  transaction_id: 'transactions', lead_id: 'leads', opportunity_id: 'opportunities', shift_id: 'pos_shifts',
  session_id: 'ai_chat_sessions', batch_id: 'ai_job_batches', material_id: 'products',
};

/**
 * Columns that intentionally carry no foreign key, each with the reason it stays
 * that way. A new entry needs a reason — the test below rejects an empty one.
 */
const DOCUMENTED: Record<string, string> = {
  'cash_boxes.branch_id': 'classification only; there is no deleteBranch path in the app',
  'warehouses.branch_id': 'classification only; there is no deleteBranch path in the app',
  'products.category_id': 'legacy single-category pointer; the real relation is the m2m product_product_categories',
  'vat_settings.account_id': 'nullable configuration mapping, not a financial reference',
  // Phase 82: the document-line unit is a FROZEN snapshot — unit_id has no FK on
  // purpose so deleting a catalog unit cannot rewrite or break historical lines.
  'quotation_lines.unit_id': 'Phase 82: the unit is a frozen snapshot; unit_id is deliberately FK-free so a catalog change cannot rewrite history',
  'sales_invoice_lines.unit_id': 'Phase 82: frozen unit snapshot, deliberately FK-free (see 0021_product_units)',
  'sales_return_lines.unit_id': 'Phase 82: frozen unit snapshot, deliberately FK-free',
  'purchase_invoice_lines.unit_id': 'Phase 82: frozen unit snapshot, deliberately FK-free',
  'purchase_order_lines.unit_id': 'Phase 82: frozen unit snapshot, deliberately FK-free',
  'purchase_return_lines.unit_id': 'Phase 82: frozen unit snapshot, deliberately FK-free',
  // Phase 62 cash-box unification: a used cash box must not block deletion, and
  // the document keeps the id for the audit trail (8 tables).
  'receipt_vouchers.cash_box_id': 'Phase 62 decision: a used cash box must not block deletion, the voucher keeps the id for the audit trail',
  'payment_vouchers.cash_box_id': 'Phase 62 decision: a used cash box must not block deletion, the voucher keeps the id for the audit trail',
  'sales_invoices.cash_box_id': 'Phase 62 decision: cash-box reference is audit-only, not a blocking constraint',
  'purchase_invoices.cash_box_id': 'Phase 62 decision: cash-box reference is audit-only, not a blocking constraint',
  'sales_returns.cash_box_id': 'Phase 62 decision: cash-box reference is audit-only, not a blocking constraint',
  'purchase_returns.cash_box_id': 'Phase 62 decision: cash-box reference is audit-only, not a blocking constraint',
  'purchase_orders.cash_box_id': 'Phase 62 decision: cash-box reference is audit-only, not a blocking constraint',
  'quotations.cash_box_id': 'Phase 62 decision: cash-box reference is audit-only, not a blocking constraint',
  'end_of_service.cash_box_id': 'Phase 62 decision: the payout cash box is audit-only; payEndOfService validates it in the API',
  // POS: the shift that issued the receipt, kept for the Z report.
  'sales_invoices.shift_id': 'POS receipt keeps its shift reference; a closed shift is never deleted, so no constraint is needed',
};

interface Gap { column: string; target: string }
const gaps: Gap[] = [];
for (const [t, cols] of [...tables].sort()) {
  for (const c of [...cols].sort()) {
    const target = ALIAS[c];
    if (!target) continue;                              // not a known reference shape
    if (target !== '@self' && !tables.has(target)) continue;  // target retired/absent
    if (fks.has(key(t, c))) continue;
    gaps.push({ column: key(t, c), target });
  }
}

const undocumented = gaps.filter((g) => !(g.column in DOCUMENTED));

describe('reference columns carry a key or a documented reason', () => {
  it('parses a usable table set (a broken parse would pass by absence)', () => {
    expect(tables.size).toBeGreaterThan(60);
    const names = [...tables.keys()];
    for (const must of ['customers', 'suppliers', 'products', 'accounts', 'sales_invoices', 'work_orders']) {
      expect(names, `table ${must} is parsed`).toContain(must);
    }
    // retired by an explicit, documented migration
    expect([...retired].sort()).toEqual(['banks', 'calls', 'crm_activities']);
  });

  it('reads the declared keys from all three SQL shapes', () => {
    // Drizzle style, hand-written style, and the format()-composed spec style
    expect(fks.size).toBeGreaterThan(180);
    expect(fks.has('sales_invoice_lines.product_id')).toBe(true);   // 0038 (format spec)
    expect(fks.has('quotation_lines.product_id')).toBe(true);      // 0000_init (Drizzle style)
    expect(fks.has('sales_invoices.created_by')).toBe(true);       // 0039 (audit loop)
    expect(fks.has('accounts.parent_id')).toBe(true);              // 0042 (tree spec)
  });

  it('can still fail: an undeclared keyless reference is reported as a gap', () => {
    // The scanner must reject a real table/column pair it does not know about, or
    // a new gap could ship silently. Simulated here by removing one key from the
    // parsed set and re-running the same predicate the gate uses.
    const before = fks.has('sales_invoices.customer_id');
    expect(before, 'the key exists in the migrations').toBe(true);
    fks.delete('sales_invoices.customer_id');
    const target = ALIAS.customer_id;
    const isGap = tables.has('sales_invoices')
      && tables.get('sales_invoices')!.has('customer_id')
      && !fks.has(key('sales_invoices', 'customer_id'))
      && tables.has(target);
    expect(isGap, 'removing the key turns it into a gap the gate reports').toBe(true);
    fks.add('sales_invoices.customer_id');   // restore
  });

  it('every documented exception carries a reason', () => {
    for (const [column, reason] of Object.entries(DOCUMENTED)) {
      expect(reason.length, `${column} needs a reason`).toBeGreaterThan(10);
    }
    // and the allowlist must not carry entries that are no longer needed
    const live = new Set(gaps.map((g) => g.column));
    for (const column of Object.keys(DOCUMENTED)) {
      expect(live.has(column), `${column} is documented but the key now exists — drop the entry`).toBe(true);
    }
  });

  it('no reference column is left without a key or a documented reason', () => {
    const report = undocumented.map((g) => `${g.column} -> ${g.target}`).join('\n');
    expect(report).toBe('');
  });
});
