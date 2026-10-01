import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A partial update is two implementations of one allowlist.
 *
 * `updateWarehouse`, `updateStockAdjustment`, `updateDepartment` and
 * `updatePayrollComponent` send only the keys the form changed, so the COLUMN
 * list is built twice: once in the renderer for PGlite and once in the main
 * process for the desktop. If the two lists drift, the desktop silently stops
 * updating a field the browser still updates — a field that is present in the
 * UI, saved without complaint, and unchanged in the database. Nothing else in
 * the suite can see it: the unit tests exercise the fallback, the e2e shim is a
 * third copy, and the arithmetic is all `success: true`.
 *
 * So the two are compared directly, in order, as whole lists. Sampling is what
 * made an earlier check pass a message two characters short of the real one.
 *
 * The second assertion is the reason the lists are allowed to be built at all:
 * a payload names WHICH fields change, never WHICH columns. `company_id` or
 * `created_by` appearing in either list would mean the renderer could steer the
 * tenant or forge the audit trail, so both are pinned absent by name — along
 * with `status` on the stock adjustment, which is the P0-4 shape (a status flip
 * with no journal entry and no stock movement).
 */
const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_FILTER = (s: unknown) => (typeof s === 'string' && /^[0-9a-fA-F]{8}-/.test(s) ? s : null);
const TYPES = new Set(['earning', 'deduction', 'tax', 'insurance', 'net']);
const METHODS = new Set(['fixed', 'percentage', 'formula']);

const SESSION = { user: { id: '00000000-0000-0000-0000-0000000000aa', companyId: '00000000-0000-0000-0000-0000000000bb' } };
const ID = '00000000-0000-0000-0000-0000000000cc';

/** The channel's object literal, brace-matched past template and quoted literals. */
function literalFor(channel: string): string {
  const i = SRC.indexOf(`registerRpc('${channel}'`);
  expect(i, channel + ' is not registered').toBeGreaterThan(0);
  const start = SRC.indexOf('{', i);
  let depth = 0;
  for (let k = start; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '`') { const e = SRC.indexOf('`', k + 1); if (e > 0) k = e; continue; }
    if (c === "'") { const e = SRC.indexOf("'", k + 1); if (e > 0) k = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(start, k + 1); }
  }
  throw new Error(channel + ': unterminated object literal');
}

type ComposeResult = { sql: string; params: unknown[] };
function channelCompose(channel: string) {
  const def = new Function('UUID_RE', 'UUID_FILTER', 'PAYROLL_COMPONENT_TYPES', 'PAYROLL_COMPONENT_METHODS',
    `return (${literalFor(channel)});`)(UUID_RE, UUID_FILTER, TYPES, METHODS) as {
      compose: (p: unknown, s: unknown) => ComposeResult;
    };
  return (payload: Record<string, unknown>): ComposeResult => def.compose(payload, SESSION);
}

/** Columns the main process assigns, in order, for a payload that sets everything. */
function channelColumns(compose: (p: Record<string, unknown>) => ComposeResult, payload: Record<string, unknown>): string[] {
  const { sql } = compose(payload);
  // Anchor on the WHERE id, never on a character class. An earlier version used
  // `[^W]+?` to stop before WHERE, which the W in NOW() broke — the gate then
  // reported "no SET clause" for a statement that had one, and a class like that
  // fails on the value it was meant to tolerate.
  const set = /^UPDATE \w+ SET ([\s\S]+?) WHERE id = /s.exec(sql);
  expect(set, 'the statement has no SET clause: ' + sql.slice(0, 80)).not.toBeNull();
  return [...(set![1].matchAll(/(\w+)\s*=/g))].map((m) => m[1]);
}

/**
 * Columns the renderer pushes, in order, for the same partial update.
 *
 * Start the body at `try {`, not at the signature: a multi-line parameter type
 * (`data: {` ... `}, _userId?: string)`) also begins a line with `  },`, so
 * slicing to the first one truncated updatePayrollComponent before a single
 * fields.push — which reads as an empty list and passes a divergence check.
 */
