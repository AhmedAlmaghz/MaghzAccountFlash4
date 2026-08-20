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
});
