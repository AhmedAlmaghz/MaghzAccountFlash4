import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/sales/api', () => ({ salesApi: { getCustomersPaginated: vi.fn() } }));
vi.mock('@/modules/purchases/api', () => ({ purchasesApi: { getSuppliersPaginated: vi.fn() } }));
vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: { getProductsPaginated: vi.fn(), getWarehouses: vi.fn() },
}));
vi.mock('@/modules/accounting/api', () => ({
  accountingApi: { getAccounts: vi.fn(), getReceiptVouchersPaginated: vi.fn(), getPaymentVouchersPaginated: vi.fn() },
}));
vi.mock('@/modules/hr/api', () => ({
  hrApi: { getEmployeesPaginated: vi.fn(), getEmployeeById: vi.fn() },
}));
vi.mock('@/modules/manufacturing/api', () => ({
  manufacturingApi: { getWorkOrdersPaginated: vi.fn(), getBomsPaginated: vi.fn() },
}));
vi.mock('@/modules/crm/api', () => ({
  crmApi: { getLeadsPaginated: vi.fn(), getOpportunitiesPaginated: vi.fn(), getTasksPaginated: vi.fn(), getLeadById: vi.fn() },
}));
vi.mock('@/core/api', () => ({
  getCashBoxes: vi.fn(),
}));

import { prefetchEntityCache, searchEntities } from './entityResolver';
import { clearEntityCache } from './entityResolver';
import { salesApi } from '@/modules/sales/api';
import { hrApi } from '@/modules/hr/api';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const CID = '11111111-1111-1111-1111-111111111111';

function loginWith(perms: string[]) {
  useAuthStore.getState().logout();
  const user: User = { id: 'u1', username: 't', role: 'custom', isActive: true };
  useAuthStore.getState().login(user, perms as never);
}

/**
 * P2-9 regression: prefetch + search must be RBAC-filtered — a user without
 * hr.view must not warm or match the employees list at all.
 */
describe('entityResolver — RBAC-filtered lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEntityCache();
  });

  it('prefetch skips entity types the user cannot view', async () => {
    loginWith(['sales.view', 'inventory.view']); // NO hr.view
    vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
      success: true, data: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 },
    } as never);
    vi.mocked(hrApi.getEmployeesPaginated).mockResolvedValue({
      success: true, data: { items: [{ id: 'e1', fullName: 'سري جداً' }], total: 1, page: 1, pageSize: 50, totalPages: 1 },
    } as never);

    prefetchEntityCache(CID);
    // let the allSettled fire
    await new Promise((r) => setTimeout(r, 20));

    expect(hrApi.getEmployeesPaginated).not.toHaveBeenCalled();
  });

  it('search never returns restricted entity types', async () => {
    loginWith(['sales.view']); // no hr.view
    vi.mocked(hrApi.getEmployeesPaginated).mockResolvedValue({
      success: true, data: { items: [{ id: 'e1', fullName: 'موظف سري' }], total: 1, page: 1, pageSize: 50, totalPages: 1 },
    } as never);

    const results = await searchEntities('موظف سري', CID);
    expect(results.some((r) => r.type === 'employee')).toBe(false);
    expect(hrApi.getEmployeesPaginated).not.toHaveBeenCalled();
  });

  it('permitted entity types still search normally', async () => {
    loginWith(['sales.view']);
    vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 'c1', name: 'شركة الأمل', balance: 0 }],
        total: 1, page: 1, pageSize: 50, totalPages: 1,
      },
    } as never);

    const results = await searchEntities('شركة الأمل', CID);
    expect(results.some((r) => r.type === 'customer' && r.name === 'شركة الأمل')).toBe(true);
  });
});
