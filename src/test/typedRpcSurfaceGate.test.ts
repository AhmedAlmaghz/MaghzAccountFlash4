import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A typed RPC channel is only real when it exists in all five places it has to:
 *
 *   1. electron/dbHandler.js      — the channel handler
 *   2. electron/preload.cjs       — the context-bridge twin
 *   3. electron/preload.js        — the same twin for the other build
 *   4. electronPgAdapter.ts       — the typed surface + getRPC()
 *   5. e2e/vite-e2e-plugin.ts     — the e2e shim
 *
 * The fifth one is the expensive miss. `isElectronPg()` is true whenever
 * `window.electronDB.ping` exists, and the e2e shim provides exactly that — so
 * a channel missing from the shim sends every e2e test down the RPC path and
 * then fails, which reads as "the whole application is broken" rather than
 * "one surface is missing". The adapter matters for the same reason: getRPC()
 * throws when any registered surface is absent, taking the database error
 * screen with it.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const dbHandler = read('electron/dbHandler.js');
const preloadCjs = read('electron/preload.cjs');
const preloadJs = read('electron/preload.js');
const adapter = read('src/core/database/adapters/electronPgAdapter.ts');
const shimRaw = read('e2e/vite-e2e-plugin.ts');

/** every `db:rpc:<surface>.<method>` channel registered in the main process */
function registeredChannels(): string[] {
  return [...dbHandler.matchAll(/registerRpc\('([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]);
}

/**
 * Channels kept on purpose as tombstones: their `validate` throws
 * unconditionally, so the SQL below it can never run. They exist to make the
 * removal of a partial-posting path explicit rather than silent. They are not
 * reachable, so demanding a preload method would be wrong — but they must be
 * listed here, because an unexplained "unreachable channel" is exactly the
 * kind of gap this gate exists to surface.
 */
const DISABLED_BY_DESIGN = ['sales.postInvoice', 'sales.postReturn'];

/** a channel is a tombstone only if its validate throws with no way through */
function isDisabledByDesign(channel: string): boolean {
  const i = dbHandler.indexOf(`registerRpc('${channel}'`);
  if (i < 0) return false;
  const end = dbHandler.indexOf('});', i);
  const block = dbHandler.slice(i, end < 0 ? dbHandler.length : end);
  return /validate:\s*async?\s*\(\s*\)\s*=>\s*\{\s*throw new Error\(/.test(block);
}

function surfacesOf(): string[] {
  return [...new Set(registeredChannels().map((c) => c.split('.')[0]))];
}

/** the shim's evaluated code — a template literal, so it must be evaluated */
function evaluatedShim(): string {
  const iife = shimRaw.indexOf('(function(){if(window.electronDB)return;');
  let open = -1;
  for (let k = iife; k >= 0; k--) if (shimRaw[k] === '`') { open = k; break; }
  const tail = shimRaw.indexOf('})();', iife);
  let close = -1;
  for (let k = tail; k < shimRaw.length; k++) if (shimRaw[k] === '`') { close = k; break; }
  return new Function('return `' + shimRaw.slice(open + 1, close) + '`;')() as string;
}

describe('typed RPC surfaces are wired everywhere', () => {
  it('the main process registers a meaningful number of channels', () => {
    expect(registeredChannels().length).toBeGreaterThan(100);
  });

  it('preload.cjs exposes every registered channel', () => {
    const missing = registeredChannels()
      .filter((c) => !DISABLED_BY_DESIGN.includes(c))
      .filter((c) => !preloadCjs.includes(`db:rpc:${c}`));
    expect(missing, 'a channel without a preload method is unreachable from the renderer').toEqual([]);
  });

  it('preload.js exposes the same channels as preload.cjs', () => {
    const missing = registeredChannels()
      .filter((c) => !DISABLED_BY_DESIGN.includes(c))
      .filter((c) => !preloadJs.includes(`db:rpc:${c}`));
    expect(missing).toEqual([]);
  });

  it('every exempt channel really is disabled, and none is listed needlessly', () => {
    // An exemption that stops being a tombstone would silently hide a real
    // hole, and a tombstone that gets re-enabled would stay unwired.
    const notActuallyDisabled = DISABLED_BY_DESIGN.filter((c) => !isDisabledByDesign(c));
    expect(notActuallyDisabled, 'listed as disabled but the validate no longer throws').toEqual([]);

    const unlisted = registeredChannels()
      .filter(isDisabledByDesign)
      .filter((c) => !DISABLED_BY_DESIGN.includes(c));
    expect(unlisted, 'a disabled channel must be listed, not quietly exempt').toEqual([]);
  });

  it('the adapter declares every surface and getRPC() wires it', () => {
    const missingType: string[] = [];
    const notRead: string[] = [];
    for (const surface of surfacesOf()) {
      // the typed surface on ElectronDB
      if (!new RegExp(`\\n\\s*${surface}\\??:\\s*\\{`).test(adapter)) missingType.push(surface);
      // getRPC() must actually read the surface off window.electronDB. The
      // local aliases are abbreviated (acc, ctc, mfg, ...), so the check is on
      // `db.<surface>` rather than on a variable name.
      if (!new RegExp(`db\\.${surface}\\b`).test(adapter)) notRead.push(surface);
    }
    // and the returned object must spread one alias per surface
    const getRpcStart = adapter.indexOf('function getRPC()');
    const body = adapter.slice(getRpcStart, adapter.indexOf('\n}', getRpcStart));
    const spreads = [...body.matchAll(/\.\.\.(\w+),/g)].map((m) => m[1]);
    const surfaceCount = surfacesOf().length;
    expect({ missingType }, 'surface missing from the ElectronDB type').toEqual({ missingType: [] });
    expect({ notRead }, 'getRPC() never reads the surface from window.electronDB').toEqual({ notRead: [] });
    expect(
      { spreads: spreads.length, surfaces: surfaceCount },
      'getRPC() must spread every surface — it throws at runtime when one is absent'
    ).toEqual({ spreads: surfaceCount, surfaces: surfaceCount });
  });

  it('the e2e shim evaluates and parses (evaluated, never raw text)', () => {
    const iife = shimRaw.indexOf('(function(){if(window.electronDB)return;');
    expect(iife, 'the shim IIFE moved — update this gate').toBeGreaterThan(-1);
    const code = evaluatedShim();
    expect(code.length).toBeGreaterThan(1000);
    expect(() => new Function(code), 'the shim does not parse — every e2e test would fail').not.toThrow();
  });

  it('the e2e shim implements every registered channel', () => {
    const code = evaluatedShim();
    const missing = registeredChannels()
      .filter((c) => !DISABLED_BY_DESIGN.includes(c))
      .filter((c) => {
        const method = c.split('.')[1];
        return !new RegExp('(^|[{,])' + method + ':', 'm').test(code);
      });
    expect(missing, 'a channel missing from the shim sends e2e down the RPC path and fails there').toEqual([]);
  });

  it('the shim does not send a company id to session-derived channels', () => {
    // The production channels for these methods derive the company from the
    // session. The shim is single-tenant and trusted, so reading p.companyId
    // there is harmless today — but the shim is what developers copy from, and
    // a shape that reads the company from the payload is the shape that
    // reopened the audit hole once already. Rather than rewrite eight working
    // shim methods on a single-line file — an attempt at it corrupted the
    // surface twice — the divergence is pinned by count, so it stays a visible
    // decision and a ninth occurrence fails.
    const KNOWN_DIVERGENT = 8;
    // Counting, not naming. A name-based scan has to guess which method owns a
    // given occurrence, and it got that wrong twice — once missing a channel,
    // once attributing an occurrence to the _cid helper. A count cannot be
    // wrong in that direction, and it still fails the moment a ninth one
    // appears, which is the thing worth catching.
    const code = evaluatedShim();
    const occurrences = (code.match(/p\.companyId/g) || []).length;
    expect(
      occurrences,
      'a shim channel now reads a company id from the payload — resolve it like the other surfaces, or raise this number with a reason'
    ).toBe(KNOWN_DIVERGENT);
  });

  it('the shim keeps a company-id resolver on every shim surface', () => {
    // A shim method that forgets `_cid` throws "undefined is not a function"
    // and takes the whole run down.
    const code = evaluatedShim();
    const noCid: string[] = [];
    for (const surface of ['tax', 'pos', 'sales', 'purchases', 'crm', 'hr', 'manufacturing', 'inventory']) {
      const i = code.indexOf(surface + ':{');
      if (i < 0) { noCid.push(surface + ' (surface missing)'); continue; }
      let depth = 0;
      let end = -1;
      for (let k = i + surface.length + 1; k < code.length; k++) {
        const ch = code[k];
        if (ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '}' || ch === ')' || ch === ']') { depth--; if (depth <= 0) { end = k; break; } }
      }
      const body = code.slice(i, end < 0 ? code.length : end);
      if (!body.includes('_cid:')) noCid.push(surface);
    }
    expect(noCid, 'a shim surface without a _cid resolver fails the whole e2e run').toEqual([]);
  });
});
