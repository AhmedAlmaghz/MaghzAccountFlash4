import { describe, it, expect, beforeEach } from 'vitest';
import { registerTool, clearToolRegistry } from '../tools/registry';
import { routeToolsForCycle, MAX_ADVERTISED_TOOLS } from './toolRouter';
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

describe('toolRouter — POS / tax / fixed-assets intent groups', () => {
  beforeEach(() => {
    clearToolRegistry();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(adminUser);
    registerTool(makeTool('app.list_pages', 'ai.use' as never));
    registerTool(makeTool('app.navigate', 'ai.use' as never));
    registerTool(makeTool('pos.get_active_shift', 'pos.view'));
    registerTool(makeTool('pos.list_shifts', 'pos.view'));
    registerTool(makeTool('pos.checkout_sale', 'pos.create'));
    registerTool(makeTool('pos.get_shift_summary', 'pos.view'));
    registerTool(makeTool('tax.close_period', 'accounting.post'));
    registerTool(makeTool('tax.vat_return', 'accounting.view'));
    registerTool(makeTool('accounting.close_fiscal_year', 'accounting.post'));
    registerTool(makeTool('accounting.run_depreciation', 'accounting.post'));
    registerTool(makeTool('sales.create_invoice', 'sales.create'));
  });

  it('routes the pos. domain on cashier intent keywords', () => {
    const routed = routeToolsForCycle([userMsg('افتح وردية الكاشير في نقطة البيع')]);
    expect(routed.routedByIntent).toBe(true);
    const names = routed.tools.map((t) => t.name);
    expect(names).toContain('pos.get_active_shift');
    expect(names).toContain('pos.checkout_sale');
    expect(names).not.toContain('tax.close_period');
  });

  it('routes pos. tools on receipt / shift keywords', () => {
    const routed = routeToolsForCycle([userMsg('اعرض إيصال الوردية shift receipt')]);
    const names = routed.tools.map((t) => t.name);
    expect(names).toContain('pos.get_shift_summary');
    expect(names).toContain('pos.list_shifts');
  });

  it('routes tax + accounting tools on tax-country intent', () => {
    const routed = routeToolsForCycle([userMsg('ما الدولة الضريبية؟ اعرض الإقرار tax return period')]);
    expect(routed.routedByIntent).toBe(true);
    const names = routed.tools.map((t) => t.name);
    expect(names).toContain('tax.close_period');
    expect(names).toContain('tax.vat_return');
  });

  it('routes accounting fixed-asset tools on depreciation / year-end intent', () => {
    const routed = routeToolsForCycle([userMsg('شغّل إهلاك الأصول ثم الإقفال السنوي year-end depreciation')]);
    const names = routed.tools.map((t) => t.name);
    expect(names).toContain('accounting.run_depreciation');
    expect(names).toContain('accounting.close_fiscal_year');
  });

  it('keeps the 48-tool cap with the new groups present', () => {
    expect(MAX_ADVERTISED_TOOLS).toBe(48);
    const routed = routeToolsForCycle([userMsg('تقرير وردية وإقرار وإهلاك')]);
    expect(routed.tools.length).toBeLessThanOrEqual(MAX_ADVERTISED_TOOLS);
  });
});
