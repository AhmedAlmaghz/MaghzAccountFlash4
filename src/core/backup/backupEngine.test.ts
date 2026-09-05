import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';

// jsdom ships without crypto.subtle — provide Node's WebCrypto so the
// checksum/encryption paths exercise the real algorithms.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

import {
  BACKUP_MAGIC,
  BackupError,
  base64Decode,
  base64Encode,
  composeRestoreBatch,
  decodeBackup,
  deleteForScope,
  encodeBackup,
  selectForScope,
  sha256Hex,
} from './backupEngine';

const SAMPLE = {
  customers: [
    { id: 'c1', company_id: 'co1', name: 'عميل', balance: '100.50', meta: { vip: true } },
    { id: 'c2', company_id: 'co1', name: 'عميل 2', balance: null, extra: undefined },
  ],
  sales_invoices: [],
};

describe('base64 + sha256 helpers', () => {
  it('round-trips binary data through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 13, 10]);
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });

  it('produces stable 64-char hex digests', async () => {
    const a = await sha256Hex(new TextEncoder().encode('hello'));
    const b = await sha256Hex(new TextEncoder().encode('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('encode/decode round-trip (plain)', () => {
  it('preserves tables and reports row counts', async () => {
    const text = await encodeBackup(SAMPLE, { companyId: 'co1', companyName: 'شركتي' });
    const { manifest, tables } = await decodeBackup(text);
    expect(manifest.companyId).toBe('co1');
    expect(manifest.encrypted).toBe(false);
    expect(manifest.tables.customers.rows).toBe(2);
    expect(manifest.totalRows).toBe(2);
    expect(tables.customers[0].name).toBe('عميل');
  });

  it('strips password hashes without encryption and records it', async () => {
    const text = await encodeBackup(
      { users: [{ id: 'u1', username: 'admin', password_hash: 'pbkdf2:secret' }] },
      { companyId: 'co1', companyName: 'x' },
    );
    const { manifest, tables } = await decodeBackup(text);
    expect(manifest.secretsStripped).toContain('users.password_hash');
    expect(tables.users[0]).not.toHaveProperty('password_hash');
  });

  // PBKDF2-210k × encode+decode is CPU-heavy — generous timeout so loaded
  // CI workers don't flake (unit correctness is unaffected).
  it('keeps secrets when encrypted', { timeout: 30000 }, async () => {
    const text = await encodeBackup(
      { users: [{ id: 'u1', username: 'admin', password_hash: 'pbkdf2:secret' }] },
      { companyId: 'co1', companyName: 'x', password: 'LongPassword123' },
    );
    const { manifest, tables } = await decodeBackup(text, 'LongPassword123');
    expect(manifest.encrypted).toBe(true);
    expect(manifest.secretsStripped).toEqual([]);
    expect(tables.users[0].password_hash).toBe('pbkdf2:secret');
  });
});

describe('decodeBackup verification', () => {
  it('rejects non-backup files', async () => {
    await expect(decodeBackup('{"hello":1}')).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(decodeBackup('not json')).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });

  it('rejects tampered payloads via checksum', async () => {
    const text = await encodeBackup(SAMPLE, { companyId: 'co1', companyName: 'x' });
    const env = JSON.parse(text);
    env.payload = env.payload.slice(0, -4) + 'AAAA';
    await expect(decodeBackup(JSON.stringify(env))).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('requires a password for encrypted backups and rejects wrong ones', { timeout: 30000 }, async () => {
    const text = await encodeBackup(SAMPLE, { companyId: 'co1', companyName: 'x', password: 'RightPassword99' });
    await expect(decodeBackup(text)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    await expect(decodeBackup(text, 'WrongPassword99')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });

  it('rejects future format versions', async () => {
    const text = await encodeBackup(SAMPLE, { companyId: 'co1', companyName: 'x' });
    const env = JSON.parse(text);
    env.formatVersion = 999;
    env.magic = BACKUP_MAGIC;
    await expect(decodeBackup(JSON.stringify(env))).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
  });

  it('BackupError carries machine-readable codes', () => {
    expect(new BackupError('INVALID_FILE', 'x').code).toBe('INVALID_FILE');
  });
});

describe('SQL composers (whitelisted identifiers, parameterized values)', () => {
  it('selectForScope covers all three scopes', () => {
    expect(selectForScope({ table: 'customers', scope: { type: 'company' } }).sql).toContain('WHERE company_id = $1');
    expect(selectForScope({ table: 'companies', scope: { type: 'single', idColumn: 'id' } }).sql).toContain(
      'WHERE id = $1',
    );
    expect(
      selectForScope({ table: 'sales_invoice_lines', scope: { type: 'children', parent: 'sales_invoices', fk: 'invoice_id' } })
        .sql,
    ).toContain('JOIN sales_invoices');
  });

  it('deleteForScope scopes children through the parent', () => {
    const { sql } = deleteForScope({
      table: 'sales_invoice_lines',
      scope: { type: 'children', parent: 'sales_invoices', fk: 'invoice_id' },
    });
    expect(sql).toMatch(/DELETE FROM sales_invoice_lines WHERE invoice_id IN \(SELECT id FROM sales_invoices WHERE company_id = \$1\)/);
  });

  it('composeRestoreBatch deletes before inserting and params stay aligned', () => {
    const { statements, warnings } = composeRestoreBatch('co1', SAMPLE);
    expect(warnings).toEqual([]);
    const deletes = statements.filter((s) => s.sql.startsWith('DELETE'));
    const inserts = statements.filter((s) => s.sql.startsWith('INSERT'));
    expect(deletes.length).toBeGreaterThan(0);
    expect(inserts.length).toBe(1);
    // every DELETE precedes its table INSERT
    for (const ins of inserts) {
      const table = ins.sql.match(/INSERT INTO (\w+)/)?.[1] ?? '';
      const delIdx = statements.findIndex((s) => s.sql === `DELETE FROM ${table} WHERE company_id = $1`);
      const insIdx = statements.indexOf(ins);
      expect(delIdx).toBeGreaterThanOrEqual(0);
      expect(delIdx).toBeLessThan(insIdx);
    }
    const insert = inserts[0];
    const placeholderCount = (insert.sql.match(/\$\d+/g) ?? []).length;
    expect(placeholderCount).toBe(insert.params.length);
    // objects serialized, undefined → null
    expect(insert.params).toContain('{"vip":true}');
    expect(insert.params).toContain(null);
  });

  it('composeRestoreBatch skips unknown tables with warnings', () => {
    const { statements, warnings } = composeRestoreBatch('co1', { banks: [{ id: 'b1' }] });
    expect(statements).toEqual([]);
    expect(warnings).toEqual(['banks: unknown table, skipped']);
  });
});
