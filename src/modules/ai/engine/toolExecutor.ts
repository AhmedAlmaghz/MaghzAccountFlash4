import { getTool } from '../tools/registry';
import { useAuthStore } from '@/modules/auth/store';
import { logAudit } from '@/core/utils/auditLogger';
import type { ToolContext, ToolDefinition } from '../types';

/**
 * Tool result cache — avoids redundant read queries within a session.
 * Keys are `${toolName}:${JSON.stringify(args)}`. Invalidated after any
 * write tool execution.
 */
const toolResultCache = new Map<string, { result: unknown; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

function cacheKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

export function getCachedToolResult(
  name: string,
  args: Record<string, unknown>
): { result: unknown } | null {
  const key = cacheKey(name, args);
  const entry = toolResultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    toolResultCache.delete(key);
    return null;
  }
  return { result: entry.result };
}

export function setCachedToolResult(
  name: string,
  args: Record<string, unknown>,
  result: unknown
): void {
  const key = cacheKey(name, args);
  toolResultCache.set(key, { result, timestamp: Date.now() });
}

/** Invalidate all cache — called after any write tool executes. */
export function invalidateToolCache(): void {
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
}

export function resolveTool(name: string): ToolDefinition | undefined {
  return getTool(name);
}

export function canExecute(tool: ToolDefinition): boolean {
  return useAuthStore.getState().hasPermission(tool.permission);
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ExecutionOutcome> {
  const tool = getTool(name);
  if (!tool) return { ok: false, error: `أداة غير معروفة: ${name}` };

  if (!canExecute(tool)) {
    return { ok: false, error: `ليس لديك صلاحية تنفيذ هذه العملية (${tool.permission})` };
  }

  // Read tools: check cache first
  if (tool.dangerLevel === 'read') {
    const cached = getCachedToolResult(`${ctx.companyId}:${ctx.userId}:${name}`, args);
    if (cached) return { ok: true, result: cached.result };
  }

  try {
    const result = await tool.execute(args, ctx);

    if (tool.dangerLevel === 'write') {
      // Invalidate all cache after write — data may have changed
      invalidateToolCache();

      const user = useAuthStore.getState().user;
      void logAudit({
        userId: ctx.userId,
        username: user?.username,
        action: 'create',
        tableName: 'ai_tool_calls',
        recordId: name,
        recordLabel: tool.labelAr,
        newValues: { args, result: summarizeForAudit(result) },
        companyId: ctx.companyId,
      });
    } else {
      // Cache read tool results
      setCachedToolResult(`${ctx.companyId}:${ctx.userId}:${name}`, args, result);
    }

    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
