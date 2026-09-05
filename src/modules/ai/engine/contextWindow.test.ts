import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  startStream: vi.fn(),
  ensureToolsRegistered: vi.fn(),
  resolveEntitiesInText: vi.fn(async (_t: string) => ({ all: [], highConfidence: [], corrections: [], text: _t })),
}));

vi.mock('../api', () => ({
  aiApi: { complete: mocks.complete, startStream: mocks.startStream },
}));
vi.mock('../tools/registry', () => ({
  getVisibleTools: vi.fn(() => []),
  toLlmTools: vi.fn(() => []),
}));
vi.mock('../tools/index', () => ({ ensureToolsRegistered: mocks.ensureToolsRegistered }));
vi.mock('../entityResolver', () => ({ resolveEntitiesInText: mocks.resolveEntitiesInText }));
vi.mock('./toolExecutor', () => ({
  executeToolCall: vi.fn(),
  resolveTool: vi.fn(() => undefined),
}));
vi.mock('./cardResolvers', () => ({ resolveArgsForCard: vi.fn(async () => []) }));
vi.mock('@/modules/core/api', () => ({
  coreApi: { getVatSettings: vi.fn(async () => ({ success: true, data: { vatRate: 15 } })) },
}));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({
    query: vi.fn(async () => ({ success: true, rows: [] })),
  })),
  isElectronPg: vi.fn(() => false),
}));

import { getChatEngine } from './chatEngine';
import { useAiStore } from '../store';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';
import type { LlmMessage } from '../types';

const user: User = { id: 'u1', username: 'tester', role: 'manager', isActive: true };

/**
 * Phase 77-F regression: unbounded history grew every request until provider
 * context rejections on long sessions. The window keeps system + last ~30
 * messages, snapped so tool results are never orphaned from their
 * tool_call partners.
 */
describe('context window (buildMessages sliding window)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAiStore.getState().clearMessages();
    getChatEngine().reset();
  });

  function seedHistory(n: number) {
    const engine = getChatEngine();
    const h = engine as unknown as { history: LlmMessage[] };
    h.history = [];
    for (let i = 0; i < n; i++) {
      h.history.push({ role: 'user', content: `رسالة رقم ${i}` });
      h.history.push({ role: 'assistant', content: `رد رقم ${i}` });
    }
    return h.history;
  }

  it('short history passes through untouched', async () => {
    seedHistory(5); // 10 messages
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تم', toolCalls: [], finishReason: 'stop', usage: null },
    });
    await getChatEngine().send('سؤال');
    const sent = mocks.complete.mock.calls[0][0].messages as LlmMessage[];
    // system + 10 prior + 1 new user
    expect(sent.length).toBe(12);
    expect(sent[0].role).toBe('system');
  });

  it('long history is truncated to the budget while keeping the system message', async () => {
    seedHistory(40); // 80 messages + system
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تم', toolCalls: [], finishReason: 'stop', usage: null },
    });
    await getChatEngine().send('سؤال');
    const sent = mocks.complete.mock.calls[0][0].messages as LlmMessage[];
    // system + window(29) + new user = 31 max
    expect(sent.length).toBeLessThanOrEqual(31);
    expect(sent[0].role).toBe('system');
    // the newest content must survive — the user's actual question is last
    expect(sent[sent.length - 1].content).toBe('سؤال');
    // and the second-to-last assistant replies are the RECENT ones
    const lastAssistant = [...sent].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant?.content).toBe('رد رقم 39');
  });

  it('never orphans a tool result at the window start', async () => {
    const engine = getChatEngine();
    const h = engine as unknown as { history: LlmMessage[] };
    // Build a history long enough to force truncation, ending with a
    // tool_call + tool pair that must stay together.
    h.history = [];
    h.history.push({ role: 'system', content: 'sys' });
    for (let i = 0; i < 40; i++) {
      h.history.push({ role: 'user', content: `u${i}` });
      h.history.push({ role: 'assistant', content: `a${i}` });
    }
    h.history.push({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'search.x', arguments: '{}' } }],
    });
    h.history.push({ role: 'tool', content: 'نتيجة', tool_call_id: 'tc1' });

    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تم', toolCalls: [], finishReason: 'stop', usage: null },
    });
    await getChatEngine().send('سؤال');

    const sent = mocks.complete.mock.calls[0][0].messages as LlmMessage[];
    // No message may START the (non-system) window with role 'tool'
    const firstNonSystem = sent[1];
    expect(firstNonSystem?.role).not.toBe('tool');
    // The pair survived together: a tool result implies its assistant
    // tool_call partner exists earlier in the array.
    const toolIdx = sent.findIndex((m) => m.role === 'tool');
    if (toolIdx >= 0) {
      const partner = sent.slice(0, toolIdx).find(
        (m) => m.tool_calls?.some((c) => c.id === sent[toolIdx].tool_call_id),
      );
      expect(partner).toBeDefined();
    }
  });
});
