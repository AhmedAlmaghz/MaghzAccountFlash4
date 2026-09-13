import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/accounting/api', () => ({
  accountingApi: {
    createTransaction: vi.fn(),
    postTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  },
}));
vi.mock('@/modules/sales/api', () => ({ salesApi: {} }));
vi.mock('@/modules/purchases/api', () => ({ purchasesApi: {} }));
vi.mock('@/modules/crm/api', () => ({ crmApi: {} }));
vi.mock('@/modules/inventory/api', () => ({ inventoryApi: {} }));
vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'JE-0100' })),
}));
vi.mock('@/modules/core/api', () => ({
  coreApi: { getVatSettings: vi.fn(async () => ({ success: true, data: { vatRate: 5 } })) },
}));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({
    query: vi.fn(async () => ({ success: true, rows: [] })),
  })),
  isElectronPg: vi.fn(() => false),
}));

import { wizardTools } from './wizardTools';
import { accountingApi } from '@/modules/accounting/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const balancedLines = [
  { accountId: 'acc-cash', debit: 1500, credit: 0 },
  { accountId: 'acc-sales', debit: 0, credit: 1500 },
];

/**
 * Regression for the P0 audit finding (2026-09-12):
 * `accounting.create_journal_flow` read `createRes.id`, but
 * `accountingService.postTransaction` returns `{ success, transactionId }`
 * (accounting/api.createTransaction passes it through verbatim). So EVERY
 * call reported "تم إنشاء القيد لكن لم يُرجع معرف" AFTER the entry was
 * already saved as POSTED — and the model retried → duplicated posted
 * journal entries corrupting the ledger.
 *
 * The fix accepts both keys: `createRes.transactionId ?? createRes.id`.
 */
describe('accounting.create_journal_flow (transactionId vs id P0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds when createTransaction returns the SERVICE shape { transactionId } (no .id)', async () => {
    vi.mocked(accountingApi.createTransaction).mockResolvedValue({
      success: true,
      transactionId: 'tx-service-1',
    } as never);
    vi.mocked(accountingApi.postTransaction).mockResolvedValue({ success: true });

    const tool = wizardTools.find((t) => t.name === 'accounting.create_journal_flow');
    expect(tool).toBeDefined();

    const res = (await tool!.execute({ lines: balancedLines }, ctx)) as Record<string, unknown>;

    expect(res.transactionId).toBe('tx-service-1');
    expect(res.status).toBe('posted');
    expect(res.error).toBeUndefined();
    // must NOT attempt a rollback of the (actually posted) entry
    expect(accountingApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('still accepts the legacy { id } shape (API-path compatibility)', async () => {
    vi.mocked(accountingApi.createTransaction).mockResolvedValue({
      success: true,
      id: 'tx-legacy-2',
    } as never);
    vi.mocked(accountingApi.postTransaction).mockResolvedValue({ success: true });

    const tool = wizardTools.find((t) => t.name === 'accounting.create_journal_flow');
    const res = (await tool!.execute({ lines: balancedLines }, ctx)) as Record<string, unknown>;

    expect(res.transactionId).toBe('tx-legacy-2');
    expect(res.error).toBeUndefined();
  });

  it('reports creation failure honestly and never posts or rolls back', async () => {
    vi.mocked(accountingApi.createTransaction).mockResolvedValue({
      success: false,
      error: 'رصيد غير متوازن',
    } as never);

    const tool = wizardTools.find((t) => t.name === 'accounting.create_journal_flow');
    const res = (await tool!.execute({ lines: balancedLines }, ctx)) as Record<string, unknown>;

    expect(res.error).toBe('رصيد غير متوازن');
    expect(accountingApi.postTransaction).not.toHaveBeenCalled();
    expect(accountingApi.deleteTransaction).not.toHaveBeenCalled();
  });
});
