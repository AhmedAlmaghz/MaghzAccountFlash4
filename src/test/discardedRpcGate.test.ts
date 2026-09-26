/**
 * CI gate: a typed-RPC result that is DISCARDED is a silent failure waiting to
 * happen.
 *
 * The P0 this prevents: `convertQuotationToInvoice` flipped a quotation's status
 * through `updateQuotation` (which refuses any status but 'draft') and never
 * inspected the reply. The invoice was created, the quotation stayed 'sent',
 * the UI reported success, and the same quotation could be converted again —
 * duplicate invoices, silently, on desktop only.
 *
 * `fire-and-forget` IS legitimate for compensating actions (a failed release
 * must not mask the original error), so exceptions are an explicit list with
 * a reason — a review decision, never a default.
 *
 * The classifier is shared with the sensitivity cases below: a gate whose
 * predicate cannot tell `return await x` (used) from `await x;` (discarded)
 * would pass by absence, so the cases prove it can fail first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const CALL_SRC =
  "(?:invoke[A-Za-z]*Rpc\\(\\s*'[a-zA-Z_.]+'|(?:window\\.)?electronDB\\??\\.?[a-zA-Z]+\\s*\\(|getRPC\\(\\)\\.[a-zA-Z]+\\s*\\()";

/** A FRESH regex per call — sharing one /g object between two walks makes the
 *  inner scan reset the outer lastIndex (infinite loop). */
const re = () => new RegExp('await\\s+' + CALL_SRC, 'g');

/**
 * The single predicate, shared by the scan and the sensitivity cases.
 * `src` + `at` = the position of `await`; the statement walk is statement-aware
 * (a sliding line window produced false positives on adjacent lines).
 */
function classifyFrom(src: string, at: number): 'used' | 'DISCARDED' {
  const prefix = src.slice(src.lastIndexOf('\n', at - 1) + 1, at);
  if (/[=(,:?+]\s*$/.test(prefix)) return 'used';
  if (/\b(return|throw|yield)\s+$/.test(prefix)) return 'used';
  if (/=>\s*$/.test(prefix)) return 'used';

  // Walk to the end of THIS statement (multi-line aware).
  const rest = src.slice(at);
  const m0 = /^\s*await\s+/.exec(rest)!;
  let k = m0[0].length;
  let depth = 0;
  let stmt = '';
  for (; k < rest.length; k += 1) {
    const ch = rest[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    stmt += ch;
    if (depth <= 0 && (ch === ';' || ch === '\n')) break;
  }
  const tail = stmt.replace(/^\s*/, '');
  return /\.success|\.rows|\berror\b|!=|===|\bif\b|\?\?|\?\./.test(tail) ? 'used' : 'DISCARDED';
}

/** Convenience for the standalone probe strings. */
function classify(text: string): 'used' | 'DISCARDED' | null {
  const m = re().exec(text);
  if (!m) return null;
  return classifyFrom(text, m.index);
}

/**
 * Deliberate fire-and-forget. A compensating action must never mask the error
 * that triggered it — that is why these are fire-and-forget BY DESIGN.
 */
const ALLOWED_DISCARDS = new Map<string, string>([
  [
    'src/modules/sales/api.ts:await invokeSalesRpc(\'releaseQuotation\'',
    'compensating release: a failed un-claim must not mask the invoice-creation error that caused it',
  ],
  [
    'src/core/database/adapters/pgliteTransport.ts:await db.exec(',
    'DDL/seed execution: exec throws on failure, so there is no result to check',
  ],
]);

function files(): string[] {
  const out: string[] = [];
  (function walk(dir: string): void {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  })('src');
  return out;
}

const findings: Array<{ key: string; file: string; line: number }> = [];
for (const f of files()) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const scan = re();
  let m: RegExpExecArray | null;
  while ((m = scan.exec(src)) !== null) {
    if (classifyFrom(src, m.index) !== 'DISCARDED') continue;
    const line = src.slice(0, m.index).split('\n').length;
    const snippet = src.slice(m.index, src.indexOf('\n', m.index) + 1).trim();
    const key = f.replace(/\\/g, '/') + ':' + snippet.slice(0, 70);
    if ([...ALLOWED_DISCARDS.keys()].some((a) => key.startsWith(a))) continue;
    findings.push({ key, file: f.replace(/\\/g, '/'), line });
  }
}

describe('gate: no typed-RPC result is silently discarded', () => {
  it('the classifier tells used from discarded (the predicate can fail)', () => {
    const cases: Array<[string, 'used' | 'DISCARDED']> = [
      ["await invokeSalesRpc('createInvoice', { id });", 'DISCARDED'],
      ["const r = await invokeSalesRpc('createInvoice', { id });", 'used'],
      ["if (!(await invokeSalesRpc('createInvoice', { id })).success) throw new Error('x');", 'used'],
      ["return await window.electronDB.updateConfig(config);", 'used'],
      ["throw await invokeSalesRpc('x', {});", 'used'],
      ["await window.electronDB.clearAll(payload);", 'DISCARDED'],
    ];
    const wrong = cases.filter(([code, want]) => classify(code) !== want);
    expect(
      wrong.map(([c, w]) => `${c} → ${String(classify(c))} (want ${w})`),
      'the classifier cannot distinguish these — the gate would pass by absence'
    ).toEqual([]);
  });

  it('no new discarded result exists outside the reviewed list', () => {
    expect(
      findings.map((f) => `${f.file}:${f.line}  ${f.key.split(':').slice(1).join(':')}`),
      'a typed-RPC result is dropped: check it, or add it to ALLOWED_DISCARDS with a reason'
    ).toEqual([]);
  });

  it('the reviewed fire-and-forget list is not stale', () => {
    const stale: string[] = [];
    for (const [key, reason] of ALLOWED_DISCARDS) {
      const file = key.split(':')[0];
      if (!readFileSync(join(ROOT, file), 'utf8').includes(key.split(':')[1].slice(0, 30))) {
        stale.push(`${key} (call site gone — remove: ${reason})`);
      }
    }
    expect(stale).toEqual([]);
  });
});
