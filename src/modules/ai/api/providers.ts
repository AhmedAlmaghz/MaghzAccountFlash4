/**
 * Provider registry — single source of truth for LLM provider presets (B1).
 *
 * Both transports (Electron main + PGlite browser bridge) speak the
 * OpenAI-compatible `/chat/completions` dialect, so "multi-provider" here
 * means: one preset table (hosts, default models, model-name rules) shared
 * by the settings UI, the save/test validation, and the CI gates — instead
 * of three copies that drift (the page had its own PROVIDERS list, the
 * bridge its host set, the main process its own copy).
 *
 * The `DEFAULT_BASE_URL` / `DEFAULT_MODEL` consts stay declared in
 * electron/aiHandler.js and browserBridge.ts (pinned by
 * providerDefaults.test.ts) — this registry MUST mirror them; the
 * `providers.test.ts` parity test enforces it from the TS side.
 */

export interface ProviderPreset {
  /** Stable id stored in settings (`ai.provider`). */
  id: string;
  /** Canonical base URL (no trailing slash). */
  baseUrl: string;
  /** Default model — must be a REAL catalog model for hosted providers. */
  defaultModel: string;
  /**
   * Model-name rule. `pattern` validates hosted catalog names;
   * `freeform: true` (ollama/custom) accepts any non-empty name since the
   * model list lives on the user's own server.
   */
  pattern?: RegExp;
  freeform?: boolean;
  /** Hostnames that identify this provider (subset of the SSRF allow-list). */
  hosts: string[];
  /** Short hint shown when validation fails (Arabic / English). */
  hintAr: string;
  hintEn: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.5-flash-lite',
    pattern: /^gemini-\d+\.\d+-[a-z-]+$/,
    hosts: ['generativelanguage.googleapis.com'],
    hintAr: 'أسماء نماذج Gemini مثل gemini-3.7-flash أو gemini-3.5-flash-lite أو gemini-3.1-pro',
    hintEn: 'Gemini model names look like gemini-3.5-flash-lite, gemini-3.7-flash or gemini-3.1-pro',
  },
  {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    pattern: /^(gpt-[\w.-]+|o\d+[\w.-]*|chatgpt-[\w.-]+)$/,
    hosts: ['api.openai.com'],
    hintAr: 'أسماء نماذج OpenAI مثل gpt-4o-mini أو gpt-4o أو o3-mini',
    hintEn: 'OpenAI model names look like gpt-4o-mini, gpt-4o or o3-mini',
  },
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-3.-flash-001',
    pattern: /^[\w-]+\/[\w:.-]+$/,
    hosts: ['openrouter.ai'],
    hintAr: 'أسماء OpenRouter بصيغة vendor/model مثل google/gemini-2.0-flash-001',
    hintEn: 'OpenRouter names use vendor/model form, e.g. google/gemini-2.0-flash-001',
  },
  {
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    pattern: /^[\w.-]+$/,
    hosts: ['api.groq.com'],
    hintAr: 'أسماء نماذج Groq مثل llama-3.3-70b-versatile أو mixtral-8x7b-32768',
    hintEn: 'Groq model names look like llama-3.3-70b-versatile',
  },
  {
    id: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    freeform: true,
    hosts: ['localhost', '127.0.0.1', '::1'],
    hintAr: 'أي اسم نموذج مسحوب محلياً (تحقق بـ ollama list)',
    hintEn: 'Any locally pulled model name (check with ollama list)',
  },
  {
    id: 'custom',
    baseUrl: '',
    defaultModel: '',
    freeform: true,
    hosts: [],
    hintAr: 'أي اسم يقبله الخادم المخصص',
    hintEn: 'Any name your custom server accepts',
  },
];

export function getProviderPreset(id: string | null | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** Identify the provider from a base URL host (falls back to 'custom'). */
export function resolveProviderId(baseUrl: string | null | undefined): string {
  if (!baseUrl) return 'custom';
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'custom';
  }
  return PROVIDER_PRESETS.find((p) => p.hosts.includes(host))?.id ?? 'custom';
}

