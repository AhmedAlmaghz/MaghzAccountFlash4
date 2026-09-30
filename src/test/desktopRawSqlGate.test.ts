import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A ratchet on DESKTOP-REACHABLE raw SQL.
 *
 * `rawSqlRatchetGate` counts raw statements. This one counts the subset that the
 * desktop can actually execute, which is a different and much smaller set.
 *
 * The distinction matters because the desktop adapter is not a second
 * implementation - it forwards straight to the legacy channel:
 *
 *     async query(sql, params) {
 *       const raw = await getDB()._exec(convertPlaceholders(sql), params);
 *     }
 *
 * So any `adapter.query(...)` the desktop reaches is raw SQL crossing the
 * process boundary. The only thing standing between a call site and that
 * channel is a branch on `isElectronPg()`.
 *
 * A function that checks the branch before its statements is a PGlite fallback
 * and is fine - PGlite is single-tenant, in-process, and the query never leaves
 * the renderer. A function that does not check is desktop-reachable by
 * construction, however well-intentioned the code around it is.
 *
 * Function granularity, not file granularity: guarding four functions in
 * `core/api.ts` must not launder the twenty-three raw statements in its
 * unguarded neighbours. An earlier file-level version of this scanner did
 * exactly that and reported the tranche as a win twice over.
 *
 * Lowering CEILING is the only way to raise it, so a migration has to be real
 * to move the number.
 */
