/**
 * CI gate: a financial follow-up step whose result is DISCARDED is a silent
 * ledger divergence.
 *
 * What this found and now prevents:
 *  - `createProduct`   — opening-stock movement + balanced JE dropped, plain
 *                        success reported (Phase FIN-1's `postProductStockOpening`).
 *  - `createCustomer` / `createSupplier` — the opening-balance JE dropped, so
 *                        the party's statement balanced while the ledger did not.
 *  - `resolveLineUnits` — a failed unit self-heal left `chosen` undefined and
 *                        the line fell back to factor=1, writing a wrong
 *                        base_quantity (silent inventory corruption).
 *
 * A follow-up write is a FACT about the ledger, not a side effect: it must be
 * read. Seed/bootstrap contexts are allowlisted because a seed is a bulk script
 * whose per-row contract is "insert if missing", checked by its own runner.
 *
 * The classifier is shared with the sensitivity cases: a gate whose predicate
 * cannot tell `return await x` (used) from `await x;` (discarded) — or a bare
 * imported `postX(…)` from a read — passes by absence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const AWAIT_RE = () => /await\s+/g;

function resultUsed(src: string, at: number): boolean {
  const prefix = src.slice(src.lastIndexOf('\n', at - 1) + 1, at);
  if (/[=(,:?+]\s*$/.test(prefix)) return true;
  if (/\b(return|throw|yield)\s+$/.test(prefix)) return true;
  if (/=>\s*$/.test(prefix)) return true;

  const rest = src.slice(at);
  const m0 = /^\s*await\s+/.exec(rest);
  if (!m0) return true;
  let k = m0[0].length;
  let depth = 0;
  let stmt = m0[0];
  for (; k < rest.length; k += 1) {
    const ch = rest[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    stmt += ch;
    if (depth <= 0 && (ch === ';' || ch === '\n')) break;
  }
  const tail = stmt.replace(/^\s*/, '');
  return /\.success|\.rows|\berror\b|!=|===|\bif\b|\?\?|\?\./.test(tail);
}

