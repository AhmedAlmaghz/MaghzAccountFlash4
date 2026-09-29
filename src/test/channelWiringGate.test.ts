import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A registered channel is not a migrated method.
 *
 * Three `accounting` channels already existed while their methods still reached
 * the raw adapter, and every one of them was a partial port rather than a
 * translation:
 *
 *   createAccount    inserts 9 columns where the renderer writes 13 - no id, no
 *                    is_active, no created_by/updated_by
 *   getTransactions  joins journal_entries and aggregates `entries` as JSON where
 *                    the renderer selects plain t.*
 *
 * When this gate was first written it found seven such methods, not three: five
 * more in hr, where the channel is an atomic consolidation of a multi-statement
 * renderer body rather than a translation of it. Two of the entries it was first
 * given were also wrong - accounting.getAccounts turned out to be wired
 * properly, so listing it would have documented a problem that does not exist.
 *
 * Wiring any of them "to finish the migration" would silently change desktop
 * behaviour - dropping audit columns, returning a different shape, or altering
 * when a partial failure is visible. A half-built channel is worse than no
 * channel, because it looks like finished work and it hides the work that
 * remains.
 *
 * This gate joins two independent measurements: the channels that exist, and
 * the methods that still reach raw SQL at runtime with a bridge installed. A
 * method appearing in BOTH is a latent trap - someone can wire it in an
 * afternoon without noticing it is not a translation. Every such method has to
 * be named below with what makes it different, so connecting it is a decision
 * rather than a cleanup.
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
vi.mock('@/core/database/tx', () => ({ runTransaction: vi.fn(async () => ({ success: true })) }));
vi.mock('@/core/services', () => ({
  accountingService: {
    postTransaction: vi.fn(async () => ({ success: true, id: '00000000-0000-0000-0000-0000000000a1' })),
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
  useAuthStore: () => ({ user: { id: '00000000-0000-0000-0000-0000000000a1' } }),
  getState: () => ({ user: { id: '00000000-0000-0000-0000-0000000000a1' } }),
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

const SURFACES: Array<[string, Record<string, unknown>]> = [
  ['accounting', accountingApi as unknown as Record<string, unknown>],
  ['inventory', inventoryApi as unknown as Record<string, unknown>],
  ['hr', hrApi as unknown as Record<string, unknown>],
  ['manufacturing', manufacturingApi as unknown as Record<string, unknown>],
  ['crm', crmApi as unknown as Record<string, unknown>],
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
  code: '1', nameAr: 'x', name: 'x', username: 'u', invoiceNumber: 'INV-1',
  customerId: UUID, supplierId: UUID, productId: UUID, accountId: UUID,
  lineTotal: 1, totalAmount: 1, date: '2026-01-01', type: 'asset',
};
const ARG_SETS: unknown[][] = [
  [COMPANY, DATA, UUID, UUID_B], [COMPANY, DATA, UUID], [COMPANY, DATA],
  [COMPANY, [DATA], UUID], [COMPANY, [DATA]], [COMPANY, DATA, [DATA]],
  [COMPANY, UUID], [COMPANY], [DATA, COMPANY], [],
];

async function probe(fn: (...a: unknown[]) => unknown): Promise<'clean' | 'raw' | 'inconclusive'> {
  for (const args of ARG_SETS) {
    const before = touched;
    try { await fn(...args); } catch { continue; }
    return touched > before ? 'raw' : 'clean';
  }
  return 'inconclusive';
}

/** Every channel registered in the main process, as a Set of full names. */
function registeredChannels(): Set<string> {
  const src = readFileSync(join(process.cwd(), 'electron', 'dbHandler.js'), 'utf8');
  // Registered one by one and never in a loop, so the literal name is in source.
  return new Set([...src.matchAll(/registerRpc\('([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]));
}

/**
 * Channels that exist for a method that still reaches raw SQL, and why the two
 * are not equivalent. Every entry must be safe to wire deliberately, not a
 * cleanup task.
 */
const DIVERGENT_CHANNELS: Record<string, string> = {
  'accounting.createAccount':
    'the channel inserts 9 columns where the renderer writes 13 - no id, is_active, ' +
    'created_by or updated_by; wiring it would drop the audit columns on the desktop',
  'accounting.getTransactions':
    'the channel joins journal_entries and aggregates entries as JSON where the renderer ' +
    'selects plain t.*; wiring it would make the desktop return a different shape',

  // The five HR channels are registered with dynamic SQL, and their renderer
  // counterparts run two or more statements: a status/dependency guard, then the
  // mutation. So the main-process version is an atomic consolidation rather than a
  // line-for-line translation. That is an improvement, not a bug - but it changes
  // failure behaviour, so connecting it is a decision and not a cleanup, and
  // confirming fidelity means reading each handler rather than trusting the name.
  'hr.deleteEmployee':
    'renderer runs a dependency check then the delete as separate statements; the channel is ' +
    'registered with dynamic SQL consistent with an explicit transaction handler, so wiring it ' +
    'changes the failure behaviour and needs its handler read first',
  'hr.deleteEndOfService':
    'renderer runs a status check then the delete as separate statements; the channel is ' +
    'registered with dynamic SQL consistent with an explicit transaction handler, so wiring it ' +
    'changes the failure behaviour and needs its handler read first',
  'hr.deleteLeave':
    'renderer runs a status check then the delete as separate statements; the channel is ' +
    'registered with dynamic SQL consistent with an explicit transaction handler, so wiring it ' +
    'changes the failure behaviour and needs its handler read first',
  'hr.deletePayrollRun':
    'renderer runs a status check then the delete as separate statements; the channel is ' +
    'registered with dynamic SQL consistent with an explicit transaction handler, so wiring it ' +
    'changes the failure behaviour and needs its handler read first',
  'hr.postPayrollRun':
    'the payroll gross-up posting; the channel is registered with dynamic SQL while the renderer ' +
    'reads the run and posts separately, so this is financial logic and must not be wired without ' +
    'reading the handler against the generator',
};

describe('a channel that exists is not a method that was migrated', () => {
  it('found the registered channels and the raw methods to compare', async () => {
    expect(registeredChannels().size, 'the channel scan found nothing - has dbHandler moved?')
      .toBeGreaterThan(150);
    let rawCount = 0;
    for (const [, api] of SURFACES) {
      for (const [, fn] of Object.entries(api).filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>) {
        if ((await probe(fn)) === 'raw') rawCount++;
      }
    }
    expect(rawCount, 'no method was measured as raw - the probe is not working').toBeGreaterThan(30);
  });

  it('every method that is both raw-reachable and has a channel is documented as divergent', async () => {
    const channels = registeredChannels();
    const traps: string[] = [];
    for (const [domain, api] of SURFACES) {
      for (const [name, fn] of Object.entries(api).filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>) {
        if ((await probe(fn)) !== 'raw') continue;
        const full = domain + '.' + name;
        if (channels.has(full)) traps.push(full);
      }
    }
    expect(traps.sort(), 'a channel exists for a method that still reaches raw SQL. Wiring it is NOT a ' +
      'cleanup: reconcile the two implementations first, then record why here.').toEqual(
      Object.keys(DIVERGENT_CHANNELS).sort(),
    );
  });

  it('no documented divergence has been quietly removed', () => {
    for (const [channel, why] of Object.entries(DIVERGENT_CHANNELS)) {
      expect(registeredChannels().has(channel), channel + ' is documented as divergent but is not registered')
        .toBe(true);
      expect(why.trim().length, channel + ' is documented with no reason').toBeGreaterThan(40);
    }
  });
});
