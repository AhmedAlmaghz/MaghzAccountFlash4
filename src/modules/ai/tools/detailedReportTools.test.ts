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

/**
 * Regression for the P0 audit findings (2026-09-12):
 * five report tools were 100% dead at runtime while every gate stayed green —
 * the boilerplate "No schema changes" confidence masked hand-typed SQL with
 * misnumbered placeholders and ORDER-BY-on-ghost-aliases.
 *
 *   1. `sales.sales_by_user` / `purchases.purchases_by_user` passed
 *      [companyId, from, to, limit] but the SQL used `BETWEEN $1 AND $2`
 *      ($1 = companyId UUID against a DATE column!) and `LIMIT $3`
 *      (which received the toDate string!). PG: "invalid input syntax".
 *      Fixed: `BETWEEN $2 AND $3 … LIMIT $4`.
 *   2. `sales.sales_by_product` / `purchases.purchases_by_product` /
 *      `inventory.stock_by_warehouse` sorted by `total_revenue` /
 *      `total_quantity` / `total_value` / `product_count` while the SELECT
 *      aliases were `rev/qty/val/_n/icnt`. "column does not exist" on EVERY
 *      call, including the DEFAULT sort. Fixed: sort by the real aliases.
 *
 * These tests pin the exact (SQL, params) contract via the mocked adapter.
 */
describe('P0 dead-report-tools regression (placeholders + ORDER-BY aliases)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function captured() {
    return (async () => {
      const adapter = await vi.mocked(getDbAdapter)();
      return vi.mocked(adapter.query).mock.calls.map((c) => ({
        sql: String(c[0]),
        params: c[1] as unknown[],
      }));
    })();
  }

  it('sales.sales_by_user: BETWEEN uses $2/$3 (dates), LIMIT uses $4', async () => {
    const tool = findTool('sales.sales_by_user');
    expect(tool).toBeDefined();

    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({ fromDate: '2026-09-01', toDate: '2026-09-30' }, ctx);

    const calls = await captured();
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];
    expect(sql).toMatch(/i\.date BETWEEN \$2 AND \$3/);
    expect(sql).toMatch(/LIMIT \$4/);
    // params order: companyId, from, to, limit
    expect(params[0]).toBe(ctx.companyId);
    expect(params[1]).toBe('2026-09-01');
    expect(params[2]).toBe('2026-09-30');
    expect(typeof params[3]).toBe('number');
  });

  it('purchases.purchases_by_user: BETWEEN uses $2/$3 (dates), LIMIT uses $4', async () => {
    const tool = findTool('purchases.purchases_by_user');
    expect(tool).toBeDefined();

    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({ fromDate: '2026-09-01', toDate: '2026-09-30' }, ctx);

    const calls = await captured();
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];
    expect(sql).toMatch(/pi\.date BETWEEN \$2 AND \$3/);
    expect(sql).toMatch(/LIMIT \$4/);
    expect(params[0]).toBe(ctx.companyId);
    expect(params[1]).toBe('2026-09-01');
    expect(params[2]).toBe('2026-09-30');
    expect(typeof params[3]).toBe('number');
  });

  it('sales.sales_by_product: default sort is the real `rev` alias', async () => {
    const tool = findTool('sales.sales_by_product');
    expect(tool).toBeDefined();

    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({}, ctx);

    const calls = await captured();
    expect(calls).toHaveLength(1);
    // SELECT aliases are qty/rev/ccnt/icnt — no total_* ghost.
    expect(calls[0].sql).toMatch(/ORDER BY rev /);
    expect(calls[0].sql).not.toMatch(/total_revenue/);
  });

  it('sales.sales_by_product: quantity sort maps to the real `qty` alias', async () => {
    const tool = findTool('sales.sales_by_product');
    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({ sortField: 'quantity' }, ctx);

    const calls = await captured();
    expect(calls[0].sql).toMatch(/ORDER BY qty /);
  });

  it('purchases.purchases_by_product: default sort is the real `val` alias', async () => {
    const tool = findTool('purchases.purchases_by_product');
    expect(tool).toBeDefined();

    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({}, ctx);

    const calls = await captured();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/ORDER BY val /);
    expect(calls[0].sql).not.toMatch(/total_value/);
  });

  it('inventory.stock_by_warehouse: default sort is the real `val` alias', async () => {
    const tool = findTool('inventory.stock_by_warehouse');
    expect(tool).toBeDefined();

    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({}, ctx);

    const calls = await captured();
    expect(calls).toHaveLength(1);
    // SELECT aliases are _n/qty/val — no total_*/product_count ghosts.
    expect(calls[0].sql).toMatch(/ORDER BY val /);
    expect(calls[0].sql).not.toMatch(/total_quantity|product_count|total_value/);
  });

  it('inventory.stock_by_warehouse: count sort maps to the real `_n` alias', async () => {
    const tool = findTool('inventory.stock_by_warehouse');
    mockAdapter([], { total: 0, cnt: 0 });
    await tool!.execute({ sortField: 'count' }, ctx);

    const calls = await captured();
    expect(calls[0].sql).toMatch(/ORDER BY _n /);
  });
});
