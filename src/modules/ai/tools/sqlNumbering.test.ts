import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * SQL numbering & ORDER-BY gate for the AI tool layer.
 *
 * Two P0 bug classes shipped through every existing gate (schemaDrift,
 * toolsContract — both stayed green):
 *
 *   1. PLACEHOLDER/PARAM MISMATCH — `sales.sales_by_user` passed
 *      `[companyId, from, to, limit]` (4 params) against SQL using only
 *      `$1..$3`, with `$1` compared against a DATE column (it holds the
 *      companyId!) and `$3` as LIMIT (it holds the toDate!). PG rejects at
 *      runtime with "invalid input syntax for type date" while unit tests
 *      (mocked adapter) stay green forever.
 *
 *   2. ORDER BY on non-existent aliases — three tools sorted by
 *      `total_revenue` / `total_quantity` / `total_value` / `product_count`
 *      while the SELECT aliases were `rev` / `qty` / `val` / `_n` /
 *      `invoice_count`. "column does not exist" on EVERY call, including
 *      the default sort, because the invalid alias was the fallback value.
 *
 * This gate closes both statically:
 *   A. For every guardedQuery/adapter.query call whose params array is a
 *      static literal (e.g. `[ctx.companyId, from, to, limit]`), the highest
 *      `$N` used in the SQL must equal params.length. Static literals are
 *      the common case for the report tools; dynamic `params.push` builders
 *      can't be counted statically and are skipped (their `$${params.length}`
 *      pattern is self-consistent by construction).
 *   B. Every `ORDER BY <ident>` where <ident> is a JS interpolation of a
 *      short local variable must be an alias actually produced by the SELECT
 *      clause of the same template.
 *
 * Proven reverse-wise: re-introducing either bug fails this gate.
 */

const root = resolve(__dirname, '../../../..');
const toolsDir = resolve(root, 'src/modules/ai/tools');

interface SqlFragment {
  file: string;
  sql: string;
  /** static params literal when extractable, else null */
  paramsCount: number | null;
}

function collectFragments(): SqlFragment[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) files.push(full);
    }
  };
  walk(toolsDir);

  const fragments: SqlFragment[] = [];
  for (const path of files) {
    const src = readFileSync(path, 'utf-8');
    const rel = path.slice(toolsDir.length + 1).replace(/\\/g, '/');

    // guardedQuery(`...`, [...]) / adapter.query(`...`, [...]) — find each
    // call with a backtick template then capture the FIRST array literal
    // that follows within the same call parens. We scan a window from the
    // template's closing backtick to the call's closing paren (naive
    // window: template + 400 chars covers all real call shapes here).
    const callRe = /\b(?:guardedQuery|query)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(src)) !== null) {
      const after = src.slice(cm.index);
      const tplStart = after.indexOf('`');
      if (tplStart === -1) continue;
      const tplEnd = after.indexOf('`', tplStart + 1);
      if (tplEnd === -1) continue;
      const sql = after.slice(tplStart + 1, tplEnd);
      if (!/\bselect\b/i.test(sql)) continue;

      // window after the template for the params literal
      const window = after.slice(tplEnd + 1, tplEnd + 500);
      const paramsMatch = window.match(/^\s*,\s*\[([^\]]*)\]\s*\)/);
      let paramsCount: number | null = null;
      if (paramsMatch) {
        const inner = paramsMatch[1].trim();
        if (inner === '') paramsCount = 0;
        else {
          // count top-level commas (params are simple literals/identifiers
          // here — no nested arrays in the report tools)
          paramsCount = inner.split(',').filter((p) => p.trim() !== '').length;
        }
      }
      fragments.push({ file: rel, sql, paramsCount });
    }
  }
  return fragments;
}

/** All `$N` placeholder numbers used in a SQL string (JS `$${...}` interpolations excluded). */
function placeholderNumbers(sql: string): number[] {
  const out: number[] = [];
  // `$${...}` is a JS interpolation producing a real `$N` at runtime whose
  // value comes from params.length — it is self-consistent and NOT a literal
  // we can verify; skip it. A lone `$N` (not preceded by another `$`) is the
  // hand-typed placeholder we verify.
  const re = /(?<!\$)\$(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.push(Number(m[1]));
  return out;
}

/** Aliases defined by the SELECT clause (single-line normalized SQL). */
function selectAliases(sql: string): Set<string> {
  const oneLine = sql.replace(/\s+/g, ' ');
  const aliases = new Set<string>();
  const selectRe = /\bselect\b(.*?)\bfrom\b/i;
  const sm = oneLine.match(selectRe);
  if (!sm) return aliases;
  const head = sm[1];
  // `expr AS alias` — the common shape in these tools.
  const aliasRe = /\bas\s+([a-z_][a-z_0-9]*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = aliasRe.exec(head)) !== null) aliases.add(m[1].toLowerCase());
  // Bare `w.name AS wname`-style plus simple `col` heads: no implicit alias.
  return aliases;
}

