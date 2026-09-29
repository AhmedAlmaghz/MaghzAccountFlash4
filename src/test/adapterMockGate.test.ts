import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A module mock must satisfy the module's whole public surface as far as the
 * test's own code path goes — but a test cannot know which exports a future
 * change will reach. That is how twenty-two test files ended up mocking
 * `@/core/database/adapters` without `isElectronPg`: the mock was written when
 * the module only exported the adapter, and when account resolution started
 * selecting a transport, every one of those files failed with
 * `No "isElectronPg" export is defined on the mock` — a message about the test
 * harness that reads as a production bug.
 *
 * So: any test that mocks the adapters module has to provide the transport
 * predicate too, answering false so the adapter fallback stays under test.
 */
const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out']);

/**
 * Tests whose whole purpose is to measure the DESKTOP path, so they mock
 * isElectronPg to answer true. Every other adapter mock must answer false, or
 * the test silently exercises the RPC branch instead of the fallback it means
 * to cover. Listed explicitly: an unstated exception is indistinguishable from
 * a mistake.
 *
 * All three install a bridge and hand the adapter a spy, so a method that
 * reaches raw SQL is observed reaching it. Answering false would report every
 * method as clean and prove nothing.
 */
const DESKTOP_PATH_MOCKS = new Set([
  'src/test/desktopReachabilityGate.test.ts',
  'src/test/rpcReachabilityCrossCheck.test.ts',
  'src/test/channelWiringGate.test.ts',
]);

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('module mocks cover the whole adapters surface', () => {
  it('every test mocking the adapters module also provides isElectronPg', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of testFiles(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      // this file names the module inside its own prose, which the naive scan
      // below cannot tell apart from a real mock
      if (rel === 'src/test/adapterMockGate.test.ts') continue;
      const t = readFileSync(f, 'utf8');
      const i = t.indexOf("vi.mock('@/core/database/adapters'");
      const j = t.indexOf('vi.mock("@/core/database/adapters"');
      const at = i >= 0 ? i : j;
      if (at < 0) continue;
      checked++;
      // The factory body is the object literal after `({`. Counting from the
      // opening paren swallows paren and brace together, which reports a
      // misplaced entry in files that are in fact fine.
      const paren = t.indexOf('(', at);
      const brace = t.indexOf('{', paren);
      let depth = 0;
      let close = -1;
      for (let k = brace; k < t.length; k++) {
        if (t[k] === '{') depth++;
        else if (t[k] === '}') { depth--; if (depth === 0) { close = k; break; } }
      }
      const body = t.slice(brace, close < 0 ? brace + 900 : close);
      if (!/isElectronPg/.test(body)) offenders.push(rel);
    }
    expect(checked, 'the scan found no adapter mocks at all — has the module moved?').toBeGreaterThan(20);
    expect(offenders, 'a mock without isElectronPg fails confusingly once the code reaches for it').toEqual([]);
  });

  it('the predicate must answer false, so tests exercise the fallback', () => {
    const wrong: string[] = [];
    for (const f of testFiles(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      if (rel === 'src/test/adapterMockGate.test.ts') continue;
      // The reachability gates are the deliberate exception: they answer TRUE
      // because measuring the desktop path is their entire purpose. A test that
      // returns false here would report every function as clean and prove
      // nothing. The exemption is written down so it reads as a decision.
      if (DESKTOP_PATH_MOCKS.has(rel)) continue;
      const t = readFileSync(f, 'utf8');
      const at = t.indexOf("vi.mock('@/core/database/adapters'");
      if (at < 0) continue;
      const paren = t.indexOf('(', at);
      const brace = t.indexOf('{', paren);
      let depth = 0;
      let close = -1;
      for (let k = brace; k < t.length; k++) {
        if (t[k] === '{') depth++;
        else if (t[k] === '}') { depth--; if (depth === 0) { close = k; break; } }
      }
      const body = t.slice(brace, close < 0 ? brace + 900 : close);
      if (!/isElectronPg/.test(body)) continue;
      // a truthy mock would silently divert these tests to the RPC path,
      // where there is no electronDB and every call returns "RPC unavailable"
      if (/isElectronPg:\s*(vi\.fn\(\(\)\s*=>\s*true\)|true)/.test(body)) wrong.push(rel);
    }
    expect(wrong).toEqual([]);
  });
});
