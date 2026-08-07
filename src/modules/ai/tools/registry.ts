import type { LlmTool, ToolDefinition } from '../types';
import { useAuthStore } from '@/modules/auth/store';

/**
 * Central tool registry for the AI Harness.
 *
 * Tools are declarative definitions wrapping the existing module APIs.
 * Visibility is permission-filtered: a tool is only advertised to the LLM
 * (and executable) when the current user holds its RBAC permission.
 */

const tools = new Map<string, ToolDefinition>();

export function registerTool(def: ToolDefinition): void {
  tools.set(def.name, def);
}

export function registerTools(defs: ToolDefinition[]): void {
  for (const def of defs) registerTool(def);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function getAllTools(): ToolDefinition[] {
  return [...tools.values()];
}

/** Tools the current user is allowed to use — only these reach the LLM. */
export function getVisibleTools(): ToolDefinition[] {
  const { hasPermission } = useAuthStore.getState();
  return [...tools.values()].filter((t) => hasPermission(t.permission));
}

/** Convert tool definitions to the OpenAI-compatible wire format. */
export function toLlmTools(defs: ToolDefinition[]): LlmTool[] {
  return defs.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.descriptionAr,
      parameters: t.parameters,
    },
  }));
}

/** Test helper — clears the registry between test runs. */
export function clearToolRegistry(): void {
  tools.clear();
}
