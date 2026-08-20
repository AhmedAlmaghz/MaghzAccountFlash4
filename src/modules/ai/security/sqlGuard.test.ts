import { describe, it, expect } from 'vitest';
import { assertSqlOperation, extractTableNames } from './sqlGuard';

describe('sqlGuard', () => {
  it('accepts a simple SELECT for an allowed table', () => {
    const r = assertSqlOperation('SELECT * FROM customers WHERE company_id = $1');
    expect(r.ok).toBe(true);
  });

  it('rejects a non-SELECT statement', () => {
    const r = assertSqlOperation('DELETE FROM customers WHERE id = $1');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('SELECT');
  });

  it('rejects a table not in the allow-list', () => {
    const r = assertSqlOperation('SELECT * FROM secret_logs WHERE company_id = $1');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('secret_logs');
  });

  it('rejects multi-statement SQL', () => {
    const r = assertSqlOperation('SELECT * FROM customers; DROP TABLE customers;');
    expect(r.ok).toBe(false);
  });
});

describe('extractTableNames', () => {
  it('extracts the queried table', () => {
    expect(extractTableNames('SELECT * FROM customers')).toContain('customers');
  });

  it('excludes CTE aliases', () => {
    const names = extractTableNames('WITH cust AS (SELECT * FROM customers) SELECT * FROM cust');
    expect(names.has('cust')).toBe(false);
    expect(names.has('customers')).toBe(true);
  });
});
