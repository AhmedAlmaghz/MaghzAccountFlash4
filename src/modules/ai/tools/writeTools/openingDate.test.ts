import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Opening-balance DATE contract at the tool boundary.
 *
 * The engine normalizes dates in `sanitizeToolArgs` (including Hijri/Arabic
 * forms); the tools must FORWARD the normalized value to the APIs, otherwise
 * the journal entry silently falls back to "today" and the user's chosen date
 * is lost. These tests pin the forwarding + honest warning reporting.
 */

vi.mock('@/modules/sales/api', () => ({
  salesApi: {
    createCustomer: vi.fn(),
    getInvoicesPaginated: vi.fn(),
    getInvoiceById: vi.fn(),
    updateInvoice: vi.fn(),
  },
}));
vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: {
    createSupplier: vi.fn(),
    createInvoice: vi.fn(),
  },
}));
vi.mock('@/modules/accounting/api', () => ({
  accountingApi: {
    createAccount: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'DOC-0001' })),
}));

import { salesWriteTools } from './sales';
import { purchasesWriteTools } from './purchases';
import { accountingWriteTools } from './accounting';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { accountingApi } from '@/modules/accounting/api';
import type { ToolContext, ToolDefinition } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function tool(list: ToolDefinition[], name: string): ToolDefinition {
  const found = list.find((t) => t.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('openingDate forwarding — customers', () => {
  it('forwards the user date and reports the opening post as done', async () => {
    vi.mocked(salesApi.createCustomer).mockResolvedValue({ success: true, id: 'cust-1' });

    const res = (await tool(salesWriteTools, 'sales.create_customer').execute(
      { name: 'شركة الأمل', openingBalance: 1500, openingDate: '2025-01-15' },
      ctx,
    )) as Record<string, unknown>;

    expect(vi.mocked(salesApi.createCustomer).mock.calls[0][0]).toMatchObject({
      openingBalance: 1500,
      openingDate: '2025-01-15',
    });
    expect(res.openingPosted).toBe(true);
  });

  it('never claims the opening balance was posted when the API reports a warning', async () => {
    vi.mocked(salesApi.createCustomer).mockResolvedValue({
      success: true,
      id: 'cust-1',
      warning: 'تعذّر ترحيل الرصيد الافتتاحي: missing account',
    });

    const res = (await tool(salesWriteTools, 'sales.create_customer').execute(
      { name: 'شركة الأمل', openingBalance: 1500, openingDate: '2025-01-15' },
      ctx,
    )) as Record<string, unknown>;

    expect(res.created).toBe(true);
    expect(res.openingPosted).toBe(false);
    expect(String(res.warning)).toContain('تعذّر ترحيل الرصيد الافتتاحي');
    expect(res.note).toBeUndefined();
  });

  it('does not send an opening date when no opening balance is posted', async () => {
    vi.mocked(salesApi.createCustomer).mockResolvedValue({ success: true, id: 'cust-2' });

    await tool(salesWriteTools, 'sales.create_customer').execute(
      { name: 'عميل بلا رصيد', openingDate: '2025-01-15' },
      ctx,
    );

    expect(vi.mocked(salesApi.createCustomer).mock.calls[0][0].openingDate).toBeUndefined();
  });
});

describe('openingDate forwarding — suppliers', () => {
  it('forwards the user date to createSupplier', async () => {
    vi.mocked(purchasesApi.createSupplier).mockResolvedValue({ success: true, id: 'sup-1' });

    const res = (await tool(purchasesWriteTools, 'purchases.create_supplier').execute(
      { name: 'مورد الخليج', openingBalance: 900, openingDate: '2025-03-01' },
      ctx,
    )) as Record<string, unknown>;

    expect(vi.mocked(purchasesApi.createSupplier).mock.calls[0][0]).toMatchObject({
      openingBalance: 900,
      openingDate: '2025-03-01',
    });
    expect(res.openingPosted).toBe(true);
  });
});

describe('openingDate forwarding — accounts', () => {
  it('maps balance → openingAmount (never writes the raw mirror) and forwards date/direction', async () => {
    vi.mocked(accountingApi.createAccount).mockResolvedValue({ success: true, id: 'acc-1' });

    const res = (await tool(accountingWriteTools, 'accounting.create_account').execute(
      {
        code: '11301',
        nameAr: 'المخزون',
        type: 'asset',
        nature: 'debit',
        openingAmount: 2500,
        openingDirection: 'debit',
        openingDate: '2025-02-10',
      },
      ctx,
    )) as Record<string, unknown>;

    const sent = vi.mocked(accountingApi.createAccount).mock.calls[0][0];
    expect(sent).toMatchObject({
      openingAmount: 2500,
      openingDirection: 'debit',
      openingDate: '2025-02-10',
      balance: 0,
    });
    expect(res.openingPosted).toBe(true);
  });

  it('accepts the legacy balance alias as an opening amount', async () => {
    vi.mocked(accountingApi.createAccount).mockResolvedValue({ success: true, id: 'acc-2' });

    await tool(accountingWriteTools, 'accounting.create_account').execute(
      { code: '11302', nameAr: 'بضاعة تامة', type: 'asset', nature: 'debit', balance: 700 },
      ctx,
    );

    expect(vi.mocked(accountingApi.createAccount).mock.calls[0][0]).toMatchObject({
      openingAmount: 700,
      balance: 0,
    });
  });

  it('surfaces a failed opening JE warning instead of claiming success', async () => {
    vi.mocked(accountingApi.createAccount).mockResolvedValue({
      success: true,
      id: 'acc-3',
      warning: 'تعذّر ترحيل الرصيد الافتتاحي: boom',
    });

    const res = (await tool(accountingWriteTools, 'accounting.create_account').execute(
      { code: '11303', nameAr: 'أصل', type: 'asset', nature: 'debit', openingAmount: 100 },
      ctx,
    )) as Record<string, unknown>;

    expect(res.openingPosted).toBe(false);
    expect(String(res.warning)).toContain('تعذّر ترحيل الرصيد الافتتاحي');
  });
});
