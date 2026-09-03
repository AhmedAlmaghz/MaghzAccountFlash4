import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    getCustomersPaginated: vi.fn(),
  },
}));
vi.mock('@/modules/purchases/api', () => ({ purchasesApi: { getSuppliersPaginated: vi.fn() } }));
vi.mock('@/modules/inventory/api', () => ({ inventoryApi: { getProductsPaginated: vi.fn() } }));
vi.mock('@/modules/hr/api', () => ({ hrApi: { getEmployeeById: vi.fn() } }));
vi.mock('@/modules/crm/api', () => ({
  crmApi: { getLeadById: vi.fn(), getOpportunitiesPaginated: vi.fn() },
}));

import { resolveArgsForCard } from './cardResolvers';
import { salesApi } from '@/modules/sales/api';
import { inventoryApi } from '@/modules/inventory/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

/**
 * The approval-card contract: a user must never be asked to consent to
 * "المعرف: 3f2a1b9c…" — ids resolve to HUMAN names/numbers before render.
 */
describe('resolveArgsForCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves customerId into a human label', async () => {
    vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 'cust-1', name: 'شركة الأمل', balance: 0 }],
        total: 1, page: 1, pageSize: 200, totalPages: 1,
      },
    } as never);

    const labels = await resolveArgsForCard({ customerId: 'cust-1' }, ctx);
    expect(labels).toEqual(['عميل: شركة الأمل']);
  });

  it('resolves productIds inside lines[] (each unique product once)', async () => {
    vi.mocked(inventoryApi.getProductsPaginated).mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 'p-1', nameAr: 'كرتون', code: 'PRD-001' },
          { id: 'p-2', nameAr: 'أرز بسمتي', code: 'PRD-002' },
        ],
        total: 2, page: 1, pageSize: 200, totalPages: 1,
      },
    } as never);

    const labels = await resolveArgsForCard(
      { lines: [{ productId: 'p-1' }, { productId: 'p-2' }, { productId: 'p-1' }] },
      ctx,
    );
    expect(labels).toEqual(['كرتون (PRD-001)', 'أرز بسمتي (PRD-002)']);
  });

  it('returns [] when nothing resolves (best-effort — card keeps plain summary)', async () => {
    vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({ success: false } as never);
    const labels = await resolveArgsForCard({ customerId: 'missing' }, ctx);
    expect(labels).toEqual([]);
  });

  it('swallows API rejections without breaking the card flow', async () => {
    vi.mocked(salesApi.getCustomersPaginated).mockRejectedValue(new Error('DB down') as never);
    const labels = await resolveArgsForCard({ customerId: 'x' }, ctx);
    expect(labels).toEqual([]);
  });

  it('ignores non-id and empty fields', async () => {
    const labels = await resolveArgsForCard({ amount: 500, notes: '', customerId: '' }, ctx);
    expect(labels).toEqual([]);
    expect(salesApi.getCustomersPaginated).not.toHaveBeenCalled();
  });
});
