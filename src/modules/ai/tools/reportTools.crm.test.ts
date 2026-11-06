import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `crm.sales_funnel` win-rate semantics.
 *
 * The old denominator was EVERY opportunity (won + lost + open), so a healthy
 * growing pipeline kept pushing the rate down — contradicting
 * `crm.rep_performance`, which computes won/(won+lost). Closed deals are the
 * only honest base for a win rate.
 */
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
vi.mock('@/modules/hr/api', () => ({ hrApi: {} }));
vi.mock('@/modules/manufacturing/api', () => ({ manufacturingApi: {} }));
vi.mock('@/modules/auth/store', () => ({
  useAuthStore: { getState: () => ({ hasPermission: mocks.hasPermission }) },
}));
vi.mock('@/core/database/adapters', () => ({
  isElectronPg: vi.fn(() => false),
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

/**
 * Route each of the three parallel queries by its shape instead of call
 * order — Promise.all preserves order today, but SQL-shape routing keeps the
 * test honest if the tool reorders its queries.
 */
function mockFunnel(opts: {
  leads?: Array<{ status: string; count: number }>;
  stages?: Array<{ stage: string; count: number; total_value: string }>;
  invoices?: { count: number; total_revenue: string };
}) {
  mocks.adapterQuery.mockImplementation(async (sql: string) => {
    if (/FROM leads/.test(sql)) return { success: true, rows: opts.leads || [] };
    if (/FROM opportunities/.test(sql)) return { success: true, rows: opts.stages || [] };
    if (/FROM sales_invoices/.test(sql)) return { success: true, rows: [opts.invoices || { count: 0, total_revenue: '0' }] };
    return { success: true, rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
});

describe('crm.sales_funnel — win rate over closed deals', () => {
  it('divides by won+lost only (open pipeline must not dilute the rate)', async () => {
    mockFunnel({
      stages: [
        { stage: 'won', count: 3, total_value: '300' },
        { stage: 'lost', count: 1, total_value: '100' },
        { stage: 'new', count: 20, total_value: '2000' },
        { stage: 'negotiation', count: 5, total_value: '500' },
      ],
    });

    const res = (await findTool('crm.sales_funnel').execute({}, ctx)) as Record<string, unknown>;
    expect(res.opportunityWinRate).toBe(75);
    expect(res.closedDeals).toBe(4);
    const funnel = res.funnel as Record<string, Record<string, unknown>>;
    expect(funnel.wonDeals.count).toBe(3);
    expect(funnel.lostDeals.count).toBe(1);
    expect(funnel.opportunities.count).toBe(29);
  });

  it('reports 0 (not NaN) when no deal has closed yet', async () => {
    mockFunnel({
      stages: [
        { stage: 'new', count: 4, total_value: '400' },
        { stage: 'proposal', count: 2, total_value: '200' },
      ],
    });

    const res = (await findTool('crm.sales_funnel').execute({}, ctx)) as Record<string, unknown>;
    expect(res.opportunityWinRate).toBe(0);
    expect(res.closedDeals).toBe(0);
  });

  it('counts lost deals even when nothing was won', async () => {
    mockFunnel({
      stages: [
        { stage: 'lost', count: 2, total_value: '150' },
        { stage: 'qualified', count: 1, total_value: '50' },
      ],
    });

    const res = (await findTool('crm.sales_funnel').execute({}, ctx)) as Record<string, unknown>;
    expect(res.opportunityWinRate).toBe(0);
    expect(res.closedDeals).toBe(2);
    expect((res.funnel as Record<string, Record<string, unknown>>).lostDeals.count).toBe(2);
  });
});
