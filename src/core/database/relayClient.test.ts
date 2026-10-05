import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRelayAvailable,
  resetRelayHealth,
  relayLogin,
  relayCall,
  setRelayToken,
  getRelayToken,
  getRelayCompanyId,
  clearRelayToken,
} from './relayClient';

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

describe('relayClient', () => {
  beforeEach(() => {
    resetRelayHealth();
    clearRelayToken();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearRelayToken();
  });

  it('detects a healthy relay and caches the probe', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, privateTargetsAllowed: false }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await isRelayAvailable();
    const second = await isRelayAvailable();
    expect(first).toEqual({ up: true, privateTargetsAllowed: false });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports down on network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await isRelayAvailable()).toEqual({ up: false, privateTargetsAllowed: false });
  });

  it('login stores the token and returns user + permissions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { success: true, token: 'tok-1', user: { id: 'u' }, permissions: ['sales.view'] })),
    );
    const r = await relayLogin('postgres://u:p@h/db', 'admin', 'pw');
    expect(r).toMatchObject({ success: true, permissions: ['sales.view'] });
    expect(getRelayToken()).toBe('tok-1');
  });

  it('failed login clears any stale token', async () => {
    setRelayToken('stale');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { success: false, error: 'nope', code: 'bad-credentials' })));
    const r = await relayLogin('postgres://u:p@h/db', 'admin', 'pw');
    expect(r.success).toBe(false);
    expect(r.code).toBe('bad-credentials');
    expect(getRelayToken()).toBeNull();
  });

  it('attaches the token to calls and clears it when the relay says expired', async () => {
    setRelayToken('tok-9');
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: unknown) => {
        seen.push(JSON.parse(String((init as { body: string }).body)));
        return jsonResponse(401, { success: false, code: 'expired-token', error: 'login required' });
      }),
    );
    const r = await relayCall('query', { databaseUrl: 'postgres://u:p@h/db', sql: 'SELECT 1' });
    expect(r).toMatchObject({ success: false, code: 'expired-token' });
    expect(getRelayToken()).toBeNull();
    expect(seen[0]).toMatchObject({ action: 'query', token: 'tok-9' });
  });

  it('reads the session company from a live JWT without verifying it', async () => {
    expect(getRelayCompanyId()).toBeNull();
    // Unsigned-read of a hand-built payload (server re-verifies on every call).
    const payload = { v: 1, cid: 'company-9' };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    setRelayToken(`h.${b64}.s`);
    expect(getRelayCompanyId()).toBe('company-9');
    setRelayToken('not-a-jwt');
    expect(getRelayCompanyId()).toBeNull();
  });

  it('passes pingdb rows/db through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { success: true, db: 'app', version: 'PostgreSQL 17' })));
    const r = await relayCall('pingdb', { databaseUrl: 'postgres://u:p@h/db' });
    expect(r).toMatchObject({ success: true, db: 'app' });
  });
});
