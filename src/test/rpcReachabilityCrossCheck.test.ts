import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-validation: two independent measurements of the same property.
 *
 * `desktopRawSqlGate` reads the source and reasons about control flow with
 * regexes. `desktopReachabilityGate` installs a bridge and observes which
 * functions actually touch the adapter. They share no code, so where they
 * agree the number is probably right - and where they disagree, one of them is
 * wrong and the disagreement is the finding.
 *
 * This exists because the text gate has been wrong three times in four
 * sessions, always in the direction that hides desktop-reachable raw SQL. A
 * single method can be trusted only after it has been caught being wrong once.
 */
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => true),
  getDbMode: vi.fn(() => 'pg'),
}));

vi.mock('@/core/utils/userIdValidator', () => ({
  safeUserId: (v?: string | null) => v ?? null,
  resolveExistingUserId: vi.fn(async () => null),
}));

// Keep the posting/validation collaborators inert: this gate is measuring
// whether raw SQL is reached, not what the posting logic does with the rows.
vi.mock('@/core/utils/validation', () => ({
  validateInput: vi.fn(() => ({ success: true, data: {} })),
  companyIdSchema: {}, idCompanySchema: {},
}));
vi.mock('@/core/utils/journalEntryGenerator', () => ({
  postSalesInvoice: vi.fn(async () => ({ success: true })),
  postSalesReturn: vi.fn(async () => ({ success: true })),
  postPurchaseInvoice: vi.fn(async () => ({ success: true })),
  postPurchaseReturn: vi.fn(async () => ({ success: true })),
  buildJournalEntryStatement: vi.fn(() => ({ sql: '', params: [] })),
  resolveExistingUserId: vi.fn(async () => null),
  getDefaultAccountId: vi.fn(async () => null),
  findAccountByCode: vi.fn(async () => null),
}));
vi.mock('@/core/database/tx', () => ({
  runTransaction: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/core/services', () => ({
  accountingService: {
    postTransaction: vi.fn(async () => ({ success: true, id: '00000000-0000-0000-0000-0000000000a1' })),
    getTrialBalance: vi.fn(async () => ({ success: true, data: [] })),
    getBalanceSheet: vi.fn(async () => ({ success: true, data: [] })),
    getProfitLoss: vi.fn(async () => ({ success: true, data: [] })),
  },
}));

import * as accountingApi from '@/modules/accounting/api';
import { getDbAdapter } from '@/core/database/adapters';

const UUID_A = '00000000-0000-0000-0000-0000000000a1';
const UUID_B = '00000000-0000-0000-0000-0000000000b2';

let touched = 0;

beforeEach(() => {
  touched = 0;
  const surface = new Proxy({}, { get: () => async () => ({ success: true, rows: [], id: UUID_A }) });
  const bridge = new Proxy(
    { ping: () => Promise.resolve({ success: true }) },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : surface) },
  );
  (window as unknown as Record<string, unknown>).electronDB = bridge;
  const bump = () => vi.fn(async () => { touched += 1; return { success: true, rows: [], results: [], id: UUID_A }; });
  vi.mocked(getDbAdapter).mockResolvedValue({
    query: bump(), transaction: bump(), createTransaction: bump(),
  } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronDB;
  vi.restoreAllMocks();
  vi.mocked(getDbAdapter).mockReset();
});

const DATA = {
  code: '1', nameAr: 'x', name: 'x', invoiceNumber: 'INV-1', customerId: UUID_A,
  productId: UUID_A, lineTotal: 1, totalAmount: 1, accountId: UUID_A, type: 'asset',
};
const ARG_SETS: unknown[][] = [
  [UUID_A, DATA, UUID_A, UUID_B],
  [UUID_A, DATA, UUID_A],
  [UUID_A, DATA],
  [UUID_A, [DATA], UUID_A],
  [UUID_A, []],
  [UUID_A, UUID_B],
  [UUID_A],
  [],
];

async function probe(fn: (...a: unknown[]) => unknown): Promise<'clean' | 'raw' | 'inconclusive'> {
  for (const args of ARG_SETS) {
    const before = touched;
    try {
      await fn(...args);
    } catch {
      continue;
    }
    return touched > before ? 'raw' : 'clean';
  }
  return 'inconclusive';
}

describe('cross-validating the text gate against behaviour', () => {
  it('reaches a working probe over the accountingApi object', async () => {
    const api = accountingApi.accountingApi as unknown as Record<string, unknown>;
    const methods = Object.entries(api).filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>;
    // Without this, a module that exports a single object instead of loose
    // functions yields an empty set and the whole cross-check passes vacuously -
    // which is exactly what the first run of this file did.
    expect(methods.length, 'the probe found no methods to measure').toBeGreaterThan(10);
    // A migrated method must report clean, or the harness is lying.
    expect(await probe(api.getAccounts as never)).toBe('clean');
  });

  it('names every accountingApi method that reaches raw SQL with a bridge present', async () => {
    const api = accountingApi.accountingApi as unknown as Record<string, unknown>;
    const raw: string[] = [];
    const inconclusive: string[] = [];
    const methods = Object.entries(api)
      .filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>;
    for (const [name, fn] of methods) {
      const v = await probe(fn);
      if (v === 'raw') raw.push(name);
      if (v === 'inconclusive') inconclusive.push(name);
    }
    // Pinned by MEASUREMENT on 2026-09-25. A migration removes a name here; a
    // regression adds one. Anything unmeasured is reported rather than assumed
    // safe, so this list can only be short when it is provably short.
    expect({ raw, inconclusive },
      'accounting reachability changed - migrate the addition, or re-measure deliberately').toEqual({
      raw: [
        'createAccount', 'deleteAccount', 'getAccountById',
        'getTransactions', 'getTransactionsPaginated', 'getTransactionById',
        'updateTransaction', 'deleteTransaction',
        'getReceiptVouchers', 'getReceiptVouchersPaginated', 'postVoucher',
        'updateReceiptVoucher', 'deleteReceiptVoucher',
        'getPaymentVouchers', 'getPaymentVouchersPaginated',
        'updatePaymentVoucher', 'deletePaymentVoucher',
        'getAccountLedger', 'applyPaymentToInvoice',
      ],
      inconclusive: [],
    });
  });

  it('the text gate cannot report fewer statements than there are reachable methods', async () => {
    // The cross-check itself. desktopRawSqlGate counts statements by reading
    // source and has been wrong three times, always under-counting. If its
    // per-file figure for accounting ever drops below the number of methods
    // observed reaching raw SQL at runtime, the static analysis is broken again
    // - and this fails without anyone having to notice the shape of the code.
    const api = accountingApi.accountingApi as unknown as Record<string, unknown>;
    const methods = Object.entries(api)
      .filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>;
    let reachable = 0;
    for (const [, fn] of methods) {
      if ((await probe(fn)) === 'raw') reachable++;
    }

    const text = readFileSync(join(process.cwd(), 'src', 'test', 'desktopRawSqlGate.test.ts'), 'utf8');
    const baseline = /'src\/modules\/accounting\/api\.ts':\s*(\d+)/.exec(text);
    expect(baseline, 'accounting/api.ts is missing from the text baseline').not.toBeNull();
    const textCount = Number(baseline![1]);
    expect(textCount,
      'the text gate under-counts accounting/api.ts: it claims fewer statements than there are ' +
      'runtime-observed methods reaching raw SQL').toBeGreaterThanOrEqual(reachable);
  });
});
