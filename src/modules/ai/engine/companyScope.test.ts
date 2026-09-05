import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  startStream: vi.fn(),
  ensureToolsRegistered: vi.fn(),
  resolveEntitiesInText: vi.fn(async (_t: string) => ({ all: [], highConfidence: [], corrections: [], text: _t })),
  fetchCompanyCtx: vi.fn(async () => ({ success: true })),
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

const user: User = { id: 'u1', username: 'tester', role: 'manager', isActive: true };

function setCompany(id: string) {
  useAppStore.setState({ activeCompany: { id, name: `شركة ${id}`, currency: 'YER' } });
}

/**
 * P3-15 regression: the engine is a singleton but its LLM history belongs to
 * ONE tenant. Switching the active company mid-session used to send the old
 * company's conversation (its documents/entities/VAT) into the new tenant's
 * requests. ensureCompanyScope must drop that history on the switch.
 */
describe('ensureCompanyScope — tenant switch guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAiStore.getState().clearMessages();
    setCompany('11111111-1111-1111-1111-111111111111');
    getChatEngine().reset();
  });

  it('first call just records the tenant (no history to leak yet)', () => {
    const engine = getChatEngine();
    engine.ensureCompanyScope('11111111-1111-1111-1111-111111111111');
    // A same-tenant follow-up is a no-op:
    engine.ensureCompanyScope('11111111-1111-1111-1111-111111111111');
  });

  it('switching companies wipes the pending write calls (stale confirmations die)', () => {
    const engine = getChatEngine();
    // Bind to company A first (reset() cleared the scope — first call records)
    engine.ensureCompanyScope('11111111-1111-1111-1111-111111111111');
    // Simulate an in-flight pending confirmation from company A
    (engine as unknown as { pendingWriteCalls: unknown[] }).pendingWriteCalls = [
      { callId: 'c1', toolName: 'sales.create_invoice', label: '', args: {}, status: 'pending-confirmation', dangerLevel: 'write' },
    ];
    engine.ensureCompanyScope('22222222-2222-2222-2222-222222222222');
    expect((engine as unknown as { pendingWriteCalls: unknown[] }).pendingWriteCalls).toHaveLength(0);
  });

  it('same-company calls never wipe state', () => {
    const engine = getChatEngine();
    (engine as unknown as { pendingWriteCalls: unknown[] }).pendingWriteCalls = [
      { callId: 'c1', toolName: 'x', label: '', args: {}, status: 'pending-confirmation', dangerLevel: 'write' },
    ];
    engine.ensureCompanyScope('11111111-1111-1111-1111-111111111111');
    expect((engine as unknown as { pendingWriteCalls: unknown[] }).pendingWriteCalls).toHaveLength(1);
  });

  it('send() after a company switch starts with EMPTY LLM history (no leak)', async () => {
    const engine = getChatEngine();
    // Seed a conversation under company A
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تم', toolCalls: [], finishReason: 'stop', usage: null },
    });
    setCompany('11111111-1111-1111-1111-111111111111');
    await engine.send('أهلاً');
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const firstMessages = mocks.complete.mock.calls[0][0].messages;
    expect(firstMessages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);

    // Switch tenant → send again: history must NOT contain company A turns
    setCompany('22222222-2222-2222-2222-222222222222');
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تمام', toolCalls: [], finishReason: 'stop', usage: null },
    });
    await engine.send('مرحبا');
    const secondMessages = mocks.complete.mock.calls[1][0].messages;
    const userTurns = secondMessages.filter((m: { role: string }) => m.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0].content).toBe('مرحبا');
  });
});