export interface ModelValidation {
  ok: boolean;
  /** Arabic honest error for the UI when !ok. */
  errorAr?: string;
  hintAr?: string;
}

/**
 * Fail-fast model validation: catch a typo'd or catalog-fake model name at
 * save/test time with a helpful hint, instead of a cryptic provider 404 at
 * first chat. Empty model = "use the provider default" (always valid).
 */
/**
 * Model names that NEVER existed in their provider's catalog but look
 * plausible (the classic 'gemini-3.5-flash-lite' incident 404'd every
 * unconfigured install). Rejected with a dedicated message even if the
 * family pattern would otherwise accept them.
 */
const NEVER_EXISTED: Array<{ test: RegExp; name: string }> = [
  { test: /gemini-2\.5/i, name: 'gemini-1.5-*' },
];

export function validateModelForProvider(
  providerId: string | null | undefined,
  model: string | null | undefined,
): ModelValidation {
  const name = (model || '').trim();
  if (!name) return { ok: true };
  const preset = getProviderPreset(providerId);
  const ghost = NEVER_EXISTED.find((g) => g.test.test(name));
  if (ghost) {
    return {
      ok: false,
      errorAr: `النموذج "${name}" غير موجود في كتالوج ${preset.id} — ‏${ghost.name}‏ اسم وهمي لم يصدر أبداً وسيرد المزود 404 عند أول محادثة`,
      hintAr: preset.hintAr,
    };
  }
  if (preset.freeform) {
    return { ok: true };
  }
  if (preset.pattern && preset.pattern.test(name)) return { ok: true };
  return {
    ok: false,
    errorAr: `اسم النموذج "${name}" لا يطابق صيغة نماذج ${preset.id} — سيرد المزود 404 عند أول محادثة`,
    hintAr: preset.hintAr,
  };
}

// ─── Failover (B3) ───────────────────────────────────────────────────
// One extra attempt on a SECOND provider when the primary fails
// transiently (429/503/529/timeout). Non-transient failures (auth, model,
// validation) fail fast — retrying them on another provider only burns
// quota. Both transports (Electron main + browser bridge) implement the
// same rule; the main-process copy is a 3-line duplicate (JS cannot import
// this TS module) and points back here.

/** HTTP statuses worth one failover attempt (mirrors the engine retry set). */
export function isTransientProviderStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 529;
}

/** Classify an error message the same way (timeouts, overloads, quota). */
export function isTransientProviderError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /\b(429|503|529)\b/.test(message) || /انتهت مهلة|انتهت حصة|overloaded|timeout|مهلة الاتصال|مثقل/i.test(message);
}

export interface TripConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Human label for honest logging (host only, never the key). */
  label: string;
}

/** Failover decision: null = serve the primary failure honestly, no retry. */
export interface FailoverPlan {
  primary: TripConfig;
  fallback: TripConfig;
}

/**
 * Build the failover plan from resolved configs. Returns null (no failover)
 * when the fallback is unconfigured OR identical to the primary endpoint —
 * retrying the same URL+model is the engine's retry job, not failover's.
 * Key comparison is the caller's job (keys are secret); endpoint equality
 * here covers host+model.
 */
export function buildFailoverPlan(
  primary: TripConfig | null,
  fallback: { baseUrl?: string; model?: string; apiKey?: string } | null,
): FailoverPlan | null {
  if (!primary || !primary.baseUrl || !primary.model || !primary.apiKey) return null;
  const baseUrl = (fallback?.baseUrl || '').replace(/\/+$/, '');
  const model = (fallback?.model || '').trim();
  const apiKey = fallback?.apiKey || '';
  if (!baseUrl || !model || !apiKey) return null;
  const sameEndpoint =
    baseUrl.toLowerCase() === primary.baseUrl.replace(/\/+$/, '').toLowerCase() &&
    model === primary.model;
  if (sameEndpoint) return null;
  let host = baseUrl;
  try {
    host = new URL(baseUrl).hostname;
  } catch { /* keep raw */ }
  return { primary, fallback: { baseUrl, model, apiKey, label: host } };
}
