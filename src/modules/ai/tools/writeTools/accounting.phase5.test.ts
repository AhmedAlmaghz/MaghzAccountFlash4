import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/accounting/api', () => ({
  accountingApi: {},
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(),
  getCashBoxes: vi.fn(),
}));

vi.mock('@/core/utils/journalEntryGenerator', () => ({
  getDefaultAccountId: vi.fn(),
}));

vi.mock('@/modules/accounting/yearEnd', () => ({
  previewFiscalClose: vi.fn(),
  closeFiscalYear: vi.fn(),
}));

vi.mock('@/modules/accounting/reversal', () => ({
  reverseTransaction: vi.fn(),
  reverseSalesInvoice: vi.fn(),
  reversePurchaseInvoice: vi.fn(),
  reverseVoucher: vi.fn(),
}));

vi.mock('@/modules/accounting/assets', () => ({
  fixedAssetsApi: { runDepreciation: vi.fn() },
}));

import { accountingWriteTools } from './accounting';
import { previewFiscalClose, closeFiscalYear } from '@/modules/accounting/yearEnd';
import {
  reverseTransaction,
  reverseSalesInvoice,
  reversePurchaseInvoice,
  reverseVoucher,
} from '@/modules/accounting/reversal';
import { fixedAssetsApi } from '@/modules/accounting/assets';
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('accounting.close_fiscal_year (Phase 5)', () => {
  it('previews without closing by default', async () => {
    vi.mocked(previewFiscalClose).mockResolvedValue({
      success: true,
      data: { year: 2024, startDate: '2024-01-01', endDate: '2024-12-31', revenue: 1000, expense: 400, net: 600, lines: [{}, {}], retainedAccountId: 'a' },
    } as never);
    const res = (await findTool('accounting.close_fiscal_year').execute({ year: 2024 }, ctx)) as Record<string, unknown>;
    expect(res.preview).toBe(true);
    expect(res.net).toBe(600);
    expect(vi.mocked(closeFiscalYear)).not.toHaveBeenCalled();
  });

  it('closes only with previewOnly=false', async () => {
    vi.mocked(closeFiscalYear).mockResolvedValue({ success: true, data: { reference: 'CLS-2024', net: 600 } } as never);
    const res = (await findTool('accounting.close_fiscal_year').execute({ year: 2024, previewOnly: false }, ctx)) as Record<string, unknown>;
    expect(res.closed).toBe(true);
    expect(res.reference).toBe('CLS-2024');
  });

  it('rejects absurd years before touching the API', async () => {
    const res = (await findTool('accounting.close_fiscal_year').execute({ year: 1999 }, ctx)) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(previewFiscalClose)).not.toHaveBeenCalled();
  });
});

describe('accounting.reverse_document (Phase 5)', () => {
  it('dispatches each kind to its reversal function', async () => {
    vi.mocked(reverseTransaction).mockResolvedValue({ success: true, data: { reference: 'REV-JE' } } as never);
    vi.mocked(reverseSalesInvoice).mockResolvedValue({ success: true, data: { reference: 'SRT-1' } } as never);
    vi.mocked(reversePurchaseInvoice).mockResolvedValue({ success: true, data: { reference: 'PRT-1' } } as never);
    vi.mocked(reverseVoucher).mockResolvedValue({ success: true, data: { reference: 'REV-RV' } } as never);
    const tool = findTool('accounting.reverse_document');

    const t1 = (await tool.execute({ kind: 'transaction', id: 't1', reason: 'wrong date posted' }, ctx)) as Record<string, unknown>;
    expect(t1.reference).toBe('REV-JE');
    const t2 = (await tool.execute({ kind: 'sales_invoice', id: 'i1', reason: 'order cancelled by client' }, ctx)) as Record<string, unknown>;
    expect(t2.reference).toBe('SRT-1');
    const t3 = (await tool.execute({ kind: 'purchase_invoice', id: 'i2', reason: 'goods never arrived here' }, ctx)) as Record<string, unknown>;
    expect(t3.reference).toBe('PRT-1');
    const t4 = (await tool.execute({ kind: 'receipt_voucher', id: 'v1', reason: 'duplicate receipt issued' }, ctx)) as Record<string, unknown>;
    expect(t4.reference).toBe('REV-RV');
    const t5 = (await tool.execute({ kind: 'payment_voucher', id: 'v2', reason: 'duplicate payment issued' }, ctx)) as Record<string, unknown>;
    expect(t5.reference).toBe('REV-RV');
  });

  it('rejects unknown kinds and short reasons without calling anything', async () => {
    const tool = findTool('accounting.reverse_document');
    const bad = (await tool.execute({ kind: 'payroll', id: 'x', reason: 'long enough reason' }, ctx)) as Record<string, unknown>;
    expect(bad.error).toBeDefined();
    const short = (await tool.execute({ kind: 'transaction', id: 'x', reason: 'ab' }, ctx)) as Record<string, unknown>;
    expect(short.error).toBeDefined();
    expect(vi.mocked(reverseTransaction)).not.toHaveBeenCalled();
  });
});

describe('accounting.run_depreciation (Phase 5)', () => {
  it('passes year/month through and reports the run', async () => {
    vi.mocked(fixedAssetsApi.runDepreciation).mockResolvedValue({
      success: true, data: { posted: 3, skipped: 1, total: 2500 },
    } as never);
    const res = (await findTool('accounting.run_depreciation').execute({ year: 2026, month: 4 }, ctx)) as Record<string, unknown>;
    expect(res.depreciated).toBe(true);
    expect(res.posted).toBe(3);
    expect(res.total).toBe(2500);
    expect(vi.mocked(fixedAssetsApi.runDepreciation)).toHaveBeenCalledWith(ctx.companyId, 2026, 4, ctx.userId);
  });

  it('rejects invalid months', async () => {
    const res = (await findTool('accounting.run_depreciation').execute({ year: 2026, month: 13 }, ctx)) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(fixedAssetsApi.runDepreciation)).not.toHaveBeenCalled();
  });
});
