import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CI GATE — preload parity (P2 class).
 *
 * electron/preload.cjs is the loaded file (main.js), preload.js is the
 * dormant twin. The two drifted silently once already (purgeOldSessions
 * missing from preload.js — the PII retention sweep would have thrown
 * `undefined is not a function` the moment anyone repointed the loader).
 * A textual diff of the exposed API surfaces pins them together.
 */
const ROOT = resolve(__dirname, '../../../..');

/** `name:` / `name =` keys of every exposed bridge method. */
function exposedMethods(src: string): string[] {
  const names = new Set<string>();
  // contextBridge surface: `  methodName: (args) => ...`
  const re = /^\s{2}([A-Za-z_$][\w$]*)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return [...names].sort();
}

describe('preload parity gate (CI)', () => {
  const cjs = readFileSync(resolve(ROOT, 'electron/preload.cjs'), 'utf-8');
  const js = readFileSync(resolve(ROOT, 'electron/preload.js'), 'utf-8');

  it('exposes identical bridge method sets (cjs vs js)', () => {
    const a = exposedMethods(cjs);
    const b = exposedMethods(js);
    const onlyCjs = a.filter((x) => !b.includes(x));
    const onlyJs = b.filter((x) => !a.includes(x));
    expect(
      { onlyCjs, onlyJs },
      'preload.js and preload.cjs drifted — the dormant twin must mirror the loaded one',
    ).toEqual({ onlyCjs: [], onlyJs: [] });
  });

  it('the AI surface covers every channel the renderer calls', () => {
    // Channels required by src/modules/ai/api/index.ts (non-optional).
    const required = [
      'purgeOldSessions',
      'renameSession',
      'subscribeStream',
      'stopStream',
      'batchCreate', 'batchClaim', 'batchItemDone', 'batchItemFail',
      'batchSetStatus', 'batchClear', 'batchRetryFailed', 'batchRecover', 'batchRelease', 'batchGet', 'batchList',
    ];
    for (const src of [cjs, js]) {
      const methods = exposedMethods(src);
      const missing = required.filter((r) => !methods.includes(r));
      expect(missing, `preload missing AI bridge methods: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('keeps the e2e electronDB typed surfaces at the top level', () => {
    const plugin = readFileSync(resolve(ROOT, 'e2e/vite-e2e-plugin.ts'), 'utf-8');
    const start = plugin.indexOf('accounting:{');
    const end = plugin.indexOf('window.electronAI', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dbSurface = plugin.slice(start, end);
    expect(dbSurface).toMatch(/postTransaction:async/);
    // Purchases is the AP mirror of the sales surface; its supplier-ledger
    // reads are composed main-side exactly like the sales ones.
    expect(dbSurface).toMatch(/getSupplierStatement:async/);
    for (const surface of ['inventory', 'contacts', 'crm', 'manufacturing', 'hr', 'sales', 'purchases', 'pos', 'core']) {
      expect(dbSurface, `e2e surface drifted: ${surface}`).toContain(`},${surface}:{`);
    }
  });

  it('the e2e purchases surface mirrors every typed purchases channel', () => {
    // A missing method here would only surface as
    // `purchasesApi.getApAging → RPC unavailable` inside an e2e run, and
    // silently as "no AP aging" in a report.
    const plugin = readFileSync(resolve(ROOT, 'e2e/vite-e2e-plugin.ts'), 'utf-8');
    const start = plugin.indexOf('},purchases:{');
    expect(start).toBeGreaterThan(-1);
    const end = plugin.indexOf('},pos:{', start);
    expect(end).toBeGreaterThan(start);
    const surface = plugin.slice(start, end);
    for (const method of [
      'getSuppliers', 'getSuppliersPaginated', 'getSupplierById',
      'getSupplierStatement', 'getApAging', 'getApAgingTotal',
      'getInvoices', 'getOutstandingInvoicesForSupplier', 'getInvoicesPaginated', 'getInvoiceById',
      'getOrders', 'getOrdersPaginated', 'getOrderById',
      'getReturns', 'getReturnsPaginated', 'getReturnById', 'getPurchasesKpis',
      'createSupplier', 'updateSupplier', 'deleteSupplier',
    ]) {
      expect(surface, `e2e purchases surface missing: ${method}`).toContain(`${method}:async`);
    }
  });

  it('never writes a backtick inside the e2e shim template', () => {
    // A single stray backtick terminates the injected shim template: the whole
    // `window.electronDB` surface silently disappears and every e2e spec
    // fails with a DB-unavailable screen. Cheap gate for a fatal mistake.
    const plugin = readFileSync(resolve(ROOT, 'e2e/vite-e2e-plugin.ts'), 'utf-8').replace(/\r\n/g, '\n');
    const start = plugin.indexOf('const shimCode = `') + 'const shimCode = `'.length;
    let raw = '';
    for (let i = start; i < plugin.length; i += 1) {
      if (plugin[i] === '\\') { raw += plugin[i] + plugin[i + 1]; i += 1; continue; }
      if (plugin[i] === '`') break;
      raw += plugin[i];
    }
    const stray = raw.match(/(?<!\\)`/g) || [];
    expect(stray.length, 'unescaped backtick inside the e2e shim template').toBe(0);
  });

  it('the e2e electronAI stub covers the same AI surface (no TypeError drift)', () => {
    // P2 fix: the e2e shim defined ~12 electronAI methods while the renderer
    // calls ~25 — any AI-adjacent e2e (purge-on-open, batch cards, resume
    // banner) hit `b.X is not a function`, swallowed by .catch. The stub is
    // a single-line template in e2e/vite-e2e-plugin.ts — pin its method set
    // here so the next channel addition updates both or fails loudly.
    const plugin = readFileSync(resolve(ROOT, 'e2e/vite-e2e-plugin.ts'), 'utf-8');
    const stubStart = plugin.indexOf('window.electronAI={');
    expect(stubStart).toBeGreaterThan(-1);
    let depth = 0;
    let end = -1;
    for (let i = stubStart; i < plugin.length; i++) {
      const c = plugin[i];
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    expect(end).toBeGreaterThan(stubStart);
    const stub = plugin.slice(stubStart, end);
    const required = [
      'purgeOldSessions',
      'renameSession',
      'subscribeStream',
      'stopStream',
      'batchCreate', 'batchClaim', 'batchItemDone', 'batchItemFail',
      'batchSetStatus', 'batchClear', 'batchRetryFailed', 'batchRecover', 'batchRelease', 'batchGet', 'batchList',
    ];
    const missing = required.filter((r) => !new RegExp(`\\b${r}\\s*:`).test(stub));
    expect(missing, `e2e electronAI stub missing methods: ${missing.join(', ')}`).toEqual([]);
  });
});
