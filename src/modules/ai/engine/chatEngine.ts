import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { aiApi } from '../api';
import { useAiStore } from '../store';
import { getVisibleTools, toLlmTools } from '../tools/registry';
import { ensureToolsRegistered } from '../tools/index';
import { ensureSkillsRegistered, selectActiveSkills } from '../skills';
import { buildSystemPrompt } from './systemPrompt';
import { executeToolCall, resolveTool } from './toolExecutor';
import { resolveEntitiesInText } from '../entityResolver';
import type { ChatMessage, LlmCompletionData, LlmMessage, LlmStreamChunk, PendingToolCall, ToolContext } from '../types';
import type { Skill } from '../skills/types';

/**
 * Merge streaming SSE chunks into a complete LlmCompletionData response.
 * Handles content deltas and incremental tool_call deltas from OpenAI-compatible
 * streaming endpoints.
 */
function reconstructResponseFromChunks(chunks: LlmStreamChunk[]): LlmCompletionData {
  let content = '';
  // Keyed by composite key (index or `index_id` when Gemini reuses index for parallel calls).
  const toolCallAccumulators: Record<string, {
    id: string;
    name: string;
    args: string;
    extraFunctionProps: Record<string, unknown>;
  }> = {};
  // Tracks the last composite key used per numeric index so deltas without id
  // still reach the correct accumulator.
  const indexToKey: Record<number, string> = {};
  let lastThoughtSignature: string | undefined;
  let finishReason: string | null = null;

  for (const chunk of chunks) {
    if (chunk.type === 'content' && chunk.content) {
      content += chunk.content;
    }

    if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
      const tc = chunk.toolCall;
      const idx = tc.index;

      // Determine the composite key for this delta.
      let key: string;
      const existingEntry = toolCallAccumulators[String(idx)];
      if (tc.id && existingEntry && existingEntry.id && existingEntry.id !== tc.id) {
        // Gemini reuses the same numeric index for a new parallel tool call.
        key = `${idx}_${tc.id}`;
      } else {
        key = indexToKey[idx] ?? String(idx);
      }
      indexToKey[idx] = key;
      if (!toolCallAccumulators[key]) {
        toolCallAccumulators[key] = { id: tc.id ?? '', name: '', args: '', extraFunctionProps: {} };
      }
      if (tc.id) toolCallAccumulators[key].id = tc.id;
      if (tc.function?.name) toolCallAccumulators[key].name += tc.function.name;
      if (tc.function?.arguments) toolCallAccumulators[key].args += tc.function.arguments;
      if (tc.function) {
        for (const k of Object.keys(tc.function)) {
          if (k !== 'name' && k !== 'arguments') {
            toolCallAccumulators[key].extraFunctionProps[k] = (tc.function as Record<string, unknown>)[k];
            // Gemini may put thought_signature inside the function object too.
            if (k === 'thought_signature') {
              lastThoughtSignature = (tc.function as Record<string, unknown>)[k] as string;
            }
          }
        }
      }
      if (typeof (tc as Record<string, unknown>).thought_signature === 'string') {
        lastThoughtSignature = (tc as Record<string, unknown>).thought_signature as string;
      }
    }

    // Special chunk emitted by aiHandler.js when Gemini returns
    // thought_signature at the message level instead of on the function.
    if (chunk.thoughtSignature) {
      lastThoughtSignature = chunk.thoughtSignature;
    }

    if (chunk.type === 'finish' && chunk.finishReason) {
      finishReason = chunk.finishReason;
    }
  }

  // Attach thought_signature to ALL tool call accumulators because Gemini
  // requires it on every tool_call in the history, not just the last one.
  if (lastThoughtSignature) {
    for (const acc of Object.values(toolCallAccumulators)) {
      acc.extraFunctionProps.thought_signature = lastThoughtSignature;
    }
  }

  const toolCalls = Object.values(toolCallAccumulators).map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: (() => {
      try { return JSON.parse(tc.args || '{}'); } catch { return {}; }
    })(),
    function: Object.keys(tc.extraFunctionProps).length > 0 ? tc.extraFunctionProps : {},
  }));

  return {
    content: content || '',
    toolCalls,
    finishReason,
    usage: null,
  };
}

