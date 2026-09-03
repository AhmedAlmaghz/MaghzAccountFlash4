import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    getQuotationsPaginated: vi.fn(),
  },
}));

import { detailedReportTools } from './detailedReportTools';
import { salesApi } from '@/modules/sales/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool(name: string) {
  return detailedReportTools.find((t) => t.name === name);
}

/**
 * Regression for the P0 audit finding (2026-09):
 * `sales.quotations_detailed` used to call salesApi.getInvoicesPaginated —
 * it fetched SALES INVOICES and re-labelled them as quotations. The user
 * asked for a quotations report and silently got invoice data.
 */
describe('sales.quotations_detailed (wrong-API regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getQuotationsPaginated — never getInvoicesPaginated', async () => {
    const tool = findTool('sales.quotations_detailed');
    expect(tool).toBeDefined();

    vi.mocked(salesApi.getQuotationsPaginated).mockResolvedValue({
      success: true,
      data: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
    } as never);

    await tool!.execute({ fromDate: '2026-09-01', toDate: '2026-09-30' }, ctx);

    expect(salesApi.getQuotationsPaginated).toHaveBeenCalledTimes(1);
    expect(salesApi.getQuotationsPaginated).toHaveBeenCalledWith(
      ctx.companyId,
      1,
      expect.any(Number),
      expect.objectContaining({ status: undefined, customerId: undefined }),
    );
    expect((salesApi as unknown as Record<string, unknown>).getInvoicesPaginated).toBeUndefined();
  });

  it('maps QUOTATION fields (quotationNumber/expiryDate/customer.name) — not invoice fields', async () => {
    const tool = findTool('sales.quotations_detailed');
    expect(tool).toBeDefined();

    vi.mocked(salesApi.getQuotationsPaginated).mockResolvedValue({
      success: true,
      data: {
        items: [{
          id: 'q1',
          quotationNumber: 'QTN-0042',
          customerId: 'c1',
          customer: { id: 'c1', name: 'شركة الأمل', balance: 0, isActive: true },
          date: '2026-09-10',
          expiryDate: '2026-09-20',
          totalAmount: 150000,
          status: 'draft',
          lines: [],
        }],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      },
    } as never);

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

  it('forwards status and customerId filters to the paginated API', async () => {
    const tool = findTool('sales.quotations_detailed');
    vi.mocked(salesApi.getQuotationsPaginated).mockResolvedValue({
      success: true,
      data: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
    } as never);

    await tool!.execute({ status: 'accepted', customerId: 'cust-9' }, ctx);
    expect(salesApi.getQuotationsPaginated).toHaveBeenCalledWith(
      ctx.companyId,
      1,
      expect.any(Number),
      { status: 'accepted', customerId: 'cust-9' },
    );
  });
});
