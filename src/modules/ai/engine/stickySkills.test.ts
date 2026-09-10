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

const user: User = { id: 'u1', username: 'tester', role: 'manager', isActive: true };

/**
 * Regression gate for the v0.15.17 second-request freeze.
 *
 * Root cause: `activeSkillsForMessage` scanned history with `i++` instead
 * of `i--` — starting at the END and walking UP forever whenever the
 * history held fewer than 3 user texts. The first request (empty history)
 * always worked; the second request (exactly 1 prior user text) spun a
 * synchronous infinite loop on the renderer thread: whole tab frozen, no
 * timeout or watchdog able to fire, no output anywhere.
 *
 * Every test here carries an explicit timeout so a recurrence FAILS LOUDLY
 * instead of hanging the worker silently (which is how this typo survived
 * since v0.15.6 — the files that would have caught it hung instead).
 */
describe('sticky-skills history scan (second-request freeze regression)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAiStore.getState().clearMessages();
    getChatEngine().reset();
    mocks.startStream.mockReturnValue(
      (async function* () {
        yield { type: 'content', content: 'تم' };
      })(),
    );
  });

  it('a second send with one prior user text resolves (no infinite scan)', async () => {
    const engine = getChatEngine();
    await engine.send('الطلب الأول');
    await engine.send('الطلب الثاني');
    const states = useAiStore.getState();
    expect(states.isProcessing).toBe(false);
    expect(states.messages.filter((m) => m.role === 'user').length).toBe(2);
  }, 15000);

  it('a second send after a restored session resolves', async () => {
    const engine = getChatEngine();
    engine.restoreHistorySync([
      { id: 'u1', role: 'user', kind: 'text', content: 'أنشئ مورد باسم الشجاع', createdAt: 1 },
      {
        id: 't1', role: 'assistant', kind: 'tool', content: '', createdAt: 2,
        toolCall: {
          callId: 'call-1', toolName: 'purchases.create_supplier', label: 'إنشاء مورد',
          args: { name: 'الشجاع' }, status: 'success', dangerLevel: 'write',
          resultSummary: '✅ تم: الشجاع (id: sup-1)',
        },
      },
      { id: 'a1', role: 'assistant', kind: 'text', content: 'تم إنشاء المورد الشجاع', createdAt: 3 },
    ]);
    await engine.send('ما اسم المورد الذي أنشأته؟');
    expect(useAiStore.getState().isProcessing).toBe(false);
  }, 15000);
});
