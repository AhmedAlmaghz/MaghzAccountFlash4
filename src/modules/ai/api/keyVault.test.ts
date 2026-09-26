import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  decryptApiKey,
  encryptApiKey,
  getDefaultStore,
  isEncryptedEnvelope,
  memoryKeyStore,
} from './keyVault';

/**
 * P1-1: the browser bridge must never persist a plaintext API key.
 * These tests pin the vault contract: envelope shape, round-trip,
 * cross-device isolation, tamper rejection and legacy detection.
 */
describe('keyVault (browser API-key encryption)', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  });

  const subtle = () => webcrypto.subtle as unknown as SubtleCrypto;

  it('round-trips a key through the enc:v1 envelope', async () => {
    const store = memoryKeyStore();
    const env = await encryptApiKey('sk-test-1234567890', { store, subtle: subtle() });
    expect(env.startsWith('enc:v1:')).toBe(true);
    expect(env).not.toContain('sk-test-1234567890');
    await expect(decryptApiKey(env, { store, subtle: subtle() })).resolves.toBe('sk-test-1234567890');
  });

  it('uses a fresh random IV per encryption (no deterministic ciphertext)', async () => {
    const store = memoryKeyStore();
    const opts = { store, subtle: subtle() };
    const a = await encryptApiKey('same-key', opts);
    const b = await encryptApiKey('same-key', opts);
    expect(a).not.toBe(b);
    await expect(decryptApiKey(a, opts)).resolves.toBe('same-key');
    await expect(decryptApiKey(b, opts)).resolves.toBe('same-key');
  });

  it('isolates devices: another store cannot decrypt (honest null, never a crash)', async () => {
    const storeA = memoryKeyStore();
    const storeB = memoryKeyStore();
    const env = await encryptApiKey('sk-secret', { store: storeA, subtle: subtle() });
    await expect(decryptApiKey(env, { store: storeB, subtle: subtle() })).resolves.toBeNull();
  });

  it('rejects tampered envelopes with null (no throw)', async () => {
    const store = memoryKeyStore();
    const opts = { store, subtle: subtle() };
    const env = await encryptApiKey('sk-secret', opts);
    const tampered = `${env.slice(0, -4)}AAAA`;
    await expect(decryptApiKey(tampered, opts)).resolves.toBeNull();
    await expect(decryptApiKey('enc:v1:garbage', opts)).resolves.toBeNull();
    await expect(decryptApiKey(null, opts)).resolves.toBeNull();
    await expect(decryptApiKey(undefined, opts)).resolves.toBeNull();
  });

  it('keeps the default store process-wide', () => {
    expect(getDefaultStore()).toBe(getDefaultStore());
  });

  it('detects legacy plaintext rows for upgrade-on-save', () => {
    expect(isEncryptedEnvelope('sk-plaintext-row')).toBe(false);
    expect(isEncryptedEnvelope('enc:v1:iv:ct')).toBe(true);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope(undefined)).toBe(false);
    expect(isEncryptedEnvelope('')).toBe(false);
  });
});
