import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LIVE integration: full web-relay chain (client adapter → stubbed fetch →
 * REAL relay handler → REAL Postgres) — proves Supabase-style remotes work
 * on web end to end, not just unit by unit.
 *
 * Runs ONLY with MAGHZ_LIVE_PG_URL set (local runs / nightlies). CI without
 * a database skips everything and stays green.
 */
const LIVE_URL = process.env.MAGHZ_LIVE_PG_URL || '';
const live = describe.skipIf(!LIVE_URL);

live('relayHttpAdapter over a live Postgres', () => {
  beforeEach(async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage);
    // Vault with one active remote (what Settings → Database persists).
    store.set(
      'maghzaccount-connections',
      JSON.stringify({ connections: [{ id: 'live', name: 'live', provider: 'localhost', host: 'localhost', database: 'live', user: 'u', driver: 'direct', createdAt: '', databaseUrl: LIVE_URL }] }),
    );
    store.set('maghzaccount-active-connection', 'live');
    store.set('maghzaccount-db-mode', 'pg');
    // Same-origin relay: route fetch at the REAL handler (default pool).
    const { createRelayHandler } = await import('../../../../api/_lib/relayHandler.js');
    const relay = createRelayHandler({ env: { ...process.env, ALLOW_PRIVATE_DB: '1', MAGHZ_RELAY_SECRET: 'live-it-secret-0123456789abcdef00' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => ({
        ok: true,
        status: 200,
        json: async () => {
          const out = await relay.handle({
            method: init?.method || 'GET',
            body: init?.body ? JSON.parse(init.body as string) : {},
            headers: {},
            clientIp: '127.0.0.1',
          });
          return out.body;
        },
      })),
    );
  });

  it('ping → login → query → transaction → company through the relay', async () => {    const { relayHttpAdapter } = await import('./relayHttpAdapter');
    const { relayLogin } = await import('../relayClient');

    const ping = await relayHttpAdapter.ping();
    expect(ping.success).toBe(true);

    const login = await relayLogin(LIVE_URL, 'admin', 'admin1234');
    expect(login.success).toBe(true);
    expect(login.user?.username).toBe('admin');

    const company = await relayHttpAdapter.getCompany();
    expect(company.success).toBe(true);
    const companyId = String((company.data as { id: string }).id);

    const counted = await relayHttpAdapter.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM suppliers WHERE company_id = $1',
      [companyId],
    );
    expect(counted.success).toBe(true);
    expect(Number(counted.rows?.[0]?.n)).toBeGreaterThanOrEqual(0);

    const tx = await relayHttpAdapter.transaction([
      { sql: 'SELECT count(*)::int AS n FROM products WHERE company_id = $1', params: [companyId] },
    ]);
    expect(tx.success).toBe(true);

    const accounts = await relayHttpAdapter.getAccounts(companyId);
    expect(accounts.success).toBe(true);
    expect(Array.isArray(accounts.data)).toBe(true);

    const transactions = await relayHttpAdapter.getTransactions(companyId);
    expect(transactions.success).toBe(true);
    expect(Array.isArray(transactions.data)).toBe(true);
  }, 120000);
});
