/**
 * Relay session auth — JWT issuance/verification, login rate limiting and
 * password verification for the generic Postgres-over-HTTPS relay.
 *
 * Token model (stateless, serverless-safe):
 *   payload = { v:1, dbh, uid, cid, role, perms, iat, exp }
 *   - dbh binds the token to ONE database (sha256 of the normalized URL);
 *     a token stolen for DB-A is useless against DB-B.
 *   - exp caps absolute lifetime at 8h (mirrors the main-process sessions).
 *   - HMAC-SHA256 with the server secret (MAGHZ_RELAY_SECRET in prod).
 *
 * No dependencies beyond node:crypto — importable from tests without
 * touching the network.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { dbFingerprint } from './dbPasswords.js';

export { dbFingerprint };

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_LIMIT_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function tokenSecret(env) {
  const s = (env && env.MAGHZ_RELAY_SECRET) || process.env.MAGHZ_RELAY_SECRET || '';
  if (s && s.length >= 32) return { secret: s, ephemeral: false };
  // Dev-only fallback: a random per-boot secret. Tokens die with the
  // process — safe for local development, loudly logged so nobody ships it
  // (and so a too-short secret surfaces here instead of as mysterious
  // "bad signature" rejections on every call).
  if (!tokenSecret.warned) {
    tokenSecret.warned = true;
    try {
      console.warn(
        '[relay] MAGHZ_RELAY_SECRET missing or shorter than 32 chars — using an ephemeral per-boot secret. ' +
          'Set a long secret in production, otherwise every restart invalidates all sessions.',
      );
    } catch {
      /* logging unavailable */
    }
  }
  return { secret: randomBytes(32).toString('hex'), ephemeral: true };
}

function signToken(payload, secret) {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = base64urlEncode(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function issueRelayToken({ databaseUrl, userId, companyId, role, permissions }, env, now = Date.now()) {
  const { secret } = tokenSecret(env);
  const payload = {
    v: 1,
    dbh: dbFingerprint(databaseUrl),
    uid: String(userId),
    cid: String(companyId),
    role: String(role || ''),
    perms: Array.isArray(permissions) ? permissions : [],
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  return signToken(payload, secret);
}

function verifyRelayToken(token, databaseUrl, env, now = Date.now()) {
  try {
    const { secret } = tokenSecret(env);
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false, error: 'malformed token' };
    const [header, body, sig] = parts;
    const expected = base64urlEncode(createHmac('sha256', secret).update(`${header}.${body}`).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: 'bad signature' };
    const payload = JSON.parse(base64urlDecode(body).toString('utf8'));
    if (!payload || payload.v !== 1) return { ok: false, error: 'unknown token version' };
    if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false, error: 'expired token' };
    if (payload.dbh !== dbFingerprint(databaseUrl)) return { ok: false, error: 'token bound to another database' };
    if (!payload.uid || !payload.cid) return { ok: false, error: 'incomplete token' };
    return {
      ok: true,
      session: {
        user: { id: String(payload.uid), companyId: String(payload.cid), role: String(payload.role || '') },
        permissions: Array.isArray(payload.perms) ? payload.perms : [],
      },
    };
  } catch {
    return { ok: false, error: 'malformed token' };
  }
}

/** Sliding-window login limiter keyed by (clientIp, username). */
function createLoginLimiter({ limit = LOGIN_LIMIT_PER_WINDOW, windowMs = LOGIN_WINDOW_MS, lockoutMs = LOGIN_LOCKOUT_MS, now = () => Date.now() } = {}) {
  const buckets = new Map();
  function key(ip, username) {
    return `ip:${String(ip || '?')}|u:${String(username || '').trim().toLowerCase()}`;
  }
  function check(ip, username) {
    const k = key(ip, username);
    const t = now();
    const b = buckets.get(k);
    if (!b || t >= b.resetAt) return { allowed: true };
    if (b.count >= limit) return { allowed: false, retryAfterMs: b.resetAt - t };
    return { allowed: true };
  }
  function recordFailure(ip, username) {
    const k = key(ip, username);
    const t = now();
    const b = buckets.get(k);
    if (!b || t >= b.resetAt) {
      buckets.set(k, { count: 1, resetAt: t + windowMs + (b ? lockoutMs : 0) });
      return;
    }
    b.count += 1;
    if (b.count >= limit) b.resetAt = t + lockoutMs;
  }
  function clear(ip, username) {
    buckets.delete(key(ip, username));
  }
  return { check, recordFailure, clear };
}

export {
  TOKEN_TTL_MS,
  tokenSecret,
  issueRelayToken,
  verifyRelayToken,
  createLoginLimiter,
};