function rendererColumns(file: string, method: string): string[] {
  const api = readFileSync(join(ROOT, file), 'utf8');
  const at = api.indexOf(`async ${method}(`);
  expect(at, method + ' is missing from ' + file).toBeGreaterThan(0);
  const bodyStart = api.indexOf('\n    try {', at);
  expect(bodyStart, method + ' has no try block').toBeGreaterThan(0);
  const body = api.slice(bodyStart, api.indexOf('\n  },', bodyStart));
  const out: string[] = [];
  for (const m of body.matchAll(/fields\.push\(\s*[`']([a-z_]+)\s*=\s*(?:\$|NOW\(\))/g)) out.push(m[1]);
  return out;
}

const NEVER_SETTABLE = ['company_id', 'created_by', 'id'];

const HR = 'src/modules/hr/api.ts';
const INV = 'src/modules/inventory/api.ts';

/**
 * Columns declared in the shipped schema, per table.
 *
 * The phantom-column check reads the DDL rather than a Drizzle snapshot so it
 * fails on exactly what a fresh database has: `ADD COLUMN` in a later migration
 * is in the file too, and anything absent from it cannot exist anywhere.
 */
function schemaColumns(table: string): Set<string> {
  const ddl = readFileSync(join(ROOT, 'drizzle', '0000_init.sql'), 'utf8');
  const at = ddl.indexOf(`CREATE TABLE "${table}" (`);
  expect(at, table + ' is not in the schema').toBeGreaterThan(0);
  const body = ddl.slice(at + table.length + 16, ddl.indexOf('\n);', at));
  return new Set([...body.matchAll(/^\s*"(\w+)"/gm)].map((m) => m[1]));
}

const CASES: Array<{ channel: string; file: string; method: string; table: string; full: Record<string, unknown> }> = [
  {
    channel: 'hr.updateDepartment', file: HR, method: 'updateDepartment', table: 'departments',
    full: { id: ID, name: 'Ops', managerId: null },
  },
  {
    channel: 'hr.updatePayrollComponent', file: HR, method: 'updatePayrollComponent', table: 'payroll_components',
    full: { id: ID, nameAr: 'Bonus', nameEn: 'Bonus', code: 'BON', type: 'earning', calculationMethod: 'fixed', defaultAmount: 1, isActive: true },
  },
  {
    channel: 'inventory.updateWarehouse', file: INV, method: 'updateWarehouse', table: 'warehouses',
    full: { id: ID, name: 'A', code: 'B', branchId: null, isActive: false },
  },
  {
    channel: 'inventory.updateStockAdjustment', file: INV, method: 'updateStockAdjustment', table: 'stock_adjustments',
    full: { id: ID, systemQty: 1, actualQty: 2, difference: 1, reason: 'r', unitCost: 3, warehouseId: ID },
  },
];

describe('a partial update has the same column list on both sides of the bridge', () => {
  it.each(CASES.map((c) => [c.channel, c] as const))(
    '%s: main and renderer assign the same columns, in order',
    (_name, c) => {
      const compose = channelCompose(c.channel);
      const channel = channelColumns(compose, c.full);
      const renderer = rendererColumns(c.file, c.method);
      expect(channel.length, 'the channel assigned nothing — a broken SET would pass an empty compare')
        .toBeGreaterThan(0);
      expect(renderer.length, 'the renderer list came back empty — the body extractor missed it')
        .toBeGreaterThan(0);
      expect(channel, c.channel + ' column lists diverged; a field would update on one platform only')
        .toEqual(renderer);
    },
  );

  it.each(CASES.map((c) => [c.channel, c] as const))(
    '%s: no list can name the tenant or the audit columns',
    (_name, c) => {
      const channel = channelColumns(channelCompose(c.channel), c.full);
      for (const cols of [channel, rendererColumns(c.file, c.method)]) {
        for (const forbidden of NEVER_SETTABLE) {
          expect(cols, forbidden + ' is settable by a partial update on ' + c.channel).not.toContain(forbidden);
        }
      }
    },
  );

  it.each(CASES.map((c) => [c.channel, c] as const))(
    '%s: a payload naming a forbidden column does not widen the SET clause',
    (_name, c) => {
      const compose = channelCompose(c.channel);
      const honest = channelColumns(compose, c.full);
      const hostile = channelColumns(compose, { ...c.full, company_id: 'x', created_by: 'y', id2: 'z' });
      expect(hostile, 'a payload field leaked into the column list').toEqual(honest);
    },
  );

  it('a stock adjustment cannot be flipped to a status through a partial update', () => {
    // The P0-4 shape: a status change with no journal entry and no stock
    // movement, because both live in postStockAdjustment. Asserted on the real
    // statement rather than on a list, so a re-added column cannot hide behind a
    // renamed one.
    const sql = channelCompose('inventory.updateStockAdjustment')({ id: ID, status: 'posted' }).sql;
    expect(sql, 'status must not be assignable by a partial update').not.toMatch(/\bstatus\s*=/);
  });

  it.each(CASES.map((c) => [c.channel, c] as const))(
    '%s: every column it writes exists in the table',
    (_name, c) => {
      // `warehouses.updated_at` was the last one of these: the renderer stamped
      // it, the engine rejected it, and editing a warehouse failed on the
      // browser and the desktop alike. The unit tests could not see it (they
      // mock the adapter) and neither could a review of the SQL string — the
      // column looks exactly like the three tables that do have one. Reading the
      // DDL turns "looks right" into a fact, and covers every future column.
      const real = schemaColumns(c.table);
      for (const cols of [channelColumns(channelCompose(c.channel), c.full), rendererColumns(c.file, c.method)]) {
        for (const col of cols) {
          expect(real.has(col), `${c.channel} writes ${c.table}.${col}, which the schema does not declare`).toBe(true);
        }
      }
    },
  );

  it('the tables these updates touch really do differ on updated_at', () => {
    // Guards the guard: if a future migration adds warehouses.updated_at, the
    // check above starts passing for a reason that has nothing to do with the
    // code, and a reader would take the fix as evidence the stamp was always
    // wrong. Pin the asymmetry that motivated it.
    expect(schemaColumns('stock_adjustments').has('updated_at')).toBe(true);
    expect(schemaColumns('warehouses').has('updated_at')).toBe(false);
    expect(schemaColumns('warehouses').has('updated_by')).toBe(true);
  });
});

describe('the two voucher deletes share one set of reasons', () => {
  /** Every user-visible string a delete channel can refuse with. */
  function refusals(channel: string): string[] {
    const body = literalFor(channel);
    return [...body.matchAll(/new Error\('([^']*)'\)/g)].map((m) => m[1]);
  }

  it('both channels refuse with the same words, in the same order', () => {
    const receipt = refusals('accounting.deleteReceiptVoucher');
    const payment = refusals('accounting.deletePaymentVoucher');
    expect(receipt.length, 'the receipt channel refused with nothing — an empty compare passes').toBeGreaterThan(3);
    expect(payment, 'the two voucher deletes drifted apart in wording').toEqual(receipt);
  });

  it('the four real reasons are all present, and the dead foreign-key one is not', () => {
    const reasons = refusals('accounting.deleteReceiptVoucher').join(' | ');
    expect(reasons).toContain('Voucher not found');
    expect(reasons).toContain('posted voucher');
    expect(reasons).toContain('reversed voucher');
    expect(reasons).toContain('applied payments');
    // Nothing references these two tables, so a DELETE cannot raise 23503 and
    // the branch that translated one could never fire. Proven against the
    // catalog (0 inbound constraints) and by executing the delete.
    expect(reasons, 'a foreign-key refusal branch is unreachable on these tables').not.toContain('linked records');
  });

  it('the guard uses IS DISTINCT FROM so a NULL status keeps the old behaviour', () => {
    // The renderer compared `String(v.status) === 'posted'`, which let a NULL
    // status through to the DELETE. Plain `NOT IN` returns NULL for NULL and
    // would silently start blocking those deletes.
    for (const ch of ['accounting.deleteReceiptVoucher', 'accounting.deletePaymentVoucher']) {
      const sql = channelCompose(ch)({ id: ID }).sql;
      expect(sql, ch + ' must translate the JS comparison faithfully').toContain("IS DISTINCT FROM 'posted'");
      expect(sql, ch + ' must translate the JS comparison faithfully').toContain("IS DISTINCT FROM 'reversed'");
    }
  });
});