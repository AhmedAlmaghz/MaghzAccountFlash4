import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { aiApi } from '../api';
import { useAiStore } from '../store';
import { getVisibleTools, toLlmTools } from '../tools/registry';
import { ensureToolsRegistered } from '../tools/index';
import { ensureSkillsRegistered, selectActiveSkills } from '../skills';
import { buildSystemPrompt, type LiveCompanyContext } from './systemPrompt';
import { executeToolCall, resolveTool } from './toolExecutor';
import { isBatchActive, runBatch, batchProgressLine } from './batchRunner';
import { buildUserParts, llmTextOf, pruneMediaForWire, trimAttachmentsToBudget } from './llmParts';
import { getBatch } from '../api/batch';
import type { PreparedAttachment } from '../attachments/attachmentTypes';
import { classifyToolError, renderErrorGuidance } from './errorTaxonomy';
import { attachmentContextBlock } from './llmParts';
import { resolveArgsForCard } from './cardResolvers';
import { expandDialectText } from './dialectMap';
import { resolveEntitiesInText } from '../entityResolver';
import { getInvoiceTaxConfig } from '../tools/writeTools/shared';
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

// Room for: searches → write confirmation → resume → up to 2 anti-fabrication
// correction cycles, without starving legitimate multi-document requests.
const MAX_ITERATIONS = 10;

/**
 * Unified completion budget. The three call sites (streaming, empty-stream
 * fallback, streaming-failure fallback) previously disagreed — 4096 vs
 * 10240 — so long reports were silently truncated on the streaming path but
 * not the fallback. One constant, one behaviour.
 */
const MAX_COMPLETION_TOKENS = 10240;

/**
 * Hard ceiling for one streaming round-trip. The main process already aborts
 * provider stalls at 90s, but if the done-event itself is lost (dead IPC,
 * destroyed sender, bridge glitch) the renderer's `for await` would wait
 * FOREVER — isProcessing stuck, every later send ignored, app "frozen".
 * This watchdog abandons the drain and falls through to the non-streaming
 * fallback instead. Must exceed the main-process 90s abort.
 */
const STREAM_TOTAL_TIMEOUT_MS = 120_000;

/**
 * Budget for the pre-LLM preamble (live settings read + entity resolution).
 * These awaits run BEFORE the first provider byte and own NO timeout of
 * their own — a wedged settings/DB read would spin the "thinking" indicator
 * forever with zero chunks and zero errors. On expiry the send proceeds
 * degraded (raw text, default context) instead of hanging.
 */
const PRE_LLM_DEADLINE_MS = 30_000;
/**
 * Race a promise against a wall clock. On expiry the loser is detached
 * (late rejection swallowed) and `fallback` is returned — the caller
 * proceeds degraded instead of hanging. Real rejections propagate.
 * The timeout is traced + warned with its label so the console tells slow
 * (deadline-hit logged) apart from stuck (nothing logged at all).
 */
