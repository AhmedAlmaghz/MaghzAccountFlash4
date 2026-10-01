import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Identity-from-session, pinned at the source level.
 *
 * `approved_by` on a leave and on a stock adjustment is a CERTIFICATION, not a
 * description: it says who vouched for the approval. While the value travelled
 * in the payload, any holder of the edit permission could stamp a colleague's
 * name onto an approval they never saw — and an approval moves money (a leave
 * balance feeds the IAS 19 end-of-service provision) or moves inventory and
 * posts the variance entry. The desktop path is the one that matters: only the
 * main process has a session, so a payload field is the only shape it can take
 * there.
 *
 * These are source assertions on purpose. There is no way to observe "the
 * approver came from the session" from the renderer — the channel simply has no
 * such argument — so the contract is pinned where it is written.
 */
const ROOT = process.cwd();
const dbHandler = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
const shimSrc = readFileSync(join(ROOT, 'e2e', 'vite-e2e-plugin.ts'), 'utf8');
const hrApi = readFileSync(join(ROOT, 'src', 'modules', 'hr', 'api.ts'), 'utf8');
const inventoryApi = readFileSync(join(ROOT, 'src', 'modules', 'inventory', 'api.ts'), 'utf8');

/** Body of one `registerRpc('name', { ... })` block, by brace matching. */
function channelBody(name: string, src = dbHandler): string {
  const at = src.indexOf(`registerRpc('${name}'`);
  if (at < 0) throw new Error(`channel ${name} is not registered`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (depth <= 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`channel ${name} has an unbalanced body`);
}

describe('an approval cannot be attributed to someone who did not give it', () => {
  it('hr.updateLeaveStatus takes no approver and stamps the session user', () => {
    const body = channelBody('hr.updateLeaveStatus');
    expect(body, 'the channel must not read an approver from the payload').not.toMatch(/p\.approvedBy/);
    expect(body).toMatch(/approved_by = \$2::uuid/);
    expect(body).toMatch(/session\.user\.id/);
  });

  it('inventory.approveStockAdjustment takes no approver and stamps the session user', () => {
    const body = channelBody('inventory.approveStockAdjustment');
    expect(body, 'the channel must not read an approver from the payload').not.toMatch(/approvedBy/);
    expect(body).toMatch(/approved_by = \$1::uuid/);
    expect(body).toMatch(/session\.user\.id/);
  });

  it('the renderer APIs expose no approver argument at all', () => {
    // A parameter here would invite the next caller to pass one.
    expect(hrApi).toMatch(/async updateLeaveStatus\(id: string, companyId: string, status: Leave\['status'\], _userId\?: string\)/);
    expect(hrApi).not.toMatch(/updateLeaveStatus\([^)]*approvedBy/);
    expect(inventoryApi).toMatch(/async approveStockAdjustment\(id: string, companyId: string, _userId\?: string\)/);
    expect(inventoryApi).not.toMatch(/approveStockAdjustment\([^)]*approvedBy/);
  });

  it('the e2e shim mirrors it — a shim that takes a payload approver teaches the shape back', () => {
    // The shim has no session, so it writes NULL. What matters is that it does
    // not read an approver the production channel would have to ignore.
    const at = shimSrc.indexOf('updateLeaveStatus:');
    expect(at).toBeGreaterThan(0);
    const slice = shimSrc.slice(at, at + 400);
    expect(slice).not.toMatch(/p\.approvedBy/);
    expect(slice).toMatch(/approved_by = NULL/);
  });
});

describe('the desktop write channels derive their audit columns from the session', () => {
  it('every hr departments / payroll-components write channel stamps the session', () => {
    // These eight were reference CRUD that Phase 74 added straight to
    // adapter.query, so their `created_by` / `updated_by` used to be whatever
    // the renderer passed. On the desktop the renderer is the untrusted side of
    // the boundary, which is the whole reason these moved.
    for (const channel of [
      'hr.createDepartment', 'hr.updateDepartment', 'hr.deleteDepartment',
      'hr.createPayrollComponent', 'hr.updatePayrollComponent', 'hr.deactivatePayrollComponent',
    ]) {
      const body = channelBody(channel);
      expect(body, channel + ' must scope its rows to the session company').toMatch(/session\.user\.companyId/);
      expect(body, channel + ' must not take an audit user from the payload')
        .not.toMatch(/p\.createdBy|p\.updatedBy|p\.userId|p\._userId/);
    }
    for (const channel of ['hr.createDepartment', 'hr.createPayrollComponent', 'hr.updatePayrollComponent', 'hr.deactivatePayrollComponent']) {
      expect(channelBody(channel), channel + ' must write the audit user from the session')
        .toMatch(/session\.user\.id/);
    }
  });

  it('the derived payroll-component columns are not payload fields', () => {
    // affects_gross_salary / affects_tax / affects_social_insurance follow from
    // the component's type. If a payload could set them, a caller could mark a
    // deduction as part of gross salary and every payroll total would move.
    //
    // Only CREATE derives them. UPDATE does not, and that is the pre-existing
    // behaviour of the renderer path — retyping a component leaves its flags
    // alone. Preserved deliberately: recomputing them here would be a behaviour
    // change smuggled into a migration, and it would make the browser and the
    // desktop disagree until the renderer changed too. Recorded here so the
    // asymmetry is a decision on the record rather than an oversight.
    const create = channelBody('hr.createPayrollComponent');
    expect(create, 'the create channel must derive the affect columns from type')
      .toMatch(/type === 'earning'/);
    for (const channel of ['hr.createPayrollComponent', 'hr.updatePayrollComponent']) {
      const body = channelBody(channel);
      expect(body, channel + ' must not read the affect columns from the payload')
        .not.toMatch(/p\.affectsGrossSalary|p\.affectsTax|p\.affectsSocialInsurance/);
    }
    expect(channelBody('hr.updatePayrollComponent'), 'the update channel must not write the affect columns either')
      .not.toMatch(/affects_gross_salary =|affects_tax =|affects_social_insurance =/);
  });

  it('the adapter interface offers no approver or audit-user field to pass', () => {
    // The previous tranche removed `approvedBy` from hr.updateLeaveStatus but
    // left it in the preload type, where it still invites the next caller to
    // send one. A type is an instruction, not a comment.
    const adapter = readFileSync(join(ROOT, 'src', 'core', 'database', 'adapters', 'electronPgAdapter.ts'), 'utf8');
    expect(adapter, 'the adapter type still offers an approver').not.toMatch(/approvedBy/);
    for (const method of ['getDepartments', 'createDepartment', 'updateDepartment', 'deleteDepartment',
      'getPayrollComponentsList', 'createPayrollComponent', 'updatePayrollComponent', 'deactivatePayrollComponent']) {
      expect(adapter, method + ' is missing from the hr surface').toMatch(new RegExp('\\b' + method + '\\('));
    }
  });

  it('the e2e shim mirrors the derived columns and writes no audit user', () => {
    // The shim has no session, so it must not invent one. What matters is that
    // it does not read a field the production channel would have to ignore.
    const at = shimSrc.indexOf('createPayrollComponent:');
    expect(at).toBeGreaterThan(0);
    const slice = shimSrc.slice(at, at + 1200);
    expect(slice).toMatch(/type==='earning'/);
    expect(slice, 'the shim reads an affect column from the payload')
      .not.toMatch(/p\.affectsGrossSalary|p\.affectsTax|p\.affectsSocialInsurance/);
  });

  it('accounting.createAccount writes both audit columns from the session', () => {
    const body = channelBody('accounting.createAccount');
    expect(body).toMatch(/created_by, updated_by/);
    expect(body).not.toMatch(/p\.createdBy|p\.updatedBy/);
    // and the count matches the columns the statement actually takes
    const placeholders = /VALUES \(([^)]*)\)/.exec(body)?.[1] ?? '';
    expect(placeholders.split(',')).toHaveLength(12);
  });

  it('accounting.getLedger takes the account from the caller and the company from the session', () => {
    const body = channelBody('accounting.getLedger');
    expect(body).not.toMatch(/p\.companyId/);
    expect(body).toMatch(/session\.user\.companyId/);
    // One statement, four fixed parameters: $1 account, $2 company, $3/$4 the
    // nullable window. No hand-renumbered $N anywhere — that was the pattern
    // the renderer used and the reason this needed a channel at all.
    expect(body).toMatch(/\$3::date IS NULL/);
    expect(body).toMatch(/\$4::date IS NULL/);
    expect(body).not.toMatch(/replace\(/);
    const params = /params: \[([\s\S]*?)\],/.exec(body)?.[1] ?? '';
    expect(params.split(',').map((p) => p.trim()).filter(Boolean)).toHaveLength(4);
  });
});

describe('a database failure keeps its SQLSTATE across the IPC boundary', () => {
  it('every DB channel answers with the extractor, not a bare err.message', () => {
    // Three call sites: the typed-RPC dispatcher, db:internal-query and
    // db:internal-transaction. A fourth channel that returns err.message
    // silently drops the code and the renderer falls back to prose matching.
    const uses = (dbHandler.match(/failureResponse\((err|retryErr)\)/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(3);
    for (const marker of ["'[DB] Query error:'", "'[DB] Transaction error:'", 'db:rpc:${name}']) {
      expect(dbHandler, marker + ' is gone from the main process').toContain(marker);
    }
    // The RPC dispatcher itself must return the envelope, not the raw message.
    const at = dbHandler.indexOf('const registerRpc');
    const dispatcher = dbHandler.slice(at, dbHandler.indexOf('// accounting.getAccounts', at));
    expect(dispatcher).toMatch(/return failureResponse\(err\)/);
    expect(dispatcher).not.toMatch(/return \{ success: false, error: err\.message \}/);
  });

  it('the extractor only accepts a real SQLSTATE', () => {
    const at = dbHandler.indexOf('function pgFailurePayload');
    expect(at).toBeGreaterThan(0);
    const body = dbHandler.slice(at, dbHandler.indexOf('\n}', at));
    // five characters, letters included — a digits-only test drops half of SQLSTATE
    expect(body).toMatch(/\[0-9A-Za-z\]\{5\}/);
  });
});
