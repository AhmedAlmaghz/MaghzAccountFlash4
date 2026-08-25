import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getChatEngine } from './chatEngine';
import { useAiStore } from '../store';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { ToolDefinition } from '../types';
import type { User } from '@/modules/auth/types';

const user: User = {
  id: '00000000-0000-0000-0000-000000000002',
  username: 'admin',
  email: 'admin@example.com',
  role: 'super_admin',
  isActive: true,
};

function tool(dangerLevel: 'read' | 'write'): ToolDefinition {
  return {
    name: dangerLevel === 'read' ? 'test.read' : 'test.write',
    labelAr: dangerLevel === 'read' ? 'قراءة اختبارية' : 'كتابة اختبارية',
    descriptionAr: 'أداة اختبار',
    permission: 'core.view',
    dangerLevel,
    parameters: { type: 'object', properties: {} },
    summarizeArgs: () => 'ملخص العملية',
    execute: async () => ({}),
  };
}

describe('ChatEngine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user);
    useAppStore.setState({
      activeCompany: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'شركة الاختبار',
        currency: 'YER',
      },
    });
    getChatEngine().reset();
  });

  it('sends user text and stores the final assistant response', async () => {
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'إجمالي المبيعات 1000 ر.ي', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await getChatEngine().send('ما إجمالي المبيعات؟');

    expect(mocks.ensureToolsRegistered).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledOnce();
    const payload = mocks.complete.mock.calls[0][0];
    expect(payload.companyId).toBe('00000000-0000-0000-0000-000000000001');
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'ما إجمالي المبيعات؟' });
    expect(useAiStore.getState().messages).toEqual([
      expect.objectContaining({ role: 'user', kind: 'text', content: 'ما إجمالي المبيعات؟' }),
      expect.objectContaining({ role: 'assistant', kind: 'text', content: 'إجمالي المبيعات 1000 ر.ي' }),
    ]);
    expect(useAiStore.getState().isProcessing).toBe(false);
  });

  it('does NOT duplicate a streamed final text answer (placeholder is the bubble)', async () => {
    mocks.startStream.mockReturnValueOnce((async function* () {
      yield { type: 'content', content: 'تم إنشاء المورد بنجاح.' };
    })());

    await getChatEngine().send('اضف مورد باسم الشجاع للتجارة');

    expect(mocks.startStream).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    const assistantTexts = useAiStore.getState().messages.filter(
      (m) => m.role === 'assistant' && m.kind === 'text'
    );
    expect(assistantTexts).toHaveLength(1);
    expect(assistantTexts[0].content).toBe('تم إنشاء المورد بنجاح.');
    expect(useAiStore.getState().isProcessing).toBe(false);
  });

  it('executes read tools immediately then continues to a final answer', async () => {
    mocks.resolveTool.mockReturnValue(tool('read'));
    mocks.executeToolCall.mockResolvedValueOnce({ ok: true, result: { total: 1250 } });
    mocks.complete
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: '',
          toolCalls: [{ id: 'read-1', name: 'test.read', arguments: { month: 7 } }],
          finishReason: 'tool_calls',
          usage: null,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { content: 'الإجمالي 1250 ر.ي', toolCalls: [], finishReason: 'stop', usage: null },
      });

    await getChatEngine().send('احسب الإجمالي');

    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      'test.read',
      { month: 7 },
      expect.objectContaining({
        companyId: '00000000-0000-0000-0000-000000000001',
        userId: user.id,
      })
    );
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    const messages = useAiStore.getState().messages;
    expect(messages[1].toolCall).toEqual(expect.objectContaining({ status: 'success', dangerLevel: 'read' }));
    expect(messages[2].content).toBe('الإجمالي 1250 ر.ي');
  });

  it('pauses a write tool for confirmation and resumes after approval', async () => {
    mocks.resolveTool.mockReturnValue(tool('write'));
    mocks.executeToolCall.mockResolvedValueOnce({ ok: true, result: { id: 'invoice-1' } });
    mocks.complete
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: '',
          toolCalls: [{ id: 'write-1', name: 'test.write', arguments: { amount: 500 } }],
          finishReason: 'tool_calls',
          usage: null,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { content: 'تم إنشاء المستند', toolCalls: [], finishReason: 'stop', usage: null },
      });

    await getChatEngine().send('أنشئ مستنداً');

    let messages = useAiStore.getState().messages;
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
    expect(messages[1].toolCall).toEqual(expect.objectContaining({
      callId: 'write-1',
      status: 'pending-confirmation',
      argsSummary: 'ملخص العملية',
    }));


    await getChatEngine().resolveConfirmation('write-1', true);

    messages = useAiStore.getState().messages;
    expect(mocks.executeToolCall).toHaveBeenCalledOnce();
    expect(messages[1].toolCall?.status).toBe('success');
    expect(messages[2].content).toBe('تم إنشاء المستند');
  });

  it('records a rejected write call without executing it', async () => {
    mocks.resolveTool.mockReturnValue(tool('write'));
    mocks.complete
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: '',
          toolCalls: [{ id: 'write-2', name: 'test.write', arguments: {} }],
          finishReason: 'tool_calls',
          usage: null,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { content: 'تم إلغاء العملية', toolCalls: [], finishReason: 'stop', usage: null },
      });

    await getChatEngine().send('نفذ عملية');
    await getChatEngine().resolveConfirmation('write-2', false);

    expect(mocks.executeToolCall).not.toHaveBeenCalled();
    const messages = useAiStore.getState().messages;
    expect(messages[1].toolCall?.status).toBe('rejected');
    expect(messages[2].content).toBe('تم إلغاء العملية');
  });

  it('treats UNKNOWN tool names as write (fail-closed) — confirmation card, never silent execution', async () => {
    // Regression: `tool?.dangerLevel === 'write' ? write : read` sent any
    // unregistered name (model hallucination, e.g. "sales.craete_invoice")
    // straight to the read path where it executed without user approval.
    mocks.resolveTool.mockReturnValue(undefined);
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: {
        content: '',
        toolCalls: [{ id: 'unknown-1', name: 'sales.craete_invoice', arguments: { amount: 1 } }],
        finishReason: 'tool_calls',
        usage: null,
      },
    });

    await getChatEngine().send('سجل فاتورة');

    expect(mocks.executeToolCall).not.toHaveBeenCalled();
    const messages = useAiStore.getState().messages;
    expect(messages[1].toolCall).toEqual(expect.objectContaining({
      callId: 'unknown-1',
      status: 'pending-confirmation',
      dangerLevel: 'write',
    }));
  });

  describe('anti-fabrication guard', () => {
    beforeEach(() => {
      // Empty stream → runLoop falls back to the mocked complete() calls
      mocks.startStream.mockReturnValue((async function* () {
        // yields nothing
      })());
    });

    it('removes a fabricated success reply and forces a real tool call on retry', async () => {
      // Real session failure: model answered with an invented invoice number
      // WITHOUT calling any create tool — nothing reached the DB.
      vi.mocked(mocks.resolveTool).mockReturnValue(undefined);
      mocks.complete
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: 'تم إنشاء وترحيل فاتورة المبيعات للعميل:\n• رقم الفاتورة: INV-0001\n• الحالة: مرحّل (Posted)\n• الإجمالي: 274,850 ر.ي',
            toolCalls: [],
            finishReason: 'stop',
            usage: null,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { content: 'لم تُنفَّذ أي عملية بعد — سأستدعي أداة الإنشاء الآن.', toolCalls: [], finishReason: 'stop', usage: null },
        });

      await getChatEngine().send('سجل فاتورة مبيعات لغدرة');

      const messages = useAiStore.getState().messages;
      // The fabricated reply must NOT be displayed
      expect(messages.some((m) => m.kind === 'text' && m.content.includes('INV-0001'))).toBe(false);
      // The retry answer IS displayed
      expect(messages[messages.length - 1].content).toContain('لم تُنفَّذ أي عملية');
      // The correction nudge was injected into the LLM history
      const secondCall = mocks.complete.mock.calls[1][0];
      const last = secondCall.messages[secondCall.messages.length - 1];
      expect(last.role).toBe('user');
      expect(String(last.content)).toContain('تنبيه نظام');
    });

    it('corrects replies that only IMITATE tool-call blocks textually', async () => {
      vi.mocked(mocks.resolveTool).mockReturnValue(undefined);
      mocks.complete
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: '[تم تنفيذ: accounting.create_payment_voucher] {"voucherNumber":"PV-000002"}\nتم صرف المبلغ بنجاح.',
            toolCalls: [],
            finishReason: 'stop',
            usage: null,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { content: 'أعتذر — لم يُنفَّذ شيء، سأستخدم الأداة الفعلية.', toolCalls: [], finishReason: 'stop', usage: null },
        });

      await getChatEngine().send('سجل سند صرف');

      const messages = useAiStore.getState().messages;
      expect(messages.some((m) => m.kind === 'text' && m.content.includes('PV-000002'))).toBe(false);
      expect(messages[messages.length - 1].content).toContain('لم يُنفَّذ شيء');
    });

    it('passes through honest answers that merely REPORT existing documents (no claim verbs)', async () => {
      vi.mocked(mocks.resolveTool).mockReturnValue(undefined);
      mocks.complete.mockResolvedValueOnce({
        success: true,
        data: {
          content: 'نعم، فاتورة غدرة مسجّلة برقم INV-0001 وحالتها مرحّلة بحسب السجلات.',
          toolCalls: [],
          finishReason: 'stop',
          usage: null,
        },
      });

      await getChatEngine().send('هل سُجلت فاتورة غدرة؟');

      const messages = useAiStore.getState().messages;
      expect(messages[messages.length - 1].content).toContain('INV-0001');
      expect(mocks.complete).toHaveBeenCalledTimes(1);
    });
  });

  it('shows provider errors as assistant error messages', async () => {
    mocks.complete.mockResolvedValueOnce({ success: false, error: 'Provider unavailable' });

    await getChatEngine().send('مرحبا');

    expect(useAiStore.getState().messages[1]).toEqual(expect.objectContaining({
      kind: 'error',
      content: 'Provider unavailable',
    }));
  });

  it('reset clears messages and starts a new system history', async () => {
    mocks.complete.mockResolvedValue({
      success: true,
      data: { content: 'رد', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await getChatEngine().send('الأولى');
    getChatEngine().reset();
    await getChatEngine().send('الثانية');

    const secondPayload = mocks.complete.mock.calls[1][0];
    expect(secondPayload.messages).toHaveLength(2);
    expect(secondPayload.messages[1]).toEqual({ role: 'user', content: 'الثانية' });
    expect(useAiStore.getState().messages).toHaveLength(2);
  });

  it('preserves thought_signature (Gemini extras) on round-trip to LLM history', async () => {
    mocks.resolveTool.mockReturnValue(tool('read'));
    mocks.executeToolCall.mockResolvedValueOnce({ ok: true, result: { total: 99 } });

    // Turn 1: LLM returns a tool_call with thought_signature in the function object
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: {
        content: '',
        toolCalls: [{
          id: 'read-1',
          name: 'test.read',
          arguments: { x: 1 },
          function: { thought_signature: 'sig-abc-123' },
        }],
        finishReason: 'tool_calls',
        usage: null,
      },
    });
    // Turn 2: final text
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'انتهى', toolCalls: [], finishReason: 'stop', usage: null },
    });

    await getChatEngine().send('شغّل الأداة');

    // The 2nd complete call carries the assistant tool_call back to the LLM.
    // The thought_signature must survive the round-trip.
    const secondPayload = mocks.complete.mock.calls[1][0];
    const assistantMsgWithTool = secondPayload.messages.find(
      (m: { role: string; tool_calls?: unknown[] }) =>
        m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    );
    expect(assistantMsgWithTool).toBeDefined();
    const toolCall = (assistantMsgWithTool as { tool_calls: { function: Record<string, unknown> }[] }).tool_calls[0];
    expect(toolCall.function.thought_signature).toBe('sig-abc-123');
    expect(toolCall.function.name).toBe('test.read');
  });

  it('does NOT spread name/arguments from tc.function over the top-level values', async () => {
    // Defensive: even if tc.function contains stale name/arguments, we should
    // not allow them to override the authoritative top-level values.
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: {
        content: 'مرحباً',
        toolCalls: [{
          id: 'read-2',
          name: 'correct.name',
          arguments: { foo: 'bar' },
          function: {
            name: 'WRONG.name',
            arguments: '{"stale": true}',
            thought_signature: 'sig-xyz',
          },
        }],
        finishReason: 'tool_calls',
        usage: null,
      },
    });

    await getChatEngine().send('اختبار');

    // The LLM only got one call (final text) — but the round-trip is on the FIRST
    // response. We need to inspect the history directly. Pull via a fresh send.
    // Since this test only ran one send and got a text response with tool_calls,
    // we check the assistant message in messages via a second turn:
    mocks.complete.mockResolvedValueOnce({
      success: true,
      data: { content: 'النهاية', toolCalls: [], finishReason: 'stop', usage: null },
    });
    await getChatEngine().send('دوّر');

    const secondPayload = mocks.complete.mock.calls[1][0];
    const assistantMsgWithTool = secondPayload.messages.find(
      (m: { role: string; tool_calls?: unknown[] }) =>
        m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    );
    expect(assistantMsgWithTool).toBeDefined();
    const toolCall = (assistantMsgWithTool as { tool_calls: { function: Record<string, unknown> }[] }).tool_calls[0];
    expect(toolCall.function.name).toBe('correct.name');
    expect(toolCall.function.arguments).toBe('{"foo":"bar"}');
    expect(toolCall.function.thought_signature).toBe('sig-xyz');
  });
});
