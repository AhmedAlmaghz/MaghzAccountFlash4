import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Child-collection replacement must be atomic.
 *
 * Every editable document keeps its header row plus a child table. Editing the
 * document rewrites that child table: header UPDATE, DELETE the old lines,
 * INSERT the new ones. When those three travel as fire-and-forget statements,
 * a failure in the middle leaves a document that contradicts itself — zero
 * lines under a non-zero total, or categories wiped by a "failed" price edit —
 * and the caller is told the outcome of whichever statement happened to run
 * last.
 *
 * Rule: a function that replaces a child collection must ship the parent
 * update and the replacement in ONE transaction, so the document is never
 * observable half-rewritten.
 *
 * Parsing note: bodies are located by the file's own line shape (2-space
 * `  async name(` … `  },`), which survives strings and regex literals where
 * brace counting does not.
 */
const SRC = join(process.cwd(), 'src', 'modules');

/** Child tables that are replaced wholesale on edit. */
const CHILD_DELETES =
  /DELETE FROM (sales_invoice_lines|quotation_lines|sales_return_lines|purchase_invoice_lines|purchase_order_lines|purchase_return_lines|product_product_categories)\b/;

/**
 * Reviewed exceptions — each one must verify EVERY write result and surface a
 * failure to the caller; the parent row is written FIRST so a failed edit can
 * never leave a half-swapped document.
 */
const REVIEWED_EXCEPTIONS: Record<string, string> = {
  'src/modules/inventory/api.ts:updateProduct':
    'Header is saved first; the link swap and the base-unit price sync are optional ' +
    'relations whose failure is returned as an explicit warning (never swallowed).',
};

/** Control flow is not an object member — treating it as one truncates bodies. */
const RESERVED = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'return', 'with']);

function apiFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      apiFiles(full, out);
    } else if (entry === 'api.ts') {
      out.push(full);
    }
  }
  return out;
}

/** Method bodies keyed by `${relPath}:${name}` — line-shape, CRLF tolerant. */
function methodBodies(absPath: string): Array<{ key: string; body: string }> {
  // Platform-independent relativization: the old `${cwd}\\` strip was a
  // no-op on Linux, producing absolute keys that matched nothing (and every
  // offender check after it). relative() + sep-split works on both.
  const rel = relative(process.cwd(), absPath).split(sep).join('/');
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
  const bodies: Array<{ key: string; body: string }> = [];
  let name: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (name) bodies.push({ key: `${rel}:${name}`, body: buf.join('\n') });
    name = null;
    buf = [];
  };
  for (const line of lines) {
    const open = /^ {2}(?:async )?([A-Za-z0-9_]+)\s*\(/.exec(line);
    if (open && !RESERVED.has(open[1])) {
      if (name) flush();
      name = open[1];
      buf = [line];
      continue;
    }
    if (name) {
      if (/^ {2}\},?\s*$/.test(line) || /^ {2}\}\);?\s*$/.test(line)) flush();
      else buf.push(line);
    }
  }
  flush();
  return bodies;
}

const allBodies = apiFiles(SRC).flatMap(methodBodies);
const offenders = allBodies.filter((b) => CHILD_DELETES.test(b.body) && !/adapter\.transaction\(/.test(b.body));

describe('child collection replacement is atomic (Phase FIN)', () => {
  it('the scanner sees the multi-statement document editors (no silent blind spot)', () => {
    const keys = allBodies.map((b) => b.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'src/modules/sales/api.ts:updateInvoice',
        'src/modules/sales/api.ts:updateQuotation',
        'src/modules/sales/api.ts:updateReturn',
        'src/modules/purchases/api.ts:updateInvoice',
        'src/modules/inventory/api.ts:updateProduct',
      ]),
    );
  });

  it('every function that replaces child rows ships the rewrite in one transaction', () => {
    const unexpected = offenders
      .filter((b) => CHILD_DELETES.test(b.body))
      .map((b) => b.key)
      .filter((key) => !(key in REVIEWED_EXCEPTIONS));
    expect(unexpected).toEqual([]);
  });

  it('a reviewed exception still has a written justification', () => {
    for (const key of offenders.map((b) => b.key)) {
      expect(REVIEWED_EXCEPTIONS[key] ?? '').not.toBe('');
    }
  });

  it('the reviewed exception keeps the parent row first (a failed edit cannot half-swap)', () => {
    const body = allBodies.find((b) => b.key === 'src/modules/inventory/api.ts:updateProduct')!.body;
    expect(body.indexOf('UPDATE products SET')).toBeLessThan(body.indexOf('DELETE FROM product_product_categories'));
  });
});
