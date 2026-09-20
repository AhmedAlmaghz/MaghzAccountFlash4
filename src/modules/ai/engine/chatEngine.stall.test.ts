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

import { getChatEngine, deadlineOr } from './chatEngine';
import { getSendTrace, traceSend } from './sendTrace';
import { useAiStore } from '../store';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const user: User = { id: 'u1', username: 'tester', role: 'manager', isActive: true };

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('deadlineOr — bounded waits', () => {
  it('resolves the value when the promise is fast', async () => {
    await expect(deadlineOr(Promise.resolve('ok'), 50, 'fallback')).resolves.toBe('ok');
  });

  it('returns the fallback on timeout and swallows the late rejection', async () => {
    let rejectLate!: (e: Error) => void;
    const hanging = new Promise<string>((_, rej) => { rejectLate = rej; });
    const out = await deadlineOr(hanging, 10, 'fallback');
    expect(out).toBe('fallback');
    // A late failure after detachment must never surface anywhere.
    rejectLate(new Error('late boom'));
    await tick();
  });

  it('propagates genuine rejections instead of masking them', async () => {
    await expect(deadlineOr(Promise.reject(new Error('real failure')), 50, 'fallback')).rejects.toThrow(
      'real failure',
    );
  });
});

describe('stall heartbeat + recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAiStore.getState().clearMessages();
    getChatEngine().reset();
  });

  it('touchProgress refreshes the heartbeat timestamp', () => {
    const engine = getChatEngine();
    engine.lastProgressAt = 0;
    engine.touchProgress();
    expect(engine.lastProgressAt).toBeGreaterThan(0);
    expect(Date.now() - engine.lastProgressAt).toBeLessThan(1000);
  });

  it('recoverStuck clears the busy flag and leaves an honest message', () => {    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const engine = getChatEngine();
      useAiStore.getState().setProcessing(true);
      engine.lastProgressAt = Date.now() - 200_000;
      const before = engine.recoveryCount;

      engine.recoverStuck('رسالة الاسترداد');

      const st = useAiStore.getState();
      expect(st.isProcessing).toBe(false);
      const last = st.messages[st.messages.length - 1];
      expect(last.role).toBe('assistant');
      expect(last.kind).toBe('error');
      expect(last.content).toBe('رسالة الاسترداد');
      expect(engine.recoveryCount).toBe(before + 1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('traces send phases in order and stores the user bubble optimistically', async () => {
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({
      activeCompany: { id: '00000000-0000-0000-0000-000000000001', name: 'شركة الاختبار', currency: 'YER' },
    });
    const { complete, startStream } = mocks;
    complete.mockReturnValue({
      success: true,
      data: { content: 'احتياطي', toolCalls: [], finishReason: 'stop', usage: null },
    });
    startStream.mockReturnValue(
      (async function* () {
        yield { type: 'content', content: 'أهلا بك' };
      })(),
    );

    await getChatEngine().send('مرحبا');

    const phases = getSendTrace().map((e) => (e.phase.startsWith('stream-end') ? 'stream-end' : e.phase));
    const order = [
      'press-received',
      'user-stored',
      'context-ready',
      'entities-done',
      'stream-start',
      'first-chunk',
      'stream-end',
      'cycle-end',
    ];
    let from = -1;
    for (const phase of order) {
      const idx = phases.indexOf(phase, from + 1);
      expect(idx).toBeGreaterThan(from);
      from = idx;
    }
    // Optimistic UI: the user's own bubble is first even though the preamble
    // (settings/entities) runs after it.
    const first = useAiStore.getState().messages[0];
    expect(first.role).toBe('user');
    expect(first.content).toBe('مرحبا');
    expect(useAiStore.getState().isProcessing).toBe(false);
  });

  it('sendTrace module records phases directly (extraction proof)', () => {
    traceSend('probe-phase');
    const tail = getSendTrace().slice(-1)[0];
    expect(tail.phase).toBe('probe-phase');
    expect(typeof tail.at).toBe('number');
  });
});

describe('P1/P2 engine guards (2026-09-12 hotfix)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAiStore.getState().clearMessages();
    getChatEngine().reset();
  });

  it('P1: a throw in the send preamble (before try body work) still clears isProcessing', async () => {
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({
      activeCompany: { id: '00000000-0000-0000-0000-000000000001', name: 'شركة الاختبار', currency: 'YER' },
    });
    const { complete } = mocks;
    complete.mockReturnValue({
      success: true,
      data: { content: 'تم', toolCalls: [], finishReason: 'stop', usage: null },
    });
    // Poison the optimistic-bubble path: addMessage throws once. Before the
    // fix, setProcessing(true) ran OUTSIDE try, so this throw skipped the
    // finally and left isProcessing=true forever (dead chat).
    const st = useAiStore.getState();
    const origAdd = st.addMessage;
    let calls = 0;
    useAiStore.setState({
      addMessage: ((msg: never) => {
        calls += 1;
        if (calls === 1) throw new Error('poisoned bubble');
        return (origAdd as (m: never) => string).call(st, msg);
      }) as typeof st.addMessage,
    });
    try {
      await getChatEngine().send('رسالة مسمومة');
    } finally {
      useAiStore.setState({ addMessage: origAdd });
    }
    expect(useAiStore.getState().isProcessing).toBe(false);
  });

  it('P1: a mid-stream throw routes the non-streaming answer to a NEW bubble', async () => {
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({
      activeCompany: { id: '00000000-0000-0000-0000-000000000001', name: 'شركة الاختبار', currency: 'YER' },
    });
    const { complete, startStream } = mocks;
    // Stream yields one chunk then throws mid-flight (partial content seen).
    startStream.mockReturnValue(
      (async function* () {
        yield { type: 'content', content: 'جزء أول' };
        throw new Error('provider exploded mid-stream');
      })(),
    );
    complete.mockReturnValue({
      success: true,
      data: { content: 'الإجابة الكاملة الاحتياطية', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await getChatEngine().send('سؤال');

    const msgs = useAiStore.getState().messages;
    // user bubble + exactly one visible assistant text bubble carrying the
    // FALLBACK content (the removed placeholder must not swallow it).
    const assistantTexts = msgs.filter((m) => m.role === 'assistant' && m.kind === 'text');
    expect(assistantTexts).toHaveLength(1);
    expect(String(assistantTexts[0].content)).toContain('الإجابة الكاملة الاحتياطية');
  });

  it('P2: ensureCompanyScope bumps the epoch so old-tenant loops die', () => {
    const engine = getChatEngine();
    engine.ensureCompanyScope('company-A');
    const before = engine.recoveryCount;
    engine.ensureCompanyScope('company-B');
    expect(engine.recoveryCount).toBe(before + 1);
    // Same tenant: no bump.
    engine.ensureCompanyScope('company-B');
    expect(engine.recoveryCount).toBe(before + 1);
  });
});
