import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';
import type { ChatMessage } from '../types';

const user: User = {
  id: '00000000-0000-0000-0000-000000000002',
  username: 'admin',
  email: 'admin@example.com',
  role: 'super_admin',
  isActive: true,
};

describe('ChatEngine memory — restoreHistorySync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({
      activeCompany: { id: '00000000-0000-0000-0000-000000000001', name: 'شركة الاختبار', currency: 'YER' },
    });
    getChatEngine().reset();
  });

  it('restores tool history so the next "استمر" remembers previous tool results', async () => {
    const persisted: ChatMessage[] = [
      { id: 'u1', role: 'user', kind: 'text', content: 'أنشئ مورد باسم الشجاع', createdAt: 1 },
      {
        id: 't1',
        role: 'assistant',
        kind: 'tool',
        content: '',
        createdAt: 2,
        toolCall: {
          callId: 'call-1',
          toolName: 'purchases.create_supplier',
          label: 'إنشاء مورد',
          args: { name: 'الشجاع' },
          status: 'success',
          dangerLevel: 'write',
          resultSummary: '✅ تم: الشجاع (id: sup-1)',
        },
      },
      { id: 'a1', role: 'assistant', kind: 'text', content: 'تم إنشاء المورد الشجاع', createdAt: 3 },
    ];

    const engine = getChatEngine();
    engine.restoreHistorySync(persisted);

    // Next send should see the full history (system + user + tool pair + assistant text)
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تذكرت المورد', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await engine.send('ما اسم المورد الذي أنشأته؟');

    const payload = mocks.complete.mock.calls[0][0];
    const history = payload.messages as Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }>;
    // system + user(الشجاع) + flattened tool memory + assistant(text) + user(السؤال).
    // Without thought_signature the harness FLATTENS tool_call/tool pairs
    // into assistant text (Gemini-safe) — no raw 'tool' role on the wire,
    // but the outcome (tool name + result) must survive verbatim.
    // (Matched on the unique result payload — the system prompt itself
    // mentions the [TOOL_RESULT:] fence in rule 17.)
    const flat = history.find(
      (m) => typeof m.content === 'string' && m.content.includes('sup-1'),
    );
    expect(flat).toBeDefined();
    expect(String(flat!.content)).toContain('[TOOL_RESULT:');
    expect(String(flat!.content)).toContain('purchases.create_supplier');
  });

  it('restores user attachments as context blocks so file extractions survive reload', async () => {
    const persisted: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        kind: 'text',
        content: 'سجّل هذه الفاتورة',
        createdAt: 1,
        attachments: [
          {
            id: 'a1',
            kind: 'pdf',
            name: 'فاتورة.pdf',
            mime: 'application/pdf',
            size: 1024,
            sha256: 'abc',
            extractedText: 'المورد: الشجاع — الإجمالي 50000',
            draftSummary: null,
            pageCount: 1,
            rowCount: null,
            width: null,
            height: null,
          },
        ],
      },
    ];

    const engine = getChatEngine();
    engine.restoreHistorySync(persisted);

    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'تم', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await engine.send('استمر');

    const payload = mocks.complete.mock.calls[0][0];
    const userMsgs = payload.messages.filter((m: { role: string }) => m.role === 'user');
    const firstUser = userMsgs[0] as { content: string };
    // Injection-framed fence (Package B): name + extracted text travel inside
    // BEGIN/END_ATTACHMENT, never as a bare "[مرفق: ...]" line.
    expect(String(firstUser.content)).toContain('BEGIN_ATTACHMENT');
    expect(String(firstUser.content)).toContain('فاتورة.pdf');
    expect(String(firstUser.content)).toContain('المورد: الشجاع');
  });

  it('restores error tool results with guidance so the LLM does not blindly retry', async () => {
    const persisted: ChatMessage[] = [
      { id: 'u1', role: 'user', kind: 'text', content: 'سجّل الحضور', createdAt: 1 },
      {
        id: 't1',
        role: 'assistant',
        kind: 'tool',
        content: '',
        createdAt: 2,
        toolCall: {
          callId: 'call-err',
          toolName: 'hr.save_attendance',
          label: 'حضور',
          args: { date: '2026-08-27' },
          status: 'error',
          dangerLevel: 'write',
          resultSummary: 'invalid input syntax for type timestamp: "08:00"',
        },
      },
    ];

    const engine = getChatEngine();
    engine.restoreHistorySync(persisted);

    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'سأصلح الصيغة', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await engine.send('استمر');

    const payload = mocks.complete.mock.calls[0][0];
    // Flattened like any tool outcome: the failed call survives as assistant
    // text carrying the error plus the structured fix guidance.
    const toolMsg = payload.messages.find((m: { role: string; content: string | null }) =>
      typeof m.content === 'string' && m.content.includes('hr.save_attendance'),
    );
    expect(toolMsg).toBeDefined();
    expect(String(toolMsg.content)).toContain('خطأ:');
    expect(String(toolMsg.content)).toContain('08:00');
  });
});
