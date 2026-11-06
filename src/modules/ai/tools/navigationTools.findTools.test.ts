import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, clearToolRegistry } from './registry';
import { navigationTools, discoveredToolNamesFromResult } from './navigationTools';
import { useAuthStore } from '@/modules/auth/store';
import type { ToolDefinition, ToolContext } from '../types';
import type { Permission, User } from '@/modules/auth/types';

/**
 * `app.find_tools` — permission-filtered tool discovery.
 *
 * The router advertises ≤48 tools per cycle while the registry holds ~256,
 * so the model needs one honest way to search the rest by meaning ("راتب")
 * or by an invented English name ("payroll"). These tests pin the contract:
 * RBAC filtering, ranking signals, limit clamp, and the no-dead-end
 * behaviors for empty/zero-result queries.
 */

const ctx = { companyId: 'c1', userId: 'u1' } as ToolContext;

function makeTool(
  name: string,
  permission: Permission,
  labelAr: string,
  descriptionAr: string,
): ToolDefinition {
  return {
    name,
    labelAr,
    descriptionAr,
    permission,
    dangerLevel: 'read',
    parameters: { type: 'object', properties: { x: { type: 'string' } } },
    execute: async () => ({}),
  };
}

const findTools = navigationTools.find((t) => t.name === 'app.find_tools')!;

async function run(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await findTools.execute(args, ctx)) as Record<string, unknown>;
}

/** Login as a user whose EXPLICIT permission list drives hasPermission. */
function loginWith(permissions: Permission[]): void {
  const user: User = {
    id: 'u-1',
    username: 'tester',
    email: 't@example.com',
    role: 'viewer',
    isActive: true,
  } as User;
  useAuthStore.getState().logout();
  useAuthStore.getState().login(user);
  useAuthStore.getState().setPermissions(permissions);
}

function loginSuperAdmin(): void {
  const user: User = {
    id: 'u-2',
    username: 'root',
    email: 'root@example.com',
    role: 'super_admin',
    isActive: true,
  } as User;
  useAuthStore.getState().logout();
  useAuthStore.getState().login(user);
}

beforeEach(() => {
  clearToolRegistry();
  loginSuperAdmin();
});

describe('app.find_tools — discovery contract', () => {
  it('finds a tool by its Arabic label meaning', async () => {
    registerTool(makeTool('hr.get_payroll_runs', 'hr.view', 'مسير الرواتب', 'يعرض مسيرات الرواتب الشهرية للموظفين'));
    registerTool(makeTool('sales.create_invoice', 'sales.create', 'إنشاء فاتورة مبيعات', 'ينشئ فاتورة بيع جديدة'));

    const res = await run({ query: 'راتب' });
    const names = res.toolNames as string[];
    expect(names).toContain('hr.get_payroll_runs');
    expect(names).not.toContain('sales.create_invoice');
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches[0].name).toBe('hr.get_payroll_runs');
    // Full schema travels with the match — the model can call it next turn.
    expect(matches[0].parameters).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
  });

  it('finds a tool by an English name token (invented namespace)', async () => {
    registerTool(makeTool('manufacturing.create_bom', 'manufacturing.create', 'إنشاء قائمة مواد', 'BOM لتصنيع منتج'));
    registerTool(makeTool('hr.get_payroll_runs', 'hr.view', 'مسير الرواتب', 'مسيرات الرواتب'));

    const res = await run({ query: 'payroll' });
    const names = res.toolNames as string[];
    expect(names).toContain('hr.get_payroll_runs');
  });

  it('never returns a tool the user cannot execute (RBAC)', async () => {
    loginWith(['core.view', 'inventory.view']);
    registerTool(makeTool('hr.get_payroll_runs', 'hr.view', 'مسير الرواتب', 'مسيرات الرواتب الشهرية'));
    registerTool(makeTool('inventory.get_products', 'inventory.view', 'المنتجات', 'قائمة المنتجات'));

    const res = await run({ query: 'راتب' });
    const names = (res.toolNames as string[] | undefined) ?? [];
    expect(names).not.toContain('hr.get_payroll_runs');
    // visibleCount reflects the RBAC-filtered registry, not the full one.
    expect(res.visibleCount).toBe(1);
  });

  it('clamps the limit (default 5, max 10)', async () => {
    for (let i = 0; i < 15; i++) {
      registerTool(makeTool(`salestool.op_${i}`, 'sales.view', `عملية مبيعات ${i}`, 'أداة مبيعات متنوعة'));
    }
    const byDefault = await run({ query: 'مبيعات' });
    expect((byDefault.matches as unknown[]).length).toBeLessThanOrEqual(5);
    const wide = await run({ query: 'مبيعات', limit: 50 });
    expect((wide.matches as unknown[]).length).toBeLessThanOrEqual(10);
    const narrow = await run({ query: 'مبيعات', limit: 2 });
    expect((narrow.matches as unknown[]).length).toBe(2);
  });

  it('empty query returns a domain summary + hint — never an error', async () => {
    registerTool(makeTool('sales.create_invoice', 'sales.create', 'إنشاء فاتورة', '...'));
    registerTool(makeTool('inventory.get_products', 'inventory.view', 'المنتجات', '...'));

    const res = await run({ query: '   ' });
    expect(res.error).toBeUndefined();
    expect(String(res.hint)).toContain('query');
    const domains = res.domains as Array<{ domain: string; count: number }>;
    expect(domains.map((d) => d.domain)).toEqual(expect.arrayContaining(['sales', 'inventory']));
    expect(res.visibleCount).toBe(2);
  });

  it('zero matches returns a hint (and near misses when any scored)', async () => {
    registerTool(makeTool('sales.create_invoice', 'sales.create', 'إنشاء فاتورة', 'إنشاء فاتورة بيع'));

    const res = await run({ query: 'زورق شراعي' });
    expect(res.found).toBe(0);
    expect((res.matches as unknown[]).length).toBe(0);
    expect(String(res.hint)).toContain('app.list_pages');
  });

  it('excludes itself from its own results', async () => {
    registerTool(makeTool('sales.create_invoice', 'sales.create', 'إنشاء فاتورة', 'إنشاء فاتورة بيع'));
    const res = await run({ query: 'أداة' });
    const names = (res.toolNames as string[] | undefined) ?? [];
    expect(names).not.toContain('app.find_tools');
  });
});

describe('discoveredToolNamesFromResult', () => {
  it('extracts string names and ignores junk shapes', () => {
    expect(discoveredToolNamesFromResult({ toolNames: ['a.b', 'c.d'] })).toEqual(['a.b', 'c.d']);
    expect(discoveredToolNamesFromResult({ toolNames: ['a.b', 42, null, ''] })).toEqual(['a.b']);
    expect(discoveredToolNamesFromResult({})).toEqual([]);
    expect(discoveredToolNamesFromResult(null)).toEqual([]);
    expect(discoveredToolNamesFromResult('nope')).toEqual([]);
  });
});
