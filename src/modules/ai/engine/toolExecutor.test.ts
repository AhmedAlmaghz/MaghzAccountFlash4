import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/utils/auditLogger', () => ({
  logAudit: vi.fn(() => Promise.resolve()),
}));

import { executeToolCall, canExecute, resolveTool } from './toolExecutor';
import { registerTool, clearToolRegistry } from '../tools/registry';
import { useAuthStore } from '@/modules/auth/store';
import { logAudit } from '@/core/utils/auditLogger';
import type { ToolDefinition, ToolContext } from '../types';
import type { User } from '@/modules/auth/types';

const ctx: ToolContext = { companyId: 'c1', userId: 'u1' };

const adminUser: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
const viewerUser: User = { id: '2', username: 'viewer', email: 'v@b.com', role: 'viewer', isActive: true };

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test.tool',
    labelAr: 'أداة اختبار',
    descriptionAr: 'وصف',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ data: 'result' }),
    ...overrides,
  };
}

describe('toolExecutor', () => {
  beforeEach(() => {
    clearToolRegistry();
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  describe('resolveTool', () => {
    it('resolves a registered tool', () => {
      registerTool(makeTool());
      expect(resolveTool('test.tool')).toBeDefined();
    });

    it('returns undefined for unknown tool', () => {
      expect(resolveTool('unknown')).toBeUndefined();
    });
  });

  describe('canExecute', () => {
    it('returns true when user has permission', () => {
      useAuthStore.getState().login(adminUser);
      expect(canExecute(makeTool())).toBe(true);
    });

    it('returns false when user lacks permission', () => {
      useAuthStore.getState().login(viewerUser); // viewer fallback lacks some
      const tool = makeTool({ permission: 'hr.delete' as ToolDefinition['permission'] });
      expect(canExecute(tool)).toBe(false);
    });

    it('returns false when not authenticated', () => {
      expect(canExecute(makeTool())).toBe(false);
    });
  });

  describe('executeToolCall', () => {
    it('executes tool and returns result', async () => {
      useAuthStore.getState().login(adminUser);
      registerTool(makeTool({ execute: async (args) => ({ got: args.x }) }));
      const outcome = await executeToolCall('test.tool', { x: 42 }, ctx);
      expect(outcome.ok).toBe(true);
      expect(outcome.result).toEqual({ got: 42 });
    });

    it('returns error for unknown tool', async () => {
      useAuthStore.getState().login(adminUser);
      const outcome = await executeToolCall('missing', {}, ctx);
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('غير معروفة');
    });

    it('rejects when user lacks permission', async () => {
      useAuthStore.getState().login(viewerUser);
      registerTool(makeTool({ permission: 'hr.delete' as ToolDefinition['permission'] }));
      const outcome = await executeToolCall('test.tool', {}, ctx);
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('صلاحية');
    });

    it('catches execution exceptions and returns error message', async () => {
      useAuthStore.getState().login(adminUser);
      registerTool(makeTool({
        execute: async () => { throw new Error('DB exploded'); },
      }));
      const outcome = await executeToolCall('test.tool', {}, ctx);
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toBe('DB exploded');
    });

    it('does NOT audit-log read tools', async () => {
      useAuthStore.getState().login(adminUser);
      registerTool(makeTool({ dangerLevel: 'read' }));
      await executeToolCall('test.tool', {}, ctx);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('audit-logs write tools with args and company context', async () => {
      useAuthStore.getState().login(adminUser);
      registerTool(makeTool({ dangerLevel: 'write' }));
      await executeToolCall('test.tool', { amount: 500 }, ctx);
      expect(logAudit).toHaveBeenCalledTimes(1);
      const call = vi.mocked(logAudit).mock.calls[0][0];
      expect(call.companyId).toBe('c1');
      expect(call.userId).toBe('u1');
      expect(call.tableName).toBe('ai_tool_calls');
    });

    it('audit-log failure does not break execution', async () => {
      vi.mocked(logAudit).mockRejectedValueOnce(new Error('audit down'));
      useAuthStore.getState().login(adminUser);
      registerTool(makeTool({ dangerLevel: 'write' }));
      const outcome = await executeToolCall('test.tool', {}, ctx);
      expect(outcome.ok).toBe(true);
    });
  });
});