const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'test-results', 'playwright-report']);
const RAW = /adapter\.(query|transaction|createTransaction)\s*(<[^()]*?>)?\s*\(/g;

/**
 * measured 2026-09-25, tranche 7a (reference reads); lowered to 377 when
 * createAccount + getAccountLedger moved onto adapter channels — three
 * renderer-composed statements gone, one typed RPC and one fixed-slot ledger
 * statement replacing them (the ledger alone used to be three hand-built
 * shapes with a manual $N renumbering).
 */
const CEILING = 377;

/**
 * Guard idioms, each paired with the test that proves the guard actually holds.
 * A guard is only a guard if control flow cannot reach the statement past it,
 * and that is not something a counter can establish:
 *  - `isElectronPg()` is a plain branch; every migration using it also returns
 *    inside it, and the tax-engine assertion in rawSqlRatchetGate pins that.
 *  - `mainAuthBridge()` is non-null only when the preload bridge exists AND the
 *    db mode is server-PG, so the raw fallback underneath is unreachable on the
 *    desktop. That one is proven by BEHAVIOUR in
 *    `src/modules/auth/api.bridgeGuard.test.ts`, which installs a bridge and
 *    asserts no auth method touches the adapter - four different valid shapes
 *    of the same guard exist, so a regex for "the guard string" would have
 *    passed a method whose guard had been broken.
 */
const GUARD_RE = /(isElectronPg\s*\(\s*\)|mainAuthBridge\s*\(\s*\))/;

/**
 * Per-file counts at CEILING. A total alone lets a new file hide inside a
 * migrating one, so the list is pinned too: adding a sixth raw statement
 * somewhere and deleting one elsewhere still fails both tests.
 */
const BASELINE: Record<string, number> = {
  'src/modules/hr/api.ts': 44,
  'src/modules/accounting/api.ts': 36,
  'src/modules/manufacturing/api.ts': 34,
  'src/modules/inventory/api.ts': 27,
  'src/modules/purchases/api.ts': 24,
  'src/modules/reports/dashboards/useDashboard.ts': 18,
  'src/modules/sales/api.ts': 14,
  'src/core/services/postingService.ts': 10,
  'src/modules/accounting/assets.ts': 10,
  'src/modules/pos/api.ts': 10,
  'src/core/utils/valuation.ts': 9,
  'src/modules/accounting/reversal.ts': 9,
  'src/modules/crm/api.ts': 9,
  'src/modules/reports/ProfitAnalysisReport.tsx': 9,
  'src/core/utils/useSettings.ts': 7,
  'src/modules/tax/engine.ts': 7,
  'src/modules/accounting/yearEnd.ts': 6,
  'src/modules/settings/components/CurrenciesPage.tsx': 6,
  'src/modules/settings/components/VatSettingsPage.tsx': 6,
  'src/core/utils/stockPolicy.ts': 5,
  'src/core/api.ts': 4,
  'src/core/backup/backupService.ts': 4,
  'src/core/database/adapters/remoteSchema.ts': 4,
  'src/core/utils/openingBalance.ts': 4,
  'src/modules/reports/LeadConversionReport.tsx': 4,
  'src/modules/reports/StockValuationReport.tsx': 4,
  'src/modules/settings/components/BranchesPage.tsx': 4,
  'src/modules/settings/components/CompanySetupPage.tsx': 4,
  'src/core/hooks/useDefaultPaymentAccounts.ts': 3,
  'src/core/utils/journalEntryGenerator.ts': 3,
  'src/modules/manufacturing/components/ProductionCostReport.tsx': 3,
  'src/modules/reports/StockMovementReport.tsx': 3,
  'src/core/services/BaseService.ts': 2,
  'src/modules/ai/tools/wizardTools.ts': 2,
  'src/modules/manufacturing/components/VarianceAnalysisReport.tsx': 2,
  'src/modules/pos/components/PosSettingsPage.tsx': 2,
  'src/modules/reports/LowStockAlertReport.tsx': 2,
  'src/modules/reports/OpportunityPipelineReport.tsx': 2,
  'src/modules/settings/components/HrSettingsPage.tsx': 2,
  'src/core/api/company.ts': 1,
  'src/core/audit/auditLogger.ts': 1,
  'src/core/database/adapters/types.ts': 1,
  'src/core/database/tx.ts': 1,
  'src/core/utils/useCurrencyDisplay.ts': 1,
  'src/core/utils/userIdValidator.ts': 1,
  'src/modules/ai/engine/chatEngine.ts': 1,
  'src/modules/ai/jev/jevConfig.ts': 1,
  'src/modules/ai/jev/jevTools.ts': 1,
  'src/modules/ai/tools/readTools.ts': 1,
  'src/modules/ai/tools/reportCommon.ts': 1,
  'src/modules/auth/components/UsersPage.tsx': 1,
  'src/modules/auth/store.ts': 1,
  'src/modules/pos/components/PosReportsPage.tsx': 1,
  'src/modules/pos/components/PosTerminalPage.tsx': 1,
  'src/modules/reports/components/CustomReportBuilder.tsx': 1,
  'src/modules/reports/CustomerStatementReport.tsx': 1,
  'src/modules/reports/InventoryAnalysisReport.tsx': 1,
  'src/modules/reports/SalesAnalysisReport.tsx': 1,
  'src/modules/reports/SupplierStatementReport.tsx': 1,
};

/**
 * Paths whose raw SQL cannot reach the desktop because nothing in the desktop
 * build calls them. Each entry carries its reason - an unproven exemption is
 * indistinguishable from a hole.
 */
const NOT_DESKTOP_REACHABLE: Record<string, string> = {
  'src/modules/ai/api/browserBridge.ts':
    'the PGlite-side AI bridge, registered only when the renderer owns the database; the desktop equivalent is electron/aiHandler.js',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Split a module into function bodies, then ask each one separately whether it
 * guards its own statements.
 *
 * Four declaration shapes have to be recognised, and missing one silently
 * reassigns work to the wrong owner. A version that handled only `function` and
 * `const` absorbed every method of an exported object literal into whichever
 * function happened to be declared last, so a two-query helper was credited
 * with 65 calls and the file was reported as 3 instead of 68. The direction of
 * that error is the dangerous one: it under-counts the debt.
 *   - export async function name(
 *   - async function name(
 *   - export const name = ... / const name = ...
 *   - `  name: async (...)` / `  name(...)`   <- object-literal methods
 */
function heads(text: string): Array<{ start: number }> {
  const re = new RegExp(
    [
      '^(?:export\\s+)?(?:async\\s+)?function\\s+\\w+',
      '^(?:export\\s+)?const\\s+\\w+\\s*=\\s*(?:async\\s*)?\\(',
      '^\\s{2}(?:async\\s+)?\\w+\\s*:\\s*(?:async\\s*)?function\\s*\\(',
      '^\\s{2}(?:async\\s+)?\\w+\\s*\\(',
    ].join('|'),
    'gm',
  );
  const out: Array<{ start: number }> = [];
  let m;
  while ((m = re.exec(text))) out.push({ start: m.index });
  return out;
}

/**
 * A guard only covers the statements it actually diverts. Require it to appear
 * BEFORE the first raw call, and for a `return` to sit between them; otherwise
 * the raw call shares the expression or the path and stays reachable.
 *
 * Conservative on purpose: an unrecognised guard shape is counted as reachable,
 * never excused. Over-counting shows up as work to do; under-counting hides it.
 */
function isGuarded(body: string): boolean {
  const firstRaw = body.search(RAW);
  if (firstRaw < 0) return false;
  const g = GUARD_RE.exec(body.slice(0, firstRaw));
  if (!g) return false;
  return /\breturn\b/.test(body.slice(g.index + g[0].length, firstRaw));
}

function reachableIn(text: string): number {
  const found = heads(text);
  let total = 0;
  for (let i = 0; i < found.length; i++) {
    const body = text.slice(found[i].start, i + 1 < found.length ? found[i + 1].start : text.length);
    const n = (body.match(RAW) || []).length;
    if (n && !isGuarded(body)) total += n;
  }
  const inside = found.length
    ? found.map((h, i) => text.slice(h.start, i + 1 < found.length ? found[i + 1].start : text.length)).join('')
    : '';
  const moduleScope = (text.match(RAW) || []).length - (inside.match(RAW) || []).length;
  return total + Math.max(0, moduleScope);
}

function offenders(): Array<{ rel: string; n: number }> {
  const out: Array<{ rel: string; n: number }> = [];
  for (const f of sourceFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (rel in NOT_DESKTOP_REACHABLE) continue;
    const n = reachableIn(readFileSync(f, 'utf8'));
    if (n) out.push({ rel, n });
  }
  return out.sort((a, b) => b.n - a.n);
}

describe('desktop-reachable raw SQL is a ratchet', () => {
  it('the desktop-reachable total matches the ratchet', () => {
    const total = offenders().reduce((a, b) => a + b.n, 0);
    expect(total,
      'desktop-reachable raw SQL drifted from CEILING; guard the statements behind isElectronPg() or update the number deliberately')
      .toBe(CEILING);
  });

  it('no new file becomes desktop-reachable, and no file gains calls', () => {
    const now: Record<string, number> = {};
    for (const o of offenders()) now[o.rel] = o.n;

    const added = Object.keys(now).filter((r) => !(r in BASELINE));
    expect(added, 'a new module reaching the desktop with raw SQL must be migrated or justified in NOT_DESKTOP_REACHABLE').toEqual([]);

    const grew = Object.keys(now)
      .filter((r) => now[r] > (BASELINE[r] ?? 0))
      .map((r) => `${r}: ${BASELINE[r] ?? 0} -> ${now[r]}`);
    expect(grew, 'desktop-reachable raw SQL grew in an already-listed file').toEqual([]);
  });

  it('every exemption states a reason', () => {
    for (const [rel, why] of Object.entries(NOT_DESKTOP_REACHABLE)) {
      expect(why.trim().length, rel + ' is exempt with no stated reason').toBeGreaterThan(20);
      expect(() => readFileSync(join(ROOT, rel), 'utf8'), rel + ' is exempt but does not exist')
        .not.toThrow();
    }
  });

  it('the document-numbering path is not desktop-reachable', () => {
    // Every invoice, voucher, receipt and product code runs through these four
    // functions, and getNextDocumentNumber interpolates a table name on the
    // PGlite path. Pins the tranche that moved the maps into the main process.
    const api = readFileSync(join(ROOT, 'src', 'core', 'api.ts'), 'utf8');
    for (const fn of [
      'export async function getDocumentSequences',
      'export async function updateDocumentSequence',
      'export async function getNextDocumentNumber',
      'export async function peekNextDocumentNumber',
    ]) {
      const start = api.indexOf(fn);
      expect(start, fn + ' is missing from core/api.ts').toBeGreaterThan(0);
      const body = api.slice(start, api.indexOf('\n}', start) + 2);
      expect(body, fn + ' must branch on isElectronPg before its statements').toContain('isElectronPg()');
    }
  });

  it('the numbering maps exist on the main side of the bridge', () => {
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    for (const name of ['DOC_TYPE_TO_TABLE', 'DOC_TYPE_TO_NUMBER_COLUMN']) {
      expect(db, name + ' must live in the main process, not the renderer').toContain('const ' + name + ' = {');
    }
    for (const ch of ['core.getNextDocumentNumber', 'core.peekNextDocumentNumber', 'core.getDocumentSequences', 'core.updateDocumentSequence']) {
      expect(db).toContain("registerRpc('" + ch + "'");
    }
  });

  it('the reference reads agree across renderer, main process and e2e shim', () => {
    // A migrated read exists in three places. If any one of them drifts on the
    // table, the is_active filter or the ordering, the browser and the desktop
    // quietly show different reference rows in the same dropdown - a defect no
    // unit test sees, because unit tests only ever run one of the three.
    const api = readFileSync(join(ROOT, 'src', 'core', 'api.ts'), 'utf8');
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    const shim = readFileSync(join(ROOT, 'e2e', 'vite-e2e-plugin.ts'), 'utf8');
    const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/::uuid/g, '').trim();
    const tailOf = (stmt: string) => norm(/WHERE company_id = \$1\s*(.*)$/.exec(stmt)?.[1] ?? stmt);

    const reads: Array<[string, string]> = [
      ['getProductTypes', 'product_types'],
      ['getUnits', 'units'],
      ['getCashBoxes', 'cash_boxes'],
      ['getCostCenters', 'cost_centers'],
      ['getPayrollComponents', 'payroll_components'],
      ['getDefaultAccounts', 'default_accounts'],
    ];

    for (const [method, table] of reads) {
      const fnStart = api.indexOf('export async function ' + method + '(');
      expect(fnStart, method + ' is missing from core/api.ts').toBeGreaterThan(0);
      const seg = api.slice(fnStart, fnStart + 1200);
      const m = /SELECT \* FROM (\w+) WHERE company_id = \$1(.*?)'/.exec(seg);
      expect(m, method + ' fallback statement not found').not.toBeNull();
      expect(m![1], method + ' fallback table').toBe(table);
      const apiTail = tailOf('WHERE company_id = $1' + m![2]);

      const chIdx = db.indexOf("registerRpc('core." + method + "'");
      expect(chIdx, method + ' has no channel in the main process').toBeGreaterThan(0);
      const dm = /sql: 'SELECT \* FROM (\w+) WHERE company_id = \$1::uuid(.*?)'/.exec(db.slice(chIdx, chIdx + 400));
      expect(dm, method + ' main statement not found').not.toBeNull();
      expect(dm![1], method + ' main table drifted').toBe(table);
      expect(tailOf('WHERE company_id = $1' + dm![2]), method + ' main filter/order drifted').toBe(apiTail);

      const sIdx = shim.indexOf(method + ':async');
      expect(sIdx, method + ' is missing from the e2e shim').toBeGreaterThan(0);
      const sm = /post\("SELECT \* FROM (\w+) WHERE company_id = \$1::uuid (.*?)"/.exec(shim.slice(sIdx, sIdx + 400));
      expect(sm, method + ' shim statement not found').not.toBeNull();
      expect(sm![1], method + ' shim table drifted').toBe(table);
      expect(tailOf('WHERE company_id = $1 ' + sm![2]), method + ' shim filter/order drifted').toBe(apiTail);
    }
  });

  it('registers channels literally, never in a loop over a name table', () => {
    // typedRpcSurfaceGate discovers channels by grepping `registerRpc('name'`.
    // A loop over an array of names keeps the code DRY and silently removes
    // those names from the source, so the gate stops checking their preload
    // wiring and a missing bridge method ships unnoticed. Verbose source,
    // verified wiring.
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    expect(db, 'channels must be registered one by one so the gate can see them')
      .not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*registerRpc\(\s*[a-zA-Z_$][\w$]*\s*,/);
  });

  it('every method the auth gate excuses has a main-process counterpart', () => {
    // auth/api.ts is excused from the count because mainAuthBridge() guards it,
    // which is only true while each method routes through the bridge. This pins
    // the wiring so adding a raw method there without a handler fails here
    // rather than silently rejoining the desktop-reachable set.
    const api = readFileSync(join(ROOT, 'src', 'modules', 'auth', 'api.ts'), 'utf8');
    const preload = readFileSync(join(ROOT, 'electron', 'preload.cjs'), 'utf8');
    const main = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');

    expect(api, 'getUserById must consult the bridge before its raw fallback')
      .toContain('mainAuth.getUserById(id)');
    for (const twin of ['electron/preload.cjs', 'electron/preload.js']) {
      const p = readFileSync(join(ROOT, twin), 'utf8');
      expect(p, twin + ' must expose auth:get-user-by-id').toContain("'auth:get-user-by-id'");
    }
    expect(preload).toContain('getUserById');
    expect(main).toContain("'auth:get-user-by-id'");
    // company_id must come from the session, never the payload
    const handler = main.slice(main.indexOf("'auth:get-user-by-id'"), main.indexOf("'auth:create-user'"));
    expect(handler).toContain('session.user.companyId');
    expect(handler).not.toMatch(/company_id\s*=\s*\$\d+::uuid[^\n]*\n[\s\S]{0,200}p\./);
  });
});
