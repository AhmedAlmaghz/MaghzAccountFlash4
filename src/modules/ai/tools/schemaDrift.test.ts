import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Schema-drift gate for the AI tool layer.
 *
 * The AI report/diagnostic tools embed raw SQL with hand-typed
 * `table.column` references. Four separate drift bugs shipped before this
 * gate existed (cash_boxes.name_ar, work_orders.planned_qty,
 * work_order_consumptions.actual_qty, stock.created_at + a missing unique
 * index) — each one killed its tool at runtime with a silent PG
 * "column does not exist" error while every unit test stayed green,
 * because tests mock the adapter and never see the database.
 *
 * This gate closes that hole STATICALLY:
 *   1. Parse the real schema — CREATE TABLE blocks from drizzle/0000_init.sql
 *      plus ALTER TABLE ... ADD COLUMN from all later migrations.
 *   2. Extract every `alias.column` reference from the SQL in the AI tools.
 *   3. Fail on any column a table does not have, and on any allow-listed
 *      sqlGuard table that does not exist.
 *
 * It cannot catch everything (dynamic aliases, JS-side row mapping like
 * r.name vs r.name_ar) but it would have caught all four shipped bugs.
 */

const root = resolve(__dirname, '../../../..');
const drizzleDir = resolve(root, 'drizzle');

/** Parse CREATE TABLE blocks + ALTER TABLE ADD COLUMN into { table: Set<cols> }. */
function loadSchema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  const addCol = (table: string, col: string) => {
    const t = table.replace(/"/g, '').toLowerCase();
    const c = col.replace(/"/g, '').toLowerCase();
    if (!tables.has(t)) tables.set(t, new Set());
    tables.get(t)!.add(c);
  };

  const files = readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(resolve(drizzleDir, file), 'utf-8');
    // CREATE TABLE "x" ( "col" type, ... );  — naive paren matching is fine
    // here because PG DDL in these migrations never nests parens in column defs.
    const createRe = /CREATE TABLE (?:IF NOT EXISTS )?"([a-z_0-9]+)"\s*\(([\s\S]*?)\n\);/g;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[1];
      for (const line of m[2].split('\n')) {
        const col = line.trim().match(/^"([a-z_0-9]+)"/);
        if (col) addCol(table, col[1]);
      }
    }
    // ALTER TABLE "x" ADD COLUMN [IF NOT EXISTS] "col"
    const alterRe = /ALTER TABLE "([a-z_0-9]+)" ADD COLUMN (?:IF NOT EXISTS )?"([a-z_0-9]+)"/g;
    while ((m = alterRe.exec(sql)) !== null) {
      addCol(m[1], m[2]);
    }
  }
  return tables;
}

/**
 * Extract `alias.column` references from SQL templates in tool sources.
 * Multi-line template literals are joined first so column refs split across
 * lines (SELECT x,\n y) are not missed.
 */
const SQL_COL_RE = /\b([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)\b/g;

// Keywords/contexts that produce false positives — matched AFTER the
// `alias.column` regex to skip non-schema occurrences.
const NON_SCHEMA_COL = new Set([
  // pg functions / literals
  'now', 'coalesce', 'sum', 'count', 'min', 'max', 'avg', 'date', 'now()',
  // JS interpolations inside the SQL template: $${p.length} is a parameter
  // placeholder array — `length` is JS, never a schema column.
  'length',
  // dialect noise
  'public',
]);

interface Drift {
  file: string;
  table: string;
  column: string;
}

describe('AI tools schema-drift gate (CI)', () => {
  const schema = loadSchema();
  const schemaTables = new Set(schema.keys());

  // Tables the sqlGuard allow-lists — every one must exist in the schema.
  it('every sqlGuard allow-listed table exists in the schema', async () => {
    const { AI_ALLOWED_TABLES_SET } = await import('../security/sqlGuard');
    const missing = [...AI_ALLOWED_TABLES_SET].filter((t) => !schemaTables.has(t));
    expect(missing, `allow-listed tables that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('no tool SQL references a column the schema does not have', async () => {
    const drifts: Drift[] = [];

    // Which tool files embed SQL — discovered by GLOB (not a hardcoded
    // list) so the Phase-77 split (writeTools/*.ts ×8) and batchTools can
    // never silently fall outside the gate again. Every .ts file under
    // tools/ EXCEPT pure test/contract files is scanned; files without
    // SQL-looking fragments cost nothing.
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const toolsDir = resolve(root, 'src/modules/ai/tools');
    const toolFiles: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full, `${prefix}${entry}/`);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
          toolFiles.push(`${prefix}${entry}`);
        }
      }
    };
    walk(toolsDir, '');

    for (const f of toolFiles) {
      const path = resolve(toolsDir, f);
      const src = readFileSync(path, 'utf-8');

      // SQL fragments: template literals passed to guardedQuery / adapter.query
      // — extract each backtick block, join its lines, then scan. NOTE:
      // fragments contain JS interpolations like $${p.length} (parameter
      // placeholders); those must not be scanned as schema refs, so any
      // `alias.length` hit is skipped below (`length` is never a column).
      const templateRe = /`([^`]*)`/g;
      let tm: RegExpExecArray | null;
      while ((tm = templateRe.exec(src)) !== null) {
        const fragment = tm[1];
        // Only scan fragments that look like SQL (case-insensitive select/from).
        if (!/\b(select|insert\s+into|update|delete\s+from)\b/i.test(fragment)) continue;
        const oneLine = fragment.replace(/\s+/g, ' ');

        // FROM/JOIN reveal which tables the aliases bind to: collect them.
        const aliasRe = /\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9]*)\s+(?:AS\s+)?([a-z_][a-z_0-9]*)/gi;
        const aliasToTable = new Map<string, string>();
        let am: RegExpExecArray | null;
        while ((am = aliasRe.exec(oneLine)) !== null) {
          aliasToTable.set(am[2].toLowerCase(), am[1].toLowerCase());
        }

        SQL_COL_RE.lastIndex = 0;
        let cm: RegExpExecArray | null;
        while ((cm = SQL_COL_RE.exec(oneLine)) !== null) {
          const alias = cm[1].toLowerCase();
          const column = cm[2].toLowerCase();
          if (NON_SCHEMA_COL.has(alias) || NON_SCHEMA_COL.has(column)) continue;

          // An alias we never bound (schema.sql embedded in strings, JSON
          // paths, module namespaces like settings.edit) — skip; we only
          // verify what we can bind to a real table.
          const table = aliasToTable.get(alias);
          if (!table) continue;

          const cols = schema.get(table);
          if (!cols) {
            // FROM references a table the schema doesn't have at all.
            if (!drifts.some((d) => d.file === f && d.table === table && d.column === '*')) {
              drifts.push({ file: f, table, column: '*' });
            }
            continue;
          }
          if (!cols.has(column)) {
            drifts.push({ file: f, table, column });
          }
        }
      }
    }

    expect(
      drifts.map((d) => `${d.file}: ${d.table}.${d.column}`),
      'tool SQL references columns that do not exist in the schema — update the SQL or the schema (see drizzle/ migrations)',
    ).toEqual([]);
  });
});
