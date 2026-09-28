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
const GUARD = /isElectronPg\s*\(\s*\)/;

/** measured 2026-09-25, tranche 5 (document sequences) */
const CEILING = 197;

/**
 * Per-file counts at CEILING. A total alone lets a new file hide inside a
 * migrating one, so the list is pinned too: adding a sixth raw statement
 * somewhere and deleting one elsewhere still fails both tests.
 */
const BASELINE: Record<string, number> = {
  'src/core/api.ts': 23,
  'src/modules/reports/dashboards/useDashboard.ts': 18,
  'src/modules/auth/api.ts': 17,
  'src/core/services/postingService.ts': 16,
  'src/modules/accounting/assets.ts': 10,
  'src/core/utils/valuation.ts': 9,
  'src/modules/accounting/reversal.ts': 9,
  'src/modules/reports/ProfitAnalysisReport.tsx': 9,
  'src/modules/manufacturing/api.ts': 8,
  'src/core/utils/useSettings.ts': 7,
  'src/modules/tax/engine.ts': 7,
  'src/modules/accounting/yearEnd.ts': 6,
  'src/core/utils/stockPolicy.ts': 5,
  'src/core/backup/backupService.ts': 4,
  'src/core/database/adapters/remoteSchema.ts': 4,
  'src/core/utils/openingBalance.ts': 4,
  'src/modules/pos/api.ts': 4,
  'src/modules/reports/LeadConversionReport.tsx': 4,
  'src/modules/reports/StockValuationReport.tsx': 4,
  'src/modules/settings/components/CompanySetupPage.tsx': 4,
  'src/core/hooks/useDefaultPaymentAccounts.ts': 3,
  'src/modules/hr/api.ts': 3,
  'src/modules/manufacturing/components/ProductionCostReport.tsx': 3,
  'src/modules/reports/StockMovementReport.tsx': 3,
  'src/core/utils/journalEntryGenerator.ts': 2,
  'src/modules/ai/tools/wizardTools.ts': 2,
  'src/core/api/company.ts': 1,
  'src/core/database/tx.ts': 1,
  'src/core/utils/useCurrencyDisplay.ts': 1,
  'src/core/utils/userIdValidator.ts': 1,
  'src/modules/ai/engine/chatEngine.ts': 1,
  'src/modules/ai/jev/jevConfig.ts': 1,
  'src/modules/ai/tools/readTools.ts': 1,
  'src/modules/ai/tools/reportCommon.ts': 1,
  'src/modules/auth/store.ts': 1,
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
 * Split a module into function bodies by declaration, then ask each one
 * separately whether it guards its own statements.
 */
function reachableIn(text: string): number {
  const heads: Array<{ name: string; start: number }> = [];
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm;
  let m;
  while ((m = re.exec(text))) heads.push({ name: m[1] || m[2], start: m.index });

  let total = 0;
  for (let i = 0; i < heads.length; i++) {
    const body = text.slice(heads[i].start, i + 1 < heads.length ? heads[i + 1].start : text.length);
    const n = (body.match(RAW) || []).length;
    if (n && !GUARD.test(body)) total += n;
  }
  // Statements at module scope are not covered by any function guard.
  const inFunctions = heads.length
    ? text.slice(0, heads[0].start) + heads.map((h, i) =>
        text.slice(h.start, i + 1 < heads.length ? heads[i + 1].start : text.length)).reverse().join('')
    : text;
  const moduleScope = (text.match(RAW) || []).length - (inFunctions.match(RAW) || []).length;
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
});
