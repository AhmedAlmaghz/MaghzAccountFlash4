import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `paramCount` is a contract, and a wrong one is invisible until the desktop
 * calls that channel - where it surfaces as "Expected N parameter(s), got M"
 * and the feature simply stops working. No unit test catches it, because unit
 * tests never enter the main process, and the e2e shim does not enforce the
 * count at all.
 *
 * So the channels are executed. The object literal for each one is extracted
 * from dbHandler.js, evaluated with the two free identifiers it closes over
 * (UUID_RE), and its real `compose` is called with a payload carrying every
 * field the channels read. Three numbers then have to agree:
 *
 *   declared paramCount  ==  params.length  ==  highest $N in the SQL
 *
 * Count commas in a params array and you get it wrong the first time (a
 * trailing comma inflates the count by one); count them and the mistake ships.
 * Executing the code cannot be wrong about its own arity.
 *
 * Reverse-proven: when this file was written, 10 of the 15 channels under test
 * had a wrong declared count - every one of them written minutes earlier and
 * all of them invisible to the suite until this ran.
 */
const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SESSION = {
  user: {
    id: '00000000-0000-0000-0000-0000000000aa',
    companyId: '00000000-0000-0000-0000-0000000000bb',
  },
};
const PAYLOAD: Record<string, unknown> = {
  id: '00000000-0000-0000-0000-0000000000cc',
  nameAr: 'a', nameEn: 'b', code: 'c', usage: 'u', type: 't',
  appearsInSales: true, appearsInPurchases: true, appearsInInventory: true,
  appearsInManufacturing: true, hasStockTracking: true, hasBOM: true,
  defaultSalesAccountId: '00000000-0000-0000-0000-0000000000dd',
  defaultCOGSAccountId: '00000000-0000-0000-0000-0000000000dd',
  defaultInventoryAccountId: '00000000-0000-0000-0000-0000000000dd',
  defaultAccountId: '00000000-0000-0000-0000-0000000000dd',
  accountId: '00000000-0000-0000-0000-0000000000dd',
  isActive: true, conversionFactor: 1, baseUnitId: null, currentBalance: 0,
  name: 'n', branchId: null, responsibleUserId: null, parentId: null,
  budgetAmount: 0, calculationMethod: 'fixed', defaultAmount: 1,
  affectsGrossSalary: true, affectsTax: true, affectsSocialInsurance: true,
};

/** The whole object literal, found by counting braces and skipping literals. */
function literalFor(channel: string): string {
  const i = SRC.indexOf(`registerRpc('${channel}'`);
  expect(i, channel + ' is not registered').toBeGreaterThan(0);
  const objStart = SRC.indexOf('{', i);
  let depth = 0;
  for (let k = objStart; k < SRC.length; k++) {
    const c = SRC[k];
    if (c === '`') { const e = SRC.indexOf('`', k + 1); if (e > 0) k = e; continue; }
    if (c === "'") { const e = SRC.indexOf("'", k + 1); if (e > 0) k = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(objStart, k + 1); }
  }
  throw new Error(channel + ': unterminated object literal');
}

type ComposeResult = { sql: string; params: unknown[] };
type ChannelDef = { paramCount?: number; validate?: (p: unknown, s: unknown) => void; compose: (p: unknown, s: unknown) => ComposeResult };

function evaluate(channel: string): ChannelDef {
  return new Function('UUID_RE', `return (${literalFor(channel)});`)(UUID_RE) as ChannelDef;
}

/**
 * Channels whose compose reads a payload field this table does not cover, or
 * that compose more than one statement. Listed with the reason, so an omission
 * has to be argued for rather than inherited.
 */
const NOT_ARITY_CHECKED: Record<string, string> = {};

const CHANNELS = [
  'core.createProductType', 'core.updateProductType', 'core.deleteProductType',
  'core.createUnit', 'core.updateUnit', 'core.deleteUnit',
  'core.createCashBox', 'core.updateCashBox', 'core.deleteCashBox',
  'core.createCostCenter', 'core.updateCostCenter', 'core.deleteCostCenter',
  'core.createPayrollComponent', 'core.updatePayrollComponent', 'core.updateDefaultAccount',
];

describe('typed RPC arity is the contract it declares', () => {
  it('paramCount equals params.length equals the highest placeholder', () => {
    const bad: string[] = [];
    for (const channel of CHANNELS) {
      if (channel in NOT_ARITY_CHECKED) continue;
      let def: ChannelDef;
      try {
        def = evaluate(channel);
      } catch (e) {
        bad.push(`${channel}: could not evaluate (${(e as Error).message})`);
        continue;
      }
      let out: ComposeResult;
      try {
        out = def.compose(PAYLOAD, SESSION);
      } catch (e) {
        bad.push(`${channel}: compose threw (${(e as Error).message})`);
        continue;
      }
      let maxPh = 0;
      for (const m of out.sql.matchAll(/\$(\d+)/g)) maxPh = Math.max(maxPh, Number(m[1]));
      if (def.paramCount !== out.params.length) {
        bad.push(`${channel}: paramCount ${def.paramCount} != params.length ${out.params.length}`);
      }
      if (maxPh !== out.params.length) {
        bad.push(`${channel}: highest placeholder $${maxPh} != params.length ${out.params.length}`);
      }
    }
    expect(bad, 'a wrong paramCount only fails on the desktop, as "Expected N parameter(s)"').toEqual([]);
  });

  it('a write channel validates the id it will use in the WHERE clause', () => {
    // Without this a malformed id reaches PostgreSQL and the failure arrives as
    // a syntax error against a uuid column rather than as a rejected request.
    for (const channel of CHANNELS) {
      const def = evaluate(channel);
      const usesId = /WHERE id = \$\d+::uuid/.test(def.compose(PAYLOAD, SESSION).sql);
      if (!usesId) continue;
      expect(def.validate, channel + ' filters on id but validates nothing').toBeTypeOf('function');
      expect(() => def.validate!({ ...PAYLOAD, id: 'not-a-uuid' }, SESSION),
        channel + ' accepted a malformed id').toThrow();
      expect(() => def.validate!({ ...PAYLOAD, id: PAYLOAD.id }, SESSION),
        channel + ' rejected a well-formed id').not.toThrow();
    }
  });

  it('every write channel takes its company from the session, never the payload', () => {
    for (const channel of CHANNELS) {
      const def = evaluate(channel);
      const { params } = def.compose(PAYLOAD, SESSION);
      // A payload company must not be able to steer the row. Every channel here
      // either filters on the session company or inserts it.
      const sql = def.compose(PAYLOAD, SESSION).sql;
      const usesPayloadCompany = /company_id\s*=\s*\$\d+(?!::uuid)/.test(sql) && !/company_id = \$\d+::uuid/.test(sql);
      expect(usesPayloadCompany, channel + ' may filter on a payload company').toBe(false);
      expect(params).toContain(SESSION.user.companyId);
    }
  });

  it('has an argued reason for every channel it skips', () => {
    for (const [channel, why] of Object.entries(NOT_ARITY_CHECKED)) {
      expect(why.trim().length, channel + ' is skipped with no stated reason').toBeGreaterThan(20);
      expect(SRC, channel + ' is skipped but does not exist').toContain(`registerRpc('${channel}'`);
    }
  });
});
