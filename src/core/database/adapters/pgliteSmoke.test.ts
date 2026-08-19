import { describe, it, expect, beforeAll } from 'vitest';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';

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
});
