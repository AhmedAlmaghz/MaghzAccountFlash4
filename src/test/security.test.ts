import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Guard يمنع تخزين كلمات مرور صلبة أو fallback في كود المصدر الملتزم.
 */

const ROOT = path.resolve(__dirname, '../..');

function readRelative(relPath: string): string {
  try {
    return readFileSync(path.join(ROOT, relPath), 'utf-8');
  } catch {
    return '';
  }
}

function loadRawTenantScopeValidator() {
  const source = readRelative('electron/dbHandler.js').replace(/\r\n/g, '\n');
  const start = source.indexOf('function rawTenantScopeIsValid');
  const end = source.indexOf('function assertSqlAuthorized', start);
  if (start < 0 || end < 0) throw new Error('rawTenantScopeIsValid was not found');
  return new Function(`${source.slice(start, end)}; return rawTenantScopeIsValid;`)();
}

function loadRawChildScopeValidator() {
  const source = readRelative('electron/dbHandler.js').replace(/\r\n/g, '\n');
  const start = source.indexOf('const RAW_SQL_CHILD_PARENT_RULES');
  const end = source.indexOf('function assertSqlAuthorized', start);
  if (start < 0 || end < 0) throw new Error('rawChildScopeIsValid was not found');
  return new Function(`${source.slice(start, end)}; return rawChildScopeIsValid;`)();
}

describe('security: no hardcoded DB password fallback in tracked config', () => {
  it('drizzle.config.ts has no non-empty password fallback', () => {
    const cfg = readRelative('drizzle.config.ts');
    expect(cfg).not.toMatch(/password\s*:\s*[^\n]*'[^']+'/);
  });

  it('drizzle.check.config.ts has no non-empty password fallback', () => {
    const cfg = readRelative('drizzle.check.config.ts');
    expect(cfg).not.toMatch(/password\s*:\s*[^\n]*'[^']+'/);
  });
});

function loadPostingDateOnly() {
  const source = readRelative('electron/dbHandler.js').replace(/\r\n/g, '\n');
  const start = source.indexOf('function postingDateOnly');
  const end = source.indexOf('async function assertPostingPeriodsOpenOnClient', start);
  if (start < 0 || end < 0) throw new Error('postingDateOnly was not found');
  return new Function(`${source.slice(start, end)}; return postingDateOnly;`)();
}

describe('security: raw renderer tenant scope', () => {
  const companyId = '00000000-0000-4000-8000-000000000001';
  const otherCompanyId = '00000000-0000-4000-8000-000000000002';
  const validate = loadRawTenantScopeValidator();
  const validateChild = loadRawChildScopeValidator();
  const normalizePostingDate = loadPostingDateOnly();

  it('normalizes Date-valued posting dates without locale text', () => {
    expect(normalizePostingDate(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(normalizePostingDate('2026-01-02T23:30:00Z')).toBe('2026-01-02');
    expect(normalizePostingDate('not-a-date')).toBe('');
  });

  it('accepts a scoped single-table read', () => {
    expect(validate('SELECT * FROM customers WHERE company_id = $1', [companyId], companyId, ['customers'])).toBe(true);
  });

  it('requires every tenant table in a join to be scoped', () => {
    const sql = 'SELECT * FROM customers c JOIN suppliers s ON s.id = c.id WHERE c.company_id = $1';
    expect(validate(sql, [companyId], companyId, ['customers', 'suppliers'])).toBe(false);
  });

  it('uses the company id as the single-row companies scope', () => {
    expect(validate('SELECT * FROM companies WHERE id = $1', [companyId], companyId, ['companies'])).toBe(true);
  });

  it('accepts an ANY company scope', () => {
    expect(validate('SELECT * FROM customers WHERE company_id = ANY($1::uuid[])', [companyId], companyId, ['customers'])).toBe(true);
  });

  it('rejects a company parameter belonging to another tenant', () => {
    expect(validate('SELECT * FROM customers WHERE company_id = $1', [otherCompanyId], companyId, ['customers'])).toBe(false);
  });

  it('rejects unscoped updates and deletes', () => {
    expect(validate('UPDATE customers SET name = $1', ['name'], companyId, ['customers'])).toBe(false);
    expect(validate('DELETE FROM customers', [], companyId, ['customers'])).toBe(false);
  });

  it('does not treat a company_id assignment as a tenant predicate', () => {
    expect(validate('UPDATE customers SET company_id = $1 WHERE id = $2', [companyId, 'customer-id'], companyId, ['customers'])).toBe(false);
  });

  it('accepts a correctly scoped update', () => {
    expect(validate('UPDATE customers SET name = $1 WHERE id = $2 AND company_id = $3', ['name', 'id', companyId], companyId, ['customers'])).toBe(true);
  });

  it('accepts a child read joined to a company-scoped parent', () => {
    const sql = 'SELECT l.* FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.company_id = $1';
    expect(validateChild(sql, [companyId], companyId, ['sales_invoice_lines'])).toBe(true);
  });

  it('accepts a child read with an explicit parent company subquery', () => {
    const sql = 'SELECT * FROM sales_invoice_lines WHERE invoice_id = $1 AND $2::uuid = (SELECT company_id FROM sales_invoices WHERE id = $1)';
    expect(validateChild(sql, ['invoice-id', companyId], companyId, ['sales_invoice_lines'])).toBe(true);
  });

  it('rejects a child read without a parent company scope', () => {
    expect(validateChild('SELECT * FROM sales_invoice_lines WHERE invoice_id = $1', ['invoice-id'], companyId, ['sales_invoice_lines'])).toBe(false);
  });

  it('rejects a child write scoped only through an unrelated product company predicate', () => {
    const sql = 'UPDATE sales_invoice_lines sil SET unit_cost = 1 FROM products p WHERE p.id = sil.product_id AND p.company_id = $1';
    expect(validateChild(sql, [companyId], companyId, ['sales_invoice_lines'])).toBe(false);
  });

  it('accepts a child CTE when the parent table is already tenant-scoped', () => {
    const sql = 'WITH inv AS (INSERT INTO sales_invoices (company_id, invoice_number) VALUES ($1, $2) RETURNING id), lines AS (INSERT INTO sales_invoice_lines (invoice_id, product_id, quantity) SELECT inv.id, $3, 1 FROM inv) SELECT id FROM inv';
    expect(validateChild(sql, [companyId, 'INV-1', 'product-id'], companyId, ['sales_invoice_lines'], ['sales_invoices'])).toBe(true);
  });
});
