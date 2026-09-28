import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The posting path is a hand-compensated saga, not one atomic transaction: the
 * forward update and the journal entry are separate database operations, and
 * the journal entry is undone by a second transaction when it fails.
 *
 * That compensation used to discard its own result at all eight sites. A
 * compensation can fail for reasons that have nothing to do with the journal
 * entry - a dropped connection, a timeout, a lock - and when it did, the
 * document stayed `posted` with a moved balance and no journal entry, while the
 * caller returned a clean error implying nothing had changed. That is silent
 * ledger corruption, and it was invisible rather than rare: any transient
 * database blip during compensation produced it.
 *
 * These tests pin the distinction that matters. A failed compensation is a
 * different outcome from a failed posting, and the caller has to be able to tell
 * them apart, because the first needs a human and the second does not.
 */
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/userIdValidator', () => ({
  resolveExistingUserId: vi.fn(async () => '00000000-0000-0000-0000-0000000000aa'),
}));

vi.mock('@/core/utils/journalEntryGenerator', () => ({
  postSalesInvoice: vi.fn(),
  postSalesReturn: vi.fn(),
  postPurchaseInvoice: vi.fn(),
  postPurchaseReturn: vi.fn(),
}));

vi.mock('@/core/utils/auditLogger', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('./logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { postSalesInvoiceAtomic, postSalesReturnAtomic } from './postingService';
import { getDbAdapter } from '@/core/database/adapters';
import { postSalesInvoice, postSalesReturn } from '@/core/utils/journalEntryGenerator';
import { logger } from './logger';

const COMPANY = '00000000-0000-0000-0000-0000000000bb';
const DOC = '00000000-0000-0000-0000-0000000000cc';
const CUSTOMER = '00000000-0000-0000-0000-0000000000dd';
const USER = '00000000-0000-0000-0000-0000000000aa';

type Adapter = {
  query: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function install(behaviour: { forward: boolean; compensate: boolean; row?: Record<string, unknown> }) {
  let call = 0;
  const transaction = vi.fn(async () => {
    call += 1;
    // First transaction is the forward update, the rest are compensations.
    const ok = call === 1 ? behaviour.forward : behaviour.compensate;
    return ok ? { success: true, results: [] } : { success: false, error: 'connection terminated' };
  });
  const query = vi.fn(async () => ({
    success: true,
    rows: [behaviour.row ?? {
      customer_id: CUSTOMER, total_amount: 100, paid_amount: 0, subtotal: 100,
      vat_amount: 0, invoice_number: 'INV-0001', date: '2026-01-15', status: 'draft',
    }],
  }));
  vi.mocked(getDbAdapter).mockResolvedValue({ query, transaction } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  return { query, transaction } satisfies Adapter;
}

const ctx = { companyId: COMPANY, userId: USER } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postSalesInvoice).mockResolvedValue({ success: true } as never);
  vi.mocked(postSalesReturn).mockResolvedValue({ success: true } as never);
});

describe('posting compensation is checked, not assumed', () => {
  it('reports a clean failure when the journal entry fails AND the undo succeeds', async () => {
    install({ forward: true, compensate: true });
    vi.mocked(postSalesInvoice).mockResolvedValue({ success: false, error: 'account not found' } as never);

    const res = await postSalesInvoiceAtomic(ctx, { id: DOC, companyId: COMPANY, userId: USER });

    expect(res.success).toBe(false);
    // The ordinary message: nothing was posted, nothing needs a human.
    expect(res.success ? '' : res.error).toContain('account not found');
    expect(res.success ? '' : res.error).not.toContain('راجعه يدوياً');
  });

  it('says the document needs a human when the journal entry fails AND the undo also fails', async () => {
    install({ forward: true, compensate: false });
    vi.mocked(postSalesInvoice).mockResolvedValue({ success: false, error: 'account not found' } as never);

    const res = await postSalesInvoiceAtomic(ctx, { id: DOC, companyId: COMPANY, userId: USER });

    expect(res.success).toBe(false);
    if (res.success) return;
    // This is the case that used to be invisible: the document is posted, the
    // balance moved, and there is no journal entry.
    expect(res.error).toContain('راجعه يدوياً');
    expect(res.code).toBe('EXTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('connection terminated'),
      'postSalesInvoiceAtomic.undo',
    );
  });

  it('reports the same distinction for a return posting', async () => {
    install({
      forward: true,
      compensate: false,
      row: { customer_id: CUSTOMER, total_amount: 50, return_number: 'SRT-1', date: '2026-01-15', status: 'draft' },
    });
    vi.mocked(postSalesReturn).mockResolvedValue({ success: false, error: 'boom' } as never);

    const res = await postSalesReturnAtomic(ctx, { id: DOC, companyId: COMPANY, userId: USER });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('راجعه يدوياً');
    expect(res.code).toBe('EXTERNAL_ERROR');
  });

  it('survives a compensation that throws rather than returning a failure', async () => {
    const { transaction } = install({ forward: true, compensate: true });
    transaction.mockImplementation(async (steps: unknown) => {
      // first call is the forward update, the compensation throws
      if (Array.isArray(steps) && (steps as unknown[]).length > 0) {
        const first = (steps as Array<{ sql: string }>)[0];
        if (first.sql.includes("status = 'posted'")) return { success: true, results: [] };
        throw new Error('socket hang up');
      }
      return { success: true, results: [] };
    });
    vi.mocked(postSalesInvoice).mockResolvedValue({ success: false, error: 'boom' } as never);

    const res = await postSalesInvoiceAtomic(ctx, { id: DOC, companyId: COMPANY, userId: USER });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('راجعه يدوياً');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('socket hang up'),
      'postSalesInvoiceAtomic.undo',
    );
  });

  it('leaves the successful path untouched', async () => {
    install({ forward: true, compensate: false });
    const res = await postSalesInvoiceAtomic(ctx, { id: DOC, companyId: COMPANY, userId: USER });
    expect(res.success).toBe(true);
  });

  it('never reports success when the forward update itself failed', async () => {
    install({ forward: false, compensate: true });
    const res = await postSalesInvoiceAtomic(ctx, { id: DOC, companyId: COMPANY, userId: USER });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('connection terminated');
  });
});
