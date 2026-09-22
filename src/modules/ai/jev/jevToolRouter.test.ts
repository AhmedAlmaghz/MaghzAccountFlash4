import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn().mockResolvedValue({ success: true, rows: [] }),
}));

vi.mock('../tools/registry', () => ({
  getVisibleTools: () => [
    { name: 'sales.create_invoice', descriptionAr: '', labelAr: '', permission: 'sales.create', dangerLevel: 'write', parameters: {}, execute: async () => ({}) },
    { name: 'purchases.create_invoice', descriptionAr: '', labelAr: '', permission: 'purchases.create', dangerLevel: 'write', parameters: {}, execute: async () => ({}) },
    { name: 'inventory.create_product', descriptionAr: '', labelAr: '', permission: 'inventory.create', dangerLevel: 'write', parameters: {}, execute: async () => ({}) },
    { name: 'hr.create_employee', descriptionAr: '', labelAr: '', permission: 'hr.create', dangerLevel: 'write', parameters: {}, execute: async () => ({}) },
    { name: 'search.customers', descriptionAr: '', labelAr: '', permission: 'sales.view', dangerLevel: 'read', parameters: {}, execute: async () => ({}) },
    { name: 'app.navigate', descriptionAr: '', labelAr: '', permission: 'sales.view', dangerLevel: 'read', parameters: {}, execute: async () => ({}) },
  ],
}));

vi.mock('./jevConfig', () => ({
  getJevConfig: vi.fn().mockResolvedValue({ enabled: false, apiKey: null, routerEnabled: false, guardEnabled: false, model: 'jev-latest', baseUrl: 'https://api.typesafe.ai' }),
  JEV_DEFAULT_MODEL: 'jev-latest',
  JEV_DEFAULT_BASE_URL: 'https://api.typesafe.ai',
  JEV_SETTINGS_KEYS: {},
}));

vi.mock('./jevClient', () => ({
  jevSystemOne: vi.fn().mockResolvedValue(null),
}));

import { jevRouteToolsForCycle } from './jevToolRouter';

function userMsg(text: string) {
  return { role: 'user' as const, content: text };
}

describe('jevToolRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to legacy when JEV disabled', async () => {
    const routed = await jevRouteToolsForCycle('c1', [userMsg('مرحبا')]);
    expect(routed.jevUsed).toBe(false);
    expect(routed.intent).toBe('fallback');
    expect(routed.tools.length).toBeGreaterThan(0);
  });

  it('falls back gracefully on JEV failure', async () => {
    const { jevSystemOne } = await import('./jevClient');
    vi.mocked(jevSystemOne).mockResolvedValue(null);
    // Force enabled config
    const { getJevConfig } = await import('./jevConfig');
    vi.mocked(getJevConfig).mockResolvedValue({
      enabled: true, apiKey: 'ts_test', routerEnabled: true, guardEnabled: false, model: 'jev-latest', baseUrl: 'https://api.typesafe.ai',
    });
    const routed = await jevRouteToolsForCycle('c1', [userMsg('أنشئ فاتورة بيع')]);
    // jevSystemOne returns null → fallback, but jevUsed should be false (not consulted successfully)
    expect(routed.tools.length).toBeGreaterThan(0);
  });

  it('routes via JEV when intent is high confidence', async () => {
    const { getJevConfig } = await import('./jevConfig');
    vi.mocked(getJevConfig).mockResolvedValue({
      enabled: true, apiKey: 'ts_test', routerEnabled: true, guardEnabled: false, model: 'jev-latest', baseUrl: 'https://api.typesafe.ai',
    });
    const { jevSystemOne } = await import('./jevClient');
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        intent: { type: 'choice', choice: 'sales', confidence: 0.92, probabilities: { sales: 0.92, purchases: 0.03, inventory: 0.02, other: 0.03 } },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const routed = await jevRouteToolsForCycle('c1', [userMsg('أنشئ فاتورة بيع لشركة الأمل')]);
    expect(routed.jevUsed).toBe(true);
    expect(routed.intent).toBe('sales');
    expect(routed.confidence).toBeGreaterThan(0.85);
    expect(routed.tools.some((t) => t.name.startsWith('sales.'))).toBe(true);
  });
});