export function deadlineOr<T>(p: Promise<T>, ms: number, fallback: T, label = 'op'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('__deadline__')), ms);
  });
  return Promise.race([
    p.then(
      (v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; },
    ),
    timeout,
  ]).catch((e) => {
    if (e instanceof Error && e.message === '__deadline__') {
      p.catch(() => { /* detached loser stays unobserved */ });
      console.warn(`[ai] deadline hit: ${label} — proceeding degraded`);
      traceSend(`deadline-hit:${label}`);
      return fallback;
    }
    throw e;
  });
}

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
  const BLOCK_START = /^\s*(?:\[(?:تم (?:تنفيذ|استدعاء):|TOOL_RESULT:|TOOL_CALLED:)|@@@call:)/;
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

/**
 * Detects replies that CLAIM a business action happened (document created /
 * posted / voucher paid…) without any real tool execution behind them.
 *
 * The failing pattern from real sessions: the model drifts off the tool
 * loop and imitates earlier success summaries — inventing sequential doc
 * numbers (RV-000002…), "مرحّل Posted" status lines, even account codes —
 * while NOTHING was written to the DB.
 */
const DOC_NUMBER_RE = /\b(?:INV|PINV|QTN|RV|PV|JE|SRT|PRT|WO|PRD|EMP|CUST|LEAD|OPP|DEP|POS)-?\s?\d{2,}\b/i;
const ACTION_CLAIM_RE =
  /(قمت\s+ب?\s*(إنشاء|تسجيل|ترحيل|إصدار|صرف|قبض|سداد|دفع))|(تم\s+(الآن\s+)?(إنشاء|تسجيل|ترحيل|إصدار|صرف|قبض|سداد))|(أنشأت|سجّلت|سجلت|رحّلت|رحلت|أصدرت|صرفت|قبضت|سدّدت|سددت|دفعت)/;

/** True when the reply asserts a completed business action. */
export function claimsBusinessAction(content: string): boolean {
  if (!content) return false;
  if (!ACTION_CLAIM_RE.test(content)) return false;
  return DOC_NUMBER_RE.test(content) || /مرحّل|مُرحّل|Posted/i.test(content);
}

export function getChatEngine(): ChatEngine {
  if (!engineInstance) engineInstance = new ChatEngine();
  return engineInstance;
}

/**
 * Send-phase trace: every send records its progress through a tiny ring
 * buffer (press → context → entities → stream → first chunk → end), one
 * console line per phase. When a user reports "pressed send and everything
 * froze", the console shows EXACTLY which phase never completed — no more
 * guessing between a dead UI, a wedged DB read, and a stalled provider.
 */
const SEND_TRACE_CAP = 60;
const sendTrace: Array<{ at: number; phase: string }> = [];
export function traceSend(phase: string): void {
  sendTrace.push({ at: Date.now(), phase });
  if (sendTrace.length > SEND_TRACE_CAP) sendTrace.splice(0, sendTrace.length - SEND_TRACE_CAP);
  console.info(`[ai/send] ${phase}`);
}
/** Full phase history (oldest first) — also reachable live as window.__aiTrace. */
export function getSendTrace(): Array<{ at: number; phase: string }> {
  return sendTrace.slice();
}
if (typeof window !== 'undefined') {
  (window as unknown as { __aiTrace?: unknown }).__aiTrace = getSendTrace;
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
  /** The tenant this engine's history currently belongs to (company-switch guard). */
  private scopedCompanyId: string | null = null;

  /**
   * Anti-fabrication state (per `send()` invocation):
   *  - successfulWritesThisSend: write tools that ACTUALLY executed (post
   *    user approval). A final reply claiming success with zero entries here
   *    is a hallucination and gets corrected, never displayed.
   *  - fabricationRetries: correction cycles used for this send (max 2).
   */
  private successfulWritesThisSend = new Set<string>();
  private fabricationRetries = 0;
  /**
   * Identical-retry guard: a model that keeps re-issing the SAME write call
   * with the SAME arguments after repeated failures (e.g. an API guard
   * rejecting bad input) must not spawn confirmation cards forever — the
   * user approves, it fails, the model retries verbatim, on and on.
   * Key = toolName + stable-stringified args; value = failures so far.
   */
  private failedWriteAttempts = new Map<string, number>();
  private static readonly WRITE_RETRY_LIMIT = 2;

  /** Stable key for a (toolName, args) pair — key order must not matter. */
  private static writeAttemptKey(toolName: string, args: unknown): string {
    const stable = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(stable);
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        );
      }
      return v;
    };
    return `${toolName}::${JSON.stringify(stable(args))}`;
  }

  private get ctx(): ToolContext {
    const company = useAppStore.getState().activeCompany;
    const user = useAuthStore.getState().user;
    return {
      companyId: company?.id ?? '',
      userId: user?.id ?? '',
    };
  }

  /**
   * Live financial context for the system prompt (VAT rate + invoice
   * display flags). Cached for LIVE_CONTEXT_TTL_MS — the engine rebuilds
   * the prompt on every send, and a settings round-trip per message would
   * be wasteful; one settings read per minute is plenty fresh.
   */
  private liveContextCache: { at: number; data: LiveCompanyContext } | null = null;
  private static readonly LIVE_CONTEXT_TTL_MS = 60_000;

  private async fetchLiveContext(): Promise<LiveCompanyContext> {
    const { companyId } = this.ctx;
    if (!companyId) return {};
    const now = Date.now();
    if (this.liveContextCache && now - this.liveContextCache.at < ChatEngine.LIVE_CONTEXT_TTL_MS) {
      return this.liveContextCache.data;
    }
    try {
      const tax = await getInvoiceTaxConfig(companyId);
      const data: LiveCompanyContext = {
        ...(tax.vatRate > 0 ? { vatRate: tax.vatRate } : {}),
        vatOnInvoices: tax.showVat,
      };
      this.liveContextCache = { at: now, data };
      return data;
    } catch {
      return {};
    }
  }

  /**
   * Selects the skills that should be active given the latest user message.
   * Returns always-on skills (regardless of message) + trigger-based skills
   * matching the user text. Filtered by current tool visibility.
   *
   * Harness best practice — sticky triggers: the current turn's text plus
   * the last few user turns keep domain skills alive across "استمر / تابع".
   */
  private activeSkillsForMessage(userText: string): Skill[] {
    ensureSkillsRegistered();
    const recentUserTexts: string[] = [];
    for (let i = this.history.length - 1; i >= 0 && recentUserTexts.length < 3; i++) {
      const m = this.history[i];
      if (!m || m.role !== 'user') continue;
      try {
        const t = llmTextOf(m.content);
        if (t) recentUserTexts.push(t);
      } catch { /* ignore malformed content */ }
    }
    const combined = [...recentUserTexts.reverse(), userText].join(' ');
    return selectActiveSkills({
      userMessage: combined,
      visibleTools: getVisibleTools(),
    });
  }

  /**
   * Start or resume a conversation with user text plus optional file
   * attachments. Attachment binaries ride the wire ONCE (latest turn only —
   * see pruneMediaForWire); their metadata + extracted text persist with the
   * message so history stays meaningful after the binary expires.
   */
  async send(text: string, attachments: PreparedAttachment[] = []): Promise<void> {
    ensureToolsRegistered();
    const store = this.store();

    if (store.isProcessing) return;

    // Tenant guard: a company switch since the last send discards the old
    // tenant's LLM history before anything reads it.
    this.ensureCompanyScope(this.ctx.companyId);

    store.setProcessing(true);
    this.touchProgress();
    traceSend('press-received');

    // Optimistic UI: the user's bubble appears INSTANTLY, before the
    // (deadline-guarded but still slow on weak transports) settings/entity
    // preamble. Previously the bubble waited behind up to 60s of DB reads —
    // pressing send looked completely dead.
    const trimmedAttachments = trimAttachmentsToBudget(attachments);
    store.addMessage({
      role: 'user',
      kind: 'text',
      content: text,
      ...(trimmedAttachments.length > 0
        ? { attachments: trimmedAttachments.map((a) => a.meta) }
        : {}),
    });
    traceSend('user-stored');

    try {
      // Always (re)build the system prompt so trigger-based skills
      // match the latest user message. The system message lives at
      // index 0 of history and is reused on every API call.
      const tools = getVisibleTools();
      const activeSkills = this.activeSkillsForMessage(text);
      traceSend('prefix-sync-done');
      // Deadline-guarded: a wedged settings read must degrade, not hang.
      const liveContext = await deadlineOr(this.fetchLiveContext(), PRE_LLM_DEADLINE_MS, {}, 'live-context');
      const systemContent = buildSystemPrompt({ tools, activeSkills, liveContext });
      traceSend('context-ready');

      // Ensure history is a clean array — a previous crash may have left
      // undefined holes (e.g. sparse array) that would throw on `m.role`.
      this.history = (this.history || []).filter((m): m is LlmMessage => !!m && typeof (m as LlmMessage).role === 'string');
      if (this.history.length === 0) {
        this.history.push({ role: 'system', content: systemContent });
      } else if (this.history[0]?.role === 'system') {
        // Update the system message in place so trigger skills reflect the
        // current user message (skills content is large; mutating in place
        // avoids duplicating blocks across turns).
        this.history[0] = { ...this.history[0], content: systemContent };
      } else {
        this.history.unshift({ role: 'system', content: systemContent });
      }

      // ── Dialect expansion + entity resolution ──────────────────────────
      // Pre-process the user message:
      //  1. DIALECT: regional business words (Yemeni/Gulf/Egyptian…) are
      //     rewritten into the canonical vocabulary BEFORE anything else —
      //     search tools and the model read one language.
      //  2. ENTITY: fuzzy-match entity names against the DB, correct guarded
      //     typos, and alert the user about corrections.
      let userText = text;
      let correctionMsg: string | null = null;

      // Dialect first — the canonical text feeds entity resolution too.
      let dialectChanged: string[] = [];
      try {
        const expanded = expandDialectText(text);
        userText = expanded.text;
        dialectChanged = expanded.changed;
      } catch {
        // Dialect expansion is best-effort — never block the message
      }

      try {
        // Deadline-guarded: a wedged entity/DB read must degrade to raw
        // text, never hold the "thinking" spinner forever before the first
        // provider byte.
        const resolved = await deadlineOr(
          resolveEntitiesInText(userText, this.ctx.companyId),
          PRE_LLM_DEADLINE_MS,
          null,
          'entities',
        );
        if (!resolved) {
          console.warn('[ai] entity resolution timed out — proceeding with raw text');
        } else {
          userText = resolved.text || userText;

        if (resolved.corrections.length > 0 || dialectChanged.length > 0) {
          // Build user-friendly correction summary
          const lines: string[] = [];
          if (dialectChanged.length > 0) {
            lines.push(`- **لهجة**: تم توحيد ${dialectChanged.length} مصطلحاً محلياً بالمصطلح النظامي لضمان فهم دقيق`);
          }
          for (const c of resolved.corrections) {
            const typeLabel: Record<string, string> = {
              account: 'حساب', customer: 'عميل', supplier: 'مورد',
              employee: 'موظف', product: 'منتج', cashBox: 'خزنة',
              invoice: 'فاتورة مبيعات',
              purchaseInvoice: 'فاتورة مشتريات', quotation: 'عرض سعر',
              receiptVoucher: 'سند قبض', paymentVoucher: 'سند صرف',
              workOrder: 'أمر تشغيل', bom: 'شجرة منتج',
              lead: 'عميل محتمل', warehouse: 'مستودع',
            };
            const lbl = typeLabel[c.type] ?? c.type;
            lines.push(`- **${lbl}**: "${c.original}" ← "${c.corrected}"`);
          }
          correctionMsg = `🔍 **تمت معالجة طلبك تلقائياً:**\n${lines.join('\n')}\n\n_تم تحديث طلبك بالمصطلحات والأسماء الصحيحة._`;
          }
        }
      } catch {
        // Entity resolution is best-effort — never block the user's message
      }
      traceSend('entities-done');

      // Append the (possibly corrected) user turn to the LLM history. The UI
      // bubble was already stored optimistically at press time above.
      // Canonical extraction blocks ride with the wire content (chip = source
      // of truth); the editable textarea draft is advisory.
      this.history.push({ role: 'user', content: buildUserParts(userText, trimmedAttachments) });

      // If we corrected something, show a notification to the user
      if (correctionMsg) {
        store.addMessage({
          role: 'assistant',
          kind: 'text',
          content: correctionMsg,
        });
      }

      this.iterationCount = 0;
      this.successfulWritesThisSend.clear();
      this.fabricationRetries = 0;
      this.failedWriteAttempts.clear();
      this.abortRequested = false; // fresh request — previous stop is consumed

      await this.runLoop();
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      this.store().addMessage({ role: 'assistant', kind: 'error', content: errorText });
    } finally {
      traceSend('cycle-end');
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
    this.touchProgress();

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

          // Mark as REALLY executed — the anti-fabrication guard allows
          // success claims only when at least one write landed here.
          this.successfulWritesThisSend.add(pending.toolName);

          // Batch tools hand back a batchId to run: the single approval the
          // user just gave covers the whole batch, so the worker starts
          // immediately (fire-and-forget) and reports progress onto the
          // same card. No second approval round is ever requested.
          const batchId = (outcome.result as { startBatchRun?: unknown } | null)?.startBatchRun;
          if (typeof batchId === 'string' && batchId) {
            void this.startBatchRun(batchId, messageId);
          }

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

          // Identical-retry guard bookkeeping: remember this exact call failed
          // so runLoop stops re-issuing confirmation cards for it forever.
          const key = ChatEngine.writeAttemptKey(pending.toolName, pending.args);
          this.failedWriteAttempts.set(key, (this.failedWriteAttempts.get(key) ?? 0) + 1);

          // The failure reaches the model WITH the structured guidance block
          // (classification + reason + fixHint) so the next reply guides the
          // user to the resolution instead of repeating the raw error.
          const guidance = outcome.errorClass ? `\n${renderErrorGuidance(outcome.errorClass)}` : '';
          this.history.push({
            role: 'tool',
            content: `خطأ: ${outcome.error}${guidance}`,
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

  /**
   * Run a batch to completion after its single approval. Fire-and-forget:
   * progress lands on the same tool card after every chunk, and a final
   * summary message closes the run. Stopping the whole engine also stops
   * the worker via the shared abort flag — the batch row stays resumable.
   */
  private async startBatchRun(batchId: string, messageId: string): Promise<void> {
    const store = this.store();
    // Pin the batch to its card so MessageBubble renders the live progress
    // card (persisted inside tool_call JSONB — survives reloads).
    store.updateToolCall(messageId, { batchId });
    try {
      const final = await runBatch(this.ctx.companyId, this.ctx.userId, batchId, {
        shouldStop: () => this.abortRequested,
        onProgress: (detail) => {
          this.reportBatchProgress(messageId, 'executing', batchProgressLine(detail));
        },
      });
      if (!final) {
        store.updateToolCall(messageId, { status: 'error', resultSummary: 'تعذّر قراءة حالة الدفعة' });
        return;
      }
      const line = batchProgressLine(final);
      this.reportBatchProgress(
        messageId,
        final.status === 'done' || final.status === 'partial' ? 'success' : 'error',
        line,
      );
      const finalContent =
        final.status === 'done'
          ? `اكتملت الدفعة: ${line}`
          : final.status === 'partial'
            ? `اكتملت الدفعة جزئياً: ${line} — اسألني عن تفاصيل الفاشلة أو قل "أعد الفاشلة" لإعادة المحاولة`
            : `توقفت الدفعة (${final.status}): ${line} — قل "تابع" للاستئناف في أي وقت`;
      store.addMessage({
        role: 'assistant',
        kind: final.status === 'done' ? 'text' : 'error',
        content: finalContent,
      });
      // Harness memory: the LLM must remember that this batch finished and
      // how it finished — otherwise the next "استمر" has no completion to
      // build on. Mirror the UI message into the LLM history.
      this.history.push({ role: 'assistant', content: finalContent });
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      this.reportBatchProgress(messageId, 'error', errorText);
      this.history.push({ role: 'assistant', content: errorText });
    }
  }

  /**
   * Report batch progress onto a message: the tool card when the message
   * carries one (approval flows), otherwise the message text itself
   * (resumed runs, which own a plain text message). Never both — the live
   * BatchProgressCard already shows substance.
   */
  private reportBatchProgress(
    messageId: string,
    status: 'executing' | 'success' | 'error',
    line: string,
  ): void {
    this.touchProgress();
    const store = this.store();
    const hasCard = store.messages.some((m) => m.id === messageId && m.toolCall);
    if (hasCard) {
      store.updateToolCall(messageId, { status, resultSummary: line });
    } else {
      store.updateMessageContent(messageId, line);
    }
  }

  /**
   * Resume a persisted batch (running/paused/partial) — used by the resume
   * banner after restarts and by "تابع" follow-ups. The original approval
   * still covers the run: no new confirmation round is requested. Owns a
   * plain text message that doubles as the progress line.
   */
  async resumeBatchById(batchId: string): Promise<void> {
    const store = this.store();
    if (store.isProcessing) return;
    if (isBatchActive(batchId)) return; // already driven here — no second loop
    store.setProcessing(true);
    this.touchProgress();
    try {
      const got = await getBatch(batchId, { companyId: this.ctx.companyId, userId: this.ctx.userId });
      if (!got.success || !got.data) {
        const msg = got.error || 'الدفعة غير موجودة';
        store.addMessage({ role: 'assistant', kind: 'error', content: msg });
        this.history.push({ role: 'assistant', content: msg });
        return;
      }
      const detail = got.data;
      if (detail.status === 'done') {
        const msg = 'الدفعة مكتملة أصلاً — لا شيء لاستئنافه';
        store.addMessage({ role: 'assistant', kind: 'text', content: msg });
        this.history.push({ role: 'assistant', content: msg });
        return;
      }
      if (detail.status === 'cancelled') {
        const msg = 'الدفعة ملغاة — أنشئ دفعة جديدة بدلاً من ذلك';
        store.addMessage({ role: 'assistant', kind: 'error', content: msg });
        this.history.push({ role: 'assistant', content: msg });
        return;
      }
      if (detail.failedCount > 0) {
        const retry = await aiApi.batchRetryFailed(this.ctx.companyId, this.ctx.userId, batchId);
        if (!retry.success) {
          const msg = retry.error || 'فشل إعادة العناصر الفاشلة';
          store.addMessage({ role: 'assistant', kind: 'error', content: msg });
          this.history.push({ role: 'assistant', content: msg });
          return;
        }
      } else if (detail.status === 'paused') {
        const unpause = await aiApi.batchSetStatus(this.ctx.companyId, this.ctx.userId, batchId, 'running');
        if (!unpause.success) {
          const msg = unpause.error || 'فشل إلغاء الإيقاف';
          store.addMessage({ role: 'assistant', kind: 'error', content: msg });
          this.history.push({ role: 'assistant', content: msg });
          return;
        }
      }
      const messageContent = `استئناف الدفعة: ${detail.title || batchId}`;
      const messageId = store.addMessage({
        role: 'assistant',
        kind: 'text',
        content: messageContent,
      });
      this.history.push({ role: 'assistant', content: messageContent });
      this.abortRequested = false;
      await this.startBatchRun(batchId, messageId);
    } finally {
      store.setProcessing(false);
    }
  }

  /** Start a fresh conversation. */
  reset(): void {
    this.history = [];
    this.pendingWriteCalls = [];
    this.iterationCount = 0;
    this.successfulWritesThisSend.clear();
    this.failedWriteAttempts.clear();
    this.liveContextCache = null;
    this.scopedCompanyId = null;
    this.store().clearMessages();
  }

  /**
   * Company-switch guard: the engine is a singleton, but its history belongs
   * to ONE tenant. When the active company changes mid-session, the old
   * conversation's context (entities, documents, VAT rate) silently leaks into
   * the new company's requests — a cross-tenant data-hygiene bug. UI mounts
   * call this on companyId change; it preserves the on-screen messages unless
   * asked to wipe them (the LLM history is always discarded).
   */
  ensureCompanyScope(companyId: string): void {
    if (this.scopedCompanyId === null) {
      this.scopedCompanyId = companyId;
      return;
    }
    if (this.scopedCompanyId === companyId) return;
    // Different tenant — drop LLM history + caches; keep the UI transcript
    // (it is already persisted per-company) but the model starts clean.
    this.scopedCompanyId = companyId;
    this.history = [];
    this.pendingWriteCalls = [];
    this.iterationCount = 0;
    this.successfulWritesThisSend.clear();
    this.failedWriteAttempts.clear();
    this.liveContextCache = null;
  }

  /**
   * Called when the final reply claims business actions with zero executed
   * writes behind them (or carries silently-stripped imitation blocks).
   *
   * Removes the fabricated bubble, injects a mandatory correction turn into
   * the LLM history and resumes the loop so the model either calls the REAL
   * tool or honestly admits nothing was done. Bounded to 2 retries — then
   * an explicit failure is shown instead of a lie.
   */
  private async correctFabricatedReply(
    streamingId: string | null,
    streamedContent: boolean,
  ): Promise<void> {
    this.fabricationRetries++;
    this.touchProgress();

    // Remove the fabricated bubble (streamed replies are already rendered).
    if (streamedContent && streamingId) {
      this.store().removeMessage(streamingId);
    }

    if (this.fabricationRetries > 2) {
      this.store().addMessage({
        role: 'assistant',
        kind: 'error',
        content:
          'تعذّر تنفيذ العملية: أجاب المساعد دون استدعاء أدوات فعلية. لم يُسجَّل أي شيء. أعِد صياغة الطلب أو نفّذ العملية من الشاشات مباشرة.',
      });
      return;
    }

    this.history.push({
      role: 'user',
      content:
        '[تنبيه نظام — إلزامي]: ردّك الأخير ادّعى تنفيذ عملية (إنشاء/ترحيل مستند أو قيد) دون استدعاء أي أداة كتابة حقيقية، وهذا ممنوع تماماً ولن يُعرض على المستخدم. أكمل الآن بأحد أمرين فقط: (1) استدعِ الأداة المناسبة فعلياً بالمعطيات المتوفرة عبر function-calls، أو (2) أقرّ بوضوح أن العملية لم تُنفَّذ واذكر السبب.',
    });

    await this.runLoop();
  }

  /**
   * Rebuild internal LLM history from the persisted ChatMessage[] so the
   * model has full conversation context when a saved session is resumed.
   *
   * Harness best practice: the LLM must see the SAME history the user saw —
   * including tool_calls + tool_results and attachment extractions — otherwise
   * the next "استمر" has no memory of what was done. We reconstruct the full
   * sequence from ChatMessages (UI store) and rely on buildMessages() to
   * flatten it safely when thought_signature is absent (Gemini-safe).
   */
  restoreHistorySync(messages: ChatMessage[]): void {
    const history: LlmMessage[] = [];

    // Inject a fresh system prompt first so the LLM has current context
    // (company, currency, date, user info, available tools, active skills).
    // Use the full recent user history to seed sticky trigger skills, not just
    // the last message — otherwise "استمر" drops the domain skill.
    const tools = getVisibleTools();
    const aggregatedUserText = messages
      .filter((m) => m && m.role === 'user' && m.kind === 'text')
      .slice(-3)
      .map((m) => String(m.content || ''))
      .join(' ');
    const activeSkills = this.activeSkillsForMessage(aggregatedUserText);

    const liveContext = this.liveContextCache?.data ?? {};

    history.push({
      role: 'system',
      content: buildSystemPrompt({
        tools,
        activeSkills,
        liveContext,
      }),
    });

    for (const msg of messages) {
      if (!msg || typeof msg.role !== 'string') continue;
      if (msg.role === 'user' && msg.kind === 'text') {
        // Attachments survive reload as metadata + extractedText — rebuild the
        // same authoritative context blocks the original send used, so the LLM
        // still sees file extractions after the binary expired.
        let content: string | null = String(msg.content ?? '');
        if (msg.attachments && msg.attachments.length > 0) {
          try {
            const blocks = msg.attachments
              .filter((a) => a && a.name && a.kind)
              .map((a) => attachmentContextBlock(a.name, a.kind, a.extractedText));
            content = [msg.content, ...blocks].filter(Boolean).join('\n\n');
          } catch {
            // attachment block is best-effort
          }
        }
        history.push({ role: 'user', content });
      } else if (msg.role === 'assistant' && msg.kind === 'text') {
        if (msg.content) history.push({ role: 'assistant', content: String(msg.content) });
      } else if (msg.role === 'assistant' && msg.kind === 'error') {
        if (msg.content) history.push({ role: 'assistant', content: String(msg.content) });
      } else if (msg.role === 'assistant' && msg.kind === 'tool' && msg.toolCall) {
        const tc = msg.toolCall;
        // Skip cards that never reached the LLM (should not happen after
        // normalization, but guard anyway). Normalized stale cards become
        // rejected/error and ARE kept — the LLM must see the outcome.
        // Reconstruct the two-part sequence: assistant(tool_calls) + tool(result)
        history.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: tc.callId,
              type: 'function',
              function: {
                name: tc.toolName,
                arguments: JSON.stringify(tc.args ?? {}),
              },
            },
          ],
        });
        let toolContent: string;
        if (tc.status === 'success') {
          toolContent = tc.resultSummary || '✅ تم بنجاح';
        } else if (tc.status === 'error') {
          const base = tc.resultSummary || 'خطأ غير معروف';
          // Re-attach structured guidance so the LLM sees the same help the
          // live runLoop injected — otherwise retried "استمر" has no fixHint.
          try {
            const cls = classifyToolError(base);
            toolContent = `خطأ: ${base}\n${renderErrorGuidance(cls)}`;
          } catch {
            toolContent = `خطأ: ${base}`;
          }
        } else if (tc.status === 'rejected') {
          toolContent = 'تم رفض العملية من المستخدم. لا تحاول التنفيذ مرة أخرى.';
        } else {
          // pending-confirmation / executing are normalized on load, but handle
          toolContent = tc.resultSummary
            ? `خطأ: ${tc.resultSummary}`
            : 'انتهت الجلسة قبل تأكيد العملية — لم تُنفّذ';
        }
        history.push({ role: 'tool', content: toolContent, tool_call_id: tc.callId });
      }
    }

    this.history = history;
    // This restored history belongs to the currently active company (the
    // persistence layer already scoped the load by companyId). Pin it so the
    // tenant guard does not wipe it on the next send.
    this.scopedCompanyId = this.ctx.companyId || null;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Context-window budget: long sessions grew this.history without bound —
   * a 40+ message conversation eventually trips provider context limits
   * (or degrades into huge, slow, costly requests). The window keeps the
   * system prompt (index 0) plus the most recent messages, SNAPPED to a
   * safe boundary so we never orphan a tool result from its tool_call.
   */
  private static readonly CONTEXT_WINDOW_MESSAGES = 30;

  /**
   * Slice history to the context budget without breaking conversation
   * invariants:
   *   - the system message is always kept (index 0);
   *   - the slice never STARTS on a `tool` message (its assistant tool_call
   *     partner must come with it);
   *   - the slice never STARTS mid-pair after an assistant(tool_calls) —
   *     the following tool results must not be orphaned.
   */
  private windowedHistory(): LlmMessage[] {
    // Defensive: filter any undefined / malformed entries that may have slipped
    // in from a corrupted persisted session — the reported "Cannot read
    // properties of undefined (reading 'role')" came from a hole here.
    const h = (this.history || []).filter((m): m is LlmMessage => !!m && typeof (m as LlmMessage).role === 'string');
    if (h.length <= ChatEngine.CONTEXT_WINDOW_MESSAGES) {
      // keep filtered copy in place so the hole never resurfaces
      if (h.length !== this.history.length) this.history = h;
      return h;
    }

    const system = h[0]?.role === 'system' ? [h[0]] : [];
    const rest = system.length ? h.slice(1) : h;

    let start = rest.length - (ChatEngine.CONTEXT_WINDOW_MESSAGES - system.length);
    if (start < 0) start = 0;

    // Snap forward past orphaned tool results / dangling tool_call partners.
    while (start < rest.length) {
      const m = rest[start];
      if (!m || m.role === 'tool') { start++; continue; }              // orphaned result
      if (m.tool_calls && m.tool_calls.length > 0) { start++; continue; } // pair opener without its results yet
      break;
    }

    return [...system, ...rest.slice(start)];
  }

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
   *
   * The input is first windowed (see CONTEXT_WINDOW_MESSAGES) so unbounded
   * sessions stop growing every request.
   */
  private buildMessages(): LlmMessage[] {
    const history = this.windowedHistory();

    // First pass: find any thought_signature across all (windowed) assistant messages
    let globalTs: string | undefined;
    let hasAnyToolCalls = false;
    for (const m of history) {
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
      return pruneMediaForWire(history.map((message) => {
        const tool_calls = message.tool_calls?.map((call) => {
          const fn = { ...call.function };
          if (globalTs && !fn.thought_signature) {
            fn.thought_signature = globalTs;
          }
          return { ...call, function: fn };
        });
        return { ...message, tool_calls };
      }));
    }

    // ── Thought-signature absent → flatten tool_call+tool pairs ────
    // Each assistant(tool_calls) + tool(...) pair is merged into a single
    // assistant text message so Gemini sees only user/assistant turns.
    const result: LlmMessage[] = [];
    let pendingPreText: string | null = null;   // text before the tool_calls
    let pendingCallNames: string[] | null = null; // function names to merge

    for (const m of history) {
      if (!m || typeof m.role !== 'string') continue;
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
        try {
          pendingPreText = llmTextOf(m.content);
        } catch {
          pendingPreText = null;
        }
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

    return pruneMediaForWire(result);
  }

  /**
   * Stop-generation request: set by the UI stop button while streaming.
   * The runLoop checks it (a) between iterations and (b) on every streamed
   * chunk — an aborted request finalizes the partial text honestly instead
   * of hammering the provider to completion.
   */
  private abortRequested = false;

  /** Request the current generation to stop at the next safe point. */
  requestStop(): void {
    this.abortRequested = true;
  }

  private consumeAbort(): boolean {
    const was = this.abortRequested;
    this.abortRequested = false;
    return was;
  }

  /**
   * Stall heartbeat: the timestamp of the last OBSERVED forward progress
   * (cycle start, streamed chunk, finished tool call, new iteration, batch
   * progress report). The UI watchdog compares it against the clock — if the
   * engine claims to be processing but nothing moved for longer than every
   * legitimate timeout on the path (provider 90s, stream watchdog 120s),
   * the cycle is genuinely wedged and must be force-recovered so the user
   * can always type the next request.
   */
  lastProgressAt = 0;

  /**
   * Recovery generation: bumped by every recoverStuck(). Long-running async
   * work (a provider call that finally resolves AFTER the watchdog already
   * recovered the UI) captures the generation at entry and quietly abandons
   * its results when it no longer matches — otherwise the late reply lands
   * on top of the recovered state and confuses the next request.
   */
  recoveryCount = 0;

  touchProgress(): void {
    this.lastProgressAt = Date.now();
  }

  stallSignature(): Record<string, unknown> {
    return {
      iterationCount: this.iterationCount,
      historyLength: this.history.length,
      pendingWrites: this.pendingWriteCalls.length,
      msSinceProgress: Date.now() - this.lastProgressAt,
    };
  }

  /**
   * Force-recover a wedged cycle: stop any in-flight generation, clear the
   * busy flag (which re-enables the input), and leave an honest message.
   * Called ONLY by the UI stall watchdog — never by the engine itself.
   */
  recoverStuck(message: string): void {
    const sig = this.stallSignature();
    console.warn('[ai] stall watchdog: no engine progress for', sig.msSinceProgress, 'ms — forcing recovery', sig);
    this.abortRequested = true;
    this.failedWriteAttempts.clear();
    this.recoveryCount++;
    this.store().addMessage({ role: 'assistant', kind: 'error', content: message });
    this.store().setProcessing(false);
    this.touchProgress();
  }

  async runLoop(): Promise<void> {
    // Orphaned work from before a watchdog recovery must die quietly —
    // its results belong to a session the UI already moved past.
    const myEpoch = this.recoveryCount;
    while (this.iterationCount < MAX_ITERATIONS) {
      if (myEpoch !== this.recoveryCount) return;
      // User pressed stop between turns — end the loop gracefully.
      if (this.consumeAbort()) {
        this.emitStoppedNotice();
        return;
      }

      this.iterationCount++;
      this.touchProgress();

      const llmTools = toLlmTools(getVisibleTools());

      // Try push-based streaming first, then fall back to non-streaming
      let response: { success: boolean; data?: LlmCompletionData; error?: string };
      let streamingId: string | null = null;
      // Tracks whether the streaming placeholder received real text content.
      // If so, the placeholder IS the final assistant bubble — adding a second
      // message below would render the same text twice.
      let streamedContent = false;

      try {
        traceSend('stream-start');
        const streamGen = aiApi.startStream({
          companyId: this.ctx.companyId,
          messages: this.buildMessages(),
          tools: llmTools.length > 0 ? llmTools : undefined,
          temperature: 0.2,
          maxTokens: MAX_COMPLETION_TOKENS,
        });

        // Add a streaming placeholder so the user sees content appear
        streamingId = this.store().addMessage({
          role: 'assistant',
          kind: 'text',
          content: '',
        });

        const chunks: LlmStreamChunk[] = [];
        // Incremental accumulation + rAF-throttled flushes: re-joining every
        // chunk was O(n²) and each chunk triggered a full message-list render.
        const sid = streamingId;
        let contentAcc = '';
        let flushScheduled = false;
        const scheduleFlush = () => {
          if (flushScheduled) return;
          flushScheduled = true;
          const run = () => {
            flushScheduled = false;
            this.store().updateMessageContent(sid, stripImitationToolBlocks(contentAcc));
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
          else setTimeout(run, 16);
        };

        // Stream watchdog: race the drain against a hard ceiling. A stuck
        // `for await` (lost done-event, dead IPC, hung provider) can NOT be
        // freed by generator.return() — a pending next() stays pending — so
        // the timed-out drain is ABANDONED, not awaited. Its late settlement,
        // if any, only touches the placeholder id + local array: harmless
        // after we fall through to the complete() fallback below.
        // Returns 'stopped' when the user pressed stop mid-stream.
        const drainStream = async (): Promise<'drained' | 'stopped'> => {
          for await (const chunk of streamGen) {
            // Stop button: finalize the partial text and end the request.
            if (this.abortRequested) {
              this.abortRequested = false;
              // Drain the generator so its cleanup (listener removal) runs.
              void streamGen.return?.({ success: false, error: 'stopped' }).catch(() => {});
              if (streamedContent && streamingId) {
                this.store().updateMessageContent(streamingId, stripImitationToolBlocks(contentAcc));
              }
              return 'stopped';
            }
            chunks.push(chunk);
            this.touchProgress();
            if (chunk.type === 'content' && chunk.content) {
              if (!streamedContent) traceSend('first-chunk');
              streamedContent = true;
              contentAcc += chunk.content;
              scheduleFlush();
            }
          }
          return 'drained';
        };
        const drainOutcome = await Promise.race([
          drainStream(),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), STREAM_TOTAL_TIMEOUT_MS)),
        ]);
        traceSend(`stream-end:${drainOutcome}`);
        if (drainOutcome === 'timeout') {
          void streamGen.return?.({ success: false, error: 'stream timeout' }).catch(() => {});
          throw new Error('انتهت مهلة البث (120 ثانية) دون اكتمال — تم التحويل للطلب المباشر');
        }
        if (drainOutcome === 'stopped') {
          this.store().addMessage({
            role: 'assistant',
            kind: 'text',
            content: '⏹️ أوقفت التوليد بطلبك — المحتوى أعلاه جزئي.',
          });
          return;
        }

        if (chunks.length > 0) {
          response = { success: true, data: reconstructResponseFromChunks(chunks) };
        } else {
          // Empty stream — fall back to non-streaming, remove placeholder
          this.store().removeMessage(streamingId);
          this.touchProgress();
          response = await aiApi.complete({
            companyId: this.ctx.companyId,
            messages: this.buildMessages(),
            tools: llmTools.length > 0 ? llmTools : undefined,
            temperature: 0.2,
            maxTokens: MAX_COMPLETION_TOKENS,
          });
          this.touchProgress();
        }
      } catch {
        // Streaming failed — remove placeholder, fall back to non-streaming
        if (streamingId) {
          this.store().removeMessage(streamingId);
        }
        this.touchProgress();
        response = await aiApi.complete({
          companyId: this.ctx.companyId,
          messages: this.buildMessages(),
          tools: llmTools.length > 0 ? llmTools : undefined,
          temperature: 0.2,
          maxTokens: MAX_COMPLETION_TOKENS,
        });
        this.touchProgress();
      }

      // A watchdog recovery happened while the provider call was in flight —
      // drop its results instead of writing them over the recovered state.
      if (myEpoch !== this.recoveryCount) return;

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

      // A streaming placeholder with no text content would linger as an
      // empty bubble whenever the reply carries only tool calls (the
      // toolCalls branch below never renders text). Remove it here; the
      // text branch reuses it for the final sanitized content.
      if (streamingId && !streamedContent) {
        this.store().removeMessage(streamingId);
      }

      // If no tool calls → final text response
      if (data.toolCalls.length === 0) {
        const raw = data.content ?? '';
        if (!raw) {
          // Empty streamed placeholder would linger otherwise
          if (streamedContent && streamingId) this.store().removeMessage(streamingId);
          return;
        }

        // ── Anti-fabrication guard ────────────────────────────────────
        // A final reply must never CLAIM a business action (document
        // created/posted, voucher paid…) unless a write tool ACTUALLY
        // executed during this request. Models drifting off the tool loop
        // imitate earlier success summaries with invented document numbers —
        // those replies are removed and the model is forced to either call
        // the real tool or honestly say nothing was done.
        if (this.successfulWritesThisSend.size === 0 && claimsBusinessAction(raw)) {
          await this.correctFabricatedReply(streamingId, streamedContent);
          return;
        }
        // Silent stripping of imitation blocks also hides failed attempts:
        // if the model emitted textual fake tool-calls, correct it too.
        if (stripImitationToolBlocks(raw) !== raw && this.successfulWritesThisSend.size === 0) {
          await this.correctFabricatedReply(streamingId, streamedContent);
          return;
        }

        const cleaned = stripImitationToolBlocks(raw);
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
        return;
      }

      // Separate read vs write tool calls.
      // FAIL-CLOSED: only tools that are registered AND explicitly 'read'
      // take the silent path. Unknown names (model hallucination) default to
      // WRITE so they always require user confirmation instead of executing
      // unattended.
      const readCalls: typeof data.toolCalls = [];
      const writeCalls: typeof data.toolCalls = [];

      for (const tc of data.toolCalls) {
        const tool = resolveTool(tc.name);
        if (tool && tool.dangerLevel === 'read') {
          readCalls.push(tc);
        } else {
          writeCalls.push(tc);
        }
      }

      // Execute read tools in parallel (they're independent — no shared state)
      const readOutcomes = await Promise.all(
        readCalls.map(async (tc) => {
          const outcome = await executeToolCall(tc.name, tc.arguments, this.ctx);
          return { tc, outcome };
        })
      );
      if (myEpoch !== this.recoveryCount) return;
      this.touchProgress();

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

        // Failed reads reach the model WITH structured guidance (code + reason
        // + fixHint) so it explains the failure and proposes the next step
        // instead of parroting the raw error string.
        this.history.push({
          role: 'tool',
          content: outcome.ok
            ? compactToolResultForLlm(outcome.result)
            : `خطأ: ${outcome.error}${outcome.errorClass ? `\n${renderErrorGuidance(outcome.errorClass)}` : ''}`,
          tool_call_id: tc.id,
        });
      }

      // Every finished tool call is forward progress (matters to the stall
      // watchdog: a long chain of slow-but-completing tools must not look
      // wedged).
      this.touchProgress();

      // Handle write tools → emit confirmation cards and STOP loop.
      // IDENTICAL-RETRY GUARD: a write that already failed this send with the
      // SAME arguments gets no more confirmation cards — the model is stuck in
      // a loop (approve → fail → re-issue verbatim). Surface honest errors and
      // stop instead of asking the user to approve the doomed call again.
      if (writeCalls.length > 0) {
        this.pendingWriteCalls = [];
        const exhausted: Array<{ name: string; error: string }> = [];
        const confirmable: typeof writeCalls = [];

        for (const tc of writeCalls) {
          const key = ChatEngine.writeAttemptKey(tc.name, tc.arguments);
          const failures = this.failedWriteAttempts.get(key) ?? 0;
          if (failures >= ChatEngine.WRITE_RETRY_LIMIT) {
            exhausted.push({
              name: tc.name,
              error: `توقف تلقائي: استدعاء ${tc.name} بنفس المعطيات فشل ${failures} مرات — لن يُطلب موافقتك مجدداً على نفس العملية. عدّل المعطيات أو نفّذها من الشاشة مباشرة.`,
            });
          } else {
            confirmable.push(tc);
          }
        }

        for (const ex of exhausted) {
          this.history.push({
            role: 'tool',
            content: `خطأ: ${ex.error}`,
            tool_call_id: `exhausted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          });
          this.store().addMessage({
            role: 'assistant',
            kind: 'error',
            content: ex.error,
          });
        }

        if (confirmable.length === 0) {
          // Every write is a verbatim retry of a failed call — stop here with
          // an honest summary instead of looping back into the LLM.
          return;
        }

        for (const tc of confirmable) {
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

          const messageId = this.store().addMessage({
            role: 'assistant',
            kind: 'tool',
            content: '',
            toolCall: pending,
          });

          // Enrich the confirmation card asynchronously: resolve raw UUID
          // args (customerId/productId…) into human names/numbers so the user
          // approves SUBSTANCE, not "المعرف: 3f2a1b9c…". Best-effort — the
          // card stays fully functional with the plain summary alone.
          void resolveArgsForCard(tc.arguments, this.ctx).then((labels) => {
            if (labels.length === 0) return;
            this.store().updateToolCall(messageId, {
              argsSummary: [pending.argsSummary, ...labels].filter(Boolean).join(' — '),
            });
          }).catch(() => { /* best-effort enrichment */ });
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
      content:
        'توقّف قبل إكمال الطلب لأنه تجاوز الحد الأقصى لخطوات التنفيذ. ما نُفِّذ فعلاً يظهر فقط في بطاقات الأدوات أعلاه — لا شيء إضافي. جرّب تقسيم الطلب إلى خطوات أصغر.',
    });
  }

  /** Honest partial-output notice when the user stops between iterations. */
  private emitStoppedNotice(): void {
    this.store().addMessage({
      role: 'assistant',
      kind: 'text',
      content: '⏹️ أوقفت التنفيذ بطلبك. ما نُفِّذ فعلاً يظهر في بطاقات الأدوات أعلاه فقط.',
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
      // Nested objects/arrays must NEVER hit String() (yields the infamous
      // "[object Object]") — render compact JSON instead.
      const text = typeof v === 'object' ? safeJson(v) : String(v);
      lines.push(`${icon} ${label}: ${text}`);
    }
  }

  return lines.join('\n');
}

/** Compact JSON for nested values inside cards — never String(obj). */
function safeJson(v: unknown): string {
  try {
    const json = JSON.stringify(v);
    return json.length <= 300 ? json : `${json.slice(0, 300)}…`;
  } catch {
    return '؟';
  }
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
/**
 * Compact a raw tool result before feeding it back into the LLM context.
 *
 * Full JSON dumps of search/report results bloat the context window every
 * iteration (slower responses, higher token cost, and eventually provider
 * rejections). Best practice (OpenAI/Anthropic agent guidance): keep tool
 * payloads small — strip noisy internal fields and cap the serialized size,
 * marking the truncation explicitly so the model knows data was elided.
 */
const TOOL_RESULT_MAX_CHARS = 4000;
const NOISY_FIELDS = new Set([
  'companyId', 'company_id', 'createdBy', 'created_by', 'updatedBy', 'updated_by',
  'createdAt', 'created_at', 'updatedAt', 'updated_at', 'openingBalancePosted',
  'opening_balance_posted', 'isActive', 'is_active', 'passwordHash',
]);
// NOTE: `notes` is deliberately NOT stripped — in search results it can carry
// the business WHY (rejection reason, reference, memo). Only truly internal
// audit/tenant plumbing is noise for the model.

function compactToolResultForLlm(result: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(result, (key, value) => (NOISY_FIELDS.has(key) ? undefined : value));
  } catch {
    return '✅ تم بنجاح';
  }
  if (json.length <= TOOL_RESULT_MAX_CHARS) return json;

  // Try trimming array payloads first (search/list tools) so the model keeps
  // whole items rather than a cut-off JSON fragment.
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    for (const key of ['matches', 'items', 'data']) {
      const arr = obj[key];
      if (Array.isArray(arr) && arr.length > 3) {
        const trimmed = { ...obj, [key]: arr.slice(0, 3), truncated: true, totalAvailable: arr.length };
        try {
          json = JSON.stringify(trimmed, (k, v) => (NOISY_FIELDS.has(k) ? undefined : v));
          if (json.length <= TOOL_RESULT_MAX_CHARS) {
            return `${json}\n(تم اقتطاع النتيجة — ${arr.length} عنصراً متاحاً؛ استخدم بحثاً أدق لرؤية البقية)`;
          }
        } catch { /* fall through */ }
      }
    }
  }
  return json.slice(0, TOOL_RESULT_MAX_CHARS) + '\n…(نتيجة كبيرة تم اقتصاصها)';
}

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
