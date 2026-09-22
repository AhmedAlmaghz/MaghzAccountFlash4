/**
 * JEV client singleton — TypeSafe AI System One API.
 *
 * Wraps `@typesafe-ai/sdk` TypeSafeClient with deadline, fallback and
 * PII-free diagnostics. Single client per process; key rotation requires
 * `resetJevClient()`.
 *
 * Design:
 *  - Reads apiKey from JevConfig (DB → env fallback) on first use per company.
 *  - `deadlineOr 2s` on preamble — never hangs the chat.
 *  - On failure returns null → caller falls back to Gemini/toolRouter.
 *  - `dangerouslyAllowBrowser: true` — the key is already per-company and
 *    guarded by RBAC; browser mode is an explicit user choice (ai.browser_disabled kill-switch).
 */

import { TypeSafeClient } from '@typesafe-ai/sdk';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { deadlineOr } from '../engine/deadline';
import { getJevConfig, JEV_DEFAULT_BASE_URL, JEV_DEFAULT_MODEL, type JevConfig } from './jevConfig';

let jevClient: TypeSafeClient | null = null;
let jevClientKey: string | null = null;
let jevClientBaseUrl: string | null = null;

export function resetJevClient(): void {
  jevClient = null;
  jevClientKey = null;
  jevClientBaseUrl = null;
}

/**
 * Get or create the TypeSafe client for the current company.
 * Returns null when JEV is disabled or no key is configured (degraded).
 */
export async function getJevClient(companyId: string): Promise<TypeSafeClient | null> {
  let config: JevConfig | null;
  try {
    config = await getJevConfig(companyId);
  } catch {
    return null;
  }
  if (!config.enabled || !config.apiKey) return null;

  const key = config.apiKey;
  const baseUrl = config.baseUrl || JEV_DEFAULT_BASE_URL;
  const model = config.model || JEV_DEFAULT_MODEL;

  // Reuse if same key+baseUrl
  if (jevClient && jevClientKey === key && jevClientBaseUrl === baseUrl) return jevClient;

  try {
    jevClient = new TypeSafeClient({
      apiKey: key,
      baseURL: baseUrl,
      defaultModel: model,
      timeout: 8000,
      dangerouslyAllowBrowser: true,
      logLevel: 'warn',
    });
    jevClientKey = key;
    jevClientBaseUrl = baseUrl;
    return jevClient;
  } catch (e) {
    console.warn('[jev] failed to create TypeSafeClient', e);
    return null;
  }
}

/**
 * Call JEV systemOne with deadline and graceful fallback.
 * Returns null on any failure (timeout, auth, rate-limit, network) — caller
 * must fall back to the existing Gemini/toolRouter path.
 */
export async function jevSystemOne<Q extends Questions>(
  companyId: string,
  request: { state: unknown; questions: Q; model?: string },
  opts?: { timeoutMs?: number; label?: string },
): Promise<SystemOneResult<Q> | null> {
  const client = await getJevClient(companyId);
  if (!client) return null;

  const timeoutMs = opts?.timeoutMs ?? 2000;
  const label = opts?.label ?? 'jev-systemOne';

  try {
    const result = await deadlineOr<SystemOneResult<Q> | null>(
      (async () => {
        const res = await client.systemOne(
          {
            // SDK EntryType = string | object | array | null — our Record<string,unknown> is object
            state: request.state as unknown as string,
            questions: request.questions,
            ...(request.model ? { model: request.model } : {}),
          } as Parameters<TypeSafeClient['systemOne']>[0],
          { timeout: timeoutMs },
        );
        return res as SystemOneResult<Q>;
      })(),
      timeoutMs + 500,
      null,
      label,
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 401/403 → key misconfigured — log once, don't spam
    if (/401|403|authentication/i.test(msg)) {
      console.warn('[jev] authentication failed — check ai.jev_api_key', msg);
    } else {
      console.warn(`[jev] systemOne failed (${label})`, msg);
    }
    return null;
  }
}

/**
 * Lightweight health check — validates key without consuming chat budget.
 * Uses a minimal Noul question; ~50 input tokens.
 */
export async function jevHealthCheck(companyId: string): Promise<{ ok: boolean; latencyMs?: number; error?: string; model?: string }> {
  const start = Date.now();
  const res = await jevSystemOne(
    companyId,
    {
      state: 'ping',
      questions: {
        ping: { type: 'noul', instructions: 'Is the state exactly "ping"?' },
      },
    },
    { timeoutMs: 4000, label: 'jev-health' },
  );
  const latencyMs = Date.now() - start;
  if (!res) return { ok: false, latencyMs, error: 'No response (check key / network / rate limit)' };
  return { ok: true, latencyMs, model: res.model };
}
