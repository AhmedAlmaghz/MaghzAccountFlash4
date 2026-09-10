import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendFileSync } from 'node:fs';

const LOG = 'C:\\Users\\AbuEmad\\AppData\\Local\\Temp\\opencode\\probe.log';
const mark = (s: string) => appendFileSync(LOG, `${Date.now()} ${s}\n`);

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  startStream: vi.fn(),
  executeToolCall: vi.fn(),
  resolveTool: vi.fn(),
  ensureToolsRegistered: vi.fn(),
}));

vi.mock('../api', () => ({
  aiApi: { complete: mocks.complete, startStream: mocks.startStream },
}));
vi.mock('../tools/registry', () => ({
  getVisibleTools: vi.fn(() => []),
  toLlmTools: vi.fn(() => []),
}));
vi.mock('../tools/index', () => ({
  ensureToolsRegistered: mocks.ensureToolsRegistered,
}));
vi.mock('../entityResolver', () => ({
  resolveEntitiesInText: vi.fn(async (_text: string) => ({ all: [], highConfidence: [], corrections: [], text: _text })),
}));
vi.mock('./toolExecutor', () => ({
  executeToolCall: mocks.executeToolCall,
  resolveTool: mocks.resolveTool,
}));
vi.mock('./batchRunner', () => ({
  runBatch: vi.fn(async () => null),
  batchProgressLine: vi.fn(() => 'أُنجز 0 — فشل 0'),
  extractResultRef: vi.fn(() => null),
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
import * as fs from 'node:fs';

const origInfo = console.info.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);
const toFile = (...a: unknown[]) => {
  try { fs.appendFileSync(LOG, a.map((x) => String(x)).join(' ') + '\n'); } catch { /* ignore */ }
};
console.info = (...a: unknown[]) => { toFile(...a); origInfo(...a); };
console.warn = (...a: unknown[]) => { toFile(...a); origWarn(...a); };
console.error = (...a: unknown[]) => { toFile(...a); origError(...a); };

describe('probe — file markers for restore+send hang', () => {
  beforeEach(() => {
    mark('beforeEach start');
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login({ id: 'x', username: 'a', role: 'super_admin', isActive: true } as never);
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } as never });
    useAiStore.getState().clearMessages();
    getChatEngine().reset();
    mark('beforeEach done');
  });

  it('restore then send', async () => {
    const engine = getChatEngine();
    mark('before restore');
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
    mark('after restore');
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تذكرت المورد', toolCalls: [], finishReason: 'stop', usage: null },
    });
    mark('before send');
    await engine.send('ما اسم المورد الذي أنشأته؟');
    mark('after send');
    expect(true).toBe(true);
  }, 15000);
});
