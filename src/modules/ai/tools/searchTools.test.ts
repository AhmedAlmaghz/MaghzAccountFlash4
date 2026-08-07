import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchTools } from './searchTools';
import type { ToolContext } from '../types';
import type { User } from '@/modules/auth/types';
import { useAuthStore } from '@/modules/auth/store';

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    getCustomersPaginated: vi.fn(),
    getQuotations: vi.fn(),
    getInvoices: vi.fn(),
    getReturns: vi.fn(),
  },
}));

vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: {
    getSuppliersPaginated: vi.fn(),
    getInvoices: vi.fn(),
    getOrders: vi.fn(),
    getReturns: vi.fn(),
  },
}));

vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: {
    getProductsPaginated: vi.fn(),
    getWarehouses: vi.fn(),
  },
}));

vi.mock('@/modules/accounting/api', () => ({
  accountingApi: {
    getAccounts: vi.fn(),
  },
}));

vi.mock('@/modules/crm/api', () => ({
  crmApi: {
    getLeadsPaginated: vi.fn(),
    getOpportunitiesPaginated: vi.fn(),
  },
}));

vi.mock('@/modules/hr/api', () => ({
  hrApi: {
    getEmployeesPaginated: vi.fn(),
  },
}));

import { salesApi } from '@/modules/sales/api';
import { inventoryApi } from '@/modules/inventory/api';
import { purchasesApi } from '@/modules/purchases/api';

const ctx: ToolContext = { companyId: 'c1', userId: 'u1' };

const adminUser: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };

function findTool(name: string) {
  const tool = searchTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().login(adminUser);
});

describe('AI search tools — fuzzy matching against DB rows', () => {
  describe('search.customers', () => {
    it('matches customers whose name contains query letters even when DB has ة but query has ه', async () => {
      // The DB stores "شركة الأمل" with ة, but the user typed "شركه الامل" with ه.
      // Old behavior: ILIKE %شركه الامل% did NOT match "شركة الأمل" → empty results.
      // New behavior: fuzzy matching in JS normalizes both sides → match found.
      vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
        success: true,
        data: {
          items: [
            { id: 'c1', name: 'شركة الأمل للتجارة', phone: '777111222', balance: 5000, code: 'CUST-001' },
            { id: 'c2', name: 'مؤسسة النور', phone: '777333444', balance: 0, code: 'CUST-002' },
          ],
          total: 2,
          page: 1,
          pageSize: 200,
          totalPages: 1,
        },
      });

      const result = await findTool('search.customers').execute({ query: 'شركه الامل' }, ctx);

      expect(result).toMatchObject({
        matches: expect.arrayContaining([
          expect.objectContaining({ id: 'c1', name: 'شركة الأمل للتجارة' }),
        ]),
        totalMatches: 1,
      });
    });

    it('returns empty when nothing matches', async () => {
      vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
        success: true,
        data: {
          items: [
            { id: 'c1', name: 'شركة الأمل', phone: '777', balance: 0, code: 'C1' },
          ],
          total: 1, page: 1, pageSize: 200, totalPages: 1,
        },
      });

      const result = await findTool('search.customers').execute({ query: 'xyzabc' }, ctx);

      expect(result).toMatchObject({ matches: [], totalMatches: 0 });
    });
  });

  describe('search.products', () => {
    it('matches product with alef variants (أرز vs ارز)', async () => {
      // DB has "أرز بسمتي" but user typed "ارز بسمتي"
      vi.mocked(inventoryApi.getProductsPaginated).mockResolvedValue({
        success: true,
        data: {
          items: [
            { id: 'p1', code: 'PRD-001', nameAr: 'أرز بسمتي فاخر', nameEn: 'Basmati Rice', salePrice: 3200, costPrice: 2800, quantity: 100, barcode: '', sku: '' },
            { id: 'p2', code: 'PRD-015', nameAr: 'بسكويت أوريو', nameEn: 'Oreo Biscuit', salePrice: 650, costPrice: 550, quantity: 50, barcode: '', sku: '' },
          ],
          total: 2, page: 1, pageSize: 200, totalPages: 1,
        },
      });

      const result = await findTool('search.products').execute({ query: 'ارز بسمتي' }, ctx);

      expect(result).toMatchObject({
        matches: expect.arrayContaining([
          expect.objectContaining({ id: 'p1', code: 'PRD-001' }),
        ]),
      });
      // Should NOT match Oreo for "ارز"
      const matchIds = (result as { matches: { id: string }[] }).matches.map((m) => m.id);
      expect(matchIds).not.toContain('p2');
    });

    it('matches by SKU and barcode', async () => {
      vi.mocked(inventoryApi.getProductsPaginated).mockResolvedValue({
        success: true,
        data: {
          items: [
            { id: 'p1', code: 'PRD-001', nameAr: 'منتج ١', nameEn: '', salePrice: 100, costPrice: 80, quantity: 5, barcode: '6281234567890', sku: 'SKU-A1' },
          ],
          total: 1, page: 1, pageSize: 200, totalPages: 1,
        },
      });

      const bySku = await findTool('search.products').execute({ query: 'SKU-A1' }, ctx);
      expect((bySku as { matches: { id: string }[] }).matches.map((m) => m.id)).toContain('p1');

      const byBarcode = await findTool('search.products').execute({ query: '6281234' }, ctx);
      expect((byBarcode as { matches: { id: string }[] }).matches.map((m) => m.id)).toContain('p1');
    });
  });

  describe('search.suppliers', () => {
    it('matches suppliers with yeh variants (ى vs ي)', async () => {
      vi.mocked(purchasesApi.getSuppliersPaginated).mockResolvedValue({
        success: true,
        data: {
          items: [
            { id: 's1', name: 'مورّد الأوائل', phone: '711', balance: 0, code: 'SUP-001' },
          ],
          total: 1, page: 1, pageSize: 200, totalPages: 1,
        },
      });

      const result = await findTool('search.suppliers').execute({ query: 'مورد الاول' }, ctx);

      expect((result as { matches: { id: string }[] }).matches.map((m) => m.id)).toContain('s1');
    });
  });

  describe('error and edge cases', () => {
    it('returns error when API fails', async () => {
      vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
        success: false,
        error: 'connection refused',
      });

      const result = await findTool('search.customers').execute({ query: 'test' }, ctx);

      expect(result).toMatchObject({ error: expect.stringContaining('connection') });
    });

    it('returns error for empty query', async () => {
      const result = await findTool('search.customers').execute({ query: '' }, ctx);
      expect(result).toMatchObject({ error: expect.stringContaining('مطلوب') });
    });

    it('does not call API when query is empty', async () => {
      await findTool('search.customers').execute({ query: '   ' }, ctx);
      expect(salesApi.getCustomersPaginated).not.toHaveBeenCalled();
    });
  });
});
