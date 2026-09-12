import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/accounting/api', () => ({
  accountingApi: {
    createPaymentVoucher: vi.fn(),
    getAccounts: vi.fn(),
    postVoucher: vi.fn(),
  },
}));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
  getCashBoxes: vi.fn(),
}));
vi.mock('@/core/utils/journalEntryGenerator', () => ({
  getDefaultAccountId: vi.fn(),
}));

import { accountingWriteTools } from './accounting';
import { accountingApi } from '@/modules/accounting/api';
import { getNextDocumentNumber, getCashBoxes } from '@/core/api';
import { getDefaultAccountId } from '@/core/utils/journalEntryGenerator';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

interface TestableTool {
  summarizeArgs?: (a: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = accountingWriteTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

const mockedApi = vi.mocked(accountingApi, true);

const EXPENSES = [
  { id: 'acc-net', companyId: 'c1', code: '52301', nameAr: 'مصروفات الإنترنت والاتصالات', nameEn: '', type: 'expense', nature: 'debit', isGroup: false, balance: 0, isActive: true, children: [] },
  { id: 'acc-rent', companyId: 'c1', code: '52201', nameAr: 'مصروفات الإيجار', nameEn: '', type: 'expense', nature: 'debit', isGroup: false, balance: 0, isActive: true, children: [] },
];

const BOXES = [
  { id: 'box-jeb', companyId: 'c1', name: 'محفظة جيب', code: 'JB-01', accountId: 'acc-cash2', isActive: true },
  { id: 'box-main', companyId: 'c1', name: 'الصندوق الرئيسي', code: 'CB-01', accountId: 'acc-cash1', isActive: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNextDocumentNumber).mockResolvedValue({ success: true, number: 'PV-0001' } as never);
  mockedApi.createPaymentVoucher.mockResolvedValue({ success: true, id: 'v-1' } as never);
  mockedApi.getAccounts.mockResolvedValue({ success: true, data: EXPENSES } as never);
  vi.mocked(getCashBoxes).mockResolvedValue({ success: true, data: BOXES } as never);
  vi.mocked(getDefaultAccountId).mockImplementation(async (_cid: string, key: string) =>
    key === 'default_misc_expense' ? 'acc-misc' : key === 'default_cash' ? 'acc-cash1' : null,
  );
});

describe('accounting.create_expense_voucher — context-aware resolution', () => {
  // Real session 2026-09-10: "سداد اشتراك الانترنت" and "إيجار هذا الشهر"
  // died with "supplierId مطلوب" although the intent was a plain expense.
  it('matches the closest expense account from the description text', async () => {
    const res = (await findTool('accounting.create_expense_voucher').execute(
      { amount: 6500, paymentMethod: 'bank', date: '2026-08-02', description: 'سداد اشتراك الانترنت' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ expenseAccountId: 'acc-net', supplierId: undefined }),
      expect.anything(),
    );
    expect(String(res.note)).toContain('مصروفات الإنترنت والاتصالات');
  });

  it('falls back to the default expense account when nothing matches', async () => {
    const res = (await findTool('accounting.create_expense_voucher').execute(
      { amount: 1000, description: 'بند مجهول تماما xyz' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ expenseAccountId: 'acc-misc' }),
      expect.anything(),
    );
    expect(String(res.note)).toContain('الافتراضي');
  });

  it('fails honestly when no default expense account exists', async () => {
    vi.mocked(getDefaultAccountId).mockResolvedValue(null);
    const res = (await findTool('accounting.create_expense_voucher').execute(
      { amount: 1000, description: 'بند مجهول تماما xyz' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toMatch(/expenseAccountId/);
    expect(mockedApi.createPaymentVoucher).not.toHaveBeenCalled();
  });

  it('matches the cash box from the hint text (محفظة جيب)', async () => {
    const res = (await findTool('accounting.create_expense_voucher').execute(
      { amount: 6500, expenseAccountId: 'acc-net', description: 'حوالة من محفظة جيب', paymentMethod: 'bank' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ cashBoxId: 'box-jeb' }),
      expect.anything(),
    );
    expect(String(res.cashBoxName)).toContain('محفظة جيب');
  });

  it('uses the default cash box when the text names none', async () => {
    const res = (await findTool('accounting.create_expense_voucher').execute(
      { amount: 6500, expenseAccountId: 'acc-net', description: 'مصروف عام' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    // default_cash → acc-cash1 → box-main
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ cashBoxId: 'box-main' }),
      expect.anything(),
    );
  });

  it('merges description into notes so the reference text is never lost', async () => {
    await findTool('accounting.create_expense_voucher').execute(
      { amount: 6500, expenseAccountId: 'acc-net', description: 'سداد اشتراك الانترنت', reference: '443' },
      ctx,
    );
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ notes: expect.stringContaining('سداد اشتراك الانترنت') }),
      expect.anything(),
    );
  });

  it('declares auto-resolution on the approval card (no blind consent)', () => {
    const s = findTool('accounting.create_expense_voucher').summarizeArgs!({ amount: 6500 });
    expect(s).toContain('تلقائياً');
  });
});

describe('accounting.create_payment_voucher — expense path without supplier', () => {
  it('creates an expense-style voucher when only notes/description are given', async () => {
    const res = (await findTool('accounting.create_payment_voucher').execute(
      { amount: 85000, paymentMethod: 'bank', date: '2026-08-12', description: 'إيجار هذا الشهر' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId: undefined, expenseAccountId: 'acc-rent' }),
      expect.anything(),
    );
  });

  it('keeps the supplier path untouched (no resolution queries)', async () => {
    const res = (await findTool('accounting.create_payment_voucher').execute(
      { supplierId: 'sup-1', amount: 250000, paymentMethod: 'bank' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(mockedApi.getAccounts).not.toHaveBeenCalled();
    expect(mockedApi.createPaymentVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId: 'sup-1' }),
      expect.anything(),
    );
  });
});

describe('accounting.post_*_voucher — real posting pipeline (P0-4 regression)', () => {
  // A bare status UPDATE flipped the column with ZERO accounting effect (no
  // JE, no party-balance move, no invoice allocation) while showing the
  // voucher as "posted" in every list. The tools must call postVoucher().
  beforeEach(() => {
    mockedApi.postVoucher.mockResolvedValue({ success: true } as never);
  });

  it('posts receipt vouchers through postVoucher (receipt)', async () => {
    const res = (await findTool('accounting.post_receipt_voucher').execute(
      { voucherId: 'rv-1' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBe(true);
    expect(mockedApi.postVoucher).toHaveBeenCalledWith('rv-1', ctx.companyId, 'receipt', ctx.userId);
  });

  it('posts payment vouchers through postVoucher (payment)', async () => {
    const res = (await findTool('accounting.post_payment_voucher').execute(
      { voucherId: 'pv-1' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBe(true);
    expect(mockedApi.postVoucher).toHaveBeenCalledWith('pv-1', ctx.companyId, 'payment', ctx.userId);
  });

  it('surfaces posting failures honestly (no fake posted:true)', async () => {
    mockedApi.postVoucher.mockResolvedValueOnce({ success: false, error: 'رصيد الخزنة لا يكفي' } as never);
    const res = (await findTool('accounting.post_receipt_voucher').execute(
      { voucherId: 'rv-9' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBeUndefined();
    expect(String(res.error)).toContain('رصيد الخزنة لا يكفي');
  });
});
