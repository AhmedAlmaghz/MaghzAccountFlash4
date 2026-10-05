import { describe, it, expect } from 'vitest';

import {
  assertRelaySql,
  isPublicIpLiteral,
  classifyRelayTarget,
  extractTableNames,
  hasPermission,
  SQL_MODULE_TABLE_RULES,
  normalizeIdempotent,
} from './relayGuard.js';

const CID_A = '00000000-0000-0000-0000-000000000001';
const CID_B = '00000000-0000-0000-0000-000000000002';
const UID = '00000000-0000-0000-0000-000000000099';

function session(role, permissions = []) {
  return { user: { id: UID, companyId: CID_A, role }, permissions };
}
const admin = () => session('admin');
const viewer = () => session('viewer');
const salesRep = () => session('sales_rep');

function allows(s, sql, params = []) {
  assertRelaySql(s, sql, params);
}
function denies(s, sql, params = [], pattern = /./) {
  let error = '';
  try {
    assertRelaySql(s, sql, params);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  expect(error, `expected refusal for: ${sql}`).toMatch(pattern);
}

describe('relayGuard — statement surface (mirrors main _exec)', () => {
  it('allows ordinary tenant-scoped reads for a viewer', () => {
    allows(viewer(), 'SELECT * FROM products WHERE company_id = $1', [CID_A]);
    allows(viewer(), 'SELECT c.*, (SELECT 1) AS x FROM customers c WHERE c.company_id = $1 ORDER BY name', [CID_A]);
  });

  it('allows tenant-scoped writes for a creator role', () => {
    allows(admin(), 'INSERT INTO suppliers (company_id, name) VALUES ($1, $2)', [CID_A, 'x']);
    allows(admin(), 'UPDATE suppliers SET name = $1 WHERE id = $2 AND company_id = $3', ['x', UID, CID_A]);
  });

  it('denies reads without a company scope on tenant tables', () => {
    denies(viewer(), 'SELECT * FROM products', [], /Cross-company/);
    denies(viewer(), 'SELECT * FROM products WHERE company_id = $1', [CID_B], /Cross-company/);
  });

  it('denies mutations without WHERE on tenant tables', () => {
    denies(admin(), 'UPDATE suppliers SET name = $1', ['x'], /Cross-company/);
  });

  it('denies DDL, transactions verbs, comments and stacked statements', () => {
    for (const sql of [
      'DROP TABLE suppliers',
      'ALTER TABLE suppliers ADD COLUMN x text',
      'CREATE INDEX i ON suppliers (name)',
      'TRUNCATE suppliers',
      'DO $$ BEGIN END $$',
      'BEGIN',
      'COMMIT',
      'EXPLAIN SELECT 1',
      'SELECT 1; DROP TABLE suppliers',
      'SELECT * FROM suppliers -- comment',
    ]) {
      denies(admin(), sql, [CID_A], /not permitted/);
    }
  });

  it('denies system catalogs and unknown tables', () => {
    denies(admin(), 'SELECT * FROM pg_tables WHERE company_id = $1', [CID_A], /not permitted/);
    denies(admin(), 'SELECT * FROM information_schema.tables WHERE company_id = $1', [CID_A], /not permitted/);
    denies(admin(), 'SELECT * FROM mystery_table WHERE company_id = $1', [CID_A], /not permitted/);
  });

  it('denies sensitive columns on the relay channel', () => {
    denies(admin(), 'SELECT password_hash FROM users WHERE company_id = $1', [CID_A], /Sensitive/);
    denies(admin(), 'SELECT id, password_hash FROM users WHERE company_id = $1', [CID_A], /Sensitive/);
  });

  it('denies writes for read-only roles and cross-module writes', () => {
    denies(viewer(), 'INSERT INTO suppliers (company_id, name) VALUES ($1, $2)', [CID_A, 'x'], /Permission denied/);
    denies(salesRep(), 'INSERT INTO employees (company_id, name) VALUES ($1, $2)', [CID_A, 'x'], /Permission denied/);
  });

  it('allows cross-module posting writes the main allows (journal entries)', () => {
    allows(session('accountant'), 'INSERT INTO journal_entries (company_id, x) VALUES ($1, $2)', [CID_A, 1]);
    denies(viewer(), 'INSERT INTO journal_entries (company_id, x) VALUES ($1, $2)', [CID_A, 1], /Permission denied/);
  });

  it('enforces financial-update permissions on status/paid fields', () => {
    denies(
      session('accountant'),
      'UPDATE sales_invoices SET status = $1 WHERE id = $2 AND company_id = $3',
      ['posted', UID, CID_A],
      /Permission denied/,
    );
    allows(admin(), 'UPDATE sales_invoices SET status = $1 WHERE id = $2 AND company_id = $3', ['posted', UID, CID_A]);
  });

  it('keeps audit_logs append-only', () => {
    allows(admin(), 'INSERT INTO audit_logs (company_id, user_id) VALUES ($1, $2)', [CID_A, UID]);
    denies(admin(), 'DELETE FROM audit_logs WHERE company_id = $1', [CID_A], /append-only/);
  });

  it('accepts the CTE invoice shape the app ships (join + values alias)', () => {
    allows(
      admin(),
      'WITH inv AS (INSERT INTO purchase_invoices (company_id, invoice_number) VALUES ($1::uuid, $2) RETURNING id) SELECT id FROM inv',
      [CID_A, 'PINV-1'],
    );
  });

  it('every business table in the baseline has a rule', () => {
    const names = [...extractTableNames('SELECT * FROM sales_invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = $1')];
    expect(names.sort()).toEqual(['customers', 'sales_invoices']);
    for (const t of ['companies', 'users', 'roles', 'pos_shifts', 'ai_chat_messages', 'tax_periods', 'document_sequences']) {
      expect(SQL_MODULE_TABLE_RULES.some((r) => r.tables.includes(t)), `no rule for ${t}`).toBe(true);
    }
  });

  it('hasPermission honors admin bypass and fallbacks like the main', () => {
    expect(hasPermission(admin(), 'sales.delete')).toBe(true);
    expect(hasPermission(admin(), 'core.edit')).toBe(false);
    expect(hasPermission(viewer(), 'sales.view')).toBe(true);
    expect(hasPermission(viewer(), 'sales.create')).toBe(false);
    expect(hasPermission(salesRep(), 'sales.own')).toBe(true);
  });
});

describe('relayGuard — migration replay normalization', () => {
  it('adds IF NOT EXISTS once and guards bare constraints', () => {
    const out = normalizeIdempotent('CREATE TABLE t (id text);\nCREATE INDEX i ON t (id);');
    expect(out).toContain('CREATE TABLE IF NOT EXISTS t');
    expect(out).toContain('CREATE INDEX IF NOT EXISTS i');
    expect(normalizeIdempotent(out)).toBe(out);
  });

  it('wraps bare ADD CONSTRAINT in an existence-guarded DO block', () => {
    const out = normalizeIdempotent('ALTER TABLE "t" ADD CONSTRAINT "c_uniq" UNIQUE(id);');
    expect(out).toContain('IF NOT EXISTS (SELECT 1 FROM pg_constraint');
    expect(out).toContain('ADD CONSTRAINT "c_uniq"');
  });
});

describe('relayGuard — SSRF target classification', () => {
  const prod = { allowPrivate: false };
  const dev = { allowPrivate: true };

  it('blocks loopback, private, link-local and reserved IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.1', '169.254.169.254', '0.0.0.0', '224.0.0.1']) {
      expect(isPublicIpLiteral(ip), ip).toBe(false);
      expect(classifyRelayTarget('example.com', [ip], prod).ok, ip).toBe(false);
    }
    // 172.32.x is public (not in 172.16/12)
    expect(isPublicIpLiteral('172.32.0.1')).toBe(true);
  });

  it('blocks IPv6 non-public forms and judges mapped IPv4 by its tail', () => {
    expect(isPublicIpLiteral('::1')).toBe(false);
    expect(isPublicIpLiteral('fe80::1')).toBe(false);
    expect(isPublicIpLiteral('fc00::1')).toBe(false);
    expect(isPublicIpLiteral('ff02::1')).toBe(false);
    expect(isPublicIpLiteral('::ffff:10.0.0.1')).toBe(false);
    expect(isPublicIpLiteral('::ffff:8.8.8.8')).toBe(true);
  });

  it('allows public addresses and names', () => {
    expect(classifyRelayTarget('db.example.com', ['93.184.216.34'], prod)).toEqual({ ok: true });
  });

  it('rejects unresolvable hosts and magic local names in production', () => {
    expect(classifyRelayTarget('db.example.com', [], prod).ok).toBe(false);
    for (const h of ['localhost', 'db.localhost', 'printer.local', 'svc.internal']) {
      expect(classifyRelayTarget(h, ['127.0.0.1'], prod).ok, h).toBe(false);
      expect(classifyRelayTarget(h, ['127.0.0.1'], dev).ok, h).toBe(true);
    }
  });

  it('a single bad answer vetoes the whole target (rebinding-safe)', () => {
    expect(classifyRelayTarget('x.example', ['93.184.216.34', '10.0.0.1'], prod).ok).toBe(false);
    expect(classifyRelayTarget('x.example', ['93.184.216.34', '10.0.0.1'], dev).ok).toBe(true);
  });
});
