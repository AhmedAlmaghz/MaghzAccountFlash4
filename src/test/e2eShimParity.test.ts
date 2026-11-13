import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractShimCode,
  parseShimCode,
  checkStaticParamCounts,
} from '../../scripts/shimChecks.mjs';

/**
 * Parity gate for the e2e bridge shim (e2e/vite-e2e-plugin.ts).
 *
 * The shim is the app's substitute for the main process in the browser. It
 * drifted from production in four ways that made whole screens silently
 * empty, unwritable, or simply dead:
 *
 *  1. the paged reads answered with the old `COUNT(*) OVER()` shape, which
 *     has no `has_row` column — splitPagedRpcRows() dropped every row;
 *  2. a surface used `this._cid()` without defining it, and an ARROW method
 *     used `this._cid()` at all (an arrow captures `this` lexically, so it
 *     never sees the called object);
 *  3. a query passed a different number of parameters than it had
 *     placeholders — PostgreSQL rejects the statement and the write fails;
 *  4. a SQL literal lost its escaping backslash, so the whole shim stopped
 *     PARSING — `window.electronDB` was then never defined and every page
 *     showed "cannot connect to the database" with no hint about the cause.
 *
 * The analysis lives in `scripts/shimChecks.mjs`, shared with the
 * plain-node CLIs — the CLI and this gate once carried DIFFERENT logic for
 * the same rule, so each missed what the other caught.
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

  it('the generated shim PARSES (a lost escape kills the whole bridge)', () => {
    const code = extractShimCode(shim);
    const result = parseShimCode(code);
    expect(
      result.ok ? '' : `${result.error}\n${(result.context ?? []).join('\n')}`,
    ).toBe('');
  });

  it('every static query passes as many params as it has placeholders', () => {
    const { problems } = checkStaticParamCounts(shimBody);
    expect(
      problems.map((p) => `${p.method}: ${p.placeholders} placeholders vs ${p.params} params — ${p.sql}`),
      'a query whose parameter count does not match its placeholders is rejected by PostgreSQL',
    ).toEqual([]);
  });

  it('normalizes the window-count paged shape to the production has_row shape', () => {
    expect(shim).toContain('function normalizePagedRows');
    expect(shim).toContain('normalizePagedRows(body.sql, result.rows)');
    expect(shim).toContain('has_row: false');
  });
});
