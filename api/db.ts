/**
 * Vercel serverless relay: /api/db — generic Postgres-over-HTTPS for the
 * web build (Supabase, self-hosted, local-via-tunnel, Neon, …).
 *
 * Why this exists: browsers cannot open TCP sockets, so the web app could
 * only reach Neon (HTTP driver). Same-origin relay is the standards-
 * compliant path for every other provider — identical in spirit to
 * api/jev-systemone.ts. Electron keeps direct TCP and never calls this.
 *
 * Contract:
 *   GET  /api/db                                   → { ok, service, version, privateTargetsAllowed }
 *   POST /api/db { action:'pingdb', databaseUrl }  → connectivity probe (rate-limited, SSRF-guarded)
 *   POST /api/db { action:'login', databaseUrl, username, password }
 *                                                  → { token, user, permissions }
 *   POST /api/db { action:'query', databaseUrl, token, sql, params? }
 *   POST /api/db { action:'transaction', databaseUrl, token, queries[] }
 *   POST /api/db { action:'migrate', databaseUrl, token }
 *        (admin JWT only — replays the bundled drizzle files server-side)
 *
 * Security: stateless HMAC JWT bound to one database (8h TTL, login rate
 * limits), per-statement SQL authorization (api/_lib/relayGuard.js — the
 * same contract as the desktop _exec channel), SSRF net guards (private
 * targets denied in production), parameterized pg only, row/byte caps,
 * secret-redacting errors. No CORS headers: same-origin only.
 */
import { createRelayHandler } from './_lib/relayHandler.js';

type VercelReq = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => { json: (body: unknown) => unknown };
  setHeader: (k: string, v: string) => void;
};

const relay = createRelayHandler({ env: process.env });

function readBody(req: VercelReq): unknown {
  const b = req.body;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b || '{}');
    } catch {
      return {};
    }
  }
  return b ?? {};
}

function clientIp(req: VercelReq): string {
  const h = req.headers || {};
  const fwd = h['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof first === 'string' && first) return first.split(',')[0].trim();
  return 'unknown';
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try {
    const out = await relay.handle({
      method: req.method,
      body: readBody(req),
      headers: req.headers,
      clientIp: clientIp(req),
    });
    res.status(out.status).json(out.body);
  } catch {
    res.status(500).json({ success: false, code: 'unavailable', error: 'relay failure' });
  }
}
