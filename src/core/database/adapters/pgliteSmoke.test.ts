import { describe, it, expect, beforeAll } from 'vitest';
import type { DbAdapter } from './types';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';

type RoleRow = { name: string; permissions: string; is_system: boolean };
type UserRow = { username: string; role: string; is_active: boolean; password_hash: string };
const query = pgliteAdapter.query as DbAdapter['query'];

async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  const parts = typeof storedHash === 'string' ? storedHash.split(':') : [];
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 100000 || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(expected)) return false;
  try {
    const encoder = new TextEncoder();
    const keyMaterial = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const derivedBits = await webcrypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
      keyMaterial,
      (expected.length / 2) * 8
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const actualHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return actualHex === expected;
  } catch {
    return false;
  }
}

describe('pglite seed smoke (node)', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  });

  it('runs migrations', async () => {
    const r = await runPgliteMigrations();
    expect(r.success).toBe(true);
    if (!r.success) console.error(r.error);
  }, 120000);

  it('seedDefault completes', async () => {
    const r = await pgliteAdapter.seedDefault('admin1234');
    console.log('seedDefault:', JSON.stringify(r).slice(0, 200));
    expect(r.success).toBe(true);
  }, 120000);

  it('seeded admin password verifies against stored hash (no double-hash)', async () => {
    const r = await pgliteAdapter.seedDefault('admin1234');
    expect(r.success).toBe(true);
    const res = await pgliteAdapter.query(
      `SELECT username, password_hash, is_active FROM users WHERE username = $1 LIMIT 1`,
      ['admin']
    );
    expect(res.success).toBe(true);
    const row = (res.rows || [])[0] as { username: string; password_hash: string; is_active: boolean } | undefined;
    expect(row).toBeDefined();
    expect(row!.username).toBe('admin');
    expect(row!.is_active).toBe(true);
    const ok = await verifyPassword('admin1234', row!.password_hash);
    expect(ok).toBe(true);
  }, 120000);

  it('seedDefault seeds the full default-settings set (roles, accountant, master data)', async () => {
    const r = await pgliteAdapter.seedDefault('admin1234');
    expect(r.success).toBe(true);
    const companyId = r.companyId as string;
    expect(companyId).toBeTruthy();

    // System roles with JSON permissions, named to match users.role codes
    const rolesRes = await query(
      `SELECT name, permissions, is_system FROM roles WHERE company_id = $1::uuid ORDER BY name`,
      [companyId]
    );
    expect(rolesRes.success).toBe(true);
    const roles = (rolesRes.rows || []) as unknown as RoleRow[];
    const roleNames = roles.map((x) => x.name).sort();
    expect(roleNames).toEqual(['accountant', 'admin', 'manager', 'sales_rep', 'viewer'].sort());
    const accountantRole = roles.find((x) => x.name === 'accountant');
    expect(accountantRole).toBeDefined();
    expect(accountantRole!.is_system).toBe(true);
    const perms = JSON.parse(accountantRole!.permissions) as string[];
    expect(perms).toContain('accounting.view');
    expect(perms).toContain('accounting.post');

    // Accountant user exists, active, role accountant, password = same as admin
    const accRes = await query(
      `SELECT username, role, is_active, password_hash FROM users WHERE company_id = $1::uuid AND username = 'accountant' LIMIT 1`,
      [companyId]
    );
    expect(accRes.success).toBe(true);
    const acc = (accRes.rows || [])[0] as UserRow | undefined;
    expect(acc).toBeDefined();
    expect(acc!.role).toBe('accountant');
    expect(acc!.is_active).toBe(true);
    expect(await verifyPassword('admin1234', acc!.password_hash)).toBe(true);

    // Master data counts
    const counts = async (table: string) => {
      const res = await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1::uuid`, [companyId]);
      const row = (res.rows || [])[0] as { n: unknown } | undefined;
      return Number(row?.n ?? 0);
    };
    expect(await counts('accounts')).toBeGreaterThanOrEqual(20);
    expect(await counts('currencies')).toBeGreaterThanOrEqual(1);
    expect(await counts('vat_settings')).toBeGreaterThanOrEqual(1);
    expect(await counts('document_sequences')).toBeGreaterThanOrEqual(5);
    expect(await counts('branches')).toBeGreaterThanOrEqual(1);
    expect(await counts('product_types')).toBeGreaterThanOrEqual(1);
    expect(await counts('units')).toBeGreaterThanOrEqual(1);
    expect(await counts('cost_centers')).toBeGreaterThanOrEqual(1);
    expect(await counts('cash_boxes')).toBeGreaterThanOrEqual(1);
    expect(await counts('default_accounts')).toBeGreaterThanOrEqual(1);
    expect(await counts('product_categories')).toBeGreaterThanOrEqual(1);

    // Exactly one default currency
    const defCur = await query(
      `SELECT code FROM currencies WHERE company_id = $1::uuid AND is_default = TRUE`,
      [companyId]
    );
    expect(defCur.rows?.length).toBe(1);
    expect((defCur.rows![0] as { code: string }).code).toBe('YER');
  }, 180000);
});
