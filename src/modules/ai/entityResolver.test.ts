import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEntitiesInText, clearEntityCache } from './entityResolver';

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
    getReceiptVouchersPaginated: vi.fn(),
    getPaymentVouchersPaginated: vi.fn(),
  },
}));

vi.mock('@/modules/hr/api', () => ({
  hrApi: {
    getEmployeesPaginated: vi.fn(),
  },
}));

vi.mock('@/modules/manufacturing/api', () => ({
  manufacturingApi: {
    getWorkOrders: vi.fn(),
    getBoms: vi.fn(),
  },
}));

vi.mock('@/modules/crm/api', () => ({
  crmApi: {
    getLeadsPaginated: vi.fn(),
  },
}));

vi.mock('@/core/api', () => ({
  getCashBoxes: vi.fn(async () => ({ success: true, data: [] })),
  getBanks: vi.fn(async () => ({ success: true, data: [] })),
}));

import { purchasesApi } from '@/modules/purchases/api';
import { salesApi } from '@/modules/sales/api';

const COMPANY = 'c1';

function mockSuppliers(names: string[]) {
  vi.mocked(purchasesApi.getSuppliersPaginated).mockResolvedValue({
    success: true,
    data: {
      items: names.map((name, i) => ({ id: `s${i}`, name, phone: '', balance: 0, code: `SUP-${i}` })),
      total: names.length,
      page: 1,
      pageSize: 200,
      totalPages: 1,
    },
  });
}

function mockCustomers(names: string[]) {
  vi.mocked(salesApi.getCustomersPaginated).mockResolvedValue({
    success: true,
    data: {
      items: names.map((name, i) => ({ id: `c${i}`, name, phone: '', balance: 0, code: `CUS-${i}` })),
      total: names.length,
      page: 1,
      pageSize: 200,
      totalPages: 1,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The resolver caches DB entities module-level with a 30s TTL — without
  // clearing it, tests would read stale entities from previous tests.
  clearEntityCache();
});

describe('entityResolver — guarded auto-correction', () => {
  it('REGRESSION: never corrects the name of a NEW supplier being defined via اسمه', async () => {
    // Chat transcript failure: existing supplier "الشجاع للتجارة"; user creates
    // a DIFFERENT supplier "الحمادي للتجارة" → old code rewrote the defined
    // name into "الحمادي الشجاع للتجارة".
    mockSuppliers(['الشجاع للتجارة']);

    const res = await resolveEntitiesInText(
      'قم باضافة مورد اسمه الحمادي للتجارة عنوانة شارع هايل حولة 20',
      COMPANY,
    );

    expect(res.corrections).toEqual([]);
    expect(res.text).toBe('قم باضافة مورد اسمه الحمادي للتجارة عنوانة شارع هايل حولة 20');
  });

  it('skips suffix-word matches when the canonical full name already appears verbatim', async () => {
    // Word "للتجارة" alone matches "الشجاع للتجارة" (substring shortcut),
    // but replacing it would duplicate the name ("الشجاع الشجاع للتجارة").
    mockSuppliers(['الشجاع للتجارة']);

    const res = await resolveEntitiesInText(
      'سجل فاتورة مشتريات من الشجاع للتجارة',
      COMPANY,
    );

    expect(res.corrections).toEqual([]);
    expect(res.text).toBe('سجل فاتورة مشتريات من الشجاع للتجارة');
  });

  it('never treats generic commercial suffixes as entity references', async () => {
    mockSuppliers(['الشجاع للتجارة', 'مؤسسة التاجر']);

    // "للتجارة" appears outside any definition zone and the full canonical
    // name is absent — still blocked because it is a generic trade suffix.
    const res = await resolveEntitiesInText('اشترِ من للتجارة اليوم', COMPANY);

    expect(res.corrections).toEqual([]);
  });

  it('still corrects genuine typos when referencing an existing supplier', async () => {
    mockSuppliers(['الشجاع']);

    const res = await resolveEntitiesInText('سجل فاتورة مشتريات من الشوجاع بقيمة 5000', COMPANY);

    expect(res.corrections).toHaveLength(1);
    expect(res.corrections[0]).toMatchObject({ type: 'supplier', original: 'الشوجاع', corrected: 'الشجاع' });
    expect(res.text).toBe('سجل فاتورة مشتريات من الشجاع بقيمة 5000');
  });

  it('protects typo-looking names inside definition zones (اسمه …)', async () => {
    // "الشوجاع" looks like a typo of existing "الشجاع" but the user is
    // DEFINING a new supplier with that exact name — must stay untouched.
    mockSuppliers(['الشجاع']);

    const res = await resolveEntitiesInText('اضافة مورد اسمه الشوجاع للتجارة', COMPANY);

    expect(res.corrections).toEqual([]);
    expect(res.text).toBe('اضافة مورد اسمه الشوجاع للتجارة');
  });

  it('corrects prepositional customer references ("لغدة" → "غدة")', async () => {
    mockCustomers(['غدة']);

    // "لغدة" (with preposition لام) strongly references customer "غدة"
    // (substring score 0.875 ≥ 0.75). The لام must NOT block the fix and the
    // replacement must not corrupt other words.
    const res = await resolveEntitiesInText('سجل فاتورة مبيعات لغدة', COMPANY);

    expect(res.corrections).toHaveLength(1);
    expect(res.corrections[0]).toMatchObject({ type: 'customer', original: 'لغدة', corrected: 'غدة' });
    expect(res.text).toBe('سجل فاتورة مبيعات غدة');
  });

  it('returns input text untouched when nothing matches', async () => {
    mockSuppliers(['الشجاع للتجارة']);
    mockCustomers(['مؤسسة غدرة التجارية']);

    const text = 'ما هو رصيد حساب المصروفات؟';
    const res = await resolveEntitiesInText(text, COMPANY);

    expect(res.corrections).toEqual([]);
    expect(res.text).toBe(text);
  });
});
