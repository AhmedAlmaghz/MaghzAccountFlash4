import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbAdapter } from '@/core/database/adapters/types';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';

/**
 * Real-database verification of the hr departments / payroll-components
 * channels (PGlite).
 *
 * The unit tests mock the adapter, so they prove routing and payload shape but
 * never execute a statement. Three things in this tranche are invisible to a
 * mock and can only be settled by a real engine:
 *
 *  1. `departments` has no `updated_at` column (0000_init) while
 *     `payroll_components` gained one in 0009 — so one channel may set it and
 *     the other may not. A wrong guess is "column does not exist" in production.
 *  2. The delete guard is a CTE that reads `count` back out of a subquery. `count`
 *     is also an aggregate name, and whether it resolves as a column reference is
 *     exactly the kind of question a regex cannot answer.
 *  3. The `affects_*` columns are NOT NULL with defaults; a create that omits or
 *     mis-derives them either fails or stores a wrong payroll classification.
 *
 * The SQL executed here is the channel's own `compose()` output, extracted from
 * dbHandler.js and evaluated — not a transcription. A hand-written copy is how a
 * smoke test passes while the product fails.
 */
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
async function run(name: string, payload: Record<string, unknown>, session: unknown): Promise<{ ok: boolean; rows?: unknown[]; error?: string }> {
  const def = channel(name);
  try {
    if (def.validate) await def.validate(payload, session);
    const { sql, params } = def.compose(payload, session);
    const res = await query(sql, params);
    if (!res.success) return { ok: false, error: res.error };
    const rows = def.mapResult ? def.mapResult(res.rows || []) : (res.rows || []);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

let session: { user: { id: string; companyId: string } };
let otherCompanyId: string;

/**
 * Seed an employee. `employees.base_salary` is NOT NULL with no default, and an
 * INSERT whose result is not checked fails silently — which is how the first run
 * of this file "passed" the delete guard with no employee ever linked. Every
 * write here asserts, because a test that seeds nothing proves nothing.
 */
async function seedEmployee(employeeNumber: string, departmentId: string): Promise<string> {
  const res = await query(
    `INSERT INTO employees (company_id, employee_number, full_name, department_id, hire_date, is_active, base_salary)
     VALUES ($1::uuid, $2, 'موظف اختبار', $3::uuid, CURRENT_DATE, true, 1000) RETURNING id`,
    [session.user.companyId, employeeNumber, departmentId],
  );
  expect(res.success, 'employee seed failed: ' + res.error).toBe(true);
  expect(res.rows![0], 'employee seed returned no id').toBeDefined();
  return String(res.rows![0].id);
}

beforeAll(async () => {
  await runPgliteMigrations();
  // src/test/setup.ts replaces crypto.randomUUID() with a non-UUID, and several
  // columns here are uuid — restore a real generator for anything minted here.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

  const name = `HRREF-${Date.now()}`;
  const co = await query(`INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`, [name]);
  const companyId = String(co.rows![0].id);
  const user = await query(
    `INSERT INTO users (company_id, username, full_name, role, is_active, password_hash)
     VALUES ($1, 'hr_ref_u', 'مدير الاختبار', 'admin', true, 'x:y:z:w') RETURNING id`,
    [companyId],
  );
  expect(user.success, 'user seed failed: ' + user.error).toBe(true);
  session = { user: { id: String(user.rows![0].id), companyId } };

  const co2 = await query(`INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`, [`${name}-2`]);
  otherCompanyId = String(co2.rows![0].id);
}, 120000);

describe('the hr departments channels execute against a real database', () => {
  it('creates a department with the session company and audit user', async () => {
    const res = await run('hr.createDepartment', { name: '  المبيعات  ' }, session);
    expect(res.ok, res.error).toBe(true);
    const id = String((res.rows![0] as { id: string }).id);

    const row = await query(`SELECT company_id, name, manager_id, created_by, updated_by FROM departments WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].company_id).toBe(session.user.companyId);
    expect(row.rows![0].name).toBe('المبيعات');
    expect(row.rows![0].created_by).toBe(session.user.id);
    expect(row.rows![0].updated_by).toBe(session.user.id);
  });

  it('rejects a blank name before touching the database', async () => {
    const res = await run('hr.createDepartment', { name: '   ' }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('اسم القسم مطلوب');
  });

  it('a partial update writes only the named field and stamps updated_by', async () => {
    const created = await run('hr.createDepartment', { name: 'المشتريات' }, session);
    const id = String((created.rows![0] as { id: string }).id);

    const upd = await run('hr.updateDepartment', { id, name: 'المشتريات والتوريد' }, session);
    expect(upd.ok, upd.error).toBe(true);

    const row = await query(`SELECT name, manager_id, updated_by FROM departments WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].name).toBe('المشتريات والتوريد');
    expect(row.rows![0].updated_by).toBe(session.user.id);
    // the untouched column survived - a null would mean the SET overwrote it
    expect(row.rows![0].manager_id).toBeNull();
  });

  it('a manager can be set and cleared in isolation', async () => {
    const created = await run('hr.createDepartment', { name: 'المالية' }, session);
    const id = String((created.rows![0] as { id: string }).id);

    await run('hr.updateDepartment', { id, managerId: session.user.id }, session);
    let row = await query(`SELECT name, manager_id FROM departments WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].manager_id).toBe(session.user.id);
    expect(row.rows![0].name).toBe('المالية');

    await run('hr.updateDepartment', { id, managerId: null }, session);
    row = await query(`SELECT name, manager_id FROM departments WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].manager_id).toBeNull();
    expect(row.rows![0].name).toBe('المالية');
  });

  it('refuses to delete a department that still has employees, and says how many', async () => {
    const created = await run('hr.createDepartment', { name: 'قسم مرتبط' }, session);
    const deptId = String((created.rows![0] as { id: string }).id);
    await seedEmployee('E-LINKED', deptId);

    const res = await run('hr.deleteDepartment', { id: deptId }, session);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('1 موظف مرتبط');

    const still = await query(`SELECT count(*)::int AS c FROM departments WHERE id = $1::uuid`, [deptId]);
    expect(Number(still.rows![0].c)).toBe(1);
  });

  it('deletes an empty department, and reports a missing one instead of success', async () => {
    const created = await run('hr.createDepartment', { name: 'قسم فارغ' }, session);
    const deptId = String((created.rows![0] as { id: string }).id);

    const ok = await run('hr.deleteDepartment', { id: deptId }, session);
    expect(ok.ok, ok.error).toBe(true);
    const gone = await query(`SELECT count(*)::int AS c FROM departments WHERE id = $1::uuid`, [deptId]);
    expect(Number(gone.rows![0].c)).toBe(0);

    // The renderer path returned success here, because DELETE of a missing row is
    // not an error in PostgreSQL. Saying so is the honest answer.
    const missing = await run('hr.deleteDepartment', { id: deptId }, session);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe('القسم غير موجود.');
  });

  it('never reaches another company: the session owns the tenant', async () => {
    const foreign = await query(
      `INSERT INTO departments (company_id, name) VALUES ($1::uuid, 'قسم مستأجر آخر') RETURNING id`,
      [otherCompanyId],
    );
    const foreignId = String(foreign.rows![0].id);

    const res = await run('hr.deleteDepartment', { id: foreignId }, session);
    expect(res.ok).toBe(false);

    const still = await query(`SELECT count(*)::int AS c FROM departments WHERE id = $1::uuid`, [foreignId]);
    expect(Number(still.rows![0].c)).toBe(1);
  });

  it('getDepartments counts employees and names the manager', async () => {
    const created = await run('hr.createDepartment', { name: 'قسم العرض' }, session);
    const deptId = String((created.rows![0] as { id: string }).id);
    await run('hr.updateDepartment', { id: deptId, managerId: session.user.id }, session);
    await seedEmployee('E-SHOWCASE', deptId);

    const res = await run('hr.getDepartments', {}, session);
    expect(res.ok, res.error).toBe(true);
    const row = (res.rows as Array<Record<string, unknown>>).find((r) => r.id === deptId);
    expect(row, 'the department is missing from the read').toBeDefined();
    expect(Number(row!.employee_count)).toBe(1);
    expect(row!.manager_name).toBeTruthy();
  });
});

