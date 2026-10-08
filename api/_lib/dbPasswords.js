/**
 * Shared password + fingerprint primitives (node:crypto).
 *
 * Lives apart from `dbCore.js` ON PURPOSE: dbCore must stay runtime-neutral
 * (importable from browsers), while this module needs node:crypto. Exactly
 * two runtimes consume it — the Electron main process and the relay — both
 * Node. The browser keeps its async WebCrypto implementation in
 * `src/modules/auth/api.ts` (different runtime API; documented, not drift).
 *
 * Envelope (all writers, all readers): `pbkdf2:iterations:salt:hex`.
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { trimInvisible } from './dbCore.js';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 32;

function hashPasswordNode(password) {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

function verifyPasswordNode(password, storedHash) {
  const parts = typeof storedHash === 'string' ? storedHash.split(':') : [];
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 100000 || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(expected)) return false;
  let actual;
  try {
    actual = pbkdf2Sync(String(password), salt, iterations, expected.length / 2, 'sha256');
  } catch {
    return false;
  }
  const expBuf = Buffer.from(expected, 'hex');
  if (actual.length !== expBuf.length) return false;
  return timingSafeEqual(actual, expBuf);
}

function dbFingerprint(rawUrl) {
  return createHash('sha256').update(trimInvisible(rawUrl)).digest('hex');
}

export { PBKDF2_ITERATIONS, SALT_LENGTH, hashPasswordNode, verifyPasswordNode, dbFingerprint };
