import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The existing tenantScopeGate asks whether a statement carries a `company_id`
 * predicate. That is necessary and not sufficient.
 *
 * `INSERT INTO audit_logs (..., company_id) VALUES (..., $9)` has the column,
 * has the predicate-shaped value, and passes. But $9 came from a renderer
 * payload, so any authenticated caller can file an audit entry against another
 * company. The predicate proves the *column* is scoped; nothing about it proves
 * the *value* came from the session.
 *
 * So this gate asks the harder question: for every company-scoped table the
 * renderer writes, is the value session-derived? Two accepted shapes:
 *   - the module declares no renderer-side company value at all (it is gone,
 *     replaced by a typed RPC channel), or
 *   - the module states the value is session-derived and the channel it uses
 *     resolves the company in the main process.
 *
 * The real finding was auditLogger: logAudit is called from 71 sites in 30
 * files and every one of them could write another company's id.
 */
const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out']);

/**
 * Modules that write a company-scoped table from the renderer, and how each one
 * justifies the company value. Adding an entry is a deliberate act: it is a
 * claim that the value cannot come from the payload.
 */
const SESSION_DERIVED = new Set<string>([
  // Typed RPC: the main process resolves company_id from the authenticated
  // session, so no renderer value reaches the statement.
  'src/modules/tax/engine.ts',
  'src/modules/sales/api.ts',
  'src/modules/purchases/api.ts',
  'src/modules/inventory/api.ts',
  'src/modules/accounting/api.ts',
  'src/modules/crm/api.ts',
  'src/modules/hr/api.ts',
  'src/modules/manufacturing/api.ts',
  'src/modules/pos/api.ts',
  'src/modules/core/api.ts',
  'src/core/api.ts',
  'src/core/utils/journalEntryGenerator.ts',
  'src/core/utils/taxPolicy.ts',
  'src/core/utils/stockPolicy.ts',
  'src/core/utils/yearEnd.ts',
  'src/core/utils/assets.ts',
  'src/core/utils/reversal.ts',
  'src/core/database/adapters/pgliteAdapter.ts',
  // Both audit loggers now write through the session-derived channel.
  'src/core/utils/auditLogger.ts',
  'src/core/audit/auditLogger.ts',
  // Infrastructure and one-shot tools. Listed, not excused: each is a
  // deliberate claim that the company value is not caller-controlled.
  'src/core/backup/backupService.ts',
  'src/core/database/tx.ts',
  'src/core/services/postingService.ts',
  'src/core/utils/openingBalance.ts',
  'src/core/utils/valuation.ts',
  'src/modules/accounting/yearEnd.ts',
  'src/modules/ai/api/browserBridge.ts',
  'src/modules/ai/jev/jevConfig.ts',
  'src/modules/auth/api.ts',
  'src/modules/pos/components/PosSettingsPage.tsx',
  'src/modules/settings/components/HrSettingsPage.tsx',
  'src/modules/settings/components/VatSettingsPage.tsx',
]);

