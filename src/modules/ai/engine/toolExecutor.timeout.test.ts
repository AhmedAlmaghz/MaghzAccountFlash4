import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeToolCall,
  resetToolRateLimiter,
  clearToolResultCache,
} from './toolExecutor';
import { registerTool, clearToolRegistry } from '../tools/registry';
import type { ToolDefinition } from '../types';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

/**
 * Timeout + cache interplay regression for the tool executor.
 * The 30s budget guarantees a hung tool can never freeze the agent loop —
 * the losing call surfaces an honest error card instead.
 */

vi.mock('@/core/utils/auditLogger', () => ({ logAudit: vi.fn(async () => ({})) }));

const adminUser: User = { id: 'u1', username: 'admin', role: 'admin', isActive: true };
const CTX = { companyId: 'c1', userId: 'u1' } as const;

function makeTool(
  name: string,
  execute: ToolDefinition['execute'],
  dangerLevel: 'read' | 'write' = 'read',
): ToolDefinition {
  return {
    name,
    labelAr: `أداة ${name}`,
    descriptionAr: `وصف ${name}`,
    permission: 'accounting.view',
    dangerLevel,
    parameters: { type: 'object', properties: {} },
    execute,
  };
}

describe('toolExecutor timeout budget', () => {
  beforeEach(() => {
    clearToolRegistry();
    resetToolRateLimiter();
    clearToolResultCache();
    useAuthStore.getState().login({ ...adminUser, permissions: ['accounting.view'] } as never);
  });

  it('rejects a hung tool with an honest timeout error (never freezes)', async () => {
    vi.useFakeTimers();
    try {
      registerTool(
        makeTool('test.hung', () => new Promise(() => { /* never settles */ })),
      );
      const outcomePromise = executeToolCall('test.hung', {}, CTX);
      // Advance past the 30s budget without awaiting real time
      const outcome = await Promise.race([
        vi.advanceTimersByTimeAsync(31_000).then(() => outcomePromise),
      ]);
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toMatch(/مهلة|timeout/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fast tools complete normally within the budget', async () => {
    registerTool(
      makeTool('test.fast', async () => ({ value: 42 })),
    );
    const outcome = await executeToolCall('test.fast', {}, CTX);
    expect(outcome.ok).toBe(true);
    expect((outcome.result as { value: number }).value).toBe(42);
  });

  it('a tool erroring AFTER the timeout does not crash (unobserved rejection guard)', async () => {
    vi.useFakeTimers();
    try {
      let rejectFn: ((e: Error) => void) | undefined;
      registerTool(
        makeTool('test.late_reject', () => new Promise((_res, rej) => { rejectFn = rej; })),
      );
      const outcomePromise = executeToolCall('test.late_reject', {}, CTX);
      await vi.advanceTimersByTimeAsync(31_000);
      const outcome = await outcomePromise;
      expect(outcome.ok).toBe(false);

      // The abandoned call rejects AFTER the timeout already resolved ours.
      // This must not produce an unhandled rejection that kills the renderer.
      expect(() => rejectFn?.(new Error('late failure'))).not.toThrow();
      // Let the microtask queue drain — an unhandled rejection would surface here.
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still enforces RBAC before executing (permission denied)', async () => {
    // sales_rep fallback has NO accounting.view — and login() with an empty
    // explicit permissions array falls back to the role list.
    useAuthStore.getState().logout();
    useAuthStore.getState().login({ ...adminUser, role: 'sales_rep' } as never);
    registerTool(makeTool('test.denied', async () => ({ ok: 1 })));
    const outcome = await executeToolCall('test.denied', {}, CTX);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/صلاحية/);
  });

  it('unknown tool names are rejected, never executed', async () => {
    const outcome = await executeToolCall('nonexistent.tool', {}, CTX);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/أداة غير معروفة/);
  });
});
