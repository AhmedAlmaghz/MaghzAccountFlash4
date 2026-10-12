import { describe, it, expect, vi, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { assertRelaySql } from '@root/api/_lib/relayGuard.js';
import {
  seedDefault,
  seedDemo,
  withoutInternalMigration,
} from './pgliteAdapter';

/**
 * CONTRACT: every statement the shared seed emits AFTER the relay
 * bootstrap (company + admin/accountant created server-side, remainder run
 * under an admin JWT) must pass the REAL relay guard. The guard bans
 * password_hash absolutely and refuses unscoped/commented statements — a
 * single violating seed line bricks web onboarding on a fresh Supabase DB
 * (the failure that motivated the bootstrap-users split: seeding used to
 * die on the first statement after the admin insert).
 *
 * The mock records {sql, params} and returns canned ids; nothing executes.
 * If this test names a statement, that statement must be reshaped (or moved
 * server-side) — never worked around in the guard.
 */

const CID = '22222222-2222-4222-8222-222222222222';
const AID = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';

function recordingAdapter() {
  const stmts: { sql: string; params: unknown[] }[] = [];
  return {
    stmts,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      stmts.push({ sql, params: params ?? [] });
      return { success: true, rows: [{ id: ROW_ID }] };
    }),
    transaction: vi.fn(async (queries: { sql: string; params?: unknown[] }[]) => {
      for (const q of queries) stmts.push({ sql: q.sql, params: q.params ?? [] });
      return {
        success: true,
        results: queries.map(() => ({ rows: [{ id: ROW_ID }], rowCount: 1 })),
      };
    }),
  };
}

function adminSession() {
  return { user: { id: AID, companyId: CID, role: 'admin' }, permissions: [] as string[] };
}

function expectGuardClean(
  stmts: { sql: string; params: unknown[] }[],
  session: { user: { id: string; companyId: string; role: string }; permissions: string[] },
) {
  expect(stmts.length).toBeGreaterThan(50);
  const hashHits = stmts.filter((s) => /password_hash/i.test(s.sql));
  expect(
    hashHits.map((s) => s.sql.slice(0, 100)),
    'phase-B seed must never mention password_hash (bootstrap-users owns user creation)',
  ).toEqual([]);
  for (const s of stmts) {
    let error: string | null = null;
    try {
      assertRelaySql(session, s.sql, s.params);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    expect(
      error,
      `guard refused seed statement [${error}]: ${s.sql.slice(0, 160)}`,
    ).toBeNull();
  }
}

describe('relay seed guard contract', () => {
  beforeAll(() => {
    // hashPassword uses WebCrypto (same polyfill pattern as pgliteSmoke).
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  });

  it('seedDefault remainder (skipUsers) passes the relay guard statement by statement', async () => {
    const mock = recordingAdapter();
    const r = await withoutInternalMigration(() =>
      seedDefault.call(
        mock as never,
        'admin1234',
        undefined,
        { skipUsers: true, companyId: CID, adminId: AID },
      ),
    );
    expect(r.success, (r as { error?: string }).error).toBe(true);
    expectGuardClean(mock.stmts, adminSession());
  }, 60000);

  it('seedDemo remainder (skipUsers) passes the relay guard statement by statement', async () => {
    const mock = recordingAdapter();
    const r = await withoutInternalMigration(() =>
      seedDemo.call(
        mock as never,
        'admin1234',
        undefined,
        { skipUsers: true, companyId: CID, adminId: AID },
      ),
    );
    expect(r.success, (r as { error?: string }).error).toBe(true);
    expectGuardClean(mock.stmts, adminSession());
  }, 120000);
});