/** the statement shapes that write a company-scoped row */
const COMPANY_WRITES =
  /(INSERT\s+INTO|UPDATE)\s+(customers|suppliers|employees|accounts|sales_invoices|sales_invoice_lines|purchases_invoices|purchases|purchase_invoice_lines|receipt_vouchers|payment_vouchers|audit_logs|settings|default_accounts|products|stock|stock_movements|journals|journal_entries|transactions|quotations|leads|opportunities|tasks|activities|tax_periods|accounting_periods|pos_shifts|pos_payments|document_sequences|cash_boxes|warehouses|work_orders|boms|user_?s?)\b/i;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function writesCompanyScopedTable(text: string): boolean {
  // only raw renderer statements count: adapter.query / adapter.transaction
  const calls = text.match(/adapter\.(query|transaction|createTransaction)\s*(<[^()]*?>)?\s*\(/g) || [];
  if (!calls.length) return false;
  return COMPANY_WRITES.test(text);
}

describe('company values in renderer writes are session-derived', () => {
  it('the unlisted set covers every module that writes a company-scoped table', () => {
    const unlisted: string[] = [];
    for (const f of sourceFiles(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      const text = readFileSync(f, 'utf8');
      if (!writesCompanyScopedTable(text)) continue;
      if (!SESSION_DERIVED.has(rel)) unlisted.push(rel);
    }
    expect(unlisted, 'a module writing a company-scoped table must state how the company value is derived').toEqual([]);
  });

  it('the audit logger reaches the database without a renderer company id on desktop', () => {
    // Regression for the finding: logAudit reached PostgreSQL with a company
    // id taken from its caller, and 71 call sites in 30 files supplied it. On
    // desktop the write now goes through the session-derived channel; the
    // remaining adapter statement is the PGlite fallback, which is a
    // single-tenant in-process database where the payload company is the only
    // company there is.
    const logger = readFileSync(join(ROOT, 'src', 'core', 'utils', 'auditLogger.ts'), 'utf8');
    const rpcAt = logger.indexOf('electronDB?.audit');
    expect(rpcAt, 'the audit write must go through a typed channel').toBeGreaterThan(-1);
    const fallback = logger.slice(logger.indexOf('const adapter = await getDbAdapter()'));
    expect(fallback, 'the fallback must still exist for PGlite').toMatch(/INSERT\s+INTO\s+audit_logs/i);
    // the branch order is the point: RPC first, adapter only when it is absent
    expect(rpcAt, 'the typed branch must come before the adapter fallback').toBeLessThan(
      logger.indexOf('const adapter = await getDbAdapter()')
    );
  });

  it('neither audit logger prefers a caller-supplied company id', () => {
    // There are two loggers with the same name. The second one derived the
    // user from the store but still preferred `entry.companyId`, which is the
    // same hole wearing a different hat.
    for (const rel of ['src/core/utils/auditLogger.ts', 'src/core/audit/auditLogger.ts']) {
      const text = readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
      expect(text, `${rel} must not fall back to a payload company id`).not.toMatch(/entry\.companyId\s*\|\|/);
      expect(text, `${rel} must route through the audit channel`).toMatch(/electronDB\?\.audit|isElectronPg/);
    }
  });

  it('the main process derives the audit company id from the session', () => {
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    const i = db.indexOf("registerRpc('audit.log'");
    expect(i, 'an audit channel must exist in the main process').toBeGreaterThan(-1);
    const block = db.slice(i, db.indexOf('});', i));
    expect(block, 'the audit insert must bind the company id from the session').toMatch(/session\.user\.companyId/);
    expect(block, 'the audit insert must not accept a company id from the payload').not.toMatch(/p\.companyId/);
    // the user id too: a caller must not be able to forge authorship
    expect(block, 'the audit insert must bind the user id from the session').toMatch(/session\.user\.id/);
  });

  it('the list side cannot be asked for another company either', () => {
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    const i = db.indexOf("registerRpc('audit.list'");
    expect(i).toBeGreaterThan(-1);
    const block = db.slice(i, db.indexOf('});', i));
    expect(block, 'reading the trail must not accept a company id from the payload').not.toMatch(/p\.companyId/);
  });

  it('no main-process channel binds the company id from the payload', () => {
    // The renderer-facing guard rejects a mismatching companyId before the
    // handler runs, so a channel that still binds p.companyId is a hole the
    // moment that guard is ever relaxed, and it is the exact shape the audit
    // finding had. Counting rather than naming: a name scan has to guess which
    // channel owns an occurrence, and it guesses wrong.
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    const bindings = [...db.matchAll(/params:\s*\[[^\]]*\bp\.companyId\b/g)];
    expect(
      bindings.map((m) => db.slice(Math.max(0, m.index - 3000), m.index).match(/registerRpc\('([\w.]+)'/g)?.pop()),
      'a channel binds the company from the payload — take it from session.user.companyId'
    ).toEqual([]);
  });

  it('every channel signature that reaches for the session declares it', () => {
    // Found by accident: rebinding eight channels from p.companyId to
    // session.user.companyId left two validate() bodies referencing a session
    // their signature never declared. node --check passes on that — it is a
    // runtime ReferenceError on the first call, and only for those two
    // channels. So the signatures are checked, by brace matching per channel
    // rather than by a loose scan over the whole file.
    const db = readFileSync(join(ROOT, 'electron', 'dbHandler.js'), 'utf8');
    const problems: string[] = [];
    let channels = 0;
    for (const m of db.matchAll(/registerRpc\('([\w.]+)',\s*\{/g)) {
      const name = m[1];
      const open = db.indexOf('{', m.index + m[0].length - 1);
      let d = 0;
      let end = -1;
      for (let k = open; k < db.length; k++) {
        if (db[k] === '{') d++;
        else if (db[k] === '}') { d--; if (d === 0) { end = k; break; } }
      }
      if (end < 0) { problems.push(`${name}: unterminated channel`); continue; }
      const block = db.slice(m.index, end + 1);
      channels++;
      // match each declaration and read its own body, so a compose with a
      // session parameter is not confused with a validate that has none
      const decls: { name: string; at: number; params: string[] }[] = [];
      const v = /validate:\s*(?:async\s*)?\(\s*([^)]*)\)/.exec(block);
      if (v) {
        decls.push({ name: 'validate', at: block.indexOf(v[0]) + v[0].length, params: v[1].split(',').map((x) => x.trim()).filter(Boolean) });
      }
      const c = /compose:\s*\(\s*([a-zA-Z_$][\w$]*)\s*(?:,\s*([a-zA-Z_$][\w$]*))?\s*\)\s*=>\s*(?:\{|\()/.exec(block);
      if (c) {
        const params = [c[1], c[2]].filter(Boolean) as string[];
        decls.push({ name: 'compose', at: block.indexOf(c[0]) + c[0].length, params });
      }
      for (const decl of decls) {
        // the body runs until the next top-level declaration or the end
        const rest = block.slice(decl.at);
        const nextDecl = rest.search(/\n\s{4}(?:validate|compose|paramCount|permission|mapResult):/);
        const body = nextDecl > 0 ? rest.slice(0, nextDecl) : rest;
        if (/session\./.test(body) && !decl.params.includes('session')) {
          problems.push(`${name}: ${decl.name}(${decl.params.join(',')}) uses session without declaring it`);
        }
      }
    }
    expect(channels, 'the scan found no channels — has the registration shape changed?').toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });
});
