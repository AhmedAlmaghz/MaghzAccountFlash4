import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(() => true),
  adapterQuery: vi.fn(),
}));

vi.mock('@/modules/sales/api', () => ({ salesApi: {} }));
vi.mock('@/modules/purchases/api', () => ({ purchasesApi: {} }));
vi.mock('@/modules/accounting/api', () => ({
  accountingApi: {},
  AccountingService: {},
}));
vi.mock('@/modules/accounting/services', () => ({ accountingService: {} }));
vi.mock('@/modules/inventory/api', () => ({ inventoryApi: {} }));
vi.mock('@/modules/hr/api', () => ({
  hrApi: { getHrKpis: vi.fn(async () => ({ success: true, data: { totalEmployees: 7 } })) },
}));
vi.mock('@/modules/manufacturing/api', () => ({
  manufacturingApi: {
    getManufacturingKpis: vi.fn(async () => ({
      success: true,
      data: { totalWorkOrders: 3, activeOrders: 1, completedOrders: 2, totalProductionCost: 500 },
    })),
  },
}));
vi.mock('@/modules/auth/store', () => ({
  useAuthStore: { getState: () => ({ hasPermission: mocks.hasPermission }) },
}));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({ query: mocks.adapterQuery })),
}));

import { reportTools } from './reportTools';
import type { ToolContext } from '../types';

const ctx: ToolContext = { companyId: 'c1', userId: 'u1' };

function findTool(name: string) {
  const t = reportTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as { execute: (a: Record<string, unknown>, c: ToolContext) => Promise<unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.adapterQuery.mockResolvedValue({ success: true, rows: [{ revenue: 0, count: 0, amount: 0 }] });
});

describe('reports.dashboard — module-gated blocks (P0-8 regression)', () => {
  // reports.view alone must NOT expose HR/manufacturing KPIs. Each block is
  // gated at runtime (like the dashboard page) with an honest permissionsNote.
  it('includes the HR block when the caller holds hr.view', async () => {
    const res = (await findTool('reports.dashboard').execute({}, ctx)) as Record<string, unknown>;
    expect(mocks.hasPermission).toHaveBeenCalledWith('hr.view');
    const { hrApi: mockedHr } = await import('@/modules/hr/api');
    expect(vi.mocked(mockedHr.getHrKpis)).toHaveBeenCalled();
    expect((res.counts as Record<string, unknown>).employees).toBe(7);
  });

  it('omits HR employee data and manufacturing block without the module grants', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'reports.view');
    const res = (await findTool('reports.dashboard').execute({}, ctx)) as Record<string, unknown>;
    const { hrApi: mockedHr } = await import('@/modules/hr/api');
    const { manufacturingApi: mockedMfg } = await import('@/modules/manufacturing/api');
    expect(vi.mocked(mockedHr.getHrKpis)).not.toHaveBeenCalled();
    expect(vi.mocked(mockedMfg.getManufacturingKpis)).not.toHaveBeenCalled();
    expect((res.counts as Record<string, unknown>).employees).toBeUndefined();
    expect((res as Record<string, unknown>).manufacturing).toBeUndefined();
    expect(String((res as Record<string, unknown>).permissionsNote)).toMatch(/hr\.view/);
  });

  it('includes manufacturing but not HR when only manufacturing.view is held', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'manufacturing.view' || p === 'reports.view');
    const res = (await findTool('reports.dashboard').execute({}, ctx)) as Record<string, unknown>;
    expect((res.counts as Record<string, unknown>).employees).toBeUndefined();
    expect((res as Record<string, unknown>).manufacturing).toBeDefined();
  });
});