const MAX_ITERATIONS = 8;

/**
 * Remove fake tool-execution blocks that some models imitate from the
 * flattened-history format (e.g. `[تم تنفيذ: search.accounts] {...}` or
 * `[TOOL_RESULT: search.accounts] {...}`). A model writing one of these
 * lines in its reply means the tool was NOT actually executed — the text
 * is a hallucinated imitation of internal context and must never reach the
 * UI, where it would look like a real tool result.
 */
export function stripImitationToolBlocks(content: string): string {
  if (!content) return content;
  const BLOCK_START = /^\s*\[(?:تم (?:تنفيذ|استدعاء):|TOOL_RESULT:|TOOL_CALLED:)/;
  const PAYLOAD_LINE = /^\s*[{}[\]"']/;
  const filtered: string[] = [];
  let skipPayload = false;
  for (const line of content.split('\n')) {
    if (BLOCK_START.test(line)) {
      skipPayload = true;
      continue;
    }
    if (skipPayload && PAYLOAD_LINE.test(line)) continue;
    skipPayload = false;
    filtered.push(line);
  }
  return filtered.join('\n').trim();
}

let engineInstance: ChatEngine | null = null;

export function getChatEngine(): ChatEngine {
  if (!engineInstance) engineInstance = new ChatEngine();
  return engineInstance;
}

/**
 * The core agent loop.
 *
 * send(text) runs a synchronous loop:
 *   1. append user message → LLM history + UI store
 *   2. call ai:complete with full history + visible tools
 *   3. if the LLM returns tool_calls:
 *      - read  → execute immediately, add result to history, continue loop
 *      - write → emit pending confirmation card in UI, STOP loop
 *   4. if write tool confirmed → add result to history, resume loop
 *   5. if final text only → append to UI + history, done
 *
 * LlmMessage[] lives in this class instance, not in the zustand store.
 * Each new conversation (reset) starts fresh history with the system prompt.
 */
class ChatEngine {
  private history: LlmMessage[] = [];
  private pendingWriteCalls: PendingToolCall[] = [];
  private iterationCount = 0;
  private store = useAiStore.getState;

  private get ctx(): ToolContext {
    const company = useAppStore.getState().activeCompany;
    const user = useAuthStore.getState().user;
    return {
      companyId: company?.id ?? '',
      userId: user?.id ?? '',
    };
  }

  /**
   * Selects the skills that should be active given the latest user message.
   * Returns always-on skills (regardless of message) + trigger-based skills
   * matching the user text. Filtered by current tool visibility.
   */
  private activeSkillsForMessage(userText: string): Skill[] {
    ensureSkillsRegistered();
    return selectActiveSkills({
      userMessage: userText,
      visibleTools: getVisibleTools(),
    });
  }

  /** Start or resume a conversation with user text. */
  async send(text: string): Promise<void> {
    ensureToolsRegistered();
    const store = this.store();

    if (store.isProcessing) return;

    store.setProcessing(true);

    try {
      // Always (re)build the system prompt so trigger-based skills
      // match the latest user message. The system message lives at
      // index 0 of history and is reused on every API call.
      const tools = getVisibleTools();
      const activeSkills = this.activeSkillsForMessage(text);
      const systemContent = buildSystemPrompt({ tools, activeSkills });

      if (this.history.length === 0) {
        this.history.push({ role: 'system', content: systemContent });
      } else if (this.history[0].role === 'system') {
        // Update the system message in place so trigger skills reflect the
        // current user message (skills content is large; mutating in place
        // avoids duplicating blocks across turns).
        this.history[0] = { ...this.history[0], content: systemContent };
      } else {
        this.history.unshift({ role: 'system', content: systemContent });
      }

      // ── Entity resolution ──────────────────────────────────────────
      // Pre-process the user message: fuzzy-match entity names against the
      // DB, correct common typos, and alert the user about corrections.
      let userText = text;
      let correctionMsg: string | null = null;

      try {
        const resolved = await resolveEntitiesInText(text, this.ctx.companyId);
        if (resolved.corrections.length > 0) {
          // Build corrected text — replace original names with canonical ones
          userText = text;
          for (const c of resolved.corrections) {
            // Case-insensitive replacement of the original word
            userText = userText.replace(
              new RegExp(c.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
              c.corrected,
            );
          }

          // Build user-friendly correction summary
          const lines: string[] = [];
          for (const c of resolved.corrections) {
            const typeLabel: Record<string, string> = {
              account: 'حساب', customer: 'عميل', supplier: 'مورد',
              employee: 'موظف', product: 'منتج', cashBox: 'خزنة',
              bank: 'بنك', invoice: 'فاتورة مبيعات',
              purchaseInvoice: 'فاتورة مشتريات', quotation: 'عرض سعر',
              receiptVoucher: 'سند قبض', paymentVoucher: 'سند صرف',
              workOrder: 'أمر تشغيل', bom: 'شجرة منتج',
              lead: 'عميل محتمل', warehouse: 'مستودع',
            };
            const lbl = typeLabel[c.type] ?? c.type;
            lines.push(`- **${lbl}**: "${c.original}" ← "${c.corrected}"`);
          }
          correctionMsg = `🔍 **تم تصحيح أسماء الكيانات تلقائياً:**\n${lines.join('\n')}\n\n_تم تحديث طلبك بالاسم الصحيح._`;

          // Update the displayed user message in the store to show the correction
          // We show the original text + correction note so the user sees what happened
        }
      } catch {
        // Entity resolution is best-effort — never block the user's message
      }

      // Append user message (original text visible in UI, corrected in LLM history)
      this.history.push({ role: 'user', content: userText });
      store.addMessage({ role: 'user', kind: 'text', content: text });

      // If we corrected something, show a notification to the user
      if (correctionMsg) {
        store.addMessage({
          role: 'assistant',
          kind: 'text',
          content: correctionMsg,
        });
      }

      this.iterationCount = 0;

      await this.runLoop();
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      this.store().addMessage({ role: 'assistant', kind: 'error', content: errorText });
    } finally {
      this.store().setProcessing(false);
    }
  }

  /**
   * Called by the UI when the user clicks confirm or reject on a pending
   * write tool call. Resumes the agent loop with the tool result (or rejection).
   */
  async resolveConfirmation(callId: string, approved: boolean): Promise<void> {
    const store = this.store();
    store.setProcessing(true);

    try {
      const pending = this.pendingWriteCalls.find((c) => c.callId === callId);
      if (!pending) return;

      const messageId = store.messages.find((m) => m.toolCall?.callId === callId)?.id;
      if (!messageId) return;

      if (approved) {
        // Execute the write tool
        store.updateToolCall(messageId, { status: 'executing' });

        const outcome = await executeToolCall(pending.toolName, pending.args, this.ctx);

        if (outcome.ok) {
          store.updateToolCall(messageId, {
            status: 'success',
            resultSummary: summarizeResult(outcome.result),
          });

          // Add tool result to LLM history
          this.history.push({
            role: 'tool',
            content: JSON.stringify(outcome.result),
            tool_call_id: callId,
          });
        } else {
          store.updateToolCall(messageId, {
            status: 'error',
            resultSummary: outcome.error ?? 'خطأ غير معروف',
          });

          this.history.push({
            role: 'tool',
            content: `خطأ: ${outcome.error}`,
            tool_call_id: callId,
          });
        }
      } else {
        // Rejected
        store.updateToolCall(messageId, {
          status: 'rejected',
          resultSummary: 'تم رفض العملية من المستخدم',
        });

        this.history.push({
          role: 'tool',
          content: 'تم رفض العملية من المستخدم. لا تحاول التنفيذ مرة أخرى.',
          tool_call_id: callId,
        });
      }

      // Clean up pending
      this.pendingWriteCalls = this.pendingWriteCalls.filter((c) => c.callId !== callId);

      // OpenAI-compatible providers require one tool response per emitted call.
      // Resume only after every pending write call has been resolved.
      if (this.pendingWriteCalls.length === 0) {
        this.iterationCount = 0;
        await this.runLoop();
      }
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      this.store().addMessage({ role: 'assistant', kind: 'error', content: errorText });
    } finally {
      this.store().setProcessing(false);
    }
  }

  /** Start a fresh conversation. */
  reset(): void {
    this.history = [];
    this.pendingWriteCalls = [];
    this.iterationCount = 0;
    this.store().clearMessages();
  }

  /**
   * Rebuild internal LLM history from the persisted ChatMessage[] so the
   * model has full conversation context when a saved session is resumed.
   *
   * Text messages are restored directly. Successful tool-call sequences
   * are reconstructed as assistant + tool pairs. Stale/error/pending tool
   * calls are skipped — the LLM should not re-process failed operations.
   */
  restoreHistory(messages: ChatMessage[]): void {
    const history: LlmMessage[] = [];

    // Inject a fresh system prompt first so the LLM has current context
    // (company, currency, date, user info, available tools, active skills).
    const tools = getVisibleTools();

    // Find the most recent user message — use it to seed trigger-based skills
    const lastUserText = [...messages].reverse().find((m) => m.role === 'user' && m.kind === 'text')?.content ?? '';
    const activeSkills = this.activeSkillsForMessage(lastUserText);

    history.push({
      role: 'system',
      content: buildSystemPrompt({ tools, activeSkills }),
    });

    for (const msg of messages) {
      if (msg.role === 'user' && msg.kind === 'text') {
        history.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant' && msg.kind === 'text') {
        history.push({ role: 'assistant', content: msg.content });
      }
      // assistant 'tool' kind messages and their matching tool role messages
      // are NOT reconstructed here because Gemini requires thought_signature
      // on every tool_call in history, and we don't persist it in the compact
      // ChatMessage shape.  The agent loop starts fresh from context provided
      // by user text messages and the newly generated system prompt.
    }

    this.history = history;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Build the messages array for the LLM request. Clones each message and its
   * tool_calls to avoid mutating history. Also ensures that if ANY tool_call
   * across the ENTIRE history has thought_signature, ALL tool_calls in every
   * assistant message get it — Gemini requires thought_signature on every
   * functionCall when using tools, even on older turns.
   *
   * If NO thought_signature exists anywhere in history (e.g. after session
   * restore or when the provider did not emit one), **tool_call+tool-result
   * pairs are flattened into single assistant text messages** so the LLM
   * retains execution context without triggering Gemini's 400 rejection.
   * This also prevents infinite tool-call loops because the LLM can see that
   * its previous call was already executed.
   */
  private buildMessages(): LlmMessage[] {
    // First pass: find any thought_signature across all assistant messages
    let globalTs: string | undefined;
    let hasAnyToolCalls = false;
    for (const m of this.history) {
      if (m.tool_calls && m.tool_calls.length > 0) {
        hasAnyToolCalls = true;
        for (const call of m.tool_calls) {
          if (call.function?.thought_signature) {
            globalTs = String(call.function.thought_signature);
            break;
          }
        }
        if (globalTs) break;
      }
    }

    // ── Thread-safe path (thought_signature available) ──────────────
    if (globalTs || !hasAnyToolCalls) {
      return this.history.map((message) => {
        const tool_calls = message.tool_calls?.map((call) => {
          const fn = { ...call.function };
          if (globalTs && !fn.thought_signature) {
            fn.thought_signature = globalTs;
          }
          return { ...call, function: fn };
        });
        return { ...message, tool_calls };
      });
    }

    // ── Thought-signature absent → flatten tool_call+tool pairs ────
    // Each assistant(tool_calls) + tool(...) pair is merged into a single
    // assistant text message so Gemini sees only user/assistant turns.
    const result: LlmMessage[] = [];
    let pendingPreText: string | null = null;   // text before the tool_calls
    let pendingCallNames: string[] | null = null; // function names to merge

    for (const m of this.history) {
      if (m.role === 'tool') {
        // Pair with the preceding assistant tool_call message
        const names = pendingCallNames?.join(', ') ?? 'tools';
        const resultText = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const text = pendingPreText
          ? `${pendingPreText}\n\n[TOOL_RESULT: ${names}]\n${resultText}`
          : `[TOOL_RESULT: ${names}]\n${resultText}`;
        result.push({ role: 'assistant', content: text });
        pendingPreText = null;
        pendingCallNames = null;
        continue;
      }

      if (m.tool_calls && m.tool_calls.length > 0) {
        pendingPreText = m.content;
        pendingCallNames = m.tool_calls.map((tc) => tc.function?.name ?? 'tool');
        continue;
      }

      // Normal user / assistant text message
      result.push({ ...m, tool_calls: undefined });
    }

    // Unpaired tool calls at the very end (shouldn't happen, but be safe)
    if (pendingCallNames) {
      const tail = pendingPreText
        ? `${pendingPreText}\n\n[TOOL_CALLED: ${pendingCallNames.join(', ')} — لم يتم إرجاع نتيجة بعد]`
        : `[TOOL_CALLED: ${pendingCallNames.join(', ')} — لم يتم إرجاع نتيجة بعد]`;
      result.push({ role: 'assistant', content: tail });
    }

    // Gemini rejects requests ending with an assistant ("model") turn.
    // If the last message is assistant, append a synthetic user turn so
    // the alternation is preserved.
    if (result.length > 0 && result[result.length - 1].role === 'assistant') {
      result.push({ role: 'user', content: 'أكمل من فضلك.' });
    }

    return result;
  }

  private async runLoop(): Promise<void> {
    while (this.iterationCount < MAX_ITERATIONS) {
      this.iterationCount++;

      const llmTools = toLlmTools(getVisibleTools());

      // Try push-based streaming first, then fall back to non-streaming
      let response: { success: boolean; data?: LlmCompletionData; error?: string };
      let streamingId: string | null = null;
      // Tracks whether the streaming placeholder received real text content.
      // If so, the placeholder IS the final assistant bubble — adding a second
      // message below would render the same text twice.
      let streamedContent = false;

      try {
        const streamGen = aiApi.startStream({
          companyId: this.ctx.companyId,
          messages: this.buildMessages(),
          tools: llmTools.length > 0 ? llmTools : undefined,
          temperature: 0.2,
          maxTokens: 4096,
        });

        // Add a streaming placeholder so the user sees content appear
        streamingId = this.store().addMessage({
          role: 'assistant',
          kind: 'text',
          content: '',
        });

        const chunks: LlmStreamChunk[] = [];

        for await (const chunk of streamGen) {
          chunks.push(chunk);
          // Progressively update the text content as chunks arrive
          if (chunk.type === 'content' && chunk.content) {
            streamedContent = true;
            const accumulated = chunks
              .filter((c): c is LlmStreamChunk & { content: string } => c.type === 'content' && typeof c.content === 'string')
              .map((c) => c.content as string)
              .join('');
            this.store().updateMessageContent(streamingId, stripImitationToolBlocks(accumulated));
          }
        }

        if (chunks.length > 0) {
          response = { success: true, data: reconstructResponseFromChunks(chunks) };
        } else {
          // Empty stream — fall back to non-streaming, remove placeholder
          this.store().removeMessage(streamingId);
          response = await aiApi.complete({
            companyId: this.ctx.companyId,
            messages: this.buildMessages(),
            tools: llmTools.length > 0 ? llmTools : undefined,
            temperature: 0.2,
            maxTokens: 4096,
          });
        }
      } catch {
        // Streaming failed — remove placeholder, fall back to non-streaming
        if (streamingId) {
          this.store().removeMessage(streamingId);
        }
        response = await aiApi.complete({
          companyId: this.ctx.companyId,
          messages: this.buildMessages(),
          tools: llmTools.length > 0 ? llmTools : undefined,
          temperature: 0.2,
          maxTokens: 10240,
        });
      }

      if (!response.success || !response.data) {
        this.store().addMessage({
          role: 'assistant',
          kind: 'error',
          content: response.error ?? 'فشل الاتصال بمزود الذكاء الاصطناعي',
        });
        return;
      }

      const data = response.data;

      // Append assistant message to history (with tool_calls if present).
      // Content is sanitized so hallucinated [تم تنفيذ: ...] / [TOOL_RESULT: ...]
      // imitation blocks never re-enter the LLM context as assistant text.
      const assistantMsg: LlmMessage = {
        role: 'assistant',
        content: data.content ? stripImitationToolBlocks(data.content) : null,
      };
      if (data.toolCalls.length > 0) {
        assistantMsg.tool_calls = data.toolCalls.map((tc) => {
          // Only preserve EXTRA props from tc.function (e.g. Gemini's thought_signature).
          // Do NOT spread name/arguments from tc.function because they would override
          // the top-level values and could desync from parsed arguments.
          const extras: Record<string, unknown> = {};
          if ('function' in tc && tc.function && typeof tc.function === 'object') {
            for (const key of Object.keys(tc.function as Record<string, unknown>)) {
              if (key !== 'name' && key !== 'arguments') {
                extras[key] = (tc.function as Record<string, unknown>)[key];
              }
            }
          }
          return {
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments), ...extras },
          };
        });
      }
      this.history.push(assistantMsg);

      // If no tool calls → final text response
      if (data.toolCalls.length === 0) {
        if (data.content) {
          const cleaned = stripImitationToolBlocks(data.content);
          if (streamedContent && streamingId) {
            // Streaming already displayed this content in the placeholder
            // bubble — update it with the final sanitized text instead of
            // adding a duplicate message (fixes duplicated assistant replies).
            this.store().updateMessageContent(streamingId, cleaned);
          } else {
            this.store().addMessage({
              role: 'assistant',
              kind: 'text',
              content: cleaned,
            });
          }
        }
        return;
      }

      // Separate read vs write tool calls
      const readCalls: typeof data.toolCalls = [];
      const writeCalls: typeof data.toolCalls = [];

      for (const tc of data.toolCalls) {
        const tool = resolveTool(tc.name);
        if (tool?.dangerLevel === 'write') {
          writeCalls.push(tc);
        } else {
          readCalls.push(tc);
        }
      }

      // Execute read tools in parallel (they're independent — no shared state)
      const readOutcomes = await Promise.all(
        readCalls.map(async (tc) => {
          const outcome = await executeToolCall(tc.name, tc.arguments, this.ctx);
          return { tc, outcome };
        })
      );

      for (const { tc, outcome } of readOutcomes) {
        const summary = outcome.ok ? summarizeResult(outcome.result) : (outcome.error ?? 'خطأ');

        this.store().addMessage({
          role: 'assistant',
          kind: 'tool',
          content: '',
          toolCall: {
            callId: tc.id,
            toolName: tc.name,
            label: resolveTool(tc.name)?.labelAr ?? tc.name,
            args: tc.arguments,
            status: outcome.ok ? 'success' : 'error',
            dangerLevel: 'read',
            resultSummary: summary,
          },
        });

        this.history.push({
          role: 'tool',
          content: outcome.ok ? JSON.stringify(outcome.result) : `خطأ: ${outcome.error}`,
          tool_call_id: tc.id,
        });
      }

      // Handle write tools → emit confirmation cards and STOP loop
      if (writeCalls.length > 0) {
        this.pendingWriteCalls = [];

        for (const tc of writeCalls) {
          const tool = resolveTool(tc.name);
          const pending: PendingToolCall = {
            callId: tc.id,
            toolName: tc.name,
            label: tool?.labelAr ?? tc.name,
            args: tc.arguments,
            argsSummary: tool?.summarizeArgs?.(tc.arguments),
            status: 'pending-confirmation',
            dangerLevel: 'write',
          };
          this.pendingWriteCalls.push(pending);

          this.store().addMessage({
            role: 'assistant',
            kind: 'tool',
            content: '',
            toolCall: pending,
          });
        }

        // Stop loop — waiting for user confirmation
        return;
      }

      // If only read tools ran, loop continues (LLM may respond with more text).
      // When the provider did not emit a thought_signature, buildMessages()
      // flattens the tool_call/tool-result pairs into assistant text turns so
      // providers that require thought_signature on every tool_call (Gemini)
      // don't reject the follow-up request. MAX_ITERATIONS guards against
      // infinite tool-call loops.
    }

    // Safety: max iterations reached
    this.store().addMessage({
      role: 'assistant',
      kind: 'text',
      content: 'تم الوصول إلى الحد الأقصى لعدد الخطوات. يرجى إعادة صياغة طلبك.',
    });
  }
}

/**
 * Render an array of simple objects as a pipe-delimited markdown table.
 */
function renderTable(rows: Record<string, unknown>[], label?: string): string {
  if (rows.length === 0) return label ? `${label}: (فارغ)` : '(فارغ)';

  // Pick keys from the first row, filtering out long/internal ones
  const keys = Object.keys(rows[0]).filter(
    (k) => k !== 'id' && !k.startsWith('_') && String(rows[0][k] ?? '').length < 60,
  );
  if (keys.length === 0) return label ? `${label}: ${rows.length} عنصر` : `${rows.length} عنصر`;

  // Build header
  const arabicHeaders: Record<string, string> = {
    name: 'الاسم',
    name_ar: 'الاسم',
    customerName: 'العميل',
    customer_name: 'العميل',
    supplierName: 'المورد',
    supplier_name: 'المورد',
    productName: 'المنتج',
    product_name: 'المنتج',
    code: 'الكود',
    phone: 'الهاتف',
    balance: 'الرصيد',
    total: 'الإجمالي',
    totalAmount: 'المبلغ',
    total_amount: 'المبلغ',
    amount: 'المبلغ',
    paidAmount: 'المدفوع',
    paid_amount: 'المدفوع',
    status: 'الحالة',
    date: 'التاريخ',
    invoiceNumber: 'رقم الفاتورة',
    invoice_number: 'رقم الفاتورة',
    quantity: 'الكمية',
    unitPrice: 'سعر الوحدة',
    unit_price: 'سعر الوحدة',
    email: 'البريد',
    createdAt: 'تاريخ الإنشاء',
    created_at: 'تاريخ الإنشاء',
  };

  const headers = keys.map((k) => arabicHeaders[k] ?? k);
  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${keys.map(() => '---').join(' | ')} |`;

  const bodyLines = rows.map((row) => {
    const vals = keys.map((k) => {
      const v = row[k];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.length > 50 ? s.slice(0, 47) + '...' : s;
    });
    return `| ${vals.join(' | ')} |`;
  });

  const title = label ? `**${label}**\n\n` : '';
  return `${title}${headerLine}\n${sepLine}\n${bodyLines.join('\n')}`;
}

/**
 * Render an object as key-value lines with icons.
 */
function renderObject(obj: Record<string, unknown>, title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`**${title}**\n`);

  const iconMap: Record<string, string> = {
    name: '👤',
    customerName: '👤',
    customer_name: '👤',
    supplierName: '🏢',
    supplier_name: '🏢',
    phone: '📞',
    email: '📧',
    totalAmount: '💰',
    total_amount: '💰',
    amount: '💰',
    paidAmount: '✅',
    paid_amount: '✅',
    balance: '💰',
    status: '📌',
    date: '📅',
    invoiceNumber: '📄',
    invoice_number: '📄',
    notes: '📝',
  };

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k.startsWith('_')) continue;
    const icon = iconMap[k] ?? '•';
    const label = k.replace(/_/g, ' ');
    if (v !== null && v !== undefined) {
      lines.push(`${icon} ${label}: ${String(v)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a numeric value with commas and a currency symbol suffix.
 */
function fmtCurrency(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n) || isNaN(n)) return String(v ?? '');
  return n.toLocaleString('ar-YE') + ' ر.ي';
}

/**
 * Convert a raw tool result into a beautifully formatted, human-readable string
 * that may contain markdown-like tables (pipe-delimited) and key-value cards.
 *
 * The formatted text is shown to the user in the ToolCallCard and is also used
 * as context for the LLM in subsequent turns.
 */
function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) return '✅ تم بنجاح';

  if (typeof result === 'string') return result;

  if (typeof result === 'number') return fmtCurrency(result);

  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    // Error pattern
    if ('success' in obj && obj.success === false) {
      return `❌ ${String(obj.error ?? 'فشلت العملية')}`;
    }

    // ── Search results with matches ─────────────────────────────────
    if ('matches' in obj && Array.isArray(obj.matches)) {
      const { matches, totalMatches, suggestion } = obj as {
        matches: Record<string, unknown>[];
        totalMatches: number;
        suggestion?: string;
      };
      if (matches.length === 0) {
        const tip = suggestion ? `\n\n💡 ${String(suggestion)}` : '';
        return `❌ لا توجد نتائج.${tip}`;
      }
      const table = renderTable(matches, `🔍 تم العثور على ${totalMatches ?? matches.length} نتيجة`);
      if (suggestion) return `${table}\n\n💡 ${String(suggestion)}`;
      return table;
    }

    // ── Report / summary with named stats ───────────────────────────
    const statKeys = [
      'invoiceCount', 'invoice_count', 'totalSales', 'total_sales',
      'totalRevenue', 'total_revenue', 'totalExpenses', 'total_expenses',
      'netProfit', 'net_profit', 'totalPaid', 'total_paid',
      'totalOutstanding', 'total_outstanding', 'totalInBase', 'total_in_base',
      'revenue', 'expenses', 'profit', 'total',
    ];

    const hasStats = statKeys.some((k) => k in obj);
    if (hasStats) {
      const lines: string[] = ['📊 **الملخص**\n'];
      const statLabels: Record<string, string> = {
        invoiceCount: '📄 عدد الفواتير',
        invoice_count: '📄 عدد الفواتير',
        totalSales: '💰 إجمالي المبيعات',
        total_sales: '💰 إجمالي المبيعات',
        totalRevenue: '💰 الإيرادات',
        total_revenue: '💰 الإيرادات',
        totalExpenses: '💸 المصروفات',
        total_expenses: '💸 المصروفات',
        netProfit: '📈 صافي الربح',
        net_profit: '📈 صافي الربح',
        totalPaid: '✅ المدفوع',
        total_paid: '✅ المدفوع',
        totalOutstanding: '⏳ المستحق',
        total_outstanding: '⏳ المستحق',
        totalInBase: '🏦 الإجمالي بالأساسية',
        total_in_base: '🏦 الإجمالي بالأساسية',
        revenue: '💰 الإيرادات',
        expenses: '💸 المصروفات',
        profit: '📈 الربح',
        total: '🏷️ الإجمالي',
      };
      for (const [k, v] of Object.entries(obj)) {
        const label = statLabels[k] ?? k.replace(/_/g, ' ');
        if (typeof v === 'number') {
          lines.push(`${label}: ${fmtCurrency(v)}`);
        } else if (v !== null && v !== undefined) {
          lines.push(`${label}: ${String(v)}`);
        }
      }
      return lines.join('\n');
    }

    // ── Array of objects → table ────────────────────────────────────
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
      return renderTable(obj as Record<string, unknown>[]);
    }

    // ── Simple array → numbered list ────────────────────────────────
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '(فارغ)';
      return obj.map((item, i) => `${i + 1}. ${String(item)}`).join('\n');
    }

    // ── Single object with known fields → card ──────────────────────
    const knownFields = ['name', 'customerName', 'customer_name', 'supplierName', 'supplier_name',
      'phone', 'email', 'totalAmount', 'total_amount', 'amount', 'status', 'date',
      'invoiceNumber', 'invoice_number', 'notes'];
    const hasKnown = knownFields.some((k) => k in obj);
    if (hasKnown) {
      const title = 'invoiceNumber' in obj ? '📋 فاتورة' :
        'customerName' in obj ? '👤 عميل' :
        'supplierName' in obj ? '🏢 مورد' :
        'name' in obj ? '👤 بيانات' :
        undefined;
      return renderObject(obj, title);
    }

    // ── Fallback: compact JSON (truncated) ──────────────────────────
    try {
      const json = JSON.stringify(result);
      if (json.length <= 200) return json;
      return json.slice(0, 200) + '...';
    } catch {
      return '✅ تم بنجاح';
    }
  }

  return String(result);
}
