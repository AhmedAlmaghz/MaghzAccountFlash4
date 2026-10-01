import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A partial update is two implementations of one allowlist.
 *
 * `updateDepartment` and `updatePayrollComponent` send only the keys the form
 * changed, so the COLUMN list is built twice: once in the renderer for PGlite and
 * once in the main process for the desktop. If the two lists drift, the desktop
 * silently stops updating a field the browser still updates — a field that is
 * present in the UI, saved without complaint, and unchanged in the database.
 * Nothing else in the suite can see it: the unit tests exercise the fallback, the
 * e2e shim is a third copy, and the arithmetic is all `success: true`.
 *
 * So the two are compared directly, in order, as whole lists. Sampling is what
 * made an earlier check pass a message two characters short of the real one.
 *
 * The second assertion is the reason the lists are allowed to be built at all:
 * a payload names WHICH fields change, never WHICH columns. `company_id` or
 * `created_by` appearing in either list would mean the renderer could steer the
 * tenant or forge the audit trail, so both are pinned absent by name.
 */
const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
const HR_API = readFileSync(join(ROOT, 'src', 'modules', 'hr', 'api.ts'), 'utf8');
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

/** Columns the renderer pushes, in order, for the same partial update. */
function rendererColumns(method: string): string[] {
  const at = HR_API.indexOf(`async ${method}(`);
  expect(at, method + ' is missing from hr/api.ts').toBeGreaterThan(0);
  // Start the body at `try {`, not at the signature. A multi-line parameter type
  // (`data: {` ... `}, _userId?: string)`) also begins a line with `  },`, so
  // slicing to the first one truncated updatePayrollComponent before a single
  // fields.push — which reads as an empty list and passes a divergence check.
  const bodyStart = HR_API.indexOf('\n    try {', at);
  expect(bodyStart, method + ' has no try block').toBeGreaterThan(0);
  const body = HR_API.slice(bodyStart, HR_API.indexOf('\n  },', bodyStart));
  const out: string[] = [];
  for (const m of body.matchAll(/fields\.push\(\s*[`']([a-z_]+)\s*=\s*(?:\$|NOW\(\))/g)) out.push(m[1]);
  return out;
}

const NEVER_SETTABLE = ['company_id', 'created_by', 'id'];

describe('a partial update has the same column list on both sides of the bridge', () => {
  it('hr.updateDepartment: main and renderer assign the same columns, in order', () => {
    const compose = channelCompose('hr.updateDepartment');
    const channel = channelColumns(compose, { id: ID, name: 'Ops', managerId: null });
    const renderer = rendererColumns('updateDepartment');
    expect(channel.length, 'the channel assigned nothing — a broken SET would pass an empty compare')
      .toBeGreaterThan(0);
    expect(channel, 'hr.updateDepartment column lists diverged; a field would update on one platform only')
      .toEqual(renderer);
  });

  it('hr.updatePayrollComponent: main and renderer assign the same columns, in order', () => {
    const compose = channelCompose('hr.updatePayrollComponent');
    const channel = channelColumns(compose, {
      id: ID, nameAr: 'Bonus', nameEn: 'Bonus', code: 'BON', type: 'earning',
      calculationMethod: 'fixed', defaultAmount: 1, isActive: true,
    });
    const renderer = rendererColumns('updatePayrollComponent');
    expect(channel.length, 'the channel assigned nothing — a broken SET would pass an empty compare')
      .toBeGreaterThan(0);
    expect(channel, 'hr.updatePayrollComponent column lists diverged; a field would update on one platform only')
      .toEqual(renderer);
  });

  it('neither list can name the tenant or the audit columns', () => {
    const composeDept = channelCompose('hr.updateDepartment');
    const composeComp = channelCompose('hr.updatePayrollComponent');
    const lists = [
      channelColumns(composeDept, { id: ID, name: 'Ops', managerId: null, companyId: 'x', createdBy: 'y' } as never),
      channelColumns(composeComp, { id: ID, nameAr: 'Bonus', type: 'earning', companyId: 'x', createdBy: 'y' } as never),
      rendererColumns('updateDepartment'),
      rendererColumns('updatePayrollComponent'),
    ];
    for (const cols of lists) {
      for (const forbidden of NEVER_SETTABLE) {
        expect(cols, forbidden + ' is settable by a partial update').not.toContain(forbidden);
      }
    }
  });

  it('a payload naming a forbidden column does not widen the SET clause', () => {
    // The channel decides the columns; the payload only says which ones change.
    const compose = channelCompose('hr.updateDepartment');
    const honest = channelColumns(compose, { id: ID, name: 'Ops' });
    const hostile = channelColumns(compose, { id: ID, name: 'Ops', company_id: 'x', created_by: 'y' } as never);
    expect(hostile, 'a payload field leaked into the column list').toEqual(honest);
  });
});
