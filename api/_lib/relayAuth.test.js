import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  issueRelayToken,
  verifyRelayToken,
  createLoginLimiter,
  tokenSecret,
} from './relayAuth.js';
import { verifyPasswordNode as verifyRelayPassword, dbFingerprint } from './dbPasswords.js';

import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ENV = { MAGHZ_RELAY_SECRET: 'test-secret-that-is-long-enough-0123456789' };
const URL_A = 'postgres://u:p@db-a.example.com:5432/app';
const URL_B = 'postgres://u:p@db-b.example.com:5432/app';

function makeHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hex = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2:100000:${salt}:${hex}`;
}

describe('relayAuth — tokens', () => {
  it('round-trips a session bound to one database', () => {
    const token = issueRelayToken(
      { databaseUrl: URL_A, userId: 'u1', companyId: 'c1', role: 'admin', permissions: [] },
      ENV, 1000,
    );
    const v = verifyRelayToken(token, URL_A, ENV, 2000);
    expect(v.ok).toBe(true);
    expect(v.session).toEqual({ user: { id: 'u1', companyId: 'c1', role: 'admin' }, permissions: [] });
  });

  it('rejects tampered, expired and cross-database tokens', () => {
    const token = issueRelayToken(
      { databaseUrl: URL_A, userId: 'u1', companyId: 'c1', role: 'admin', permissions: [] },
      ENV, 1000,
    );
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'ab' ? 'cd' : 'ab');
    expect(verifyRelayToken(tampered, URL_A, ENV, 2000).ok).toBe(false);
    expect(verifyRelayToken(token, URL_A, ENV, 1000 + 8 * 3600 * 1000 + 1).ok).toBe(false);
    expect(verifyRelayToken(token, URL_B, ENV, 2000)).toEqual({ ok: false, error: 'token bound to another database' });
    expect(verifyRelayToken('junk', URL_A, ENV, 2000).ok).toBe(false);
  });

  it('dbFingerprint is stable and secret-free', () => {
    expect(dbFingerprint(URL_A)).toBe(dbFingerprint(URL_A));
    expect(dbFingerprint(URL_A)).not.toBe(dbFingerprint(URL_B));
    expect(dbFingerprint(URL_A)).not.toMatch(/p@/);
  });

  it('short secrets fall back to ephemeral (never silently stable)', () => {
    expect(tokenSecret({ MAGHZ_RELAY_SECRET: 'x'.repeat(32) }).ephemeral).toBe(false);
    expect(tokenSecret({ MAGHZ_RELAY_SECRET: 'x'.repeat(31) }).ephemeral).toBe(true);
    expect(tokenSecret({}).ephemeral).toBe(true);
  });
});

describe('relayAuth — password verification (app envelope)', () => {
  it('accepts the correct password and rejects the rest', () => {
    const hash = makeHash('correct-horse-123');
    expect(verifyRelayPassword('correct-horse-123', hash)).toBe(true);
    expect(verifyRelayPassword('wrong', hash)).toBe(false);
    expect(verifyRelayPassword('correct-horse-123', 'garbage')).toBe(false);
    expect(verifyRelayPassword('correct-horse-123', 'pbkdf2:10:abc:def')).toBe(false);
  });
});

describe('relayAuth — login rate limiter', () => {
  it('allows 5, locks out, and extends the lockout', () => {
    let t = 0;
    const lim = createLoginLimiter({ now: () => t });
    for (let i = 0; i < 5; i++) {
      expect(lim.check('1.2.3.4', 'Admin').allowed).toBe(true);
      lim.recordFailure('1.2.3.4', 'Admin');
    }
    const denied = lim.check('1.2.3.4', 'ADMIN');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    t += 6 * 60 * 1000;
    expect(lim.check('1.2.3.4', 'admin').allowed).toBe(true);
    lim.clear('9.9.9.9', 'admin');
  });

  it('keys by ip and username independently', () => {
    const lim = createLoginLimiter({});
    for (let i = 0; i < 5; i++) lim.recordFailure('1.1.1.1', 'a');
    expect(lim.check('1.1.1.1', 'a').allowed).toBe(false);
    expect(lim.check('2.2.2.2', 'a').allowed).toBe(true);
    expect(lim.check('1.1.1.1', 'b').allowed).toBe(true);
  });
});
