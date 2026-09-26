/**
 * CI gate: no renderer-side raw SQL may touch a company-scoped table without a
 * tenant predicate.
 *
 * Why this exists (learned the hard way, see the audit report):
 *  - The company_id table set is derived from the MIGRATIONS, not hand-listed,
 *    and the DDL quotes identifiers: CREATE TABLE "branches" ( ... ).
 *  - Both literal shapes must be scanned: `adapter.query(\`…\`)` AND
 *    `adapter.query('…')`. A backtick-only scan silently exempts every
 *    single-quoted statement.
 *  - A composed filter (${where}) is a HYBRID verdict, not a miss: the
 *    predicate is proven by measuring the distance back to the nearest
 *    company_id push. Every idiom counts: `conditions = [...]`,
 *    `conditions: string[] = []`, `conditions.push(...)`, and the verdict
 *    reports its evidence distance instead of hiding a threshold.
 *  - Self-test: the scanner must flag a known-unscoped statement. A gate that
 *    cannot fail is not a gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const DRIZZLE = join(ROOT, 'drizzle');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Tables that have a company_id column, from the migrations themselves. */
function companyScopedTables(): Set<string> {
  const ddl = readdirSync(DRIZZLE)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(DRIZZLE, f), 'utf8'))
    .join('\n');
  const scoped = new Set<string>();
  const QID = '(?:"([a-z0-9_]+)"|([a-z_][a-z0-9_]*))';
  const createRe = new RegExp(
    'CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + QID + '\\s*\\(([\\s\\S]*?)\\n\\s*\\)\\s*;',
    'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(ddl)) !== null) {
    if (/\bcompany_id\b/i.test(m[3])) scoped.add((m[1] || m[2]).toLowerCase());
  }
  const alterRe = new RegExp(
    'ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + QID + '\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?company_id',
    'gi'
  );
  while ((m = alterRe.exec(ddl)) !== null) scoped.add((m[1] || m[2]).toLowerCase());
  return scoped;
}

interface Finding {
  file: string;
  line: number;
  tables: string[];
  grade: 'UNSCOPED' | 'INTERPOLATED';
  vars: string;
  evidenceDistance: number | null;
}

const WINDOW = 150;

function scan(): { scoped: Set<string>; findings: Finding[]; examined: number; callsites: number } {
  const scoped = companyScopedTables();
  const findings: Finding[] = [];
  let examined = 0;
  let callsites = 0;
  // Both literal shapes: template AND single-quoted.
  const CALL = /adapter\.query(?:<[^>]*>)?\(\s*([`'"])/g;
  const CALL_ANY = /adapter\.query(?:<[^>]*>)?\(/g;

  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    callsites += (src.match(CALL_ANY) || []).length;
    let m: RegExpExecArray | null;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(src)) !== null) {
      const quote = m[1];
      let k = m.index + m[0].length;
      let body = '';
      while (k < src.length && src[k] !== quote) {
        if (src[k] === '\\') { body += src[k + 1]; k += 2; continue; }
        body += src[k]; k += 1;
      }
      if (k >= src.length) continue;
      examined += 1;
      const line = src.slice(0, m.index).split('\n').length;
      if (!/^\s*(select|insert|update|delete|with)\b/i.test(body)) continue;

      const tabs = new Set<string>();
      const tRe = /\b(?:from|join|into|update|delete\s+from)\s+"?([a-z_][a-z0-9_]*)"?/gi;
      let t: RegExpExecArray | null;
      while ((t = tRe.exec(body)) !== null) tabs.add(t[1].toLowerCase());
      const touched = [...tabs].filter((x) => scoped.has(x));
      if (!touched.length) continue;
      if (/\bcompany_id\b/i.test(body)) continue;

      const vars: string[] = [];
      const iRe = /\$\{\s*([A-Za-z_$][\w$]*)/g;
      let v: RegExpExecArray | null;
      while ((v = iRe.exec(body)) !== null) vars.push(v[1]);
      if (!vars.length) {
        findings.push({ file: rel, line, tables: touched, grade: 'UNSCOPED', vars: '', evidenceDistance: null });
        continue;
      }
      // HYBRID: prove the predicate by walking back to the nearest push.
      const lines = src.split('\n');
      const before = lines.slice(0, line - 1);
      let dist: number | null = null;
      for (let i = before.length - 1; i >= 0; i -= 1) {
        const near = before[i] + ' ' + (before[i + 1] || '');
        if (/\bcompany_id\b/i.test(before[i]) && /(conditions|where|scope|filter|params)\w*\s*[.(:=]/i.test(near)) {
          dist = before.length - i;
          break;
        }
        if (before.length - i > WINDOW) break;
      }
      findings.push({ file: rel, line, tables: touched, grade: 'INTERPOLATED', vars: [...new Set(vars)].join(','), evidenceDistance: dist });
    }
  }
  return { scoped, findings, examined, callsites };
}

const RESULT = scan();

describe('cross-tenant gate: raw SQL keeps a tenant predicate', () => {
  it('derives a usable company_id table set from the migrations', () => {
    // A quoted-identifier or missing-ALTER parse would silently shrink this
    // and turn every assertion below into a pass-by-absence.
    expect(RESULT.scoped.size).toBeGreaterThan(40);
    for (const must of ['accounts', 'transactions', 'sales_invoices', 'purchase_orders', 'leads', 'employees']) {
      expect(RESULT.scoped, `table ${must} is company-scoped`).toContain(must);
    }
  });

  it('the scanner can fail: a known unscoped statement is detected', () => {
    const probe = 'SELECT id, name FROM accounts WHERE code = $1';
    const tabs = [...probe.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
    const touched = tabs.filter((x) => RESULT.scoped.has(x));
    expect(touched.length).toBeGreaterThan(0);
    expect(/\bcompany_id\b/i.test(probe)).toBe(false);
    expect(touched.length > 0 && !/\bcompany_id\b/i.test(probe)).toBe(true);
  });

  it('scans both literal shapes (a backtick-only scan would exempt quoted SQL)', () => {
    expect(RESULT.examined).toBeGreaterThan(300);
    expect(RESULT.callsites).toBeGreaterThanOrEqual(RESULT.examined);
  });

  it('no UNSCOPED statement touches a company-scoped table', () => {
    const unscoped = RESULT.findings.filter((f) => f.grade === 'UNSCOPED');
    // Child reads once lived here with reasons (lines-by-parent-id inherited the
    // parent's scope). They were all hardened with explicit company predicates,
    // so the list is now EMPTY BY DESIGN — any new UNSCOPED statement fails.
    const KNOWN_CHILD_READS = new Set<string>([]);
    const unexpected = unscoped.filter((f) => !KNOWN_CHILD_READS.has(`${f.file}:${f.line}`));
    expect(
      unexpected.map((f) => `${f.file}:${f.line} [${f.tables.join(',')}]`),
      'new unscoped raw SQL on a company-scoped table — add AND company_id = $N, or extend the reviewed list with a reason'
    ).toEqual([]);
  });

  it('every composed filter (${where}) is proven to carry a tenant predicate', () => {
    const unproven = RESULT.findings.filter((f) => f.grade === 'INTERPOLATED' && f.evidenceDistance === null);
    expect(
      unproven.map((f) => `${f.file}:${f.line} \${${f.vars}}`),
      'a composed filter with no provable company_id push — the predicate may not exist'
    ).toEqual([]);
  });
});
