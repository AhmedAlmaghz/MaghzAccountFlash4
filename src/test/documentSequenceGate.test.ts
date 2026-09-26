/**
 * CI gate: document numbering has exactly one source, and every engine that
 * seeds sequences agrees on the same set.
 *
 * Why this exists: `getNextDocumentNumber` is the single numbering path for 19
 * document types (core/api.ts), and it returns the honest failure
 * "Sequence not found: <type>" when the row is missing. Three engines seed that
 * table — the demo seed, the PGlite seed and the signup backfill in
 * electron/dbHandler.js. `fixed_asset` was present in two of them, so every
 * browser/PGlite company was unable to create a fixed asset. Nothing caught it:
 * the failure is a runtime error message, not a type or test error.
 *
 * Reading the seeds is textual on purpose — the values are data, not code, and
 * a data list is exactly what a type checker cannot verify.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Every document type the runtime actually asks for. */
const RUNTIME_TYPES = [
  'customer', 'employee', 'fixed_asset', 'inventory_transfer', 'journal_voucher',
  'payment_voucher', 'payroll_run', 'pos_receipt', 'product', 'purchase_invoice',
  'purchase_order', 'purchase_return', 'quotation', 'receipt_voucher',
  'sales_invoice', 'sales_return', 'stock_adjustment', 'supplier', 'work_order',
];

/** The three engines that populate document_sequences. */
const ENGINES = [
  { label: 'demo seed', file: 'electron/seedDemoData.js' },
  { label: 'pglite seed', file: 'src/core/database/adapters/pgliteAdapter.ts' },
  { label: 'signup backfill', file: 'electron/dbHandler.js' },
];

function seedTypes(file: string): Set<string> {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const out = new Set<string>();
  // { type: 'x', prefix: … } — demo + pglite
  for (const m of src.matchAll(/type:\s*'([a-z_]+)'/g)) out.add(m[1]);
  // ['x', 'PFX-', …] tuple form — dbHandler additionalDocSeqs
  for (const m of src.matchAll(/\[\s*'([a-z_]+)'\s*,\s*'[A-Za-z]{1,5}-'/g)) out.add(m[1]);
  return out;
}

/** Types the renderer asks for, read from the call sites themselves. */
function calledTypes(): Set<string> {
  const found = new Set<string>();
  const files: string[] = [];
  (function walk(dir: string): void {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
    }
  })('src');
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/getNextDocumentNumber\([^,)]+,\s*'([a-z_]+)'/g)) found.add(m[1]);
  }
  return found;
}

const engineTypes = new Map(ENGINES.map((e) => [e.label, seedTypes(e.file)]));
const CALLED = calledTypes();

describe('document numbering: one source, three agreeing engines', () => {
  it('the call-site scan sees every documented type (a broken scan passes by absence)', () => {
    // Both literal shapes again: a quote-only or template-only scanner halves
    // this set and every assertion below becomes weaker without failing.
    for (const t of RUNTIME_TYPES) {
      expect(CALLED, `${t} is called at runtime but the scan missed it`).toContain(t);
    }
    expect(CALLED.size).toBe(RUNTIME_TYPES.length);
  });

  for (const e of ENGINES) {
    it(`the ${e.label} seeds every runtime type`, () => {
      const seeded = engineTypes.get(e.label)!;
      const missing = RUNTIME_TYPES.filter((t) => !seeded.has(t));
      expect(
        missing,
        `${e.label} (${e.file}) is missing document_sequences rows for: ${missing.join(', ')} — ` +
        'getNextDocumentNumber would answer "Sequence not found" at runtime'
      ).toEqual([]);
    });
  }

  it('the two numbering maps in core/api.ts cover the same keys', () => {
    const src = readFileSync(join(ROOT, 'src/core/api.ts'), 'utf8');
    const table = src.slice(
      src.indexOf('function getTableForDocumentType'),
      src.indexOf('function getNumberColumnForDocumentType')
    );
    const col = src.slice(
      src.indexOf('function getNumberColumnForDocumentType'),
      src.indexOf('export async function applyDefaultTemplate')
    );
    const tk = new Set([...table.matchAll(/([a-z_]+):\s*'[a-z_]+'/g)].map((m) => m[1]));
    const ck = new Set([...col.matchAll(/([a-z_]+):\s*'[a-z_]+'/g)].map((m) => m[1]));
    // A type in one map and not the other means either no collision check or a
    // missing table — the numbering silently degrades.
    expect([...tk].filter((k) => !ck.has(k)), 'table map without a column map').toEqual([]);
    expect([...ck].filter((k) => !tk.has(k)), 'column map without a table map').toEqual([]);
    expect(tk.size).toBeGreaterThan(15);
  });
});
