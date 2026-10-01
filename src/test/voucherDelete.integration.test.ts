import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbAdapter } from '@/core/database/adapters/types';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';

/**
 * Real-database proof for the two guarded voucher deletes and the two partial
 * updates (tranche 9b). PGlite.
 *
 * The unit tests mock the adapter, so they prove routing and payload shape but
 * never run a statement. Three things here are invisible to a mock:
 *
 *  1. The guard is a CTE whose decision and delete share one snapshot. Whether
 *     a row survives depends on how PostgreSQL evaluates a data-modifying CTE,
 *     not on how the JS reads. The last tranche's `HAVING` defect lived exactly
 *     in that gap and shipped as "departments can never be deleted".
 *  2. `IS DISTINCT FROM` versus `NOT IN` is a NULL-semantics question only the
 *     engine can answer, and the JS comparison it replaces let a NULL status
 *     through.
 *  3. The two partial updates write to live rows, so "the untouched column
 *     survived" is an observable fact rather than an inspected SQL string.
 *
 * The SQL executed is each channel's own `compose()` output, extracted from
 * dbHandler.js and evaluated — not a transcription. A hand-written copy is how a
 * smoke test passes while the product fails.
 */
vi.mock('@/core/utils/validation', async (orig) => {
  const actual = await orig<typeof import('@/core/utils/validation')>();
  return { ...actual, validateInput: vi.fn(() => ({ success: true })) };
});

const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_FILTER = (s: unknown) => (typeof s === 'string' && /^[0-9a-fA-F]{8}-/.test(s) ? s : null);
const TYPES = new Set(['earning', 'deduction', 'tax', 'insurance', 'net']);
const METHODS = new Set(['fixed', 'percentage', 'formula']);

const query = pgliteAdapter.query as DbAdapter['query'];

type ComposeResult = { sql: string; params: unknown[] };
type ChannelDef = {
  paramCount?: number | null;
  validate?: (p: unknown, s: unknown) => void;
  compose: (p: unknown, s: unknown) => ComposeResult;
  mapResult?: (rows: unknown[]) => unknown[];
};

function channel(name: string): ChannelDef {
  const i = SRC.indexOf(`registerRpc('${name}'`);
  expect(i, name + ' is not registered').toBeGreaterThan(0);
  const start = SRC.indexOf('{', i);
  let depth = 0;
  for (let k = start; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '`') { const e = SRC.indexOf('`', k + 1); if (e > 0) k = e; continue; }
    if (c === "'") { const e = SRC.indexOf("'", k + 1); if (e > 0) k = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) {
      return new Function('UUID_RE', 'UUID_FILTER', 'PAYROLL_COMPONENT_TYPES', 'PAYROLL_COMPONENT_METHODS',
        `return (${SRC.slice(start, k + 1)});`)(UUID_RE, UUID_FILTER, TYPES, METHODS) as ChannelDef;
    } }
  }
  throw new Error(name + ': unterminated object literal');
}

