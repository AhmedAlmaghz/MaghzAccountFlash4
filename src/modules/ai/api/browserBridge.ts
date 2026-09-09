import { getDbAdapter } from '@/core/database/adapters';
import { useAuthStore } from '@/modules/auth/store';
import type {
  AiChatSessionSummary,
  AiPublicConfig,
  AiSaveConfigPayload,
  AiSaveSessionPayload,
  ChatMessage,
  LlmCompletionData,
  LlmMessage,
  LlmStreamChunk,
  LlmTool,
} from '../types';
import type {
  JobBatchDetail,
  JobBatchItem,
  JobBatchItemInput,
  JobBatchSummary,
} from './batchTypes';
import {
  BATCH_CLAIM_LIMIT,
  BATCH_CREATE_CHUNK,
  BATCH_MAX_ATTEMPTS,
} from './batchTypes';

/**
 * Browser-side AI bridge (PGlite mode).
 *
 * In Electron the LLM proxy runs in the main process (aiHandler.js) so the
 * API key never reaches the renderer and is encrypted with safeStorage.
 * In pure browser/PGlite mode there is no main process, so this module
 * implements the same `window.electronAI` surface directly:
 *   - Settings are persisted in the `settings` table (category='ai').
 *   - The API key is stored in the local PGlite DB (same trust boundary as
 *     the rest of the app's data — it never leaves the machine).
 *   - Chat sessions use the same ai_chat_sessions / ai_chat_messages tables.
 *
 * Security note: unlike Electron, the key is not OS-encrypted. It is only
 * stored in the browser's local database (IndexedDB). This is acceptable for
 * a local-first app, but users should prefer the desktop build for shared
 * machines.
 */

const AI_CATEGORY = 'ai';
const KEY_SETTING = 'ai.api_key';
const PROVIDER_SETTING = 'ai.provider';
const BASE_URL_SETTING = 'ai.base_url';
const MODEL_SETTING = 'ai.model';
const ENABLED_SETTING = 'ai.enabled';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const REQUEST_TIMEOUT_MS = 90000;
const TEST_TIMEOUT_MS = 30000;

// Same allow-list as aiHandler.js — prevents SSRF / key exfiltration.
const DEFAULT_PROVIDER_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.together.xyz',
  'generativelanguage.googleapis.com',
  'localhost',
  '127.0.0.1',
  '::1',
]);

