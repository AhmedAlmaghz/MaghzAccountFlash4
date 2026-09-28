import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A JS string opened with one quote and closed with the other parses as
 * nothing at all — and it happened twice in one tranche, both times in the e2e
 * shim's SQL literals, both times in a file that no other check inspects
 * (node --check only covers the Electron files, and the shim lives inside a
 * template literal inside a TS file).
 *
 * The symptom is miserable to debug: "Invalid or unexpected token" pointing
 * somewhere in a 124,000-character single line. So the rule is checked
 * directly: inside the shim, every string literal opens and closes with the
 * same quote character.
 *
 * It walks the evaluated shim character by character rather than pattern
 * matching, because a regex cannot tell an opening quote from a closing one
 * without parsing — which is the thing that is broken.
 */
const ROOT = process.cwd();
const shimRaw = readFileSync(join(ROOT, 'e2e', 'vite-e2e-plugin.ts'), 'utf8');

function evaluatedShim(): string {
  const iife = shimRaw.indexOf('(function(){if(window.electronDB)return;');
  let open = -1;
  for (let k = iife; k >= 0; k--) if (shimRaw[k] === '`') { open = k; break; }
  const tail = shimRaw.indexOf('})();', iife);
  let close = -1;
  for (let k = tail; k < shimRaw.length; k++) if (shimRaw[k] === '`') { close = k; break; }
  return new Function('return `' + shimRaw.slice(open + 1, close) + '`;')() as string;
}

interface Mismatch {
  at: number;
  openedWith: string;
  closedWith: string;
  context: string;
}

/**
 * Walk the evaluated shim looking for the real defect: a string that opens with
 * one quote and whose *terminating* quote is the other one.
 *
 * The subtlety that produced a false positive on the first version: SQL
 * literals legitimately nest. `"... t.status = 'posted' ..."` is a correct
 * double-quoted string that happens to contain single quotes, and the existing
 * getAccounts channel is written exactly that way. So a single quote inside a
 * double-quoted string is content, not a terminator — and a double quote inside
 * a single-quoted string is likewise content. The only mismatch is when the
 * scanner runs to the end of the file (or hits a newline, for a string that
 * was never closed) still inside a string, which is what a genuinely mismatched
 * pair produces.
 */
function findMismatchedQuotes(code: string): Mismatch[] {
  const out: Mismatch[] = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '`') {
      i++;
      while (i < n) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '`') break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const opener = c;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === opener) { closed = true; break; }
        // A newline inside a single-quoted string means it was never closed —
        // in this shim every SQL literal is on one line, so a newline can only
        // appear if a quote went missing.
        if (code[i] === '\n') break;
        i++;
      }
      if (!closed) {
        out.push({
          at: start,
          openedWith: opener,
          closedWith: '(unterminated)',
          context: code.slice(Math.max(0, start - 30), start + 90),
        });
        break;
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

describe('the e2e shim has well-formed string literals', () => {
  it('the shim evaluates (a broken one would fail every e2e test at once)', () => {
    const code = evaluatedShim();
    expect(code.length).toBeGreaterThan(1000);
  });

  it('no string literal is opened with one quote and closed with the other', () => {
    const bad = findMismatchedQuotes(evaluatedShim());
    expect(
      bad.map((b) => `"${b.openedWith}..." closed with ${b.closedWith} at ${b.at}: ${b.context}`),
      'a mismatched quote pair makes the whole shim unparseable'
    ).toEqual([]);
  });

  it('the shim parses as JavaScript', () => {
    const code = evaluatedShim();
    expect(() => new Function(code)).not.toThrow();
  });

  it('the audit surface is present and complete', () => {
    // regression for this tranche: the audit channels were added and the
    // shim is what makes them reachable under e2e
    const code = evaluatedShim();
    const i = code.indexOf('audit:{');
    expect(i, 'the audit surface is missing from the e2e shim').toBeGreaterThan(-1);
    const body = code.slice(i, i + 1400);
    expect(body).toMatch(/log:async/);
    expect(body).toMatch(/list:async/);
    expect(body, 'the shim audit insert must bind the company id, not a payload value').toMatch(/_cid\(\)/);
  });
});
