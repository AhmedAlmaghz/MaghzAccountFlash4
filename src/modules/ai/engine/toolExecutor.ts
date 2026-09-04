import { getTool } from '../tools/registry';
import { useAuthStore } from '@/modules/auth/store';
import { logAudit } from '@/core/utils/auditLogger';
import { sanitizeToolArgs } from './argNormalizers';
import { classifyToolError, type ToolErrorClassification } from './errorTaxonomy';
import type { ToolContext, ToolDefinition } from '../types';

/**
 * Tool result cache — avoids redundant read queries within a session.
 * Namespaced by tenant+user+tool and keyed by the JSON of the cleaned args.
 * Invalidated after any write tool execution.
 *
 * Cache key design note: the OLD signature was `getCachedToolResult(name, args)`
 * while every caller passed a pre-composed `${companyId}:${userId}:${tool}` —
 * the parameter named "name" was actually a namespace. The new signature
 * makes both explicit and guards against empty namespaces (which would
 * have silently shared results across tenants).
 */
const toolResultCache = new Map<string, { result: unknown; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

function cacheKey(namespace: string, name: string, args: Record<string, unknown>): string {
  return `${namespace}:${name}:${JSON.stringify(args)}`;
}

export function getCachedToolResult(
  namespace: string,
  name: string,
  args: Record<string, unknown>
): { result: unknown } | null {
  if (!namespace) return null; // defensive: never share cache across tenants
  const entry = toolResultCache.get(cacheKey(namespace, name, args));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    toolResultCache.delete(cacheKey(namespace, name, args));
    return null;
  }
  return { result: entry.result };
}

export function setCachedToolResult(
  namespace: string,
  name: string,
  args: Record<string, unknown>,
  result: unknown
): void {
  if (!namespace) return;
  toolResultCache.set(cacheKey(namespace, name, args), { result, timestamp: Date.now() });
}

/** Invalidate all cache — called after any write tool executes. */
export function invalidateToolCache(): void {
  toolResultCache.clear();
}

/** Test helper — clears the read-result cache between test runs. */
export function clearToolResultCache(): void {
  toolResultCache.clear();
}

/**
 * Tool executor — the single gate every LLM-requested tool call passes through:
 *   1. tool exists in the registry
 *   2. current user holds the tool's RBAC permission
 *   3. execute with injected context (companyId/userId — never from the LLM)
 *   4. write tools are audit-logged (fire-and-forget)
 */

export interface ExecutionOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Structured classification of `error` — present whenever ok === false. */
  errorClass?: ToolErrorClassification;
}

export function resolveTool(name: string): ToolDefinition | undefined {
  return getTool(name);
}

export function canExecute(tool: ToolDefinition): boolean {
  return useAuthStore.getState().hasPermission(tool.permission);
}

/**
 * Sliding-window rate limiter for tool calls, keyed per user (userId).
 * Caps tool invocations per minute so a runaway agent loop (or a malicious
 * session) cannot hammer the DB or, for write tools, spam document creation.
 *
 * Thresholds are deliberately generous for normal assistant use; the loop cap
 * (MAX_ITERATIONS) is the primary backstop, this is defense-in-depth.
 */
const TOOL_RATE_LIMIT_READ_PER_MINUTE = 300;
const TOOL_RATE_LIMIT_WRITE_PER_MINUTE = 60;
const TOOL_RATE_WINDOW_MS = 60_000;

const callCounter = new Map<string, number[]>();
/**
 * The OLD heuristic (`typeof window === 'undefined'`) silently disabled the
 * limiter in any windowless environment (SSR, workers, a future server
 * runtime). The explicit flag is opt-OUT by the TEST SUITE ONLY — production
 * paths (browser AND any future renderer host) are always rate-limited.
 * `import.meta.env.MODE` is the renderer-safe way to detect vitest (vitest
 * injects MODE === 'test').
 */
const isTest: boolean =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test';

function userRateKey(ctx: ToolContext, dangerLevel: string): string {
  return `${ctx.userId}:${dangerLevel}`;
}

function allowCall(ctx: ToolContext, dangerLevel: 'read' | 'write'): boolean {
  const limit = dangerLevel === 'write' ? TOOL_RATE_LIMIT_WRITE_PER_MINUTE : TOOL_RATE_LIMIT_READ_PER_MINUTE;
  const now = Date.now();
  const key = userRateKey(ctx, dangerLevel);
  const stamps = (callCounter.get(key) || []).filter((t) => now - t < TOOL_RATE_WINDOW_MS);
  if (stamps.length >= limit) return false;
  stamps.push(now);
  callCounter.set(key, stamps);
  return true;
}

