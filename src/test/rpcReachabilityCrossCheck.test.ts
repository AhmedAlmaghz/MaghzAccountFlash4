import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-validation across the whole migrated surface: two independent
 * measurements of the same property, sharing no code.
 *
 * `desktopRawSqlGate` reads the source and reasons about control flow with
 * regexes. This file installs a bridge - the only thing isElectronPg() looks at -
 * and hands the adapter a spy, so a function that reaches raw SQL on the desktop
 * is observed doing it. The desktop adapter's `query` forwards straight to the
 * legacy `_exec` channel, so touching the spy IS the finding.
 *
 * The regex gate has been wrong three times in four sessions, always
 * under-counting, because control flow cannot be settled by pattern matching:
 * four valid guard shapes exist here, plus the router-helper idiom. Running the
 * function settles it every time.
 *
 * The assertion that earns the file: the static per-file count must be at least
 * the number of methods observed reaching raw SQL at runtime. If the analysis
 * breaks again, this fails on its own, with nobody reading the code.
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
    postTransaction: vi.fn(async () => ({ success: true, id: UUID })),
    getTrialBalance: vi.fn(async () => ({ success: true, data: [] })),
    getBalanceSheet: vi.fn(async () => ({ success: true, data: [] })),
    getProfitLoss: vi.fn(async () => ({ success: true, data: [] })),
  },
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'X-0001' })),
  peekNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'X-0001' })),
  getDefaultAccounts: vi.fn(async () => ({ success: true, data: [] })),
  updateDefaultAccount: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/core/utils/auditLogger', () => ({ logAudit: vi.fn(async () => undefined) }));

vi.mock('@/modules/auth/store', () => ({
  useAuthStore: () => ({ user: { id: UUID, companyId: COMPANY, role: 'admin' } }),
  getState: () => ({ user: { id: UUID, companyId: COMPANY, role: 'admin' } }),
}));

import { accountingApi } from '@/modules/accounting/api';
import { inventoryApi } from '@/modules/inventory/api';
import { hrApi } from '@/modules/hr/api';
import { manufacturingApi } from '@/modules/manufacturing/api';
import { crmApi } from '@/modules/crm/api';
import { getDbAdapter } from '@/core/database/adapters';

const UUID = '00000000-0000-0000-0000-0000000000a1';
const COMPANY = '00000000-0000-0000-0000-0000000000b2';
const UUID_B = '00000000-0000-0000-0000-0000000000b3';

/** The five surfaces under test, and the file the static gate reports for each. */
const SURFACES: Array<[string, Record<string, unknown>, string]> = [
  ['accounting', accountingApi as unknown as Record<string, unknown>, 'src/modules/accounting/api.ts'],
  ['inventory', inventoryApi as unknown as Record<string, unknown>, 'src/modules/inventory/api.ts'],
  ['hr', hrApi as unknown as Record<string, unknown>, 'src/modules/hr/api.ts'],
  ['manufacturing', manufacturingApi as unknown as Record<string, unknown>, 'src/modules/manufacturing/api.ts'],
  ['crm', crmApi as unknown as Record<string, unknown>, 'src/modules/crm/api.ts'],
];

let touched = 0;

beforeEach(() => {
  touched = 0;
  const surface = new Proxy({}, { get: () => async () => ({ success: true, rows: [], id: UUID }) });
  const bridge = new Proxy(
    { ping: () => Promise.resolve({ success: true }) },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : surface) },
  );
  (window as unknown as Record<string, unknown>).electronDB = bridge;
  const bump = () => vi.fn(async () => { touched += 1; return { success: true, rows: [], results: [], id: UUID }; });
  vi.mocked(getDbAdapter).mockResolvedValue({
    query: bump(), transaction: bump(), createTransaction: bump(),
  } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronDB;
  vi.restoreAllMocks();
  vi.mocked(getDbAdapter).mockReset();
});

