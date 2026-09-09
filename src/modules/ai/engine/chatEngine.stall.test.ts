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
import { useAiStore } from '../store';

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

  it('recoverStuck clears the busy flag and leaves an honest message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
});
