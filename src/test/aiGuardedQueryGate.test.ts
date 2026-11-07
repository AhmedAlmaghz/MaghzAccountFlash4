import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Full guardedQuery gate (2026-11-07 audit): every raw `adapter.query` in
 * `src/modules/ai/tools` must go through the SELECT allow-list guard
 * (`assertSqlOperation` — tenant scope enforced). Direct adapter calls are
 * the unguarded channel the guard cannot see; they are forbidden here.
 *
 * Allowed channels (they funnel through the guard / typed module APIs):
 *  - reportCommon.guardedQuery (wraps assertSqlOperation)
 *  - readTools.guardedQuery (same wrap)
 *  - module APIs (salesApi/purchasesApi/inventoryApi/accountingApi/hrApi/crmApi/
 *    manufacturingApi/coreApi/posApi/fixedAssetsApi) — validated + company-scoped
 */
const ROOT = process.cwd();
const TOOLS_DIR = join(ROOT, 'src', 'modules', 'ai', 'tools');

const RAW_ADAPTER = /adapter\s*\.\s*(query|transaction|createTransaction)\s*\(/g;
const GUARD_IMPORT = /(reportCommon|assertSqlOperation|guardSqlQuery)/;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) tsFiles(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('ai guardedQuery gate — no unguarded adapter.query in tools', () => {
  it('every direct adapter.query is behind the SQL guard', () => {
    const violations: string[] = [];
    for (const f of tsFiles(TOOLS_DIR)) {
      const src = readFileSync(f, 'utf8');
      const hits = (src.match(RAW_ADAPTER) || []).length;
      if (!hits) continue;
      // The only allowed direct users are the wrappers themselves.
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      const allowed =
        rel.endsWith('tools/reportCommon.ts') || rel.endsWith('tools/readTools.ts');
      if (!allowed && !GUARD_IMPORT.test(src)) {
        violations.push(`${rel}: ${hits} raw adapter call(s)`);
      }
    }
    expect(violations, `unguarded raw SQL in AI tools — route through guardedQuery: ${violations.join('; ')}`).toEqual([]);
  });
});
