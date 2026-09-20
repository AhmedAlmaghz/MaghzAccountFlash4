import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/core/api', () => ({
  coreApi: {
    getSettings: vi.fn(),
    setSetting: vi.fn(),
  },
}));

import { coreApi } from '@/modules/core/api';
import { loadMemoryBlock, loadMemoryFacts, memoryTools } from './memoryTools';
import type { ToolContext } from '../types';

const ctx: ToolContext = { companyId: 'c1', userId: 'u1' };
const getSettings = vi.mocked(coreApi.getSettings);
const setSetting = vi.mocked(coreApi.setSetting);

function settingRow(key: string, value: string) {
  return { id: `s-${key}`, companyId: 'c1', key, value, category: 'ai_memory' };
}

/** C2: user-pinned long-term memory on the generic settings store. */
describe('memoryTools (C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function tool(name: string) {
    const t = memoryTools.find((x) => x.name === name);
    if (!t) throw new Error(`tool missing: ${name}`);
    return t;
  }

  it('registers remember/recall/forget with contract-safe shape', () => {
    expect(memoryTools.map((t) => t.name)).toEqual(['ai.remember_fact', 'ai.recall_facts', 'ai.forget_fact']);
    for (const t of memoryTools) {
      expect(t.labelAr.trim()).toBeTruthy();
      expect(t.descriptionAr.trim()).toBeTruthy();
      expect(t.parameters?.type).toBe('object');
    }
    const remember = tool('ai.remember_fact');
    const forget = tool('ai.forget_fact');
    expect(remember.dangerLevel).toBe('write');
    expect(forget.dangerLevel).toBe('write');
    expect(typeof remember.summarizeArgs).toBe('function');
    expect(typeof forget.summarizeArgs).toBe('function');
    expect(tool('ai.recall_facts').dangerLevel).toBe('read');
  });

  it('remember validates length and refuses duplicates + overflow', async () => {
    const remember = tool('ai.remember_fact');
    await expect(remember.execute({ text: 'x' }, ctx)).resolves.toMatchObject({
      error: expect.stringContaining('قصير'),
    });
    await expect(remember.execute({ text: 'y'.repeat(501) }, ctx)).resolves.toMatchObject({
      error: expect.stringContaining('500'),
    });

    getSettings.mockResolvedValue({
      success: true,
      data: [settingRow('ai.memory.a', JSON.stringify({ text: 'المالك أحمد', createdAt: 't' }))],
    });
    await expect(remember.execute({ text: 'المالك أحمد' }, ctx)).resolves.toMatchObject({
      error: expect.stringContaining('مسبقاً'),
    });
    expect(setSetting).not.toHaveBeenCalled();

    const many = Array.from({ length: 100 }, (_, i) =>
      settingRow(`ai.memory.m${i}`, JSON.stringify({ text: `حقيقة ${i}`, createdAt: 't' })),
    );
    getSettings.mockResolvedValue({ success: true, data: many });
    await expect(remember.execute({ text: 'حقيقة جديدة تماماً' }, ctx)).resolves.toMatchObject({
      error: expect.stringContaining('ai.forget_fact'),
    });
  });

  it('remember writes namespaced JSON via coreApi.setSetting', async () => {
    getSettings.mockResolvedValue({ success: true, data: [] });
    setSetting.mockResolvedValue({ success: true });
    const out = (await tool('ai.remember_fact').execute({ text: 'العملة المعتمدة ر.ي' }, ctx)) as Record<string, unknown>;
    expect(out.saved).toBe(true);
    expect(typeof out.factId).toBe('string');
    expect(setSetting).toHaveBeenCalledOnce();
    const payload = setSetting.mock.calls[0][0];
    expect(payload.companyId).toBe('c1');
    expect(payload.category).toBe('ai_memory');
    expect(String(payload.key).startsWith('ai.memory.')).toBe(true);
    expect(JSON.parse(String(payload.value))).toMatchObject({ text: 'العملة المعتمدة ر.ي' });
  });

  it('recall lists live facts, skips tombstones and filters by query', async () => {
    getSettings.mockResolvedValue({
      success: true,
      data: [
        settingRow('ai.memory.a', JSON.stringify({ text: 'المالك أحمد', createdAt: 't1' })),
        settingRow('ai.memory.b', ''), // forgotten tombstone — invisible
        settingRow('ai.memory.c', 'not-json'), // corrupt — skipped, never crashes
        settingRow('other.key', 'x'), // foreign namespace — ignored
      ],
    });
    const all = (await tool('ai.recall_facts').execute({}, ctx)) as {
      facts: Array<{ id: string; text: string }>;
      totalFacts: number;
    };
    expect(all.totalFacts).toBe(1);
    expect(all.facts).toEqual([{ id: 'a', text: 'المالك أحمد', createdAt: 't1' }]);
    const filtered = (await tool('ai.recall_facts').execute({ query: 'غائب' }, ctx)) as { facts: unknown[] };
    expect(filtered.facts).toEqual([]);
  });

  it('forget by id erases content (tombstone, no PII left)', async () => {
    getSettings.mockResolvedValue({
      success: true,
      data: [settingRow('ai.memory.a', JSON.stringify({ text: 'سر قديم', createdAt: 't' }))],
    });
    setSetting.mockResolvedValue({ success: true });
    const out = (await tool('ai.forget_fact').execute({ id: 'a' }, ctx)) as Record<string, unknown>;
    expect(out.forgotten).toBe(true);
    const payload = setSetting.mock.calls[0][0];
    expect(payload.key).toBe('ai.memory.a');
    expect(payload.value).toBe('');
  });

  it('forget by text refuses on zero or ambiguous matches (no silent delete)', async () => {
    getSettings.mockResolvedValue({
      success: true,
      data: [
        settingRow('ai.memory.a', JSON.stringify({ text: 'خصم العميل 5%', createdAt: 't' })),
        settingRow('ai.memory.b', JSON.stringify({ text: 'خصم المورد 3%', createdAt: 't' })),
      ],
    });
    const amb = (await tool('ai.forget_fact').execute({ text: 'خصم' }, ctx)) as Record<string, unknown>;
    expect(amb.error).toContain('عدة حقائق');
    expect(amb.candidates).toHaveLength(2);
    expect(setSetting).not.toHaveBeenCalled();

    const none = await tool('ai.forget_fact').execute({ text: 'غير موجود' }, ctx);
    expect(none).toMatchObject({ error: expect.stringContaining('لا توجد') });

    const noArg = await tool('ai.forget_fact').execute({}, ctx);
    expect(noArg).toMatchObject({ error: expect.stringContaining('ai.recall_facts') });
  });

  it('loadMemoryFacts returns [] when the store is unreadable (best-effort)', async () => {
    getSettings.mockResolvedValue({ success: false, error: 'db down' });
    await expect(loadMemoryFacts('c1')).resolves.toEqual([]);
    getSettings.mockRejectedValue(new Error('db down'));
    await expect(loadMemoryFacts('c1')).resolves.toEqual([]);
  });

  it('loadMemoryBlock renders null when empty, capped block otherwise', async () => {
    getSettings.mockResolvedValue({ success: true, data: [] });
    await expect(loadMemoryBlock('c1')).resolves.toBeNull();
    getSettings.mockResolvedValue({
      success: true,
      data: [settingRow('ai.memory.a', JSON.stringify({ text: 'المالك أحمد', createdAt: 't' }))],
    });
    const block = await loadMemoryBlock('c1');
    expect(block).toContain('حقائق مثبتة');
    expect(block).toContain('المالك أحمد');
  });
});
