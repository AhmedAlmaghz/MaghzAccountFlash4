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
            id: (tc as { id?: string }).id || `call_${Math.random().toString(36).slice(2, 10)}`,
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

let chunkCallback: ChunkCallback | null = null;
let doneCallback: DoneCallback | null = null;
let streamAbort: AbortController | null = null;

function emitChunk(chunk: LlmStreamChunk): void {
  if (chunkCallback) chunkCallback(chunk);
}

function emitDone(result: { success: boolean; error?: string }): void {
  if (doneCallback) doneCallback(result);
}

async function runStream(opts: CallOptions): Promise<void> {
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
  streamAbort = controller;
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
      emitDone({ success: false, error: `LLM provider error (${res.status}): ${msg}` });
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
              emitChunk({ type: 'content', content: delta.content });
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                emitChunk({
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
                });
              }
            }
            const ts = delta.thought_signature || chunk.thought_signature || choice?.thought_signature;
            if (ts) {
              emitChunk({ type: 'tool_call_extra', thoughtSignature: ts });
            }
            if (finishReason) {
              emitChunk({ type: 'finish', finishReason, usage: finalUsage });
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    emitDone({ success: true });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      emitDone({ success: false, error: 'انتهت مهلة الاتصال بمزود الذكاء الاصطناعي (timeout)' });
    } else {
      emitDone({ success: false, error: `تعذر الاتصال بمزود الذكاء الاصطناعي: ${(err as Error).message}` });
    }
  } finally {
    clearTimeout(timer);
    streamAbort = null;
  }
}

// ─── Chat persistence ──────────────────────────────────────────────────────

function isValidChatMessages(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.every(
      (m) =>
        m &&
        typeof (m as ChatMessage).id === 'string' &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
        ((m as ChatMessage).kind === 'text' || (m as ChatMessage).kind === 'tool' || (m as ChatMessage).kind === 'error') &&
        typeof (m as ChatMessage).createdAt === 'number'
    )
  );
}

async function persistSession(payload: AiSaveSessionPayload): Promise<string> {
  const adapter = await getDbAdapter();
  const { companyId, userId, sessionId, title, messages } = payload;
  const safeTitle = typeof title === 'string' ? title.slice(0, 200) : null;

  let sid: string | null = sessionId || null;
  if (sid) {
    const upd = await adapter.query(
      `UPDATE ai_chat_sessions
          SET title = $3, message_count = $4, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $5::uuid
        RETURNING id`,
      [sid, companyId, safeTitle, messages.length, userId]
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

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    await adapter.query(
      `INSERT INTO ai_chat_messages
         (company_id, session_id, role, kind, content, tool_call, sort_order, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)`,
      [
        companyId,
        sid,
        m.role,
        m.kind,
        m.content || null,
        m.toolCall ? JSON.stringify(m.toolCall) : null,
        i,
        new Date(m.createdAt).toISOString(),
      ]
    );
  }

  return sid;
}

// ─── Public surface (mirrors window.electronAI) ─────────────────────────────

export const browserAiBridge = {
  async getConfig(companyId: string): Promise<{ success: boolean; data?: AiPublicConfig; error?: string }> {
    try {
      const settings = await readAiSettings(companyId);
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
      const settings = await readAiSettings(payload.companyId);
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
      const settings = await readAiSettings(payload.companyId);
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
  }): void {
    void (async () => {
      try {
        const settings = await readAiSettings(payload.companyId);
        const apiKey = settings[KEY_SETTING];
        if (!apiKey) {
          emitDone({ success: false, error: 'لم يتم ضبط مفتاح API — افتح إعدادات الذكاء الاصطناعي' });
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
        });
      } catch (err) {
        emitDone({ success: false, error: (err as Error).message });
      }
    })();
  },

  onStreamChunk(callback: ChunkCallback): void {
    chunkCallback = callback;
  },

  onStreamDone(callback: DoneCallback): void {
    doneCallback = callback;
  },

  removeStreamListeners(): void {
    chunkCallback = null;
    doneCallback = null;
    if (streamAbort) {
      try { streamAbort.abort(); } catch { /* ignore */ }
      streamAbort = null;
    }
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
        created_at: string;
      }>(
        `SELECT m.id, m.role, m.kind, m.content, m.tool_call, m.created_at
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
};
