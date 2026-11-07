import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { browserAiBridge, resetAiRateLimiterForTests } from '@/modules/ai/api/browserBridge';
import { getDbAdapter } from '@/core/database/adapters';
import { useAuthStore } from '@/modules/auth/store';
import { webcrypto } from 'node:crypto';

describe('browser AI bridge (PGlite)', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  });

  it('saves and reads config with masked key', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    expect(seed.success).toBe(true);
    const companyId = seed.companyId!;

    const save = await browserAiBridge.saveConfig({
      companyId,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test-1234567890',
      enabled: true,
    });
    expect(save.success).toBe(true);

    const cfg = await browserAiBridge.getConfig(companyId);
    expect(cfg.success).toBe(true);
    expect(cfg.data?.provider).toBe('openai');
    expect(cfg.data?.model).toBe('gpt-4o-mini');
    expect(cfg.data?.enabled).toBe(true);
    expect(cfg.data?.hasApiKey).toBe(true);
    expect(cfg.data?.maskedKey).toMatch(/sk-/);
    expect(cfg.data?.maskedKey).not.toContain('1234567890');
  }, 120000);

  it('persists and lists chat sessions', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    const userId = seed.adminId!;
    useAuthStore.getState().login(
      { id: userId, companyId, username: 'admin', email: 'admin@demo.ye', role: 'admin', isActive: true },
      []
    );

    const save = await browserAiBridge.saveSession({
      companyId,
      userId,
      title: 'جلسة اختبار',
      messages: [
        { id: 'm1', role: 'user', kind: 'text', content: 'مرحبا', createdAt: Date.now() },
        { id: 'm2', role: 'assistant', kind: 'text', content: 'أهلا بك', createdAt: Date.now() + 1 },
      ],
    });
    expect(save.success).toBe(true);
    expect(save.data?.sessionId).toBeTruthy();

    const list = await browserAiBridge.listSessions({ companyId, userId });
    expect(list.success).toBe(true);
    expect(list.data?.length).toBeGreaterThanOrEqual(1);
    const s = list.data!.find((x) => x.id === save.data!.sessionId);
    expect(s).toBeDefined();
    expect(s!.messageCount).toBe(2);

    const msgs = await browserAiBridge.getSessionMessages({ companyId, sessionId: save.data!.sessionId });
    expect(msgs.success).toBe(true);
    expect(msgs.data?.length).toBe(2);
    expect(msgs.data![0].content).toBe('مرحبا');

    const del = await browserAiBridge.deleteSession({ companyId, userId, sessionId: save.data!.sessionId });
    expect(del.success).toBe(true);
    const list2 = await browserAiBridge.listSessions({ companyId, userId });
    expect(list2.data?.find((x) => x.id === save.data!.sessionId)).toBeUndefined();
  }, 120000);

  it('autosaves never clobber a user-renamed title', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    const userId = seed.adminId!;
    useAuthStore.getState().login(
      { id: userId, companyId, username: 'admin', email: 'admin@demo.ye', role: 'admin', isActive: true },
      []
    );

    const first = await browserAiBridge.saveSession({
      companyId,
      userId,
      title: 'عنوان تلقائي',
      messages: [
        { id: 'm1', role: 'user', kind: 'text', content: 'مرحبا', createdAt: Date.now() },
      ],
    });
    expect(first.success).toBe(true);
    const sid = first.data!.sessionId;

    // User renames the session, then an autosave fires with a derived title:
    const renamed = await browserAiBridge.renameSession({ companyId, userId, sessionId: sid, title: 'اسمي المخصص' });
    expect(renamed.success).toBe(true);
    const autosave = await browserAiBridge.saveSession({
      companyId,
      userId,
      sessionId: sid,
      title: 'عنوان مشتق جديد',
      messages: [
        { id: 'm1', role: 'user', kind: 'text', content: 'مرحبا', createdAt: Date.now() },
        { id: 'm2', role: 'assistant', kind: 'text', content: 'أهلا بك', createdAt: Date.now() + 1 },
      ],
    });
    expect(autosave.success).toBe(true);
    expect(autosave.data?.sessionId).toBe(sid);

    const list = await browserAiBridge.listSessions({ companyId, userId });
    const s = list.data!.find((x) => x.id === sid);
    expect(s).toBeDefined();
    expect(s!.title).toBe('اسمي المخصص');
    expect(s!.messageCount).toBe(2);

    await browserAiBridge.deleteSession({ companyId, userId, sessionId: sid });
  }, 120000);

  it('truncates giant tool summaries when persisting sessions', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    const userId = seed.adminId!;
    useAuthStore.getState().login(
      { id: userId, companyId, username: 'admin', email: 'admin@demo.ye', role: 'admin', isActive: true },
      []
    );

    const big = 'س'.repeat(10000);
    const save = await browserAiBridge.saveSession({
      companyId,
      userId,
      title: 'جلسة ملخص ضخم',
      messages: [
        { id: 'm1', role: 'user', kind: 'text', content: 'تقرير', createdAt: Date.now() },
        {
          id: 'm2',
          role: 'assistant',
          kind: 'tool',
          content: '',
          createdAt: Date.now() + 1,
          toolCall: {
            callId: 'c1',
            toolName: 'sales.invoices_detailed',
            label: 'تقرير',
            args: {},
            status: 'success',
            dangerLevel: 'read',
            resultSummary: big,
          },
        },
      ],
    });
    expect(save.success).toBe(true);
    const sid = save.data!.sessionId;
    const msgs = await browserAiBridge.getSessionMessages({ companyId, sessionId: sid });
    expect(msgs.success).toBe(true);
    // NOTE: storage ids are server-generated — locate by kind, not client id.
    const toolMsg = msgs.data!.find((m) => m.kind === 'tool');
    const summary = String(toolMsg?.toolCall?.resultSummary || '');
    expect(summary.length).toBeLessThan(5000);
    expect(summary).toContain('تم اقتصاص الملخص عند الحفظ');

    await browserAiBridge.deleteSession({ companyId, userId, sessionId: sid });
  }, 120000);

  it('P1-1: stores the API key as ciphertext, decrypts on read, honors kill-switch + revoke', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;

    const save = await browserAiBridge.saveConfig({
      companyId,
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-3.5-flash-lite',
      apiKey: 'sk-live-abcdef1234567890',
      enabled: true,
    });
    expect(save.success).toBe(true);

    // Raw row must be ciphertext, never the plaintext key.
    const raw = await adapter.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE company_id = $1 AND key = 'ai.api_key'`,
      [companyId]
    );
    const stored = raw.rows?.[0]?.value || '';
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('sk-live-abcdef1234567890');

    // ...but reads still work (decrypt → mask).
    const cfg = await browserAiBridge.getConfig(companyId);
    expect(cfg.success).toBe(true);
    expect(cfg.data?.hasApiKey).toBe(true);
    expect(cfg.data?.keyStorage).toBe('encrypted-device');
    expect(cfg.data?.maskedKey).toMatch(/sk-l/);
    expect(cfg.data?.maskedKey).not.toContain('abcdef1234567890');

    // Kill-switch blocks LLM traffic...
    const off = await browserAiBridge.saveConfig({ companyId, browserDisabled: true });
    expect(off.success).toBe(true);
    const blocked = await browserAiBridge.testConnection({ companyId });
    expect(blocked.success).toBe(false);

    // ...and re-enabling restores it (stored key untouched).
    await browserAiBridge.saveConfig({ companyId, browserDisabled: false });
    const cfg2 = await browserAiBridge.getConfig(companyId);
    expect(cfg2.data?.hasApiKey).toBe(true);

    // Revocation deletes the row entirely.
    const revoked = await browserAiBridge.saveConfig({ companyId, revokeKey: true });
    expect(revoked.success).toBe(true);
    const cfg3 = await browserAiBridge.getConfig(companyId);
    expect(cfg3.data?.hasApiKey).toBe(false);
    expect(cfg3.data?.keyStorage).toBe('none');
  }, 120000);
});

// ─── Per-user hourly provider-call budget (mirror of aiHandler.js) ──────────
describe('browser AI bridge rate limiter (per-user hourly provider budget)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const OK_COMPLETION = () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
  });

  const SSE_STREAM = () => {
    const enc = new TextEncoder();
    const frames = [
      enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'مرحبا' } }] })}\n\n`),
      enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 3 } })}\n\n`),
      enc.encode('data: [DONE]\n\n'),
    ];
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (i < frames.length ? { done: false, value: frames[i++] } : { done: true, value: undefined }),
          releaseLock: () => {},
        }),
      },
    };
  };

  const HTTP_ERROR = (status: number) => ({
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { message: 'boom' } }),
  });

  async function setCap(companyId: string, cap: string): Promise<void> {
    const adapter = await getDbAdapter();
    await adapter.query(
      `INSERT INTO settings (company_id, key, value, category)
       VALUES ($1::uuid, 'ai.rate_limit_hour', $2, 'ai')
       ON CONFLICT (company_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [companyId, cap],
    );
  }

  /** Unique user per test: the limiter is module-level state keyed by userId. */
  function loginAs(companyId: string, tag: string): void {
    useAuthStore.getState().login(
      { id: `rl-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, companyId, username: `rl_${tag}`, email: 'rl@demo.ye', role: 'admin', isActive: true },
      []
    );
  }

  beforeEach(() => {
    resetAiRateLimiterForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    // The shared PGlite store outlives this suite — never leak a tiny cap
    // onto the real browser profile.
    const adapter = await getDbAdapter();
    await adapter.query(`DELETE FROM settings WHERE key = 'ai.rate_limit_hour' AND category = 'ai'`, []);
  });

  it('validation rejections never burn the hourly budget', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    await setCap(companyId, '1');
    const save = await browserAiBridge.saveConfig({
      companyId,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-rl-1234567890',
      enabled: true,
    });
    expect(save.success).toBe(true);
    loginAs(companyId, 'reject');

    // (a) Bad messages → rejected before the gate; must not record.
    const bad = await browserAiBridge.complete({ companyId, messages: [] });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('messages must be');

    // (b) Browser kill-switch rejection → also free.
    await adapter.query(
      `INSERT INTO settings (company_id, key, value, category)
       VALUES ($1::uuid, 'ai.browser_disabled', 'true', 'ai')
       ON CONFLICT (company_id, key) DO UPDATE SET value = 'true', updated_at = NOW()`,
      [companyId],
    );
    const disabled = await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'hi' }] });
    expect(disabled.success).toBe(false);
    expect(disabled.error).toContain('وضع المتصفح');
    await adapter.query(`DELETE FROM settings WHERE company_id = $1::uuid AND key = 'ai.browser_disabled'`, [companyId]);

    // Budget untouched → the single allowed real call still succeeds…
    fetchMock.mockResolvedValue(OK_COMPLETION());
    const ok = await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'hi' }] });
    expect(ok.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // …and the NEXT call is rate-limited (the one real call consumed cap=1).
    const blocked = await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'hi again' }] });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('انتهت حصة الذكاء الاصطناعي لهذا المستخدم خلال الساعة');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 120000);

  it('blocks with the Arabic budget message once the cap is reached', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    await setCap(companyId, '2');
    await browserAiBridge.saveConfig({
      companyId, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-rl-1234567890', enabled: true,
    });
    loginAs(companyId, 'cap');
    fetchMock.mockResolvedValue(OK_COMPLETION());

    expect((await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'a' }] })).success).toBe(true);
    expect((await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'b' }] })).success).toBe(true);

    const blocked = await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'c' }] });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('انتهت حصة الذكاء الاصطناعي لهذا المستخدم خلال الساعة');
    expect(blocked.error).toContain('ai.rate_limit_hour');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 120000);

  it('failed provider calls do not burn the budget', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    await setCap(companyId, '1');
    await browserAiBridge.saveConfig({
      companyId, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-rl-1234567890', enabled: true,
    });
    loginAs(companyId, 'fail');

    // 500 is NOT transient → fail fast, no failover, no record.
    fetchMock.mockResolvedValue(HTTP_ERROR(500));
    expect((await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'a' }] })).success).toBe(false);
    expect((await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'b' }] })).success).toBe(false);

    // Budget still empty → the first success passes.
    fetchMock.mockResolvedValue(OK_COMPLETION());
    expect((await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'c' }] })).success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 120000);

  it("'0' disables the limiter entirely", async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    await setCap(companyId, '0');
    await browserAiBridge.saveConfig({
      companyId, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-rl-1234567890', enabled: true,
    });
    loginAs(companyId, 'off');
    fetchMock.mockResolvedValue(OK_COMPLETION());

    for (let i = 0; i < 4; i++) {
      expect((await browserAiBridge.complete({ companyId, messages: [{ role: 'user', content: 'x' }] })).success).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 120000);

  it('meters the streaming path (the renderer primary route) too', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    await setCap(companyId, '1');
    await browserAiBridge.saveConfig({
      companyId, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-rl-1234567890', enabled: true,
    });
    loginAs(companyId, 'stream');
    fetchMock.mockImplementation(async () => SSE_STREAM());

    const sid1 = `rl-s1-${Date.now()}`;
    const done1 = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const unsub = browserAiBridge.subscribeStream(sid1, () => {}, (r) => { resolve(r); unsub(); });
    });
    browserAiBridge.startStream({ companyId, messages: [{ role: 'user', content: 'hi' }], streamId: sid1 });
    const r1 = await done1;
    expect(r1.success).toBe(true);

    // Second stream → gated; the provider is never called again.
    const sid2 = `rl-s2-${Date.now()}`;
    const done2 = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const unsub = browserAiBridge.subscribeStream(sid2, () => {}, (r) => { resolve(r); unsub(); });
    });
    browserAiBridge.startStream({ companyId, messages: [{ role: 'user', content: 'hi' }], streamId: sid2 });
    const r2 = await done2;
    expect(r2.success).toBe(false);
    expect(r2.error).toContain('انتهت حصة الذكاء الاصطناعي لهذا المستخدم خلال الساعة');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 120000);

  it('a failed stream (HTTP error) does not burn the streaming budget', async () => {
    const adapter = await getDbAdapter();
    const seed = await adapter.seedDefault('admin1234');
    const companyId = seed.companyId!;
    await setCap(companyId, '1');
    await browserAiBridge.saveConfig({
      companyId, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-rl-1234567890', enabled: true,
    });
    loginAs(companyId, 'streamfail');

    fetchMock.mockResolvedValue(HTTP_ERROR(500));
    const sid1 = `rl-f1-${Date.now()}`;
    const done1 = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const unsub = browserAiBridge.subscribeStream(sid1, () => {}, (r) => { resolve(r); unsub(); });
    });
    browserAiBridge.startStream({ companyId, messages: [{ role: 'user', content: 'hi' }], streamId: sid1 });
    const r1 = await done1;
    expect(r1.success).toBe(false);

    // Budget untouched → the next stream succeeds.
    fetchMock.mockImplementation(async () => SSE_STREAM());
    const sid2 = `rl-f2-${Date.now()}`;
    const done2 = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const unsub = browserAiBridge.subscribeStream(sid2, () => {}, (r) => { resolve(r); unsub(); });
    });
    browserAiBridge.startStream({ companyId, messages: [{ role: 'user', content: 'hi' }], streamId: sid2 });
    const r2 = await done2;
    expect(r2.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 120000);
});