/** Run a channel the way the dispatcher does: validate, compose, execute, map. */
async function run(name: string, payload: Record<string, unknown>, session: unknown): Promise<{ ok: boolean; error?: string }> {
  const def = channel(name);
  try {
    if (def.validate) await def.validate(payload, session);
    const { sql, params } = def.compose(payload, session);
    const res = await query(sql, params);
    if (!res.success) return { ok: false, error: res.error };
    if (def.mapResult) def.mapResult(res.rows || []);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

let session: { user: { id: string; companyId: string } };
let otherCompany: string;

beforeAll(async () => {
  await runPgliteMigrations();
  // setup.ts replaces crypto.randomUUID() with a non-UUID; several columns here
  // are uuid, so a real generator is restored for anything minted below.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

  const name = `VOUCHER-${Date.now()}`;
  const co = await query(`INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`, [name]);
  expect(co.success, co.error).toBe(true);
  const companyId = String(co.rows![0].id);
  const user = await query(
    `INSERT INTO users (company_id, username, full_name, role, is_active, password_hash)
     VALUES ($1, 'voucher_u', 'محاسب الاختبار', 'admin', true, 'x:y:z:w') RETURNING id`,
    [companyId],
  );
  expect(user.success, user.error).toBe(true);
  session = { user: { id: String(user.rows![0].id), companyId } };

  const co2 = await query(`INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`, [`${name}-other`]);
  otherCompany = String(co2.rows![0].id);
}, 180000);

/** Every column these two tables need NOT NULL, so a seed cannot half-insert. */
async function seedVoucher(table: 'receipt_vouchers' | 'payment_vouchers', n: number, status: string, applied = 0, companyId?: string): Promise<string> {
  const cid = companyId ?? session.user.companyId;
  const res = await query(
    `INSERT INTO ${table} (company_id, voucher_number, date, amount, status, amount_applied, cash_box_id)
     VALUES ($1::uuid, $2, CURRENT_DATE, 1000, $3, $4, NULL) RETURNING id`,
    [cid, `V-${table}-${n}`, status, applied],
  );
  expect(res.success, `seed ${table} failed: ` + res.error).toBe(true);
  return String(res.rows![0].id);
}

const count = async (table: string, id: string): Promise<number> =>
  Number((await query(`SELECT count(*)::int AS c FROM ${table} WHERE id = $1::uuid`, [id])).rows![0].c);

describe.each(['receipt_vouchers', 'payment_vouchers'] as const)('%s delete guard on a real engine', (table) => {
  const channelName = table === 'receipt_vouchers' ? 'accounting.deleteReceiptVoucher' : 'accounting.deletePaymentVoucher';
  let n = 0;

  it('deletes a draft voucher with nothing applied', async () => {
    const id = await seedVoucher(table, ++n, 'draft');
    const res = await run(channelName, { id }, session);
    expect(res.ok, res.error).toBe(true);
    expect(await count(table, id)).toBe(0);
  });

  it('refuses a posted voucher and keeps the row', async () => {
    const id = await seedVoucher(table, ++n, 'posted');
    const res = await run(channelName, { id }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('posted voucher');
    expect(await count(table, id)).toBe(1);
  });

  it('refuses a reversed voucher — it is terminal', async () => {
    const id = await seedVoucher(table, ++n, 'reversed');
    const res = await run(channelName, { id }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('reversed voucher');
    expect(await count(table, id)).toBe(1);
  });

  it('refuses a voucher with applied payments', async () => {
    const id = await seedVoucher(table, ++n, 'draft', 250);
    const res = await run(channelName, { id }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('applied payments');
    expect(await count(table, id)).toBe(1);
  });

  it('reports a missing voucher instead of succeeding', async () => {
    const res = await run(channelName, { id: '00000000-0000-0000-0000-0000000000ff' }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Voucher not found');
  });

  it('never reaches another company', async () => {
    const id = await seedVoucher(table, ++n, 'draft', 0, otherCompany);
    const res = await run(channelName, { id }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Voucher not found');
    expect(await count(table, id)).toBe(1);
  });

  it('a NULL status still deletes, as the JavaScript comparison did', async () => {
    // The renderer compared `String(v.status) === 'posted'`, so a NULL status was
    // neither posted nor reversed and the delete proceeded. `NOT IN` would have
    // returned NULL and quietly started refusing those deletes — a behaviour
    // change nobody asked for.
    const id = await seedVoucher(table, ++n, 'draft');
    await query(`UPDATE ${table} SET status = NULL WHERE id = $1::uuid`, [id]);
    const res = await run(channelName, { id }, session);
    expect(res.ok, 'a NULL status changed behaviour under the guard: ' + res.error).toBe(true);
    expect(await count(table, id)).toBe(0);
  });

  it('rejects a malformed id before the statement runs', async () => {
    const res = await run(channelName, { id: 'not-a-uuid' }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/uuid/i);
  });
});

describe('the two partial updates on a real engine', () => {
  let warehouseId: string;
  let adjustmentId: string;

  beforeAll(async () => {
    const wh = await query(`INSERT INTO warehouses (company_id, name) VALUES ($1::uuid, 'مستودع الاختبار') RETURNING id`, [session.user.companyId]);
    expect(wh.success, wh.error).toBe(true);
    warehouseId = String(wh.rows![0].id);

    const prod = await query(
      `INSERT INTO products (company_id, code, name_ar, unit, is_active) VALUES ($1::uuid, 'ADJ-1', 'صنف', 'قطعة', true) RETURNING id`,
      [session.user.companyId],
    );
    expect(prod.success, prod.error).toBe(true);

    const adj = await query(
      `INSERT INTO stock_adjustments (company_id, product_id, warehouse_id, date, system_qty, actual_qty, difference, reason, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, CURRENT_DATE, 10, 10, 0, 'أصل', 'draft') RETURNING id`,
      [session.user.companyId, prod.rows![0].id, warehouseId],
    );
    expect(adj.success, adj.error).toBe(true);
    adjustmentId = String(adj.rows![0].id);
  });

  it('updateWarehouse writes only the named field and stamps the session', async () => {
    const res = await run('inventory.updateWarehouse', { id: warehouseId, name: 'المستودع الرئيسي' }, session);
    expect(res.ok, res.error).toBe(true);

    const row = await query(`SELECT name, code, branch_id, is_active, updated_by FROM warehouses WHERE id = $1::uuid`, [warehouseId]);
    expect(row.rows![0].name).toBe('المستودع الرئيسي');
    expect(row.rows![0].updated_by).toBe(session.user.id);
    expect(row.rows![0].code, 'an untouched column was overwritten').toBeNull();
    expect(row.rows![0].is_active).toBe(true);
  });

  it('updateWarehouse cannot move the row to another company', async () => {
    const other = await query(`INSERT INTO warehouses (company_id, name) VALUES ($1::uuid, 'مستودع آخر') RETURNING id`, [otherCompany]);
    const foreignId = String(other.rows![0].id);
    const res = await run('inventory.updateWarehouse', { id: foreignId, name: 'اختطاف' }, session);
    expect(res.ok).toBe(true); // the UPDATE matches nothing rather than erroring
    const row = await query(`SELECT name FROM warehouses WHERE id = $1::uuid`, [foreignId]);
    expect(row.rows![0].name, 'a foreign company row was modified').toBe('مستودع آخر');
  });

  it('updateStockAdjustment writes quantities and leaves the status alone', async () => {
    const res = await run('inventory.updateStockAdjustment', {
      id: adjustmentId, actualQty: 7, difference: -3, reason: 'جرد',
    }, session);
    expect(res.ok, res.error).toBe(true);

    const row = await query(`SELECT actual_qty, difference, reason, status, updated_by FROM stock_adjustments WHERE id = $1::uuid`, [adjustmentId]);
    expect(Number(row.rows![0].actual_qty)).toBe(7);
    expect(Number(row.rows![0].difference)).toBe(-3);
    expect(row.rows![0].reason).toBe('جرد');
    expect(row.rows![0].status).toBe('draft');
    expect(row.rows![0].updated_by).toBe(session.user.id);
  });

  it('a status in the payload does not reach the statement', async () => {
    const before = await query(`SELECT status FROM stock_adjustments WHERE id = $1::uuid`, [adjustmentId]);
    const res = await run('inventory.updateStockAdjustment', { id: adjustmentId, status: 'posted' }, session);
    expect(res.ok, res.error).toBe(true);
    const after = await query(`SELECT status FROM stock_adjustments WHERE id = $1::uuid`, [adjustmentId]);
    expect(after.rows![0].status, 'a payload status flipped the row with no journal entry').toBe(before.rows![0].status);
  });

  it('an empty payload still succeeds, rewriting only the audit columns', async () => {
    // Parity, not aspiration: the renderer's "nothing to update" guard sat after
    // updated_by was pushed, so it could never fire and an empty payload always
    // rewrote the audit columns. The channel does the same.
    const res = await run('inventory.updateWarehouse', { id: warehouseId }, session);
    expect(res.ok, res.error).toBe(true);
    const row = await query(`SELECT name, updated_by FROM warehouses WHERE id = $1::uuid`, [warehouseId]);
    expect(row.rows![0].name).toBe('المستودع الرئيسي');
    expect(row.rows![0].updated_by).toBe(session.user.id);
  });
});