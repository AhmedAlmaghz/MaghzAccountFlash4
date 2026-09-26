/**
 * CI gate: every financial posting path must pass the period gates.
 *
 * The audit behind this gate found two posting paths with NO gate at all
 * (inventory.postStockAdjustment, accounting.revalueForeignBalances) while 20+
 * others had one — the drift is the danger, not any single site. A new posting
 * path that forgets the gate is the failure mode this prevents.
 *
 * Method:
 *  - Body extraction skips the return-type annotation: the first '{' after a
 *    signature often sits inside Promise<{ success: boolean }>, which truncates
 *    the body and would make every method look unguarded (that trap bit twice
 *    during this audit).
 *  - Both `assertAccountingPeriodOpen` (fiscal) and `assertPeriodOpen` (tax)
 *    count. A path may legitimately skip the tax gate only if it is listed in
 *    NO_TAX_GATE with a reason — a review decision, not a default.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const FISCAL_GATE = 'assertAccountingPeriodOpen';
const TAX_GATE = 'assertPeriodOpen';

/**
 * Extract a method body, skipping `Promise<{ … }>` return types.
 * Handles both shapes: object-literal members (`  postInvoice(…)`) and
 * top-level exported functions (`export async function reverseVoucher(…)`).
 */
function bodyOf(src: string, method: string): string | null {
  const re = new RegExp(
    '^(?: {2}(?:async )?' + method + '\\s*(?::[^=\\n]*)?\\('
    + '|export (?:async )?function ' + method + '\\s*\\('
    + '|(?:async )?function ' + method + '\\s*\\()',
    'm'
  );
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0;
  let p = src.indexOf('(', m.index + m[0].length - 1);
  for (let k = p; k < src.length; k += 1) {
    if (src[k] === '(') depth += 1;
    else if (src[k] === ')') { depth -= 1; if (depth === 0) { p = k; break; } }
  }
  let i = -1;
  let angle = 0;
  for (let k = p; k < src.length; k += 1) {
    const ch = src[k];
    if (ch === '<') { angle += 1; continue; }
    if (ch === '>') { if (angle > 0) { angle -= 1; continue; } }
    if (ch === '{' && angle === 0) { i = k; break; }
    if (ch === ';' && angle === 0) break;
  }
  if (i < 0) return null;
  depth = 0;
  for (let k = i; k < src.length; k += 1) {
    const ch = src[k];
    if (ch === '`') { k += 1; while (k < src.length && src[k] !== '`') { if (src[k] === '\\') k += 1; k += 1; } continue; }
    if (ch === "'" || ch === '"') { const q = ch; k += 1; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k += 1; k += 1; } continue; }
    if (ch === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}

/** Local (non-exported) function bodies, so gate checks can follow one hop. */
function localFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^ {0,2}(?:async )?function\s+([A-Za-z_][\w]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const b = braceBody(src, m.index);
    if (b) out.set(m[1], b);
  }
  return out;
}

