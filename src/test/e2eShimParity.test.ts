import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parity gate for the e2e bridge shim (e2e/vite-e2e-plugin.ts).
 *
 * The shim is the app's substitute for the main process in the browser. It
 * drifted from production in three ways that made whole screens silently
 * empty or unwritable:
 *
 *  1. the paged reads answered with the old `COUNT(*) OVER()` shape, which
 *     has no `has_row` column — splitPagedRpcRows() dropped every row;
 *  2. a surface used `this._cid()` without defining it, and an ARROW method
 *     used `this._cid()` at all (an arrow captures `this` lexically, so it
 *     never sees the called object);
 *  3. a query passed a different number of parameters than it had
 *     placeholders — PostgreSQL rejects the statement and the write fails.
 *
 * These are cheap to check statically, so they are checked here.
 */

const SHIM_PATH = resolve(process.cwd(), 'e2e/vite-e2e-plugin.ts');
const shim = readFileSync(SHIM_PATH, 'utf8');
const shimBody = shim.slice(shim.indexOf('window.electronDB={'));

const SURFACES = [
  'accounting', 'inventory', 'contacts', 'crm', 'manufacturing', 'hr',
  'sales', 'pos', 'tax', 'purchases', 'audit', 'core',
];

function surfaceBlock(name: string): string {
  const k = shimBody.indexOf(name + ':{');
  if (k < 0) return '';
  let depth = 0;
  for (let j = k + name.length + 1; j < shimBody.length; j++) {
    if (shimBody[j] === '{') depth++;
    else if (shimBody[j] === '}') {
      depth--;
      if (depth === 0) return shimBody.slice(k, j + 1);
    }
  }
  return '';
}

/** Count the top-level entries of a params array literal. */
function countParams(src: string): number {
  let depth = 0;
  let count = 0;
  let inStr: string | null = null;
  let sawValue = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; sawValue = true; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (c === ',' && depth === 0) { count++; continue; }
    if (!/\s/.test(c)) sawValue = true;
  }
  return sawValue ? count + 1 : 0;
}

describe('e2e bridge shim parity', () => {
  it('every surface that calls this._cid() defines it', () => {
    const broken: string[] = [];
    for (const name of SURFACES) {
      const block = surfaceBlock(name);
      if (!block) continue;
      if (/this\._cid\(\)/.test(block) && !/(^|[,{])\s*_cid\s*:/.test(block)) {
        broken.push(name);
      }
    }
    expect(broken).toEqual([]);
  });

  it('no arrow method calls this._cid() (an arrow ignores the receiver)', () => {
    const offenders: string[] = [];
    const arrowRe = /:async\(([^()]*)\)=>\{/g;
    let m: RegExpExecArray | null;
    while ((m = arrowRe.exec(shimBody)) !== null) {
      const window = shimBody.slice(m.index, m.index + 400);
      if (/this\._cid\(\)/.test(window)) {
        const before = shimBody.slice(Math.max(0, m.index - 60), m.index);
        const names = [...before.matchAll(/([A-Za-z0-9_]+)\s*:\s*(?:async\s+)?(?:function\s*)?\(/g)];
        offenders.push(names.length ? names[names.length - 1][1] : '?');
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every static query passes as many params as it has placeholders', () => {
    const problems: string[] = [];
    const re = /post\(\s*(["'`])([\s\S]*?)\1\s*,\s*\[/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(shimBody)) !== null) {
      const sql = m[2];
      // Dynamic SQL (built by concatenation) cannot be counted statically.
      if (/'\s*\+|\+\s*'|\+\(/.test(sql)) continue;

      const arrStart = m.index + m[0].length - 1;
      let depth = 0;
      let end = arrStart;
      for (let i = arrStart; i < shimBody.length; i++) {
        if (shimBody[i] === '[') depth++;
        else if (shimBody[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
      const params = countParams(shimBody.slice(arrStart + 1, end));
      const placeholders = new Set((sql.match(/\$(\d+)/g) || []).map((x) => Number(x.slice(1))));
      const max = placeholders.size ? Math.max(...placeholders) : 0;
      if (params !== max) {
        const before = shimBody.slice(Math.max(0, m.index - 500), m.index);
        const names = [...before.matchAll(/([A-Za-z0-9_]+)\s*:\s*(?:async\s+)?(?:function\s*)?\(/g)];
        problems.push(`${names.length ? names[names.length - 1][1] : '?'}: ${max} placeholders vs ${params} params`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('normalizes the window-count paged shape to the production has_row shape', () => {
    expect(shim).toContain('function normalizePagedRows');
    expect(shim).toContain('normalizePagedRows(body.sql, result.rows)');
    expect(shim).toContain('has_row: false');
  });
});
