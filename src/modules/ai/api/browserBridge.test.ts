import { describe, it, expect, beforeAll } from 'vitest';
import { browserAiBridge } from '@/modules/ai/api/browserBridge';
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
});
