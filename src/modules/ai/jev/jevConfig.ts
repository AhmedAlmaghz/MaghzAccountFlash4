/**
 * JEV configuration — single source of truth for TypeSafe AI / JEV settings.
 *
 * Keys live in the `settings` table (category `ai`) alongside the existing
 * Gemini/OpenAI provider keys. This allows per-company JEV enablement without
 * env var sprawl.
 *
 * Storage:
 *  - apiKey   → `ai.jev_api_key`  (enc:v1: envelope via keyVault when browser mode)
 *  - enabled  → `ai.jev_enabled`  (boolean string)
 *  - router   → `ai.jev_router_enabled` (boolean string)
 *  - guard    → `ai.jev_guard_enabled` (boolean string)
 *  - model    → `ai.jev_model` (default jev-latest)
 *
 * Fallback: env `TYPESAFE_API_KEY` / `TYPESAFE_BASE_URL` / `TYPESAFE_DEFAULT_MODEL`
 * is honoured when no DB key exists — useful for local dev without company context.
 */

import { getDbAdapter } from '@/core/database/adapters';

export const JEV_DEFAULT_MODEL = 'jev-latest';
export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai';

export const JEV_SETTINGS_KEYS = {
  enabled: 'ai.jev_enabled',
  apiKey: 'ai.jev_api_key',
  routerEnabled: 'ai.jev_router_enabled',
  guardEnabled: 'ai.jev_guard_enabled',
  model: 'ai.jev_model',
  baseUrl: 'ai.jev_base_url',
} as const;

export interface JevConfig {
  enabled: boolean;
  apiKey: string | null; // plaintext after decrypt, null if not configured
  routerEnabled: boolean;
  guardEnabled: boolean;
  model: string;
  baseUrl: string;
}

const BOOL_TRUE = new Set(['true', '1', 'yes', 'on']);

function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return BOOL_TRUE.has(String(value).trim().toLowerCase());
}

/**
 * Read raw JEV settings for a company. Returns null map when companyId is empty
 * or DB is unavailable (degraded — caller treats as disabled).
 */
async function readJevSettingsRaw(companyId: string): Promise<Map<string, string>> {
  if (!companyId) return new Map();
  try {
    const adapter = await getDbAdapter();
    const res = await adapter.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE company_id = $1 AND key IN (${Object.values(JEV_SETTINGS_KEYS).map((_, i) => `$${i + 2}`).join(',')})`,
      [companyId, ...Object.values(JEV_SETTINGS_KEYS)],
    );
    if (!res.success || !res.rows) return new Map();
    const map = new Map<string, string>();
    for (const row of res.rows) map.set(row.key, row.value);
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Resolve effective JEV config for a company — DB first, env fallback for apiKey.
 * Never throws.
 */
export async function getJevConfig(companyId: string): Promise<JevConfig> {
  const raw = await readJevSettingsRaw(companyId);

  // apiKey may be encrypted envelope — try decrypt via keyVault
  let apiKey: string | null = null;
  const stored = raw.get(JEV_SETTINGS_KEYS.apiKey) ?? null;
  if (stored) {
    // Encrypted envelope enc:v1:... → decrypt
    if (stored.startsWith('enc:v1:')) {
      try {
        const { decryptApiKey } = await import('../api/keyVault');
        apiKey = await decryptApiKey(stored);
      } catch {
        apiKey = null;
      }
    } else if (stored.trim().length > 0) {
      // Legacy plaintext
      apiKey = stored;
    }
  }
  // Env fallback (dev) — globalThis.process for node, import.meta.env for Vite
  if (!apiKey) {
    try {
      const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
      const envKey = g.process?.env?.TYPESAFE_API_KEY;
      if (envKey && envKey.trim()) apiKey = envKey.trim();
    } catch { /* ignore */ }
    if (!apiKey) {
      try {
        const viteKey = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_TYPESAFE_API_KEY;
        if (viteKey) apiKey = viteKey;
      } catch { /* ignore */ }
    }
  }

  const enabled = parseBool(raw.get(JEV_SETTINGS_KEYS.enabled), false);
  const routerEnabled = parseBool(raw.get(JEV_SETTINGS_KEYS.routerEnabled), enabled);
  const guardEnabled = parseBool(raw.get(JEV_SETTINGS_KEYS.guardEnabled), enabled);
  const model = raw.get(JEV_SETTINGS_KEYS.model)?.trim() || JEV_DEFAULT_MODEL;
  const baseUrl = raw.get(JEV_SETTINGS_KEYS.baseUrl)?.trim() || JEV_DEFAULT_BASE_URL;

  return { enabled, apiKey, routerEnabled, guardEnabled, model, baseUrl };
}

/** Synchronous check — reads feature flag from live settings cache if available. */
export function isJevRouterEnabledSync(config: JevConfig | null | undefined): boolean {
  if (!config) return false;
  return config.enabled && config.routerEnabled && !!config.apiKey;
}

export function isJevGuardEnabledSync(config: JevConfig | null | undefined): boolean {
  if (!config) return false;
  return config.enabled && config.guardEnabled && !!config.apiKey;
}

/**
 * Persist a single JEV setting for a company (upsert).
 */
export async function setJevSetting(
  companyId: string,
  key: string,
  value: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const adapter = await getDbAdapter();
    if (value == null || value === '') {
      const res = await adapter.query(`DELETE FROM settings WHERE company_id = $1 AND key = $2`, [companyId, key]);
      return { success: !!res.success };
    }
    // Encrypt apiKey before storing in browser mode
    let storedValue = value;
    if (key === JEV_SETTINGS_KEYS.apiKey && !value.startsWith('enc:v1:')) {
      try {
        const { encryptApiKey } = await import('../api/keyVault');
        storedValue = await encryptApiKey(value);
      } catch {
        // fall back to plaintext if vault unavailable (tests)
      }
    }
    const res = await adapter.query(
      `INSERT INTO settings (company_id, key, value, category) VALUES ($1, $2, $3, 'ai')
       ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [companyId, key, storedValue],
    );
    return { success: !!res.success, error: res.success ? undefined : (res as { error?: string }).error };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