function statementInfo(src: string, at: number): { stmt: string; callee: string; sql: string } {
  const rest = src.slice(at);
  const m0 = /^\s*await\s+/.exec(rest);
  // Keep the `await` prefix: dropping it made the callee regex never match, so
  // both callee branches of the classifier were dead code.
  let k = m0 ? m0[0].length : 0;
  let depth = 0;
  let stmt = m0 ? m0[0].replace(/^\s+/, '') : '';
  for (; k < rest.length; k += 1) {
    const ch = rest[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    stmt += ch;
    if (depth <= 0 && (ch === ';' || ch === '\n')) break;
  }
  const callee = (/await\s+([A-Za-z_$][\w$.?]*)\s*\(/.exec(stmt) || [])[1] || '';
  const sql = (/`([\s\S]*?)`|'(SELECT|INSERT|UPDATE|DELETE|WITH)([\s\S]*?)'/i.exec(stmt) || [])[1] || '';
  return { stmt, callee, sql };
}

/**
 * The GATE covers LEDGER-POSTING helpers only: a domain call that writes a
 * journal entry or a structural row whose result is dropped. A broader
 * "any discarded SQL write" rule flagged 58 items of mixed value — settings
 * upserts, audit inserts, and statements that are ELEMENTS of an
 * `adapter.transaction([...])` array (whose result IS checked at the
 * transaction envelope). A gate that cries wolf 58 times becomes a meaningless
 * allowlist, so the broad sweep stays a reported audit and the blocking rule
 * stays precise.
 */
// The callee arrives as a member expression (`inventoryApi.ensureBaseProductUnit`),
// so match the verb at the start OR the name at the end — an alternation with
// `\.?` did not work because the extractor always keeps the dot.
const LEDGER_CALL = /^(post[A-Z]|\.?ensureBaseProductUnit$|applySeedCompanyProfile$)/;
const LEDGER_NAMES = ['ensureBaseProductUnit', 'applySeedCompanyProfile'];

function isLedgerStep(info: { callee: string; sql: string }): boolean {
  if (LEDGER_CALL.test(info.callee)) return true;
  return LEDGER_NAMES.some((n) => info.callee === n || info.callee.endsWith('.' + n));
}

/**
 * Seed / bootstrap contexts: a bulk script whose per-row contract is "insert if
 * missing", verified by its own runner. Fire-and-forget is the design there.
 */
const SEED_CONTEXT = /(pgliteAdapter|neonHttpAdapter|electronBridge)\.ts$/;

/**
 * Reviewed best-effort heals: the ensure call itself is allowed to be
 * fire-and-forget because the code IMMEDIATELY verifies the outcome by
 * re-reading (and, for the AI path, by hard-erroring on an empty unit list).
 * The rule: a heal may not check its own return ONLY if the next statement
 * proves whether it worked.
 */
const REVIEWED_BEST_EFFORT = new Map<string, string>([
  [
    'src/modules/ai/tools/writeTools/shared.ts:await inventoryApi.ensureBaseProductUnit(',
    'unit self-heal: the very next lines re-read and hard-error on an empty list, so a failed heal cannot reach factor=1',
  ],
  [
    'src/modules/inventory/hooks/useInventory.ts:await inventoryApi.ensureBaseProductUnit(',
    'read-path self-heal in the units hook: the result is re-read immediately, and an empty list renders as "no units" (no ledger effect)',
  ],
]);

const findings: string[] = [];
let ledgerCalls = 0;
let reviewedHits = 0;
for (const rel of listFiles('src')) {
  if (SEED_CONTEXT.test(rel)) continue;
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const scan = AWAIT_RE();
  let m: RegExpExecArray | null;
  while ((m = scan.exec(src)) !== null) {
    const info = statementInfo(src, m.index);
    if (!isLedgerStep(info)) continue;
    ledgerCalls += 1;
    if (resultUsed(src, m.index)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const key = `${rel}:${info.stmt.replace(/\s+/g, ' ')}`;
    if ([...REVIEWED_BEST_EFFORT.keys()].some((k) => key.startsWith(k))) { reviewedHits += 1; continue; }
    findings.push(`${rel}:${line}  ${info.stmt.replace(/\s+/g, ' ').slice(0, 96)}`);
  }
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  (function walk(dir: string): void {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  })(root);
  return out;
}

describe('gate: financial follow-up steps are never silently discarded', () => {
  it('the classifier separates a ledger-posting step from a read, and used from discarded', () => {
    const cases: Array<[string, boolean, boolean]> = [
      ['await postCustomerOpening(companyId, opts);', true, false],
      ['const o = await postCustomerOpening(companyId, opts);', true, true],
      ['await inventoryApi.ensureBaseProductUnit(pid, cid);', true, false],
      ['await postProductStockOpening(companyId, opts);', true, false],
      ['await salesApi.getInvoiceById(id, cid);', false, false],
      ['return await window.electronDB.updateConfig(c);', false, true],
    ];
    const wrong = cases.filter(([code, w, u]) => {
      const at = code.indexOf('await ');
      if (at < 0) return true;
      return isLedgerStep(statementInfo(code, at)) !== w || resultUsed(code, at) !== u;
    });
    expect(
      wrong.map(([c]) => c),
      'the classifier is blind on a known case — the gate would pass by absence'
    ).toEqual([]);
  });

  it('every ledger-posting call site is actually being checked by something', () => {
    // A classifier that matched nothing would also pass the test above; this
    // proves the rule still has teeth on the real codebase.
    expect(ledgerCalls, 'the gate matched no ledger calls at all — is the rule live?').toBeGreaterThan(10);
    expect(reviewedHits, 'the reviewed-exception list matched nothing — is it stale?').toBeGreaterThan(0);
  });

  it('no ledger-posting step in a user path drops its result', () => {
    expect(
      findings,
      'a ledger posting drops its result: the ledger silently diverges from the document. ' +
      'Read it and report partial success (warning), or add a reviewed exception.'
    ).toEqual([]);
  });
});
