/**
 * Vercel serverless relay: POST /api/jev-systemone
 *
 * Why this exists: api.typesafe.ai answers CORS preflights with HTTP 400 and
 * no Access-Control-Allow-Origin, so NO browser on earth can call it directly
 * (renderer fetch always dies with "Failed to fetch"). Same-origin relay is
 * the only standards-compliant path for pure-web deployments. Electron uses
 * the ai:jev-systemone IPC channel instead; this function is web-only.
 *
 * Contract (mirrors the IPC channel):
 *   request:  { state, questions (1-40), model?, baseUrl?, apiKey }
 *   response: upstream { model, answers, usage } passed through as-is.
 *
 * Security: allowlisted upstream host only (api.typesafe.ai + optional
 * JEV_ALLOWED_HOSTS), key comes per-request over HTTPS and is never stored
 * or logged, 1–40 questions cap, ~20s upstream timeout.
 */

const UPSTREAM_HOSTS = new Set([
  'api.typesafe.ai',
  ...(process.env.JEV_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
]);

const MAX_QUESTIONS = 40;
const UPSTREAM_TIMEOUT_MS = 20000;

type JsonRecord = Record<string, unknown>;

function json(res: { status: (c: number) => unknown; json: (b: unknown) => unknown }, code: number, body: unknown): void {
  (res.status(code) as { json: (b: unknown) => unknown }).json(body);
}

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { status: (code: number) => { json: (body: unknown) => unknown }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).json({});
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { success: false, error: 'POST only' });
    return;
  }
  const body = (req.body ?? {}) as JsonRecord;
  const { state, questions } = body as { state?: unknown; questions?: Record<string, unknown> };
  const model = typeof body.model === 'string' && body.model.length > 0 && body.model.length <= 80
    ? body.model
    : 'jev-latest';
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : '';
  const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : 'https://api.typesafe.ai';

  if (!state || typeof questions !== 'object' || questions === null) {
    json(res, 400, { success: false, error: 'state and questions are required' });
    return;
  }
  const qids = Object.keys(questions);
  if (qids.length === 0 || qids.length > MAX_QUESTIONS) {
    json(res, 400, { success: false, error: `questions must list 1-${MAX_QUESTIONS} items` });
    return;
  }
  if (!apiKey) {
    json(res, 400, { success: false, error: 'apiKey is required' });
    return;
  }
  let host = '';
  try {
    host = new URL(baseUrl.replace(/\/+$/, '')).hostname.toLowerCase();
  } catch {
    json(res, 400, { success: false, error: 'invalid baseUrl' });
    return;
  }
  if (!UPSTREAM_HOSTS.has(host)) {
    json(res, 403, { success: false, error: 'upstream host not allowed' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ state, questions, model }),
      signal: controller.signal,
    });
    const text = await upstream.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!upstream.ok) {
      const msg = (data as { error?: { message?: string }; message?: string } | null)?.error?.message
        ?? (data as { message?: string } | null)?.message
        ?? text?.slice(0, 300)
        ?? `HTTP ${upstream.status}`;
      json(res, upstream.status === 429 ? 429 : 502, { success: false, error: `JEV provider error (${upstream.status}): ${msg}` });
      return;
    }
    json(res, 200, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, 504, { success: false, error: /abort/i.test(msg) ? 'انتهت مهلة الاتصال بـ JEV (timeout)' : `تعذر الاتصال بـ JEV: ${msg}` });
  } finally {
    clearTimeout(timer);
  }
}