function normalizeBaseUrl(url: string): string {
  const normalized = (url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('عنوان مزود الذكاء الاصطناعي غير صالح');
  }
  const host = parsed.hostname.toLowerCase();
  const localProvider = DEFAULT_PROVIDER_HOSTS.has(host) && ['localhost', '127.0.0.1', '::1'].includes(host);
  if (parsed.protocol !== 'https:' && !(localProvider && parsed.protocol === 'http:')) {
    throw new Error('يجب أن يستخدم مزود الذكاء الاصطناعي HTTPS');
  }
  if (!DEFAULT_PROVIDER_HOSTS.has(host)) {
    throw new Error('مزود الذكاء الاصطناعي غير مسموح به');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Settings persistence (via the active DB adapter) ──────────────────────

async function readAiSettings(companyId: string): Promise<Record<string, string>> {
  const adapter = await getDbAdapter();
  const result = await adapter.query<{ key: string; value: string | null }>(
    'SELECT key, value FROM settings WHERE company_id = $1 AND category = $2',
    [companyId, AI_CATEGORY]
  );
  const map: Record<string, string> = {};
  for (const row of result.rows || []) {
    if (row.value != null) map[row.key] = row.value;
  }
  return map;
}

/** Settings read with a hard ceiling: a wedged local DB must surface an
 * honest error, never an eternal spinner with no chunks and no done. */
const SETTINGS_TIMEOUT_MS = 15_000;
async function readAiSettingsFast(companyId: string): Promise<Record<string, string>> {
  return await Promise.race([
    readAiSettings(companyId),
    new Promise<Record<string, string>>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة قراءة إعدادات الذكاء الاصطناعي — تحقق من قاعدة البيانات المحلية وحاول مجدداً')), SETTINGS_TIMEOUT_MS),
    ),
  ]);
}

async function upsertAiSetting(companyId: string, key: string, value: string): Promise<void> {
  const adapter = await getDbAdapter();
  await adapter.query(
    `INSERT INTO settings (company_id, key, value, category)
     VALUES ($1::uuid, $2, $3, $4)
     ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [companyId, key, value, AI_CATEGORY]
  );
}

// ─── Provider HTTP calls ────────────────────────────────────────────────────

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

async function callChatCompletion(opts: CallOptions): Promise<{ success: boolean; data?: LlmCompletionData; error?: string }> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (Array.isArray(opts.tools) && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: { error?: { message?: string }; message?: string; choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string | null }>; usage?: unknown } | null = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

    if (!res.ok) {
      if (res.status === 429) {
        return { success: false, error: 'انتهت حصة الذكاء الاصطناعي مؤقتاً (429) — انتظر دقيقة ثم قل "تابع". الدفعات الجارية محفوظة وتُستأنف من حيث توقفت.' };
      }
      if (res.status === 503 || res.status === 529) {
        return { success: false, error: `مزود الذكاء الاصطناعي مثقل حالياً (${res.status}) — انتظر قليلاً ثم أعد المحاولة. لا شيء نُفِّذ أو فُقد.` };
      }
      const msg = data?.error?.message || data?.message || text?.slice(0, 300) || `HTTP ${res.status}`;
      return { success: false, error: `LLM provider error (${res.status}): ${msg}` };
    }

    const choice = data?.choices?.[0];
    if (!choice) return { success: false, error: 'LLM provider returned an empty response' };

    const message = choice.message || {};
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map((tc) => {
          const fn = (tc as { function?: { name?: string; arguments?: string; [k: string]: unknown } }).function || {};
          const extras: Record<string, unknown> = {};
          for (const key of Object.keys(fn)) {
            if (key !== 'name' && key !== 'arguments') extras[key] = fn[key];
          }
          return {
            id: (tc as { id?: string }).id || `call_${(crypto.randomUUID()).slice(9, 23).replace(/-/g, '')}`,
            name: fn.name || '',
            arguments: safeParseArgs(fn.arguments),
            function: extras,
          };
        })
      : [];

    return {
      success: true,
      data: {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        finishReason: choice.finish_reason || null,
        usage: (data?.usage as LlmCompletionData['usage']) || null,
      },
    };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { success: false, error: 'انتهت مهلة الاتصال بمزود الذكاء الاصطناعي (timeout)' };
    }
    return { success: false, error: `تعذر الاتصال بمزود الذكاء الاصطناعي: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

// ─── Streaming ──────────────────────────────────────────────────────────────

type ChunkCallback = (chunk: LlmStreamChunk) => void;
type DoneCallback = (result: { success: boolean; error?: string }) => void;

// Per-stream routing: each stream owns its handlers + AbortController so a
// stale/abandoned stream can never deliver into — or abort — another one.
// The 'legacy' key preserves the old singleton behavior for callers that
// predate stream ids.
const streamSubs = new Map<string, { onChunk?: ChunkCallback; onDone?: DoneCallback }>();
const streamControllers = new Map<string, AbortController>();
const LEGACY_STREAM_KEY = 'legacy';

function emitChunk(chunk: LlmStreamChunk, streamId?: string): void {
  const sub = streamSubs.get(streamId || LEGACY_STREAM_KEY);
  if (sub?.onChunk) sub.onChunk(chunk);
}

function emitDone(result: { success: boolean; error?: string }, streamId?: string): void {
  const sub = streamSubs.get(streamId || LEGACY_STREAM_KEY);
  if (sub?.onDone) sub.onDone(result);
}

function trackController(streamId: string | undefined, controller: AbortController): void {
  streamControllers.set(streamId || LEGACY_STREAM_KEY, controller);
}

function untrackController(streamId: string | undefined): void {
  streamControllers.delete(streamId || LEGACY_STREAM_KEY);
}

async function runStream(opts: CallOptions & { streamId?: string }): Promise<void> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2048,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (Array.isArray(opts.tools) && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  trackController(opts.streamId, controller);
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const msg = text?.slice(0, 300) || `HTTP ${res.status}`;
      emitDone({ success: false, error: `LLM provider error (${res.status}): ${msg}` }, opts.streamId);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalUsage: LlmStreamChunk['usage'] = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{
                delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string; thought_signature?: string } }>; thought_signature?: string };
                finish_reason?: string | null;
                thought_signature?: string;
              }>;
              usage?: LlmStreamChunk['usage'];
              thought_signature?: string;
            };
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};
            const finishReason = choice.finish_reason;

            if (chunk.usage) finalUsage = chunk.usage;

            if (delta.content) {
              emitChunk({ type: 'content', content: delta.content }, opts.streamId);
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                emitChunk(
                  {
                    type: 'tool_call_delta',
                    toolCall: {
                      index: tc.index ?? 0,
                      id: tc.id,
                      function: tc.function
                        ? {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                            thought_signature: tc.function.thought_signature,
                          } as { name?: string; arguments?: string; thought_signature?: string }
                        : undefined,
                    },
                  },
                  opts.streamId,
                );
              }
            }
            const ts = delta.thought_signature || chunk.thought_signature || choice?.thought_signature;
            if (ts) {
              emitChunk({ type: 'tool_call_extra', thoughtSignature: ts }, opts.streamId);
            }
            if (finishReason) {
              emitChunk({ type: 'finish', finishReason, usage: finalUsage }, opts.streamId);
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    emitDone({ success: true }, opts.streamId);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      emitDone({ success: false, error: 'انتهت مهلة الاتصال بمزود الذكاء الاصطناعي (timeout)' }, opts.streamId);
    } else {
      emitDone({ success: false, error: `تعذر الاتصال بمزود الذكاء الاصطناعي: ${(err as Error).message}` }, opts.streamId);
    }
  } finally {
    clearTimeout(timer);
    untrackController(opts.streamId);
  }
}

// ─── Chat persistence ──────────────────────────────────────────────────────

const ATTACHMENT_KINDS = new Set(['image', 'pdf', 'spreadsheet', 'audio', 'other']);

function isValidChatMessageAttachments(attachments: unknown): boolean {
  return (
    attachments === undefined ||
    attachments === null ||
    (Array.isArray(attachments) &&
      (attachments as Array<Record<string, unknown>>).every(
        (a) =>
          a &&
          typeof a.id === 'string' &&
          typeof a.name === 'string' &&
          typeof a.sha256 === 'string' &&
          ATTACHMENT_KINDS.has(a.kind as string)
      ))
  );
}

