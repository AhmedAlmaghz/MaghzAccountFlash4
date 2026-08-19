import { describe, it, expect, beforeAll } from 'vitest';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';

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
});