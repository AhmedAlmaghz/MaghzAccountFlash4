import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, getTool, getVisibleTools, toLlmTools, clearToolRegistry } from './registry';
import { useAuthStore } from '@/modules/auth/store';
import type { ToolDefinition } from '../types';
import type { User } from '@/modules/auth/types';

function makeTool(name: string, permission: string, dangerLevel: 'read' | 'write' = 'read'): ToolDefinition {
  return {
    name,
    labelAr: `أداة ${name}`,
    descriptionAr: `وصف ${name}`,
    permission: permission as ToolDefinition['permission'],
    dangerLevel,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  };
}

const adminUser: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
const viewerUser: User = { id: '2', username: 'viewer', email: 'v@b.com', role: 'viewer', isActive: true };

describe('AI Tool Registry', () => {
  beforeEach(() => {
    clearToolRegistry();
    useAuthStore.getState().logout();
  });

  describe('registerTool + getTool', () => {
    it('registers and retrieves a tool by name', () => {
      registerTool(makeTool('sales.get_invoices', 'sales.view'));
      const tool = getTool('sales.get_invoices');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('sales.get_invoices');
    });

    it('returns undefined for unknown tool', () => {
      expect(getTool('nonexistent')).toBeUndefined();
    });
  });

  describe('getVisibleTools', () => {
    it('returns empty when not authenticated', () => {
      registerTool(makeTool('sales.get_invoices', 'sales.view'));
      expect(getVisibleTools()).toHaveLength(0);
    });

    it('super_admin sees all tools', () => {
      registerTool(makeTool('a', 'sales.view'));
      registerTool(makeTool('b', 'hr.delete'));
      useAuthStore.getState().login({ ...adminUser, role: 'super_admin' });
      expect(getVisibleTools()).toHaveLength(2);
    });

    it('admin sees all tools (no restrictions for these permissions)', () => {
      registerTool(makeTool('a', 'sales.view'));
      registerTool(makeTool('b', 'sales.create', 'write'));
      useAuthStore.getState().login(adminUser);
      expect(getVisibleTools()).toHaveLength(2);
    });

    it('filters out tools the user lacks permission for', () => {
      registerTool(makeTool('allowed', 'sales.view'));
      registerTool(makeTool('forbidden', 'hr.delete'));
      // viewer role fallback has sales.view but not hr.delete
      useAuthStore.getState().login(viewerUser);
      const visible = getVisibleTools();
      expect(visible.map((t) => t.name)).toEqual(['allowed']);
    });

    it('respects explicit permission arrays', () => {
      registerTool(makeTool('a', 'sales.view'));
      registerTool(makeTool('b', 'sales.create', 'write'));
      useAuthStore.getState().login(viewerUser, ['sales.view']);
      const visible = getVisibleTools();
      expect(visible.map((t) => t.name)).toEqual(['a']);
    });
  });

  describe('toLlmTools', () => {
    it('converts to OpenAI-compatible function format', () => {
      const tools = [makeTool('sales.get_invoices', 'sales.view')];
      const llm = toLlmTools(tools);
      expect(llm).toHaveLength(1);
      expect(llm[0].type).toBe('function');
      expect(llm[0].function.name).toBe('sales.get_invoices');
      expect(llm[0].function.description).toContain('وصف');
      expect(llm[0].function.parameters).toEqual({ type: 'object', properties: {} });
    });

    it('preserves Arabic descriptions', () => {
      const tools = [makeTool('x', 'core.view')];
      const llm = toLlmTools(tools);
      expect(llm[0].function.description).toMatch(/[\u0600-\u06FF]/);
    });
  });

  describe('clearToolRegistry', () => {
    it('removes all registered tools', () => {
      registerTool(makeTool('a', 'sales.view'));
      registerTool(makeTool('b', 'sales.view'));
      clearToolRegistry();
      expect(getTool('a')).toBeUndefined();
      expect(getTool('b')).toBeUndefined();
    });
  });
});
