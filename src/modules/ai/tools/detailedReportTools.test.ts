import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { detailedReportTools } from './detailedReportTools';
import { getDbAdapter } from '@/core/database/adapters';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool(name: string) {
  return detailedReportTools.find((t) => t.name === name);
}

function mockAdapter(detRows: unknown[], aggRow: unknown) {
  vi.mocked(getDbAdapter).mockResolvedValue({
    query: vi.fn(async (sql: string) => {
      if (/SUM\(q\.total_amount\)/.test(sql)) return { success: true, rows: [aggRow] };
      return { success: true, rows: detRows };
    }),
  } as never);
}

/**
 * Regression for the P0 audit finding (2026-09):
 * `sales.quotations_detailed` used to call salesApi.getInvoicesPaginated —
 * it fetched SALES INVOICES and re-labelled them as quotations. The user
 * asked for a quotations report and silently got invoice data.
 *
 * P2 follow-up (2026-09-11): the paginated-API version filtered dates
 * CLIENT-side over a 200-row window — old quotations vanished with
 * totalValue 0. The tool now runs det+agg SQL server-side like its
 * siblings; these tests pin the SQL contract instead of the API call.
 */
describe('sales.quotations_detailed (wrong-API + client-filter regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries the quotations table (never sales_invoices) with server-side dates', async () => {
    const tool = findTool('sales.quotations_detailed');
    expect(tool).toBeDefined();

    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({ fromDate: '2026-09-01', toDate: '2026-09-30' }, ctx);

    const adapter = await vi.mocked(getDbAdapter)();
    const queries = vi.mocked(adapter.query).mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => /FROM quotations q/.test(q))).toBe(true);
    expect(queries.some((q) => /q\.date BETWEEN/.test(q))).toBe(true);
    expect(queries.some((q) => /sales_invoices/.test(q))).toBe(false);
  });

  it('maps QUOTATION fields (quotation_number/expiry_date/customer_name) — not invoice fields', async () => {
    const tool = findTool('sales.quotations_detailed');
    expect(tool).toBeDefined();

    mockAdapter(
      [{
        quotation_number: 'QTN-0042', customer_name: 'شركة الأمل',
        date: '2026-09-10', expiry_date: '2026-09-20',
        total_amount: 150000, status: 'draft', created_by_name: null,
      }],
      { total: 150000, cnt: 1 },
    );

    const res = (await tool!.execute(
      { fromDate: '2026-09-01', toDate: '2026-09-30' },
      ctx,
    )) as Record<string, unknown>;

    const quotes = res.quotations as Array<Record<string, unknown>>;
    expect(quotes).toHaveLength(1);
    expect(quotes[0].number).toBe('QTN-0042');
    expect(quotes[0].customer).toBe('شركة الأمل');
    expect(quotes[0].expiryDate).toBe('2026-09-20');
    expect(quotes[0].status).toBe('draft');
  });

  it('computes totals server-side (aggregate query, not a JS reduce over a window)', async () => {
    const tool = findTool('sales.quotations_detailed');
    mockAdapter([], { total: 987654, cnt: 42 });

    const res = (await tool!.execute(
      { fromDate: '2020-01-01', toDate: '2020-12-31' },
      ctx,
    )) as Record<string, unknown>;

    // Zero detail rows, but the AGGREGATE still reports the period total —
    // the old client-side reduce would have returned 0 unconditionally.
    expect(res.totalValue).toBe(987654);
    expect(res.count).toBe(0);
  });

  it('forwards status and customerId filters into the SQL', async () => {
    const tool = findTool('sales.quotations_detailed');
    mockAdapter([], { total: 0, cnt: 0 });

    await tool!.execute({ status: 'accepted', customerId: 'cust-9' }, ctx);

    const adapter = await vi.mocked(getDbAdapter)();
    const queries = vi.mocked(adapter.query).mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => /q\.status=/.test(q))).toBe(true);
    expect(queries.some((q) => /q\.customer_id=/.test(q))).toBe(true);
  });
});