/** Reset all rate-limit counters (used by tests). */
export function resetToolRateLimiter(): void {
  callCounter.clear();
}

/**
 * Hard wall-clock budget for a single tool execution. A hung DB query (or a
 * stuck adapter call) must never freeze the whole agent loop and UI — the
 * MAX_ITERATIONS loop-cap cannot help because it only counts completed calls.
 * Report/aggregation tools run multiple SQL queries, so the budget is generous.
 */
const TOOL_TIMEOUT_MS = 30_000;

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ExecutionOutcome> {
  const tool = getTool(name);
  if (!tool) {
    const error = `أداة غير معروفة: ${name}`;
    return { ok: false, error, errorClass: classifyToolError(error) };
  }

  if (!canExecute(tool)) {
    const error = `ليس لديك صلاحية تنفيذ هذه العملية (${tool.permission})`;
    return { ok: false, error, errorClass: classifyToolError(error) };
  }

  // Single hygiene choke-point: Arabic digits, thousands separators and
  // free-form dates ("12-8", "15 أغسطس 2026") are normalized before any
  // tool sees them — present and future tools inherit this for free.
  const { args: cleanArgs } = sanitizeToolArgs(args);

  if (!isTest && !allowCall(ctx, tool.dangerLevel)) {
    const error = 'تم تجاوز حد الاستدعاءات المسموح به — حاول مرة أخرى بعد قليل';
    return { ok: false, error, errorClass: classifyToolError(error) };
  }

  // Read tools: check cache first (namespaced per tenant+user)
  if (tool.dangerLevel === 'read') {
    const cached = getCachedToolResult(`${ctx.companyId}:${ctx.userId}`, name, cleanArgs);
    if (cached) return { ok: true, result: cached.result };
  }

  try {
    const result = await withTimeout(tool.execute(cleanArgs, ctx), TOOL_TIMEOUT_MS, tool.labelAr);

    if (tool.dangerLevel === 'write') {
      // Invalidate all cache after write — data may have changed
      invalidateToolCache();

      const user = useAuthStore.getState().user;
      void logAudit({
        userId: ctx.userId,
        username: user?.username,
        action: auditActionFor(name),
        tableName: 'ai_tool_calls',
        recordId: name,
        recordLabel: tool.labelAr,
        newValues: { args: cleanArgs, result: summarizeForAudit(result) },
        companyId: ctx.companyId,
      });
    } else {
      // Cache read tool results (namespaced per tenant+user)
      setCachedToolResult(`${ctx.companyId}:${ctx.userId}`, name, cleanArgs, result);
    }

    return { ok: true, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error, errorClass: classifyToolError(error) };
  }
}

function summarizeForAudit(result: unknown): unknown {
  try {
    const json = JSON.stringify(result);
    return json.length > 500 ? json.slice(0, 500) : result;
  } catch {
    return null;
  }
}

/**
 * Derive the honest audit action from the tool name — an audit log that says
 * "create" for a delete is a misleading trail (the P1 audit finding). Falls
 * back to 'update' for ambiguous verbs so the log never claims a create that
 * didn't happen.
 */
export function auditActionFor(toolName: string): 'create' | 'update' | 'delete' | 'post' {
  const action = toolName.split('.')[1] ?? '';
  if (action.startsWith('create_') || action.startsWith('generate_')) return 'create';
  if (action.startsWith('delete_') || action.startsWith('deactivate_')) return 'delete';
  if (action.startsWith('post_') || action.startsWith('pay_') || action.startsWith('apply_')) return 'post';
  if (
    action.startsWith('update_') ||
    action.startsWith('convert_') ||
    action.startsWith('win_') ||
    action.startsWith('complete_') ||
    action.startsWith('save_') ||
    action.startsWith('start_')
  ) return 'update';
  // Wizards chain multiple ops — the dominant effect is a new posted document.
  if (action.startsWith('process_')) return 'post';
  return 'update';
}

/**
 * Race a promise against a wall-clock budget. The losing side produces an
 * honest, actionable error instead of an eternal "executing" card.
 * The underlying promise is NOT aborted (adapter queries own their cleanup);
 * the unhandled-rejection path is guarded by the .catch(() => {}) noop so a
 * late failure after timeout can never crash the renderer.
 */
function withTimeout<T>(p: Promise<T>, ms: number, labelAr: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`انتهت مهلة تنفيذ الأداة "${labelAr}" (30 ثانية) — قد يكون الاتصال بقاعدة البيانات بطيئاً. جرّب طلباً أصغر أو أعِد المحاولة.`));
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
    // Post-timeout failures from the abandoned call must stay unobserved.
    p.catch(() => { /* already rejected by the timer */ });
  });
}
