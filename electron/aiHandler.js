import { ipcMain, safeStorage } from 'electron';
import { getPool } from './dbHandler.js';

/**
 * AI Harness — LLM proxy (Electron main process).
 *
 * Security model:
 * - The provider API key NEVER reaches the renderer. It is either supplied via
 *   the AI_API_KEY env var (dev/ops) or stored in the per-company `settings`
 *   table encrypted with Electron safeStorage (OS keychain).
 * - Renderer only sees a masked key (sk-...****) and a `hasApiKey` flag.
 * - All channels return `{ success, ... } | { success: false, error }` and
 *   never throw across IPC (same convention as dbHandler.js).
 *
 * Provider support: any OpenAI-compatible Chat Completions endpoint
 * (OpenAI, OpenRouter, Groq, Together, Ollama `/v1`, LM Studio ...).
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

const ENC_PREFIX = 'enc:v1:';

// Do not let a renderer turn the AI proxy into an SSRF primitive or exfiltrate
// its API key to an arbitrary endpoint. Self-hosted providers can be enabled
// explicitly through AI_ALLOWED_HOSTS (comma-separated).
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
const configuredProviderHosts = (process.env.AI_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
for (const host of configuredProviderHosts) DEFAULT_PROVIDER_HOSTS.add(host);

// In-memory cache of decrypted API keys, isolated per company.
const cachedApiKeys = new Map();

// ─── Settings persistence (via shared pg pool) ──────────────────────────────

async function readAiSettings(companyId) {
  const pool = getPool();
  if (!pool || !companyId) return {};
  const result = await pool.query(
    'SELECT key, value FROM settings WHERE company_id = $1 AND category = $2',
    [companyId, AI_CATEGORY]
  );
  const map = {};
  for (const row of result.rows) map[row.key] = row.value;
  return map;
}

async function upsertAiSetting(companyId, key, value) {
  const pool = getPool();
  if (!pool) throw new Error('Database not available');
  await pool.query(
    `INSERT INTO settings (company_id, key, value, category)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [companyId, key, value, AI_CATEGORY]
  );
}

// ─── API key management ─────────────────────────────────────────────────────

function encryptApiKey(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  }
  throw new Error('تشفير نظام التشغيل غير متاح لحفظ مفتاح الذكاء الاصطناعي');
}

function decryptApiKey(stored) {
  if (!stored) return null;
  try {
    if (stored.startsWith(ENC_PREFIX)) {
      const payload = stored.slice(ENC_PREFIX.length);
      return safeStorage.decryptString(Buffer.from(payload, 'base64'));
    }
    // Refuse legacy plaintext values. They must be re-entered and encrypted.
    return null;
  } catch {
    return null;
  }
}

async function resolveApiKey(companyId) {
  // Priority 1: environment variable (never stored anywhere).
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
  // Priority 2: in-memory cache (avoids repeated keychain prompts).
  const cachedApiKey = cachedApiKeys.get(companyId);
  if (cachedApiKey) return cachedApiKey;
  // Priority 3: encrypted value in the settings table.
  const settings = await readAiSettings(companyId);
  const decrypted = decryptApiKey(settings[KEY_SETTING]);
  if (decrypted) cachedApiKeys.set(companyId, decrypted);
  return decrypted;
}

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Provider HTTP calls ────────────────────────────────────────────────────

function normalizeBaseUrl(url) {
  const normalized = (url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('عنوان مزود الذكاء الاصطناعي غير صالح');
  }
  const localProvider = DEFAULT_PROVIDER_HOSTS.has(parsed.hostname.toLowerCase())
    && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(localProvider && parsed.protocol === 'http:')) {
    throw new Error('يجب أن يستخدم مزود الذكاء الاصطناعي HTTPS');
  }
  if (!DEFAULT_PROVIDER_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('مزود الذكاء الاصطناعي غير مسموح به');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function callChatCompletion({ baseUrl, apiKey, model, messages, tools, temperature, maxTokens, timeoutMs }) {
  const body = {
    model,
    messages,
    temperature: temperature ?? 0.2,
    max_tokens: maxTokens ?? 2048,
  };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
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
          // Preserve ONLY extra function props (e.g. Gemini thought_signature).
          // name/arguments live at top level so the chat engine can read them directly.
          const extras = {};
          if (tc?.function && typeof tc.function === 'object') {
            for (const key of Object.keys(tc.function)) {
              if (key !== 'name' && key !== 'arguments') extras[key] = tc.function[key];
            }
          }
          return {
            id: tc.id,
            name: tc?.function?.name,
            arguments: safeParseArgs(tc?.function?.arguments),
            function: extras,
          };
        })
      : [];
    // Gemini sometimes returns thought_signature at the message level (not per
    // tool call). When that happens, propagate it to every tool call's function
    // extras so the chat engine can attach it to the assistant message history.
    if (message.thought_signature && toolCalls.length > 0) {
      const ts = message.thought_signature;
      for (const tc of toolCalls) {
        tc.function = tc.function || {};
        tc.function.thought_signature = ts;
      }
    }

    return {
      success: true,
      data: {
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        finishReason: choice.finish_reason || null,
        usage: data.usage || null,
      },
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { success: false, error: 'انتهت مهلة الاتصال بمزود الذكاء الاصطناعي (timeout)' };
    }
    return { success: false, error: `تعذر الاتصال بمزود الذكاء الاصطناعي: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function safeParseArgs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// ─── Streaming Provider HTTP calls ───────────────────────────────────────────

async function* callChatCompletionStream({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  temperature,
  maxTokens,
  timeoutMs,
}) {
  const body = {
    model,
    messages,
    temperature: temperature ?? 0.2,
    max_tokens: maxTokens ?? 2048,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      const msg = text?.slice(0, 300) || `HTTP ${res.status}`;
      throw new Error(`LLM provider error (${res.status}): ${msg}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalUsage = null;

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
            const chunk = JSON.parse(payload);
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};
            const finishReason = choice.finish_reason;

            // Usage can appear in the final chunk (OpenAI stream_options)
            if (chunk.usage) finalUsage = chunk.usage;

            if (delta.content) {
              yield { type: 'content', content: delta.content };
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield { type: 'tool_call_delta', toolCall: tc };
              }
            }
            // Gemini sometimes returns thought_signature on the message level (not
            // on the function object). Forward it as a special "extras" chunk
            // so the renderer can attach it to the corresponding tool call.
            // Also check choice.thought_signature because Gemini's OpenAI-compatible
            // endpoint can put it there instead of delta or chunk level.
            const ts = delta.thought_signature || chunk.thought_signature || choice?.thought_signature;
            if (ts) {
              yield {
                type: 'tool_call_extra',
                thoughtSignature: ts,
              };
            }
            if (finishReason) {
              yield { type: 'finish', finishReason, usage: finalUsage };
            }
          } catch {
            // ignore parse errors for malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بمزود الذكاء الاصطناعي (timeout)');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider HTTP calls (non-streaming, kept for test-connection) ───────────

function isValidMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 && messages.length <= 100 &&
    messages.every((m) => m && typeof m.role === 'string' &&
      (typeof m.content !== 'string' || m.content.length <= 20_000))
  );
}

// ─── Chat persistence (ai_chat_sessions + ai_chat_messages) ─────────────────

function isValidChatMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        (m.role === 'user' || m.role === 'assistant') &&
        (m.kind === 'text' || m.kind === 'tool' || m.kind === 'error') &&
        typeof m.createdAt === 'number'
    )
  );
}

/** Replace-all save: upsert session header, then rewrite its messages atomically. */
async function persistSession({ companyId, userId, sessionId, title, messages }) {
  const pool = getPool();
  if (!pool) throw new Error('Database not available');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let sid = sessionId || null;
    if (sid) {
      const upd = await client.query(
        `UPDATE ai_chat_sessions
            SET title = $3, message_count = $4, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $5::uuid
        RETURNING id`,
        [sid, companyId, title, messages.length, userId]
      );
      if (upd.rows.length === 0) sid = null; // stale/foreign session — create new
    }

    if (!sid) {
      const ins = await client.query(
        `INSERT INTO ai_chat_sessions (company_id, user_id, title, message_count)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         RETURNING id`,
        [companyId, userId, title, messages.length]
      );
      sid = ins.rows[0].id;
    } else {
      await client.query(
        'DELETE FROM ai_chat_messages WHERE session_id = $1::uuid AND company_id = $2::uuid',
        [sid, companyId]
      );
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      await client.query(
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

    await client.query('COMMIT');
    return sid;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── IPC registration ───────────────────────────────────────────────────────

export function registerAiHandlers() {
  // Get current AI configuration for a company (key masked).
  ipcMain.handle('ai:get-config', async (_event, { companyId } = {}) => {
    try {
      const settings = await readAiSettings(companyId);
      const envKey = process.env.AI_API_KEY || null;
      const storedKey = settings[KEY_SETTING] ? decryptApiKey(settings[KEY_SETTING]) : null;
      const apiKey = envKey || storedKey;
      return {
        success: true,
        data: {
          provider: settings[PROVIDER_SETTING] || 'openai',
          baseUrl: settings[BASE_URL_SETTING] || DEFAULT_BASE_URL,
          model: settings[MODEL_SETTING] || DEFAULT_MODEL,
          enabled: settings[ENABLED_SETTING] !== 'false',
          hasApiKey: Boolean(apiKey),
          maskedKey: maskKey(envKey || storedKey),
          keySource: envKey ? 'env' : storedKey ? 'db' : null,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Save AI configuration. apiKey is optional — omitted means "keep current".
  ipcMain.handle('ai:save-config', async (_event, payload = {}) => {
    try {
      const { companyId, provider, baseUrl, model, apiKey, enabled } = payload;
      if (!companyId) return { success: false, error: 'companyId is required' };

      if (provider !== undefined) await upsertAiSetting(companyId, PROVIDER_SETTING, String(provider));
      if (baseUrl !== undefined) await upsertAiSetting(companyId, BASE_URL_SETTING, normalizeBaseUrl(String(baseUrl || DEFAULT_BASE_URL)));
      if (model !== undefined) await upsertAiSetting(companyId, MODEL_SETTING, String(model || DEFAULT_MODEL));
      if (enabled !== undefined) await upsertAiSetting(companyId, ENABLED_SETTING, enabled ? 'true' : 'false');

      if (typeof apiKey === 'string' && apiKey.trim()) {
        await upsertAiSetting(companyId, KEY_SETTING, encryptApiKey(apiKey.trim()));
        cachedApiKeys.set(companyId, apiKey.trim());
      } else if (apiKey === '') {
        // Explicit empty string clears the key.
        await upsertAiSetting(companyId, KEY_SETTING, '');
        cachedApiKeys.delete(companyId);
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Test connectivity with the configured (or provided) credentials.
  ipcMain.handle('ai:test-connection', async (_event, payload = {}) => {
    try {
      const { companyId, baseUrl, model, apiKey } = payload;
      const key = apiKey || (await resolveApiKey(companyId));
      if (!key) return { success: false, error: 'لا يوجد مفتاح API — أدخل المفتاح أولاً' };

      const settings = await readAiSettings(companyId);
      const result = await callChatCompletion({
        baseUrl: baseUrl || settings[BASE_URL_SETTING] || DEFAULT_BASE_URL,
        apiKey: key,
        model: model || settings[MODEL_SETTING] || DEFAULT_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      if (!result.success) return result;
      return { success: true, data: { model: model || settings[MODEL_SETTING] || DEFAULT_MODEL } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Main completion endpoint used by the chat engine.
  ipcMain.handle('ai:complete', async (_event, payload = {}) => {
    try {
      const { companyId, messages, tools, temperature, maxTokens } = payload;
      if (!companyId) return { success: false, error: 'companyId is required' };
      if (!isValidMessages(messages)) return { success: false, error: 'messages must be a non-empty array' };
      if (Array.isArray(tools) && tools.length > 50) return { success: false, error: 'too many tools' };
      if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) return { success: false, error: 'invalid temperature' };
      if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)) return { success: false, error: 'invalid maxTokens' };

      const settings = await readAiSettings(companyId);
      if (settings[ENABLED_SETTING] === 'false') {
        return { success: false, error: 'المساعد الذكي معطّل — فعّله من إعدادات الذكاء الاصطناعي' };
      }

      const apiKey = await resolveApiKey(companyId);
      if (!apiKey) {
        return { success: false, error: 'لم يتم ضبط مفتاح API — افتح إعدادات الذكاء الاصطناعي' };
      }

      return await callChatCompletion({
        baseUrl: settings[BASE_URL_SETTING] || DEFAULT_BASE_URL,
        apiKey,
        model: settings[MODEL_SETTING] || DEFAULT_MODEL,
        messages,
        tools,
        temperature,
        maxTokens,
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Push-based streaming completion — chunks are sent individually via
  // event.sender.send so the renderer can update the UI in real-time.
  ipcMain.on('ai:start-stream', async (event, payload = {}) => {
    try {
      const { companyId, messages, tools, temperature, maxTokens } = payload;
      if (!companyId) {
        event.sender.send('ai:stream-done', { success: false, error: 'companyId is required' });
        return;
      }
      if (!isValidMessages(messages)) {
        event.sender.send('ai:stream-done', { success: false, error: 'messages must be a non-empty array' });
        return;
      }
      if (Array.isArray(tools) && tools.length > 50) {
        event.sender.send('ai:stream-done', { success: false, error: 'too many tools' });
        return;
      }
      if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
        event.sender.send('ai:stream-done', { success: false, error: 'invalid temperature' });
        return;
      }
      if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)) {
        event.sender.send('ai:stream-done', { success: false, error: 'invalid maxTokens' });
        return;
      }

      const settings = await readAiSettings(companyId);
      if (settings[ENABLED_SETTING] === 'false') {
        event.sender.send('ai:stream-done', { success: false, error: 'المساعد الذكي معطّل — فعّله من إعدادات الذكاء الاصطناعي' });
        return;
      }

      const apiKey = await resolveApiKey(companyId);
      if (!apiKey) {
        event.sender.send('ai:stream-done', { success: false, error: 'لم يتم ضبط مفتاح API — افتح إعدادات الذكاء الاصطناعي' });
        return;
      }

      const stream = callChatCompletionStream({
        baseUrl: settings[BASE_URL_SETTING] || DEFAULT_BASE_URL,
        apiKey,
        model: settings[MODEL_SETTING] || DEFAULT_MODEL,
        messages,
        tools,
        temperature,
        maxTokens,
      });

      for await (const chunk of stream) {
        event.sender.send('ai:stream-chunk', chunk);
      }
      event.sender.send('ai:stream-done', { success: true });
    } catch (err) {
      event.sender.send('ai:stream-done', { success: false, error: err.message });
    }
  });

  // List chat sessions for the current user (newest first).
  ipcMain.handle('ai:list-sessions', async (_event, { companyId, userId } = {}) => {
    try {
      if (!companyId || !userId) return { success: false, error: 'companyId and userId are required' };
      const pool = getPool();
      if (!pool) return { success: false, error: 'Database not available' };
      const result = await pool.query(
        `SELECT id, title, message_count, created_at, updated_at
           FROM ai_chat_sessions
          WHERE company_id = $1::uuid AND user_id = $2::uuid
          ORDER BY updated_at DESC
          LIMIT 50`,
        [companyId, userId]
      );
      return {
        success: true,
        data: result.rows.map((r) => ({
          id: r.id,
          title: r.title,
          messageCount: Number(r.message_count) || 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Load all messages of a session (ordered by sort_order).
  ipcMain.handle('ai:get-session-messages', async (_event, { companyId, sessionId } = {}) => {
    try {
      if (!companyId || !sessionId) return { success: false, error: 'companyId and sessionId are required' };
      const pool = getPool();
      if (!pool) return { success: false, error: 'Database not available' };
      const result = await pool.query(
        `SELECT id, role, kind, content, tool_call, sort_order, created_at
           FROM ai_chat_messages
          WHERE session_id = $1::uuid AND company_id = $2::uuid
          ORDER BY sort_order ASC`,
        [sessionId, companyId]
      );
      return {
        success: true,
        data: result.rows.map((r) => ({
          id: r.id,
          role: r.role,
          kind: r.kind,
          content: r.content || '',
          toolCall: r.tool_call || undefined,
          createdAt: new Date(r.created_at).getTime(),
        })),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Save (create or replace) a chat session with its messages.
  ipcMain.handle('ai:save-session', async (_event, payload = {}) => {
    try {
      const { companyId, userId, sessionId, title, messages } = payload;
      if (!companyId || !userId) return { success: false, error: 'companyId and userId are required' };
      if (!isValidChatMessages(messages)) return { success: false, error: 'messages must be a valid chat array' };
      const safeTitle = typeof title === 'string' ? title.slice(0, 200) : null;
      const sid = await persistSession({ companyId, userId, sessionId, title: safeTitle, messages });
      return { success: true, data: { sessionId: sid } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Delete a session (messages cascade).
  ipcMain.handle('ai:delete-session', async (_event, { companyId, userId, sessionId } = {}) => {
    try {
      if (!companyId || !sessionId) return { success: false, error: 'companyId and sessionId are required' };
      const pool = getPool();
      if (!pool) return { success: false, error: 'Database not available' };
      await pool.query(
        'DELETE FROM ai_chat_sessions WHERE id = $1::uuid AND company_id = $2::uuid AND user_id = $3::uuid',
        [sessionId, companyId, userId]
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