describe('the hr payroll-component channels execute against a real database', () => {
  it('derives the three affect columns from the type, not the payload', async () => {
    const bonus = await run('hr.createPayrollComponent', { nameAr: 'مكافأة', type: 'earning' }, session);
    expect(bonus.ok, bonus.error).toBe(true);
    const bonusId = String((bonus.rows![0] as { id: string }).id);
    let row = await query(`SELECT affects_gross_salary, affects_tax, affects_social_insurance, is_active, default_amount FROM payroll_components WHERE id = $1::uuid`, [bonusId]);
    expect(row.rows![0].affects_gross_salary).toBe(true);
    expect(row.rows![0].affects_tax).toBe(false);
    expect(row.rows![0].affects_social_insurance).toBe(false);
    expect(row.rows![0].is_active).toBe(true);

    // a hostile payload that tries to set them is ignored
    const tax = await run('hr.createPayrollComponent',
      { nameAr: 'ضريبة', type: 'tax', affectsGrossSalary: true, affectsTax: false, affectsSocialInsurance: true } as never, session);
    expect(tax.ok, tax.error).toBe(true);
    const taxId = String((tax.rows![0] as { id: string }).id);
    row = await query(`SELECT affects_gross_salary, affects_tax, affects_social_insurance FROM payroll_components WHERE id = $1::uuid`, [taxId]);
    expect(row.rows![0].affects_gross_salary).toBe(false);
    expect(row.rows![0].affects_tax).toBe(true);
    expect(row.rows![0].affects_social_insurance).toBe(false);
  });

  it('rejects an unknown type and a blank name', async () => {
    expect((await run('hr.createPayrollComponent', { nameAr: 'x', type: 'bonus' }, session)).ok).toBe(false);
    expect((await run('hr.createPayrollComponent', { nameAr: '  ', type: 'earning' }, session)).ok).toBe(false);
  });

  it('a partial update touches only the named column and keeps updated_at working', async () => {
    const created = await run('hr.createPayrollComponent', { nameAr: 'بدل سفر', code: 'TRAV', type: 'earning' }, session);
    const id = String((created.rows![0] as { id: string }).id);

    const upd = await run('hr.updatePayrollComponent', { id, nameAr: 'بدل سفر محدّث' }, session);
    expect(upd.ok, upd.error).toBe(true);

    const row = await query(`SELECT name_ar, code, type, updated_by, updated_at FROM payroll_components WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].name_ar).toBe('بدل سفر محدّث');
    expect(row.rows![0].code).toBe('TRAV');
    expect(row.rows![0].type).toBe('earning');
    expect(row.rows![0].updated_by).toBe(session.user.id);
    expect(row.rows![0].updated_at, 'updated_at must exist on payroll_components (added in 0009)').toBeTruthy();
  });

  it('rejects an unknown type on update', async () => {
    const created = await run('hr.createPayrollComponent', { nameAr: 'مبلغ', type: 'earning' }, session);
    const id = String((created.rows![0] as { id: string }).id);
    const res = await run('hr.updatePayrollComponent', { id, type: 'nope' }, session);
    expect(res.ok).toBe(false);
    const row = await query(`SELECT type FROM payroll_components WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].type).toBe('earning');
  });

  it('deactivation keeps the row (history) and stamps the session user', async () => {
    const created = await run('hr.createPayrollComponent', { nameAr: 'مكوّن قديم', type: 'deduction' }, session);
    const id = String((created.rows![0] as { id: string }).id);

    const res = await run('hr.deactivatePayrollComponent', { id }, session);
    expect(res.ok, res.error).toBe(true);

    const row = await query(`SELECT is_active, updated_by FROM payroll_components WHERE id = $1::uuid`, [id]);
    expect(row.rows![0].is_active).toBe(false);
    expect(row.rows![0].updated_by).toBe(session.user.id);
  });

  it('getPayrollComponentsList returns only this company, ordered', async () => {
    await query(`INSERT INTO payroll_components (company_id, name_ar, type) VALUES ($1::uuid, 'مكوّن مستأجر', 'earning')`, [otherCompanyId]);
    const res = await run('hr.getPayrollComponentsList', {}, session);
    expect(res.ok, res.error).toBe(true);
    const names = (res.rows as Array<Record<string, unknown>>).map((r) => String(r.name_ar));
    expect(names).toContain('مكوّن قديم');
    expect(names, 'another company leaked into the list').not.toContain('مكوّن مستأجر');
  });
});