function parseBatchResultData(raw: unknown): Record<string, string | number | boolean> | null {
  try {
    const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
    return val as Record<string, string | number | boolean>;
  } catch {
    return null;
  }
}

function parseMessageAttachments(raw: unknown): ChatMessage['attachments'] {
  try {
    const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(val) || val.length === 0) return undefined;
    if (!isValidChatMessageAttachments(val)) return undefined;
    return val as ChatMessage['attachments'];
  } catch {
    return undefined;
  }
}

function isValidChatMessages(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.every(
      (m) =>
        m &&
        typeof (m as ChatMessage).id === 'string' &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
        ((m as ChatMessage).kind === 'text' || (m as ChatMessage).kind === 'tool' || (m as ChatMessage).kind === 'error') &&
        typeof (m as ChatMessage).createdAt === 'number' &&
        isValidChatMessageAttachments((m as ChatMessage).attachments)
    )
  );
}

async function persistSession(payload: AiSaveSessionPayload): Promise<string> {
  const adapter = await getDbAdapter();
  const { companyId, userId, sessionId, title, messages } = payload;
  const safeTitle = typeof title === 'string' ? title.slice(0, 200) : null;

  let sid: string | null = sessionId || null;
  // Title is written on INSERT only: renameSession is the sole title writer
  // (autosaves always rewrite title from deriveTitle, so updating it here
  // would silently clobber every user rename on the next background save).
  if (sid) {
    const upd = await adapter.query(
      `UPDATE ai_chat_sessions
          SET message_count = $3, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $4::uuid
        RETURNING id`,
      [sid, companyId, messages.length, userId]
    );
    if (!upd.success || !upd.rows || upd.rows.length === 0) sid = null;
  }

  if (!sid) {
    const ins = await adapter.query(
      `INSERT INTO ai_chat_sessions (company_id, user_id, title, message_count)
       VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING id`,
      [companyId, userId, safeTitle, messages.length]
    );
    if (!ins.success || !ins.rows || ins.rows.length === 0) throw new Error(ins.error || 'Failed to create session');
    sid = String((ins.rows[0] as { id: unknown }).id);
  } else {
    await adapter.query(
      'DELETE FROM ai_chat_messages WHERE session_id = $1::uuid AND company_id = $2::uuid',
      [sid, companyId]
    );
  }

  // Batched multi-row INSERT (9 params/row) — one round-trip per 100 messages
  // instead of one per message. Attachments persist as metadata + extracted
  // text only; binaries stay in the renderer's registry.
  const BATCH_SIZE = 100;
  for (let start = 0; start < messages.length; start += BATCH_SIZE) {
    const batch = messages.slice(start, start + BATCH_SIZE);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    batch.forEach((m, i) => {
      const base = i * 9;
      placeholders.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::jsonb, $${base + 8}, $${base + 9}::timestamptz)`
      );
      params.push(
        companyId,
        sid,
        m.role,
        m.kind,
        m.content || null,
        m.toolCall ? JSON.stringify(m.toolCall) : null,
        Array.isArray(m.attachments) && m.attachments.length > 0 ? JSON.stringify(m.attachments) : null,
        start + i,
        new Date(m.createdAt).toISOString()
      );
    });
    const res = await adapter.query(
      `INSERT INTO ai_chat_messages
         (company_id, session_id, role, kind, content, tool_call, attachments, sort_order, created_at)
       VALUES ${placeholders.join(', ')}`,
      params
    );
    if (!res.success) throw new Error(res.error || 'Failed to save chat messages');
  }

  return sid;
}

// ─── Public surface (mirrors window.electronAI) ─────────────────────────────

export const browserAiBridge = {
  async getConfig(companyId: string): Promise<{ success: boolean; data?: AiPublicConfig; error?: string }> {
    try {
      const settings = await readAiSettingsFast(companyId);
      const apiKey = settings[KEY_SETTING] || null;
      return {
        success: true,
        data: {
          provider: settings[PROVIDER_SETTING] || 'gemini',
          baseUrl: settings[BASE_URL_SETTING] || DEFAULT_BASE_URL,
          model: settings[MODEL_SETTING] || DEFAULT_MODEL,
          enabled: settings[ENABLED_SETTING] !== 'false',
          hasApiKey: !!apiKey,
          maskedKey: maskKey(apiKey),
          keySource: apiKey ? 'db' : null,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async saveConfig(payload: AiSaveConfigPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const { companyId } = payload;
      if (!companyId) return { success: false, error: 'companyId is required' };
      if (payload.provider !== undefined) await upsertAiSetting(companyId, PROVIDER_SETTING, payload.provider);
      if (payload.baseUrl !== undefined) await upsertAiSetting(companyId, BASE_URL_SETTING, payload.baseUrl);
      if (payload.model !== undefined) await upsertAiSetting(companyId, MODEL_SETTING, payload.model);
      if (payload.enabled !== undefined) await upsertAiSetting(companyId, ENABLED_SETTING, String(payload.enabled));
      if (payload.apiKey) await upsertAiSetting(companyId, KEY_SETTING, payload.apiKey);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async testConnection(payload: {
    companyId: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }): Promise<{ success: boolean; data?: { model: string }; error?: string }> {
    try {
      const settings = await readAiSettingsFast(payload.companyId);
      const apiKey = payload.apiKey || settings[KEY_SETTING];
      if (!apiKey) return { success: false, error: 'لم يتم ضبط مفتاح API — افتح إعدادات الذكاء الاصطناعي' };
      const baseUrl = payload.baseUrl || settings[BASE_URL_SETTING] || DEFAULT_BASE_URL;
      const model = payload.model || settings[MODEL_SETTING] || DEFAULT_MODEL;

      const result = await callChatCompletion({
        baseUrl,
        apiKey,
        model,
        messages: [{ role: 'user', content: 'ping' }],
        timeoutMs: TEST_TIMEOUT_MS,
      });
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: { model } } as { success: boolean; data: { model: string } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async complete(payload: {
    companyId: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ success: boolean; data?: LlmCompletionData; error?: string }> {
    try {
      const settings = await readAiSettingsFast(payload.companyId);
      const apiKey = settings[KEY_SETTING];
      if (!apiKey) return { success: false, error: 'لم يتم ضبط مفتاح API — افتح إعدادات الذكاء الاصطناعي' };
      const baseUrl = settings[BASE_URL_SETTING] || DEFAULT_BASE_URL;
      const model = settings[MODEL_SETTING] || DEFAULT_MODEL;

      return await callChatCompletion({
        baseUrl,
        apiKey,
        model,
        messages: payload.messages,
        tools: payload.tools,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
      });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  startStream(payload: {
    companyId: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    temperature?: number;
    maxTokens?: number;
    streamId?: string;
  }): void {
    void (async () => {
      try {
        // A wedged local DB must never hang the chat silently (no chunks, no
        // done, spinner forever): bound the settings read, then let the
        // provider call's own timeout own the rest of the budget.
        const settings = await readAiSettingsFast(payload.companyId);
        const apiKey = settings[KEY_SETTING];
        if (!apiKey) {
          emitDone({ success: false, error: 'لم يتم ضبط مفتاح API — افتح إعدادات الذكاء الاصطناعي' }, payload.streamId);
          return;
        }
        const baseUrl = settings[BASE_URL_SETTING] || DEFAULT_BASE_URL;
        const model = settings[MODEL_SETTING] || DEFAULT_MODEL;
        await runStream({
          baseUrl,
          apiKey,
          model,
          messages: payload.messages,
          tools: payload.tools,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
          streamId: payload.streamId,
        });
      } catch (err) {
        emitDone({ success: false, error: (err as Error).message }, payload.streamId);
      }
    })();
  },

  onStreamChunk(callback: ChunkCallback): void {
    const prev = streamSubs.get(LEGACY_STREAM_KEY) || {};
    streamSubs.set(LEGACY_STREAM_KEY, { ...prev, onChunk: callback });
  },

  onStreamDone(callback: DoneCallback): void {
    const prev = streamSubs.get(LEGACY_STREAM_KEY) || {};
    streamSubs.set(LEGACY_STREAM_KEY, { ...prev, onDone: callback });
  },

  removeStreamListeners(): void {
    streamSubs.delete(LEGACY_STREAM_KEY);
    const controller = streamControllers.get(LEGACY_STREAM_KEY);
    if (controller) {
      try { controller.abort(); } catch { /* ignore */ }
      streamControllers.delete(LEGACY_STREAM_KEY);
    }
  },

  /**
   * Per-stream subscription: routes only this stream's chunks/done to the
   * handlers. Returns an unsubscribe that also aborts the stream's fetch.
   */
  subscribeStream(streamId: string, onChunk: ChunkCallback, onDone: DoneCallback): () => void {
    streamSubs.set(streamId, { onChunk, onDone });
    return () => {
      streamSubs.delete(streamId);
      const controller = streamControllers.get(streamId);
      if (controller) {
        try { controller.abort(); } catch { /* ignore */ }
        streamControllers.delete(streamId);
      }
    };
  },

  /** Abort a single live stream without touching the others. */
  stopStream(payload: { streamId: string }): void {
    const controller = streamControllers.get(payload.streamId);
    if (controller) {
      try { controller.abort(); } catch { /* ignore */ }
      streamControllers.delete(payload.streamId);
    }
    streamSubs.delete(payload.streamId);
  },

  async listSessions(payload: { companyId: string; userId: string }): Promise<{ success: boolean; data?: AiChatSessionSummary[]; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query<{
        id: string;
        title: string | null;
        message_count: number;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, title, message_count, created_at, updated_at
           FROM ai_chat_sessions
          WHERE company_id = $1::uuid AND user_id = $2::uuid
          ORDER BY updated_at DESC
          LIMIT 50`,
        [payload.companyId, payload.userId]
      );
      return {
        success: true,
        data: (result.rows || []).map((r) => ({
          id: r.id,
          title: r.title,
          messageCount: Number(r.message_count) || 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async getSessionMessages(payload: { companyId: string; sessionId: string }): Promise<{ success: boolean; data?: ChatMessage[]; error?: string }> {
    try {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return { success: false, error: 'No authenticated user' };
      const adapter = await getDbAdapter();
      const result = await adapter.query<{
        id: string;
        role: string;
        kind: string;
        content: string | null;
        tool_call: unknown;
        attachments: unknown;
        created_at: string;
      }>(
        `SELECT m.id, m.role, m.kind, m.content, m.tool_call, m.attachments, m.created_at
           FROM ai_chat_messages m
           JOIN ai_chat_sessions s ON s.id = m.session_id
          WHERE m.session_id = $1::uuid AND m.company_id = $2::uuid AND s.user_id = $3::uuid
          ORDER BY m.sort_order ASC`,
        [payload.sessionId, payload.companyId, userId]
      );
      return {
        success: true,
        data: (result.rows || []).map((r) => ({
          id: r.id,
          role: r.role as ChatMessage['role'],
          kind: r.kind as ChatMessage['kind'],
          content: r.content || '',
          toolCall: r.tool_call as ChatMessage['toolCall'],
          attachments: parseMessageAttachments(r.attachments),
          createdAt: new Date(r.created_at).getTime(),
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async saveSession(payload: AiSaveSessionPayload): Promise<{ success: boolean; data?: { sessionId: string }; error?: string }> {
    try {
      if (!isValidChatMessages(payload.messages)) return { success: false, error: 'messages must be a valid chat array' };
      const sid = await persistSession(payload);
      return { success: true, data: { sessionId: sid } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async renameSession(payload: { sessionId: string; title: string; companyId?: string; userId?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `UPDATE ai_chat_sessions
            SET title = $2, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $3::uuid AND user_id = $4::uuid
        RETURNING id`,
        [payload.sessionId, payload.title.trim().slice(0, 200), payload.companyId ?? null, payload.userId ?? null]
      );
      if (!result.success) return { success: false, error: result.error };
      if (!result.rows || result.rows.length === 0) return { success: false, error: 'Session not found' };
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async deleteSession(payload: { companyId: string; userId: string; sessionId: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'DELETE FROM ai_chat_sessions WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $3::uuid',
        [payload.sessionId, payload.companyId, payload.userId]
      );
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  // ─── Job queue (mirrors the ai:batch-* IPC channels) ────────────────────
  // Same SQL shapes as electron/aiHandler.js — single-user browser DB, so
  // sequential adapter.query calls replace the main-process transactions.

  async batchCreate(payload: {
    companyId: string; userId: string; title?: string | null; kind?: string;
    sessionId?: string | null; items: JobBatchItemInput[];
  }): Promise<{ success: boolean; data?: { batchId: string; total: number; inserted: number }; error?: string }> {
    try {
      const { companyId, userId, items } = payload;
      if (!Array.isArray(items) || items.length === 0) return { success: false, error: 'items must be a non-empty array' };
      if (items.length > BATCH_CREATE_CHUNK) return { success: false, error: 'items exceeds 500 per call — enqueue in chunks' };
      const adapter = await getDbAdapter();
      const header = await adapter.query<{ id: string }>(
        `INSERT INTO ai_job_batches (company_id, user_id, session_id, kind, title, total_count, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'pending')
         RETURNING id`,
        [
          companyId, userId,
          payload.sessionId || null,
          (payload.kind || 'mixed').slice(0, 40),
          (payload.title || null) as string | null,
          items.length,
        ]
      );
      if (!header.success || !header.rows || header.rows.length === 0) {
        return { success: false, error: header.error || 'Failed to create batch' };
      }
      const batchId = String(header.rows[0].id);
      const placeholders: string[] = [];
      const params: unknown[] = [batchId, companyId];
      items.forEach((it, i) => {
        const base = 2 + i * 7;
        placeholders.push(`($2::uuid, $1::uuid, $${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
        params.push(i, it.tool_name.slice(0, 120), JSON.stringify(it.args), it.after_seq, it.idempotency_key.slice(0, 200), it.label ? it.label.slice(0, 200) : null, it.ref ? it.ref.slice(0, 100) : null);
      });
      const ins = await adapter.query<{ id: string }>(
        `INSERT INTO ai_job_items
           (company_id, batch_id, seq, tool_name, args, after_seq, idempotency_key, label, ref)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (batch_id, idempotency_key) DO NOTHING
         RETURNING id`,
        params
      );
      if (!ins.success) return { success: false, error: ins.error };
      return { success: true, data: { batchId, total: items.length, inserted: (ins.rows || []).length } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchClaim(payload: { companyId: string; userId: string; batchId: string; limit?: number }): Promise<{ success: boolean; data?: JobBatchItem[]; error?: string }> {
    try {
      const take = Math.max(1, Math.min(Number(payload.limit) || 10, BATCH_CLAIM_LIMIT));
      const adapter = await getDbAdapter();
      const res = await adapter.query<{
        id: string; seq: number; tool_name: string; args: unknown; after_seq: number | null; label: string | null; ref: string | null; attempts: number;
      }>(
        `WITH claimed AS (
           SELECT i.id FROM ai_job_items i
           WHERE i.batch_id = $1::uuid AND i.company_id = $2::uuid AND i.status = 'queued'
             AND i.attempts < 4
             AND (i.after_seq IS NULL OR i.after_seq IN (
               SELECT seq FROM ai_job_items WHERE batch_id = $1::uuid AND status = 'done'
             ))
             AND EXISTS (
               SELECT 1 FROM ai_job_batches b
               WHERE b.id = $1::uuid AND b.company_id = $2::uuid
                 AND b.user_id = $4::uuid AND b.status IN ('pending', 'running')
             )
           ORDER BY i.seq LIMIT $3
           FOR UPDATE SKIP LOCKED
         ),
         updated AS (
           UPDATE ai_job_items u SET status = 'running', attempts = u.attempts + 1, updated_at = NOW()
           FROM claimed WHERE u.id = claimed.id
           RETURNING u.id
         )
         SELECT i.id, i.seq, i.tool_name, i.args, i.after_seq, i.label, i.ref, i.attempts
           FROM ai_job_items i JOIN updated ON updated.id = i.id
          ORDER BY i.seq`,
        [payload.batchId, payload.companyId, take, payload.userId]
      );
      if (!res.success) return { success: false, error: res.error };
      await adapter.query(
        `UPDATE ai_job_batches SET status = 'running', updated_at = NOW()
         WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $3::uuid AND status = 'pending'`,
        [payload.batchId, payload.companyId, payload.userId]
      );
      return {
        success: true,
        data: (res.rows || []).map((r) => ({
          id: String(r.id),
          seq: Number(r.seq),
          toolName: String(r.tool_name),
          args: (typeof r.args === 'string' ? JSON.parse(r.args) : (r.args || {})) as Record<string, unknown>,
          afterSeq: r.after_seq === null ? null : Number(r.after_seq),
          label: r.label || null,
          ref: r.ref || null,
          resultData: null,
          status: 'queued' as const,
          attempts: Number(r.attempts) || 0,
          lastError: null,
          errorCode: null,
          resultRef: null,
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchItemDone(payload: {
    companyId: string; userId: string; batchId: string; itemId: string; resultRef?: string | null; resultData?: Record<string, string | number | boolean> | null;
  }): Promise<{ success: boolean; data?: { finalStatus: string | null }; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      let resultJson: string | null = null;
      try {
        const raw = JSON.stringify(payload.resultData ?? null);
        resultJson = raw && raw.length <= 2000 ? raw : null;
      } catch { resultJson = null; }
      const upd = await adapter.query<{ updated: string }>(
        `WITH upd AS (
           UPDATE ai_job_items SET status = 'done', result_ref = $4, result_data = $6::jsonb, updated_at = NOW()
           WHERE id = $1::uuid AND batch_id = $2::uuid AND company_id = $3::uuid AND status = 'running'
           RETURNING id
         )
         UPDATE ai_job_batches b SET done_count = done_count + (SELECT COUNT(*) FROM upd), updated_at = NOW()
         WHERE b.id = $2::uuid AND b.company_id = $3::uuid AND b.user_id = $5::uuid
         RETURNING (SELECT COUNT(*) FROM upd) AS updated`,
        [payload.itemId, payload.batchId, payload.companyId, payload.resultRef ? payload.resultRef.slice(0, 200) : null, payload.userId, resultJson]
      );
      if (!upd.success || !upd.rows || Number(upd.rows[0].updated) === 0) {
        return { success: false, error: 'Item not found or not running' };
      }
      const fin = await adapter.query<{ status: string }>(
        `UPDATE ai_job_batches
            SET status = CASE WHEN (failed_count + skipped_count) > 0 THEN 'partial' ELSE 'done' END,
                updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'running'
            AND NOT EXISTS (
              SELECT 1 FROM ai_job_items
              WHERE batch_id = $1::uuid AND status IN ('queued', 'running')
            )
          RETURNING status`,
        [payload.batchId, payload.companyId]
      );
      return { success: true, data: { finalStatus: fin.rows && fin.rows[0] ? String(fin.rows[0].status) : null } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchItemFail(payload: {
    companyId: string; userId: string; batchId: string; itemId: string;
    error?: string; errorCode?: string | null; retryable?: boolean;
  }): Promise<{ success: boolean; data?: { retried: boolean; attempts?: number; skipped?: number; finalStatus?: string | null }; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const cur = await adapter.query<{ seq: number; attempts: number }>(
        `SELECT i.seq, i.attempts FROM ai_job_items i
          JOIN ai_job_batches b ON b.id = i.batch_id
         WHERE i.id = $1::uuid AND i.batch_id = $2::uuid AND i.company_id = $3::uuid
           AND b.user_id = $4::uuid AND i.status = 'running'`,
        [payload.itemId, payload.batchId, payload.companyId, payload.userId]
      );
      if (!cur.success || !cur.rows || cur.rows.length === 0) {
        return { success: false, error: 'Item not found or not running' };
      }
      const failedSeq = Number(cur.rows[0].seq);
      const attempts = Number(cur.rows[0].attempts) || 0;
      const safeError = (payload.error || 'خطأ غير معروف').slice(0, 2000);
      const safeCode = payload.errorCode ? payload.errorCode.slice(0, 40) : null;
      if (payload.retryable !== false && attempts < BATCH_MAX_ATTEMPTS) {
        await adapter.query(
          `UPDATE ai_job_items SET status = 'queued', last_error = $2, error_code = $3, updated_at = NOW()
           WHERE id = $1::uuid`,
          [payload.itemId, safeError, safeCode]
        );
        return { success: true, data: { retried: true, attempts } };
      }
      await adapter.query(
        `UPDATE ai_job_items SET status = 'failed', last_error = $2, error_code = $3, updated_at = NOW()
         WHERE id = $1::uuid`,
        [payload.itemId, safeError, safeCode]
      );
      const skipped = await adapter.query<{ seq: number }>(
        `WITH RECURSIVE doomed(seq) AS (
           SELECT seq FROM ai_job_items WHERE batch_id = $1::uuid AND after_seq = $2
           UNION
           SELECT i.seq FROM ai_job_items i JOIN doomed d ON i.after_seq = d.seq
           WHERE i.batch_id = $1::uuid
         )
         UPDATE ai_job_items SET status = 'skipped',
           last_error = 'تخطي: فشل عنصر يعتمد عليه', updated_at = NOW()
         WHERE batch_id = $1::uuid AND company_id = $3::uuid AND status = 'queued'
           AND seq IN (SELECT seq FROM doomed)
         RETURNING seq`,
        [payload.batchId, failedSeq, payload.companyId]
      );
      const skippedCount = skipped.rows ? skipped.rows.length : 0;
      await adapter.query(
        `UPDATE ai_job_batches SET failed_count = failed_count + 1,
           skipped_count = skipped_count + $2, updated_at = NOW()
         WHERE id = $1::uuid AND company_id = $3::uuid AND user_id = $4::uuid`,
        [payload.batchId, skippedCount, payload.companyId, payload.userId]
      );
      const fin = await adapter.query<{ status: string }>(
        `UPDATE ai_job_batches
            SET status = CASE WHEN (failed_count + skipped_count) > 0 THEN 'partial' ELSE 'done' END,
                updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'running'
            AND NOT EXISTS (
              SELECT 1 FROM ai_job_items
              WHERE batch_id = $1::uuid AND status IN ('queued', 'running')
            )
          RETURNING status`,
        [payload.batchId, payload.companyId]
      );
      return {
        success: true,
        data: { retried: false, skipped: skippedCount, finalStatus: fin.rows && fin.rows[0] ? String(fin.rows[0].status) : null },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchSetStatus(payload: {
    companyId: string; userId: string; batchId: string; status: 'paused' | 'running' | 'cancelled';
  }): Promise<{ success: boolean; data?: { status: string; skipped: number }; error?: string }> {
    try {
      const allowed: Record<string, string[]> = {
        paused: ['pending', 'running'],
        running: ['paused'],
        cancelled: ['pending', 'running', 'paused'],
      };
      if (!allowed[payload.status]) return { success: false, error: 'status must be paused, running or cancelled' };
      const adapter = await getDbAdapter();
      const upd = await adapter.query<{ status: string }>(
        `UPDATE ai_job_batches SET status = $3, updated_at = NOW()
         WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $4::uuid
           AND status = ANY ($5)
         RETURNING status`,
        [payload.batchId, payload.companyId, payload.status, payload.userId, allowed[payload.status]]
      );
      if (!upd.success || !upd.rows || upd.rows.length === 0) {
        return { success: false, error: upd.success ? 'Batch not found or transition not allowed' : upd.error };
      }
      let skipped = 0;
      if (payload.status === 'cancelled') {
        const res = await adapter.query(
          `UPDATE ai_job_items SET status = 'skipped',
             last_error = 'تخطي: أُلغيت الدفعة', updated_at = NOW()
           WHERE batch_id = $1::uuid AND company_id = $2::uuid AND status IN ('queued', 'running')
           RETURNING seq`,
          [payload.batchId, payload.companyId]
        );
        skipped = res.rows ? res.rows.length : 0;
        await adapter.query(
          `UPDATE ai_job_batches SET skipped_count = skipped_count + $2, updated_at = NOW()
           WHERE id = $1::uuid`,
          [payload.batchId, skipped]
        );
      }
      return { success: true, data: { status: payload.status, skipped } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchRecover(payload: {
    companyId: string; userId: string; batchId: string;
  }): Promise<{ success: boolean; data?: { recoveredFailed: number; recoveredSkipped: number; finalStatus: string | null }; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const res = await adapter.query<{ failed: string; skipped: string }>(
        `WITH RECURSIVE stale AS (
           UPDATE ai_job_items SET status = 'failed',
             last_error = 'توقف التنفيذ — انقطع الـ worker (تعطل الجلسة أو إغلاق التطبيق)',
             error_code = 'INTERRUPTED', updated_at = NOW()
           WHERE batch_id = $1::uuid AND company_id = $2::uuid AND status = 'running'
           RETURNING seq
         ),
         doomed(seq) AS (
           SELECT seq FROM ai_job_items WHERE batch_id = $1::uuid AND after_seq IN (SELECT seq FROM stale)
           UNION
           SELECT i.seq FROM ai_job_items i JOIN doomed d ON i.after_seq = d.seq
           WHERE i.batch_id = $1::uuid
         ),
         skipped AS (
           UPDATE ai_job_items SET status = 'skipped',
             last_error = 'تخطي: توقف عنصر يعتمد عليه', updated_at = NOW()
           WHERE batch_id = $1::uuid AND company_id = $2::uuid AND status = 'queued'
             AND seq IN (SELECT seq FROM doomed)
           RETURNING seq
         )
         UPDATE ai_job_batches b
            SET failed_count = failed_count + (SELECT COUNT(*) FROM stale),
                skipped_count = skipped_count + (SELECT COUNT(*) FROM skipped),
                updated_at = NOW()
          WHERE b.id = $1::uuid AND b.company_id = $2::uuid AND b.user_id = $3::uuid
            AND b.status IN ('pending', 'running', 'paused')
         RETURNING (SELECT COUNT(*) FROM stale) AS failed,
                   (SELECT COUNT(*) FROM skipped) AS skipped`,
        [payload.batchId, payload.companyId, payload.userId]
      );
      if (!res.success) return { success: false, error: res.error };
      const row = (res.rows || [])[0];
      const fin = await adapter.query<{ status: string }>(
        `UPDATE ai_job_batches
            SET status = CASE WHEN (failed_count + skipped_count) > 0 THEN 'partial' ELSE 'done' END,
                updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'running'
            AND NOT EXISTS (
              SELECT 1 FROM ai_job_items
              WHERE batch_id = $1::uuid AND status IN ('queued', 'running')
            )
          RETURNING status`,
        [payload.batchId, payload.companyId]
      );
      return {
        success: true,
        data: {
          recoveredFailed: row ? Number(row.failed) || 0 : 0,
          recoveredSkipped: row ? Number(row.skipped) || 0 : 0,
          finalStatus: fin.rows && fin.rows[0] ? String(fin.rows[0].status) : null,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchRetryFailed(payload: {
    companyId: string; userId: string; batchId: string;
  }): Promise<{ success: boolean; data?: { requeued: number }; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const requeued = await adapter.query(
        `UPDATE ai_job_items SET status = 'queued', attempts = 0,
           last_error = NULL, error_code = NULL, updated_at = NOW()
         WHERE batch_id = $1::uuid AND company_id = $2::uuid AND status = 'failed'
         RETURNING seq`,
        [payload.batchId, payload.companyId]
      );
      if (!requeued.success || !requeued.rows || requeued.rows.length === 0) {
        return { success: false, error: requeued.success ? 'No failed items to retry' : requeued.error };
      }
      await adapter.query(
        `UPDATE ai_job_batches SET status = 'running',
           failed_count = failed_count - $2, updated_at = NOW()
         WHERE id = $1::uuid AND company_id = $3::uuid AND user_id = $4::uuid
           AND status IN ('partial', 'paused')`,
        [payload.batchId, requeued.rows.length, payload.companyId, payload.userId]
      );
      return { success: true, data: { requeued: requeued.rows.length } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchGet(payload: {
    companyId: string; userId: string; batchId: string;
  }): Promise<{ success: boolean; data?: JobBatchDetail; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const header = await adapter.query<{
        id: string; kind: string; title: string | null; total_count: number;
        done_count: number; failed_count: number; skipped_count: number;
        status: string; created_at: string; updated_at: string;
      }>(
        `SELECT id, kind, title, total_count, done_count, failed_count, skipped_count,
                status, created_at, updated_at
           FROM ai_job_batches
          WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $3::uuid`,
        [payload.batchId, payload.companyId, payload.userId]
      );
      if (!header.success || !header.rows || header.rows.length === 0) {
        return { success: false, error: header.success ? 'Batch not found' : header.error };
      }
      const items = await adapter.query<{
        id: string; seq: number; tool_name: string; args: unknown; after_seq: number | null;
        label: string | null; ref: string | null; status: string; attempts: number; last_error: string | null;
        error_code: string | null; result_ref: string | null; result_data: unknown;
      }>(
        `SELECT id, seq, tool_name, args, after_seq, label, ref, status, attempts,
                last_error, error_code, result_ref, result_data
           FROM ai_job_items
          WHERE batch_id = $1::uuid AND company_id = $2::uuid
          ORDER BY seq ASC`,
        [payload.batchId, payload.companyId]
      );
      if (!items.success) return { success: false, error: items.error };
      const h = header.rows[0];
      return {
        success: true,
        data: {
          id: String(h.id),
          kind: String(h.kind),
          title: h.title,
          totalCount: Number(h.total_count) || 0,
          doneCount: Number(h.done_count) || 0,
          failedCount: Number(h.failed_count) || 0,
          skippedCount: Number(h.skipped_count) || 0,
          status: h.status as JobBatchDetail['status'],
          createdAt: String(h.created_at),
          updatedAt: String(h.updated_at),
          items: (items.rows || []).map((r) => ({
            id: String(r.id),
            seq: Number(r.seq),
            toolName: String(r.tool_name),
            args: (typeof r.args === 'string' ? JSON.parse(r.args) : (r.args || {})) as Record<string, unknown>,
            afterSeq: r.after_seq === null ? null : Number(r.after_seq),
            label: r.label || null,
            ref: r.ref || null,
            status: r.status as JobBatchItem['status'],
            attempts: Number(r.attempts) || 0,
            lastError: r.last_error,
            errorCode: r.error_code,
            resultRef: r.result_ref,
            resultData: parseBatchResultData(r.result_data),
          })),
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async batchList(payload: {
    companyId: string; userId: string; status?: string;
  }): Promise<{ success: boolean; data?: JobBatchSummary[]; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const params: unknown[] = [payload.companyId, payload.userId];
      let where = 'WHERE company_id = $1::uuid AND user_id = $2::uuid';
      if (payload.status) {
        params.push(payload.status.slice(0, 20));
        where += ' AND status = $3';
      }
      const res = await adapter.query<{
        id: string; kind: string; title: string | null; total_count: number;
        done_count: number; failed_count: number; skipped_count: number;
        status: string; created_at: string; updated_at: string;
      }>(
        `SELECT id, kind, title, total_count, done_count, failed_count, skipped_count,
                status, created_at, updated_at
           FROM ai_job_batches ${where}
          ORDER BY updated_at DESC
          LIMIT 20`,
        params
      );
      if (!res.success) return { success: false, error: res.error };
      return {
        success: true,
        data: (res.rows || []).map((h) => ({
          id: String(h.id),
          kind: String(h.kind),
          title: h.title,
          totalCount: Number(h.total_count) || 0,
          doneCount: Number(h.done_count) || 0,
          failedCount: Number(h.failed_count) || 0,
          skippedCount: Number(h.skipped_count) || 0,
          status: h.status as JobBatchSummary['status'],
          createdAt: String(h.created_at),
          updatedAt: String(h.updated_at),
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};