const DATA: Record<string, unknown> = {
  code: '1', nameAr: 'x', name: 'x', nameEn: 'x', username: 'u', fullName: 'n',
  email: 'e@x.y', password: 'p', role: 'admin', employeeNumber: 'E1',
  invoiceNumber: 'INV-1', customerId: UUID, supplierId: UUID, productId: UUID,
  accountId: UUID, warehouseId: UUID, lineTotal: 1, totalAmount: 1, quantity: 1,
  date: '2026-01-01', nameEnRequired: 'x', type: 'asset',
};
const LINES = [DATA];
const ARG_SETS: unknown[][] = [
  [COMPANY, DATA, UUID, UUID_B],
  [COMPANY, DATA, UUID],
  [COMPANY, DATA, LINES, UUID],
  [COMPANY, DATA],
  [COMPANY, LINES, UUID],
  [COMPANY, DATA, LINES],
  [COMPANY, UUID],
  [COMPANY],
  [DATA, COMPANY],
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

async function measure(api: Record<string, unknown>) {
  const raw: string[] = [];
  const inconclusive: string[] = [];
  let total = 0;
  const methods = Object.entries(api).filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>;
  for (const [name, fn] of methods) {
    total++;
    const v = await probe(fn);
    if (v === 'raw') raw.push(name);
    if (v === 'inconclusive') inconclusive.push(name);
  }
  return { raw, inconclusive, total };
}

function staticCountFor(file: string): number {
  const text = readFileSync(join(process.cwd(), 'src', 'test', 'desktopRawSqlGate.test.ts'), 'utf8');
  const m = new RegExp("'" + file.replace(/[/.]/g, (c) => '\\' + c) + "':\\s*(\\d+)").exec(text);
  if (!m) throw new Error(file + ' is missing from the static baseline');
  return Number(m[1]);
}

describe('the static gate cannot under-report what the runtime observes', () => {
  it('measures every surface (a broken probe passes by absence)', async () => {
    for (const [name, api] of SURFACES) {
      const { total, inconclusive } = await measure(api);
      expect(total, name + ' has no methods to measure').toBeGreaterThan(5);
      expect(inconclusive, name + ' has unmeasured methods - an unmeasured method must not look clean')
        .toEqual([]);
    }
  });

  it('each static count is at least its runtime-observed raw method count', async () => {
    const report: Record<string, { methods: number; raw: number; static: number }> = {};
    const regressions: string[] = [];
    for (const [name, api, file] of SURFACES) {
      const { raw, total } = await measure(api);
      const staticCount = staticCountFor(file);
      report[name] = { methods: total, raw: raw.length, static: staticCount };
      if (staticCount < raw.length) {
        regressions.push(`${name}: static says ${staticCount} but ${raw.length} methods reach raw SQL`);
      }
    }
    expect(regressions, 'the static gate under-counts; it is reading control flow with regexes it cannot settle')
      .toEqual([]);
  });

  /**
   * The per-method ground truth, measured 2026-09-26 with a bridge installed.
   *
   * The count assertion above catches a gate that is badly wrong. This catches a
   * gate that is wrong in a way the count tolerates - crm sits one method above
   * its static figure, so a single regression there would pass the count and
   * fail here, by name.
   *
   * A migration removes a name from the list. A regression adds one.
   */
  it('names the methods that reach raw SQL, per surface', async () => {
    const measured: Record<string, string[]> = {};
    for (const [name, api] of SURFACES) measured[name] = (await measure(api)).raw;

    expect(measured).toEqual({
      accounting: [
        'createAccount', 'deleteAccount',
        'getTransactions',
        'updateTransaction', 'deleteTransaction',
        'postVoucher',
        'updateReceiptVoucher', 'deleteReceiptVoucher',
        'updatePaymentVoucher', 'deletePaymentVoucher',
        'getAccountLedger', 'applyPaymentToInvoice',
      ],
      inventory: [
        'getProductsForSelect', 'getProductsPaginated', 'updateProduct', 'deleteProduct',
        'updateWarehouse', 'deleteWarehouse',
        'deleteStockTransfer',
        'completeStockTransfer', 'getInventoryTransactionsPaginated',
        'deleteInventoryTransaction', 'updateStockAdjustment',
        'approveStockAdjustment', 'postStockAdjustment', 'deleteStockAdjustment',
        'deleteProductCategory', 'getInventoryKpis',
      ],
      hr: [
        'deleteEmployee', 'saveAttendance', 'previewPayrollRun', 'deletePayrollRun',
        'postPayrollRun', 'getLeaveBalances', 'deleteLeave', 'previewEndOfService',
        'payEndOfService', 'deleteEndOfService', 'getDepartments', 'deleteDepartment',
        'getPayrollComponentsList', 'deactivatePayrollComponent',
      ],
      manufacturing: [
        'getNextBatchNumber', 'getBomAvailability',
        'startWorkOrder', 'completeWorkOrder', 'cancelWorkOrder',
      ],
      crm: [
        'getLeadKpis', 'getOpportunityKpis', 'getTaskKpis', 'getActivityKpis',
        'getLeadConversionStats', 'getPipelineStats', 'getCrmDashboardKpis',
        'getOpportunityStageBreakdown',
      ],
    });
  });
});