/** Brace-match a body starting at the first '{' at angle-depth 0 after `from`. */
function braceBody(src: string, from: number): string | null {
  let i = -1;
  let angle = 0;
  for (let k = from; k < src.length; k += 1) {
    const ch = src[k];
    if (ch === '<') { angle += 1; continue; }
    if (ch === '>') { if (angle > 0) { angle -= 1; continue; } }
    if (ch === '{' && angle === 0) { i = k; break; }
    if (ch === ';' && angle === 0) return null;
  }
  if (i < 0) return null;
  let depth = 0;
  for (let k = i; k < src.length; k += 1) {
    const ch = src[k];
    if (ch === '`') { k += 1; while (k < src.length && src[k] !== '`') { if (src[k] === '\\') k += 1; k += 1; } continue; }
    if (ch === "'" || ch === '"') { const q = ch; k += 1; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k += 1; k += 1; } continue; }
    if (ch === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}

/** Posting paths that book journal entries and therefore must be locked. */
const POSTING_PATHS: Array<{ file: string; method: string }> = [
  { file: 'src/modules/sales/api.ts', method: 'postInvoice' },
  { file: 'src/modules/sales/api.ts', method: 'postReturn' },
  { file: 'src/modules/purchases/api.ts', method: 'postInvoice' },
  { file: 'src/modules/purchases/api.ts', method: 'postReturn' },
  { file: 'src/modules/pos/api.ts', method: 'checkout' },
  { file: 'src/modules/pos/api.ts', method: 'closeShift' },
  { file: 'src/modules/accounting/api.ts', method: 'postTransaction' },
  { file: 'src/modules/accounting/api.ts', method: 'postVoucher' },
  { file: 'src/modules/accounting/api.ts', method: 'revalueForeignBalances' },
  { file: 'src/modules/hr/api.ts', method: 'postPayrollRun' },
  { file: 'src/modules/hr/api.ts', method: 'payEndOfService' },
  { file: 'src/modules/manufacturing/api.ts', method: 'startWorkOrder' },
  { file: 'src/modules/manufacturing/api.ts', method: 'completeWorkOrder' },
  { file: 'src/modules/inventory/api.ts', method: 'postStockAdjustment' },
  { file: 'src/modules/accounting/reversal.ts', method: 'reverseTransaction' },
  { file: 'src/modules/accounting/reversal.ts', method: 'reverseSalesInvoice' },
  { file: 'src/modules/accounting/reversal.ts', method: 'reversePurchaseInvoice' },
  { file: 'src/modules/accounting/reversal.ts', method: 'reverseVoucher' },
  { file: 'src/modules/accounting/assets.ts', method: 'runDepreciation' },
  { file: 'src/modules/accounting/assets.ts', method: 'disposeFixedAsset' },
];

/**
 * Paths that legitimately skip the TAX gate — a documented review decision,
 * never a default. Each entry states why.
 */
const NO_TAX_GATE = new Map<string, string>([
  ['src/modules/accounting/reversal.ts#reverseTransaction', 'a mirrored reversal of an already-posted entry carries no new tax movement'],
  ['src/modules/accounting/reversal.ts#reverseVoucher', 'same: a mirrored reversal carries no new tax movement'],
  ['src/modules/accounting/reversal.ts#reverseSalesInvoice', 'the reversal is a real purchase return whose OWN posting is tax-gated'],
  ['src/modules/accounting/reversal.ts#reversePurchaseInvoice', 'the reversal is a real sales return whose OWN posting is tax-gated'],
  ['src/modules/hr/api.ts#payEndOfService', 'EOS settlement is a payable-vs-cash move; the accrual leg was gated when approved'],
  ['src/modules/manufacturing/api.ts#startWorkOrder', 'issuing raw materials is an internal transfer (Dr WIP / Cr inventory) — no VAT movement'],
  ['src/modules/manufacturing/api.ts#completeWorkOrder', 'FG receipt + consumption deltas are internal cost movements — no VAT movement'],
  ['src/modules/pos/api.ts#closeShift', 'the cash-difference leg (Dr shortage / Cr surplus) has no VAT movement'],
  ['src/modules/accounting/assets.ts#runDepreciation', 'depreciation carries no VAT movement by construction'],
  ['src/modules/accounting/assets.ts#disposeFixedAsset', 'disposal is a capital move; the gain/loss leg has no VAT movement'],
]);

/**
 * Paths that delegate their posting to ANOTHER module's posting method, which
 * carries its own gates. Verified by reading the code, not assumed:
 *   reverseSalesInvoice     → salesApi.postReturn      (real sales return)
 *   reversePurchaseInvoice  → purchasesApi.postReturn  (real purchase return)
 * The delegation target has its own row in POSTING_PATHS, so if it ever loses
 * its gate THAT row fails — the invariant stays protected transitively.
 */
const DELEGATED_GATE = new Map<string, string>([
  ['src/modules/accounting/reversal.ts#reverseSalesInvoice', 'salesApi.postReturn'],
  ['src/modules/accounting/reversal.ts#reversePurchaseInvoice', 'purchasesApi.postReturn'],
]);

const bodies = new Map<string, string | null>();
for (const p of POSTING_PATHS) {
  const src = readFileSync(join(ROOT, p.file), 'utf8').replace(/\r\n/g, '\n');
  let body = bodyOf(src, p.method);
  // Follow one hop into local helpers: a gate behind a private helper is
  // still a gate (reversalDateGuard). Ignoring indirection produced the same
  // false negative as updateWorkOrderStatus in the original audit.
  if (body) {
    const locals = localFunctions(src);
    for (const [name, hbody] of locals) {
      if (body.includes(name + '(')) body += '\n' + hbody;
    }
  }
  bodies.set(`${p.file}#${p.method}`, body);
}

describe('posting gate: every posting path is period-locked', () => {
  it('body extraction works (a broken extractor would pass this gate by absence)', () => {
    // Spot-check one known-good method: it must be found AND non-trivial.
    const b = bodies.get('src/modules/sales/api.ts#postInvoice');
    expect(b, 'postInvoice body was extracted').not.toBeNull();
    expect(b!.length, 'the body is not a truncated type literal').toBeGreaterThan(500);
  });

  for (const p of POSTING_PATHS) {
    const key = `${p.file}#${p.method}`;

    it(`${p.method} (${p.file.split('/').pop()}) passes the fiscal-year gate`, () => {
      const b = bodies.get(key);
      expect(b, `${key} exists — a renamed/removed posting path must update this gate`).not.toBeNull();
      const delegated = DELEGATED_GATE.get(key);
      if (delegated && b!.includes(delegated)) return; // gated by its own target row
      expect(
        b!.includes(FISCAL_GATE),
        `${key} books journal entries but never calls ${FISCAL_GATE} — a closed fiscal year would be posted into`
      ).toBe(true);
    });
  }

  it('every delegation target is itself a gated posting path', () => {
    // A delegation is only as safe as its target: if `postReturn` ever loses
    // its gate, the reversals would silently lose theirs too.
    for (const [key, target] of DELEGATED_GATE) {
      const targetMethod = target.split('.').pop()!;
      const targetPath = POSTING_PATHS.find(
        (p) => p.method === targetMethod && bodies.get(`${p.file}#${p.method}`)
      );
      expect(targetPath, `${key} delegates to ${target}, which is not a known posting path`).toBeTruthy();
      const tb = bodies.get(`${targetPath!.file}#${targetMethod}`)!;
      expect(tb.includes(FISCAL_GATE), `${target} must carry the fiscal gate itself`).toBe(true);
    }
  });

  it('paths that skip the tax gate are on the reviewed list with a reason', () => {
    const missing: string[] = [];
    for (const p of POSTING_PATHS) {
      const key = `${p.file}#${p.method}`;
      const b = bodies.get(key);
      if (!b || b.includes(TAX_GATE)) continue;
      const delegated = DELEGATED_GATE.get(key);
      if (delegated && b.includes(delegated)) continue; // tax gate comes from the target
      if (!NO_TAX_GATE.has(key)) missing.push(key);
    }
    expect(
      missing,
      'these posting paths call neither tax gate — add assertPeriodOpen, or record a reason in NO_TAX_GATE'
    ).toEqual([]);
  });

  it('the reviewed no-tax-gate list is not stale (each entry still skips it)', () => {
    const stale: string[] = [];
    for (const [key, reason] of NO_TAX_GATE) {
      const b = bodies.get(key);
      if (!b) { stale.push(`${key} (path no longer found)`); continue; }
      if (b.includes(TAX_GATE)) stale.push(`${key} (now gated — remove the exception: ${reason})`);
    }
    expect(stale).toEqual([]);
  });
});
