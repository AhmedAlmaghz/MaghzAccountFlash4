import { describe, it, expect } from 'vitest';
import { paletteItems, canAccessItem, canAccessModule } from './paletteItems';

const noPerms = () => false;
const allPerms = () => true;
const perm = (granted: string[]) => (p: string) => granted.includes(p);

describe('paletteItems registry', () => {
  it('covers all 11 modules', () => {
    const modules = new Set(paletteItems.map((i) => i.module));
    expect(modules.size).toBe(11);
  });

  it('has unique ids and paths', () => {
    const ids = new Set(paletteItems.map((i) => i.id));
    const paths = new Set(paletteItems.map((i) => i.path));
    expect(ids.size).toBe(paletteItems.length);
    expect(paths.size).toBe(paletteItems.length);
  });

  it('includes every protected route (mirror of router.tsx)', () => {
    const paths = paletteItems.map((i) => i.path);
    for (const p of [
      '/', '/accounting', '/accounting/chart', '/accounting/journal', '/accounting/trial', '/accounting/balance',
      '/accounting/profit', '/accounting/cashflow', '/accounting/receipt-vouchers',
      '/accounting/payment-vouchers', '/accounting/ledger', '/inventory', '/inventory/products',
      '/inventory/warehouses', '/inventory/stock', '/inventory/transactions',
      '/inventory/adjustments', '/sales', '/sales/invoices', '/sales/customers', '/sales/quotations',
      '/sales/returns', '/purchases', '/purchases/invoices', '/purchases/suppliers', '/purchases/orders',
      '/purchases/returns', '/manufacturing', '/manufacturing/bom', '/manufacturing/work-orders',
      '/manufacturing/cost-report', '/manufacturing/variance-report', '/hr', '/hr/employees',
      '/hr/departments', '/hr/attendance', '/hr/payroll', '/hr/leaves', '/hr/end-of-service', '/crm',
      '/crm/leads', '/crm/opportunities', '/crm/tasks', '/crm/activities', '/reports', '/reports/sales-analysis',
      '/reports/inventory-analysis', '/reports/low-stock-alert', '/reports/stock-movement',
      '/reports/stock-valuation', '/reports/customer-statement', '/reports/supplier-statement',
      '/reports/profit-analysis', '/reports/custom-builder', '/reports/lead-conversion',
      '/reports/opportunity-pipeline', '/users', '/roles', '/audit-logs', '/settings', '/settings/company',
      '/settings/themes', '/settings/currencies', '/settings/vat', '/settings/branches', '/settings/users',
      '/settings/ai', '/settings/document-sequences', '/settings/product-types',
      '/settings/product-categories', '/settings/default-accounts', '/settings/units',
      '/settings/cash-boxes', '/settings/cost-centers', '/settings/database', '/settings/backup',
      '/settings/hr-policies', '/settings/payroll-components', '/settings/reset', '/ai',
    ]) {
      expect(paths, `route ${p} must be searchable`).toContain(p);
    }
  });

  it('every labelKey resolves to a string in i18n', async () => {
    const ar = (await import('@/core/i18n/ar.json')).default as Record<string, unknown>;
    for (const item of paletteItems) {
      const parts = item.labelKey.split('.');
      let v: unknown = ar;
      for (const part of parts) {
        v = (v as Record<string, unknown>)[part];
        expect(v, `labelKey ${item.labelKey} (${item.path})`).toBeDefined();
      }
      expect(typeof v, `labelKey ${item.labelKey} (${item.path})`).toBe('string');
    }
  });
});

describe('canAccessModule', () => {
  it('denies when role is missing', () => {
    expect(canAccessModule('sales', undefined, allPerms)).toBe(false);
  });

  it('grants everything to super_admin', () => {
    expect(canAccessModule('sales', 'super_admin', noPerms)).toBe(true);
    expect(canAccessModule('accounting', 'super_admin', noPerms)).toBe(true);
  });

  it('grants on view/own/create permissions', () => {
    expect(canAccessModule('sales', 'manager', perm(['sales.view']))).toBe(true);
    expect(canAccessModule('sales', 'manager', perm(['sales.own']))).toBe(true);
    expect(canAccessModule('sales', 'manager', perm(['sales.create']))).toBe(true);
    expect(canAccessModule('accounting', 'manager', perm(['sales.view']))).toBe(false);
  });

  it('uses ai.use for the ai module', () => {
    expect(canAccessModule('ai', 'manager', perm(['ai.use']))).toBe(true);
    expect(canAccessModule('ai', 'manager', perm(['ai.view']))).toBe(false);
  });
});

describe('canAccessItem', () => {
  const invoice = paletteItems.find((i) => i.id === 'sales-invoices')!;
  const aiSettings = paletteItems.find((i) => i.id === 'settings-ai')!;

  it('denies when module is inaccessible', () => {
    expect(canAccessItem(invoice, 'manager', perm(['accounting.view']))).toBe(false);
  });

  it('allows when module is accessible', () => {
    expect(canAccessItem(invoice, 'manager', perm(['sales.create']))).toBe(true);
  });

  it('enforces item-level permission', () => {
    expect(canAccessItem(aiSettings, 'admin', perm(['settings.view']))).toBe(false);
    expect(canAccessItem(aiSettings, 'admin', perm(['ai.settings', 'settings.view']))).toBe(true);
  });

  it('super_admin bypasses permissions', () => {
    expect(canAccessItem(aiSettings, 'super_admin', noPerms)).toBe(true);
  });
});
