import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Reachability, measured by running the code instead of reading it.
 *
 * The text-scanning gates in this repo have been wrong three times in four
 * sessions, each in a different direction: an inverted rule (over-count), a
 * splitter that could not see object-literal methods (under-count), and a guard
 * on one read that made a whole function look safe (laundering). All three were
 * static-analysis failures, and the direction that hurts is always the same - a
 * raw statement on the desktop that nothing reports.
 *
 * So this gate analyses no text. It installs a bridge, which is the only thing
 * isElectronPg() looks at, and hands the adapter a spy. A function that reaches
 * raw SQL on the desktop calls the spy, because there the adapter's query
 * forwards straight to the legacy _exec channel. A function that routes through
 * typed RPC returns without touching it.
 *
 * No regex settles that, because it is a control-flow question and the codebase
 * has several valid guard shapes plus the router-helper idiom. Running the
 * function settles it every time.
 *
 * The expected list is a MEASUREMENT, not a derivation. A migration removes a
 * name; a regression adds one and fails here by name.
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

import * as coreApi from '@/core/api';
import { getDbAdapter } from '@/core/database/adapters';

const UUID_A = '00000000-0000-0000-0000-0000000000a1';
const UUID_B = '00000000-0000-0000-0000-0000000000b2';

let touched: string[] = [];

beforeEach(() => {
  touched = [];
  const surface = new Proxy({}, { get: () => async () => ({ success: true, rows: [], id: UUID_A }) });
  const bridge = new Proxy(
    { ping: () => Promise.resolve({ success: true }) },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : surface) },
  );
  (window as unknown as Record<string, unknown>).electronDB = bridge;

  const record = (kind: string) => vi.fn(async (sql?: unknown) => {
    touched.push(kind);
    void sql;
    return { success: true, rows: [], results: [], id: UUID_A };
  });
  vi.mocked(getDbAdapter).mockResolvedValue({
    query: record('query'),
    transaction: record('transaction'),
    createTransaction: record('createTransaction'),
  } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronDB;
  vi.restoreAllMocks();
  vi.mocked(getDbAdapter).mockReset();
});

/**
 * Plausible argument tuples, most specific first. A tuple that throws is simply
 * not the right shape for that function; the probe moves on. If none work the
 * function is INCONCLUSIVE, which is reported rather than silently counted as
 * safe - an unmeasured function must never look like a clean one.
 */
const DATA = { nameAr: 'x', name: 'x', key: 'k', value: 'v', template: 'trading' };
const ARG_SETS: unknown[][] = [
  [UUID_A, 'trading', UUID_B],
  [UUID_A, DATA, UUID_A, UUID_B],
  [UUID_A, DATA, UUID_A],
  [UUID_A, DATA],
  [UUID_A, null, UUID_A, UUID_B],
  [UUID_A, UUID_B],
  [UUID_A],
  [],
];

async function probe(fn: (...a: unknown[]) => unknown): Promise<'clean' | 'raw' | 'inconclusive'> {
  for (const args of ARG_SETS) {
    const before = touched.length;
    try {
      await fn(...args);
    } catch {
      continue;
    }
    return touched.length > before ? 'raw' : 'clean';
  }
  return 'inconclusive';
}

describe('with a bridge present, core/api reaches raw SQL only where it is known to', () => {
  const exports = Object.entries(coreApi)
    .filter(([, v]) => typeof v === 'function') as Array<[string, (...a: unknown[]) => unknown]>;

  it('has a working probe (a broken one passes by absence)', async () => {
    expect(exports.length).toBeGreaterThan(20);
    // A function that must be clean, and one that must be raw: if either of
    // these misreports, the harness is lying and the rest of the list is void.
    expect(await probe(coreApi.getUnits)).toBe('clean');
    expect(await probe(coreApi.applyDefaultTemplate)).toBe('raw');
  });

  it('names every export that still reaches raw SQL, and nothing unmeasured', async () => {
    const raw: string[] = [];
    const inconclusive: string[] = [];
    for (const [name, fn] of exports) {
      const verdict = await probe(fn);
      if (verdict === 'raw') raw.push(name);
      if (verdict === 'inconclusive') inconclusive.push(name);
    }
    expect({ raw, inconclusive },
      'reachability changed - migrate the addition, or re-measure this list deliberately').toEqual({
      raw: ['applyDefaultTemplate'],
      inconclusive: [],
    });
  });
});