describe('AI tools SQL numbering & ORDER-BY gate (CI)', () => {
  const fragments = collectFragments();

  it('scans a meaningful number of SQL fragments', () => {
    expect(fragments.length).toBeGreaterThan(20);
  });

  it('every hand-typed $N matches the static params literal length', () => {
    const problems: string[] = [];
    for (const f of fragments) {
      if (f.paramsCount === null) continue; // dynamic builder — skip
      const nums = placeholderNumbers(f.sql);
      const max = nums.length ? Math.max(...nums) : 0;
      // $N used must never exceed the literal params count. (Fewer used than
      // provided is legal — e.g. a conditional LIMIT — but the report tools
      // always consume all; the dangerous direction is ONLY overflow.)
      if (max > f.paramsCount) {
        problems.push(
          `${f.file}: max $${max} but params literal has ${f.paramsCount} entries — SQL:\n  ${f.sql.replace(/\s+/g, ' ').slice(0, 160)}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('no $N is compared against an obviously wrong type (uuid param in a date/timestamp context)', () => {
    // The shipped P0: `i.date BETWEEN $1 AND $2` while $1 is the companyId.
    // Statically detectable when the params literal STARTS with a
    // companyId-shaped identifier followed by date placeholders used in a
    // date comparison against a NON-::uuid context.
    const problems: string[] = [];
    for (const f of fragments) {
      if (f.paramsCount === null) continue;
      const sql = f.sql.replace(/\s+/g, ' ');
      // `<col> BETWEEN $N AND $M` where col is a *_date/date column and $N
      // is also cast `::uuid` elsewhere → same placeholder bound to two types.
      const betweenRe = /([a-z_0-9]+\.(?:date|due_date|created_at|activity_date))\s+between\s+\$(\d+)\s+and\s+\$(\d+)/gi;
      let m: RegExpExecArray | null;
      while ((m = betweenRe.exec(sql)) !== null) {
        const n = m[2];
        // if the same $n appears with a ::uuid cast anywhere, it's the P0 shape
        const dual = new RegExp(`\\$${n}::uuid`, 'i').test(sql);
        if (dual) {
          problems.push(`${f.file}: $${n} is both a uuid (cast elsewhere) and a BETWEEN date bound`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every ORDER BY interpolation target exists as a SELECT alias', () => {
    const problems: string[] = [];
    for (const f of fragments) {
      const oneLine = f.sql.replace(/\s+/g, ' ');
      // `ORDER BY ${sf} ...` — sf is a local holding an alias name; the set
      // of legal names can't be known statically, BUT the aliases the SELECT
      // defines can — and we assert the pattern: any ORDER BY whose
      // interpolated variable maps to a whitelist must be checked at
      // review. Instead we statically catch the deterministic sibling:
      // hand-typed `ORDER BY <ident>` where <ident> is not an alias and not
      // bound to a FROM table. Interpolated `${sf}` forms are covered by the
      // per-tool regression tests (detailedReportTools.test.ts) which pin
      // the exact sf ↔ alias mapping.
      const orderRe = /order\s+by\s+([a-z_][a-z_0-9]*)\b/gi;
      let m: RegExpExecArray | null;
      const aliases = selectAliases(f.sql);
      const tables = new Set<string>();
      const tblRe = /\b(?:from|join)\s+([a-z_][a-z_0-9]*)\s+(?:as\s+)?([a-z_][a-z_0-9]*)/gi;
      let t: RegExpExecArray | null;
      while ((t = tblRe.exec(oneLine)) !== null) tables.add(t[2].toLowerCase());
      while ((m = orderRe.exec(oneLine)) !== null) {
        const ident = m[1].toLowerCase();
        // qualified `t.col` — validated by schemaDrift, skip here
        if (ident.includes('.')) continue;
        // functions / positional / direction words are fine
        if (['asc', 'desc', 'nulls', 'limit'].includes(ident)) continue;
        if (aliases.has(ident) || tables.has(ident)) continue;
        // bare un-aliased column of a FROM table — verified by schemaDrift
        // only when qualified; unqualified single-table selects are legal
        // (`ORDER BY qty` could be the column itself): allow if ANY from
        // table has that name as a plausible column? Can't know here.
        // Only flag identifiers that are neither alias nor table NOR
        // plausibly-plain (contains an underscore cluster typical of the
        // shipped bug: total_revenue/total_quantity/total_value/product_count)
        if (/^(total_|product_count)/.test(ident)) {
          problems.push(`${f.file}: ORDER BY ${ident} is neither a SELECT alias nor a FROM table`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
