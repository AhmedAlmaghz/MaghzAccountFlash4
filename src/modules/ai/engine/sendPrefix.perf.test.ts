import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same API mocks as entityResolver.test.ts — tool/skill modules import these.
vi.mock('@/modules/sales/api', () => ({
  salesApi: { getCustomersPaginated: vi.fn(), getQuotations: vi.fn(), getInvoices: vi.fn(), getReturns: vi.fn() },
}));
vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: { getSuppliersPaginated: vi.fn(), getInvoices: vi.fn(), getOrders: vi.fn(), getReturns: vi.fn() },
}));
vi.mock('@/modules/inventory/api', () => ({
  inventoryApi: { getProductsPaginated: vi.fn(), getWarehouses: vi.fn() },
}));
vi.mock('@/modules/accounting/api', () => ({
  accountingApi: { getAccounts: vi.fn(), getReceiptVouchersPaginated: vi.fn(), getPaymentVouchersPaginated: vi.fn() },
}));
vi.mock('@/modules/hr/api', () => ({
  hrApi: { getEmployeesPaginated: vi.fn() },
}));
vi.mock('@/modules/manufacturing/api', () => ({
  manufacturingApi: { getWorkOrders: vi.fn(), getBoms: vi.fn() },
}));
vi.mock('@/modules/crm/api', () => ({
  crmApi: { getLeadsPaginated: vi.fn() },
}));
vi.mock('@/modules/core/api', () => ({
  getCashBoxes: vi.fn(async () => ({ success: true, data: [] })),
  getBanks: vi.fn(async () => ({ success: true, data: [] })),
  coreApi: { getVatSettings: vi.fn(async () => ({ success: true, data: { vatRate: 15 } })) },
}));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({ query: vi.fn(async () => ({ success: true, rows: [] })) })),
  isElectronPg: vi.fn(() => false),
}));

import { ensureToolsRegistered, getVisibleTools } from '../tools/index';
import { ensureSkillsRegistered, selectActiveSkills } from '../skills/index';
import { buildSystemPrompt } from './systemPrompt';
import { expandDialectText } from './dialectMap';
import { needsEntityResolution } from '../entityResolver';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const user: User = { id: 'u1', username: 'tester', role: 'admin', isActive: true };

// Realistic second-turn texts, including pathological shapes.
const TEXTS = [
  'استمر',
  'تابع',
  'نعم سجلها ورحلها',
  'سجل فاتورة مبيعات لغدة بمبلغ 132,500 ريال نقدا من الخزنة الرئيسية',
  'و'.repeat(200),
  'ب'.repeat(500) + 'كاش',
  'اشتراك الانترنت ' + 'ال'.repeat(100),
  'فاتورة '.repeat(300),
  ' mixed عربي English 123 underscore_test-dash ',
  '؟؟؟!!!...,,,   ',
];

describe('send() sync prefix — must never block the UI thread', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(user, []);
    ensureToolsRegistered();
    ensureSkillsRegistered();
  });

  it('registers once and exposes tools', () => {
    const tools = getVisibleTools();
    expect(tools.length).toBeGreaterThan(100);
  });

  it('buildSystemPrompt over all visible tools is fast', () => {
    const tools = getVisibleTools();
    const activeSkills = selectActiveSkills({
      userMessage: 'أنشئ فاتورة مبيعات وسجل سند قبض ثم رحل',
      visibleTools: tools,
    });
    const t0 = performance.now();
    const prompt = buildSystemPrompt({ tools, activeSkills, liveContext: { vatRate: 15 } });
    const dt = performance.now() - t0;
    expect(prompt.length).toBeGreaterThan(1000);
    expect(dt).toBeLessThan(2000);
  });

  it('expandDialectText never backtracks on any shape', () => {
    for (const text of TEXTS) {
      const t0 = performance.now();
      const out = expandDialectText(text);
      const dt = performance.now() - t0;
      expect(typeof out.text).toBe('string');
      expect(dt).toBeLessThan(1000);
    }
  });

  it('needsEntityResolution gate is instant', () => {
    for (const text of TEXTS) {
      const t0 = performance.now();
      needsEntityResolution(text);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
    expect(needsEntityResolution('استمر')).toBe(false);
  });
});
