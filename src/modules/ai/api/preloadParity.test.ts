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
      'batchSetStatus', 'batchRetryFailed', 'batchRecover', 'batchGet', 'batchList',
    ];
    for (const src of [cjs, js]) {
      const methods = exposedMethods(src);
      const missing = required.filter((r) => !methods.includes(r));
      expect(missing, `preload missing AI bridge methods: ${missing.join(', ')}`).toEqual([]);
    }
  });
});
