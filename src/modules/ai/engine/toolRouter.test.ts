import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, clearToolRegistry, getVisibleTools } from '../tools/registry';
import { routeToolsForCycle, MAX_ADVERTISED_TOOLS, describeRouting } from './toolRouter';
import { useAuthStore } from '@/modules/auth/store';
import type { ToolDefinition } from '../types';
import type { User } from '@/modules/auth/types';
import type { LlmMessage } from '../types';

function makeTool(name: string, permission: ToolDefinition['permission']): ToolDefinition {
  return {
    name,
    labelAr: `أداة ${name}`,
    descriptionAr: `وصف ${name}`,
    permission,
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  };
}

const adminUser: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'super_admin', isActive: true };

const userMsg = (t: string): LlmMessage => ({ role: 'user', content: t });

describe('toolRouter — dynamic tool routing (Phase 0.1 / Stage-3 gate)', () => {
  beforeEach(() => {
    clearToolRegistry();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(adminUser);
  });

  function seedRegistry() {
    // Always-on core (search unification 2026-09-24: jev.search_all is the
    // ONLY always-on search path; search.* ride their domain groups)
    const core = [
      'app.list_pages', 'app.navigate', 'core.get_company_info',
      'ai.batch_status', 'ai.classify_document', 'ai.enqueue_batch', 'ai.resume_batch',
      'ai.clear_queue',
      'jev.search_all',
    ];
    for (const n of core) registerTool(makeTool(n, 'ai.use' as never));
    // Verification search tools — routed by domain intent, NOT always-on
    registerTool(makeTool('search.customers', 'sales.view'));
    registerTool(makeTool('search.products', 'inventory.view'));
    // Domain tools — 20 sales + 20 hr (enough to overflow the cap when combined)
    for (let i = 0; i < 20; i++) registerTool(makeTool(`sales.tool_${i}`, 'sales.view'));
    for (let i = 0; i < 20; i++) registerTool(makeTool(`hr.tool_${i}`, 'hr.view'));
    for (let i = 0; i < 10; i++) registerTool(makeTool(`accounting.tool_${i}`, 'accounting.view'));
  }

  it('advertises only the always-on core when no intent matches', () => {
    seedRegistry();
    const routed = routeToolsForCycle([userMsg('مرحبا')]);
    expect(routed.routedByIntent).toBe(false);
    // 'مرحبا' matches no keyword → only always-on (9 registered above);
    // search.* verification tools stay out until an intent routes them
    expect(routed.tools.length).toBe(9);
    expect(routed.dropped).toBe(0);
    expect(routed.tools.every((t) => getVisibleTools().some((v) => v.name === t.name))).toBe(true);
  });

  it('search unification: sales intent routes search.customers for verification, silence does not', () => {
    seedRegistry();
    const silent = routeToolsForCycle([userMsg('مرحبا')]);
    expect(silent.tools.map((t) => t.name)).not.toContain('search.customers');
    expect(silent.tools.map((t) => t.name)).toContain('jev.search_all');
    const sales = routeToolsForCycle([userMsg('أنشئ فاتورة بيع لعميل')]);
    expect(sales.tools.map((t) => t.name)).toContain('search.customers');
  });

  it('routes the sales domain on sales intent keywords', () => {
    seedRegistry();
    const routed = routeToolsForCycle([userMsg('أنشئ فاتورة بيع لعميل')]);
    expect(routed.routedByIntent).toBe(true);
    const names = routed.tools.map((t) => t.name);
    expect(names).toContain('sales.tool_0');
    expect(names).not.toContain('hr.tool_0');
  });

  it('routes multiple domains when the message mentions both', () => {
    seedRegistry();
    const routed = routeToolsForCycle([userMsg('فاتورة مشتريات وراتب موظف')]);
    const names = new Set(routed.tools.map((t) => t.name));
    expect(names.has('hr.tool_0')).toBe(true);
    // 'مشتريات' routes purchases (none registered) + 'راتب' routes hr
    expect(routed.routedByIntent).toBe(true);
  });

  it('scans the last 3 user messages for intent (lookback)', () => {
    seedRegistry();
    const routed = routeToolsForCycle([
      userMsg('مرحبا'),
      userMsg('كيف الحال'),
      userMsg('شكرا'),
      userMsg('عرض سعر جديد'), // 4th message — still within lookback of 3? No: last 3 are شكرا/كيف/مرحبا... actually order matters
    ]);
    // The most recent message carries intent → routed
    expect(routed.routedByIntent).toBe(true);
  });

  it('adaptive expansion: unadvertised-but-registered tools join via extraToolNames', () => {
    seedRegistry();
    const plain = routeToolsForCycle([userMsg('مرحبا')]);
    expect(plain.tools.map((t) => t.name)).not.toContain('hr.tool_5');
    const expanded = routeToolsForCycle([userMsg('مرحبا')], new Set(['hr.tool_5']));
    expect(expanded.tools.map((t) => t.name)).toContain('hr.tool_5');
  });

  it('never exceeds the 48-tool cap and reports dropped count', () => {
    seedRegistry();
    // Register enough extra tools to overflow: 15 core + 50 report-ish
    for (let i = 0; i < 50; i++) registerTool(makeTool(`reports.extra_${i}`, 'reports.view'));
    const routed = routeToolsForCycle([userMsg('تقرير تحليل شامل قارن النمو')]);
    expect(routed.tools.length).toBeLessThanOrEqual(MAX_ADVERTISED_TOOLS);
    expect(MAX_ADVERTISED_TOOLS).toBe(48);
    // 'تقرير' routes sales+purchases+inventory+hr+crm+manufacturing+accounting+reports+read → overflow expected
    expect(routed.dropped).toBeGreaterThan(0);
    expect(describeRouting(routed)).toContain('48');
  });

  it('only narrows visible tools — never bypasses RBAC', () => {
    seedRegistry();
    const routed = routeToolsForCycle(
      [userMsg('فاتورة بيع')],
      new Set(['sales.tool_1', 'nonexistent.tool_xyz']),
    );
    // Unknown names are ignored (no RBAC bypass, no crash)
    expect(routed.tools.map((t) => t.name)).not.toContain('nonexistent.tool_xyz');
    expect(routed.tools.map((t) => t.name)).toContain('sales.tool_1');
  });

  it('describeRouting returns null when nothing was dropped', () => {
    seedRegistry();
    const routed = routeToolsForCycle([userMsg('مرحبا')]);
    expect(describeRouting(routed)).toBeNull();
  });

  it('P1: intent-routed domains stay represented when the cap slices (round-robin)', () => {
    // Old behavior sliced by REGISTRY insertion order: a broad intent kept
    // the first 48 registered tools (reads/searches/sales) and silently
    // dropped the hr./crm./manufacturing. tools the intent had routed.
    // New order: always-on core, then intent domains ROUND-ROBIN, then rest.
    seedRegistry();
    for (let i = 0; i < 50; i++) registerTool(makeTool(`reports.extra_${i}`, 'reports.view'));
    // Broad intent matches the 9-domain group → massive overflow forces a cut
    const routed = routeToolsForCycle([userMsg('تقرير تحليل شامل قارن النمو')]);
    expect(routed.dropped).toBeGreaterThan(0);
    const names = routed.tools.map((t) => t.name);
    // hr tools (registered deep at positions 35-54) must survive the cut
    expect(names).toContain('hr.tool_0');
    expect(names).toContain('hr.tool_1');
    // …and the always-on core is protected too
    expect(names).toContain('app.navigate');
    expect(names).toContain('ai.enqueue_batch');
  });

  describe('C1 workflow continuity (history-aware routing)', () => {
    const assistantCall = (name: string): LlmMessage => ({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: '{}' } }],
    }) as unknown as LlmMessage;

    it('keeps the called tool domain routed on keyword-less follow-ups', () => {
      // Mid-chain "تابع" carries zero keywords — without continuity the
      // whole sales workflow would drop and the model would stall.
      seedRegistry();
      const routed = routeToolsForCycle([
        userMsg('مرحبا'),
        assistantCall('sales.tool_3'),
        userMsg('تمام'),
      ]);
      expect(routed.routedByIntent).toBe(true);
      const names = routed.tools.map((t) => t.name);
      expect(names).toContain('sales.tool_3'); // the called tool itself
      expect(names).toContain('sales.tool_0'); // its domain siblings
      expect(names).not.toContain('hr.tool_0'); // unrelated domains stay out
    });

    it('reads both function.name and legacy name shapes', () => {
      seedRegistry();
      const legacy = {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c2', name: 'hr.tool_7' }],
      } as unknown as LlmMessage;
      const routed = routeToolsForCycle([userMsg('مرحبا'), legacy, userMsg('ok')]);
      expect(routed.tools.map((t) => t.name)).toContain('hr.tool_0');
    });

    it('ignores unregistered called tools without crashing', () => {
      seedRegistry();
      const routed = routeToolsForCycle([
        userMsg('مرحبا'),
        assistantCall('ghost.tool_1'),
        userMsg('تمام'),
      ]);
      expect(routed.routedByIntent).toBe(false);
      expect(routed.tools.length).toBe(9);
    });
  });
});
