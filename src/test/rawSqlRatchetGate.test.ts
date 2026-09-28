import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A ratchet on raw SQL in the renderer.
 *
 * The desktop path reaches PostgreSQL through two transports: typed RPC
 * (structured payload, SQL composed in the main process) and the legacy
 * `db:internal-query` channel (SQL text from the renderer). The second one is
 * the P0 the audit is closing, and it is still reachable for the modules that
 * have not been migrated. So the debt cannot vanish in one commit, but it can
 * be made visible and non-increasing.
 *
 * The ceiling is today's measurement. Lowering a number is the only way to
 * raise it, which is the point: a new raw statement fails the gate and has to
 * be either converted to typed RPC or argued for in this table.
 *
 * The counter is generics-aware on purpose. An earlier scan used
 * /adapter\.query\s*\(/ and silently missed every `adapter.query<{ id: string }>(`
 * - it reported 475 where the truth is 673. A ratchet built on a counter that
 * undercounts is worse than no ratchet, because the first migration looks
 * like it moved the number when it only moved the regex.
 */
const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'test-results', 'playwright-report']);
const RAW = /adapter\.(query|transaction|createTransaction)\s*(<[^()]*?>)?\s*\(/g;

/** per-module ceilings, measured 2026-09-24 (see AI_AUDIT_AND_FIX_PLAN.md) */
const CEILINGS: Record<string, number> = {
  core: 99,
  accounting: 76,
  hr: 68,
  manufacturing: 58,
  sales: 57,
  inventory: 53,
  purchases: 53,
  reports: 47,
  ai: 46,
  crm: 37,
  pos: 24,
  settings: 22,
  auth: 19,
  tax: 7,
};
const TOTAL_CEILING = 666;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function moduleOf(rel: string): string {
  const m = /src\/modules\/([^/]+)\//.exec(rel);
  if (m) return m[1];
  return rel.startsWith('src/core') ? 'core' : rel.split('/')[1];
}

function countByModule(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of sourceFiles(join(ROOT, 'src'))) {
    const n = (readFileSync(f, 'utf8').match(RAW) || []).length;
    if (!n) continue;
    const key = moduleOf(relative(ROOT, f).replace(/\\/g, '/'));
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

describe('raw SQL in the renderer is a ratchet, not a free-for-all', () => {
  it('the ceiling is reachable - the counter and the table agree', () => {
    const counts = countByModule();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total, 'the measured total drifted from TOTAL_CEILING; update the table deliberately').toBe(TOTAL_CEILING);
  });

  it('no module exceeds its ceiling', () => {
    const counts = countByModule();
    const over = Object.entries(counts)
      .filter(([k, v]) => v > (CEILINGS[k] ?? TOTAL_CEILING))
      .map(([k, v]) => `${k}: ${v} > ${CEILINGS[k] ?? TOTAL_CEILING}`);
    expect(over, 'new raw SQL in the renderer - use a typed RPC channel instead').toEqual([]);
  });

  it('a module with no entry in the table has no raw SQL at all', () => {
    const counts = countByModule();
    const unlisted = Object.keys(counts).filter((k) => !(k in CEILINGS));
    expect(unlisted, 'a new module using raw SQL must be added to the table, not left unlisted').toEqual([]);
  });

  it('no ceiling is stale (each one is still accurate or deliberately loose)', () => {
    const counts = countByModule();
    const stale = Object.entries(CEILINGS)
      .filter(([k, v]) => (counts[k] ?? 0) > v)
      .map(([k, v]) => `${k}: ${v} < measured ${counts[k] ?? 0}`);
    expect(stale).toEqual([]);
  });

  it('the tax module no longer hardcodes SQL on the desktop path', () => {
    // Six of the engine's seven remaining statements are fallback-only, each
    // behind a useRpc() branch. This pins the tranche so it cannot silently
    // regress to a desktop-only raw read.
    const engine = readFileSync(join(ROOT, 'src', 'modules', 'tax', 'engine.ts'), 'utf8');
    expect((engine.match(/rpcPath\(db\)/g) || []).length,
      'every fallback in the tax engine must be behind an rpcPath() branch').toBeGreaterThanOrEqual(6);
    expect(engine).toContain('isElectronPg');
  });

  it('default-account resolution goes through typed RPC on desktop', () => {
    // 36 call sites in ten files funnel through getDefaultAccountId, so its
    // single raw SELECT was the whole dependency. The fallback inside it must
    // not be reachable on desktop, which is why findAccountByCode returns null
    // there instead of falling through to the adapter.
    const jg = readFileSync(join(ROOT, 'src', 'core', 'utils', 'journalEntryGenerator.ts'), 'utf8');
    const fn = jg.slice(jg.indexOf('export async function getDefaultAccountId'));
    expect(fn.slice(0, 900)).toContain('isElectronPg()');
    const fac = jg.slice(jg.indexOf('async function findAccountByCode'));
    const branch = fac.slice(0, fac.indexOf('const adapter = await getDbAdapter()'));
    expect(branch).toContain('isElectronPg()');
    expect(branch, 'the RPC branch must return, never fall through to the adapter').toContain('return id ? String(id) : null');
  });
});
