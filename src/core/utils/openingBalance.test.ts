import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Opening-balance date contract.
 *
 * Every opening flow (customer, supplier, product stock, account) must let the
 * user choose the date the balance belongs to. Omitting it keeps the historic
 * behaviour: the entry date (today, LOCAL — never UTC, which is yesterday for
 * GMT+3 users between 00:00 and 03:00).
 *
 * The date is ONE value driving every side-effect of the flow: journal entry
 * date, FIFO layer receivedDate, and the stamped opening_date on the entity.
 */

const h = vi.hoisted(() => ({
  query: vi.fn(),
  tx: { statements: [] as Array<{ sql: string; params?: unknown[] }> },
  je: [] as Array<{ date: string }>,
}));

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({ query: h.query })),
  // Transport selection is imported by adapter consumers; a mock without it
  // fails confusingly once any code path reaches for it.
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/database/tx', () => ({
  runTransaction: vi.fn(async (statements: Array<{ sql: string; params?: unknown[] }>) => {
    h.tx.statements = statements;
    return { success: true as const, results: [] };
  }),
  buildJournalEntryStatement: vi.fn((_companyId: string, entry: { date: string }) => {
    h.je.push(entry);
    return { sql: 'JE', params: [entry.date] };
  }),
}));

vi.mock('@/core/utils/valuation', () => ({
  buildFifoRestoreStatement: vi.fn((_companyId: string, opts: { receivedDate: string }) => ({
    sql: 'FIFO',
    params: [opts.receivedDate],
  })),
}));

import { postCustomerOpening, postProductStockOpening } from './openingBalance';

function lastJeDate(): string {
  return h.je[h.je.length - 1]?.date;
}

function statementContaining(fragment: string): { sql: string; params?: unknown[] } | undefined {
  return h.tx.statements.find((s) => s.sql.includes(fragment));
}

describe('openingBalance dates (customers / suppliers / products / accounts)', () => {
  beforeEach(() => {
    h.query.mockReset();
    h.query.mockResolvedValue({ success: true, rows: [{ id: 'acc-1' }] });
    h.tx.statements = [];
    h.je = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('product opening stock: user date drives FIFO, JE and the product stamp', async () => {
    const res = await postProductStockOpening('company-1', {
      productId: 'product-1',
      productName: 'كرتون',
      quantity: 5,
      warehouseId: 'warehouse-1',
      costPrice: 10,
      openingDate: '2025-01-15',
    });

    expect(res.success).toBe(true);
    expect(lastJeDate()).toBe('2025-01-15');
    expect(statementContaining('FIFO')?.params).toEqual(['2025-01-15']);
    const stamp = statementContaining('opening_date');
    expect(stamp?.sql).toContain('opening_date = $5::date');
    expect(stamp?.params).toContain('2025-01-15');
  });

  it('product opening stock: omitting the date uses the LOCAL entry date (not UTC)', async () => {
    vi.useFakeTimers();
    // 04 Mar 2026 00:30 local — toISOString() would report 2026-03-03 in GMT+3.
    vi.setSystemTime(new Date(2026, 2, 4, 0, 30, 0));

    await postProductStockOpening('company-1', {
      productId: 'product-1',
      productName: 'كرتون',
      quantity: 1,
      warehouseId: 'warehouse-1',
      costPrice: 10,
    });

    expect(lastJeDate()).toBe('2026-03-04');
  });

  it('customer opening: user date drives the JE and the opening_date stamp', async () => {
    const res = await postCustomerOpening('company-1', {
      id: 'customer-1',
      name: 'شركة الأمل',
      amount: 500,
      openingDate: '2025-02-01',
    });

    expect(res.success).toBe(true);
    expect(lastJeDate()).toBe('2025-02-01');
    const stamp = statementContaining('opening_date');
    expect(stamp?.params).toContain('2025-02-01');
  });

  it('customer opening: no date falls back to the local entry date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 4, 0, 30, 0));

    await postCustomerOpening('company-1', {
      id: 'customer-1',
      name: 'شركة الأمل',
      amount: 500,
    });

    expect(lastJeDate()).toBe('2026-03-04');
  });
});
