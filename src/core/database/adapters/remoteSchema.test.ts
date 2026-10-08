import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from './types';
import { ensureRemoteSchema, isWakeRetryableError } from './remoteSchema';
import { splitMigrationStatements } from '@root/api/_lib/dbCore.js';
import { getBundledMigrations } from './pgliteAdapter';

function makeAdapter(log: string[], opts?: { failOn?: (sql: string) => string | null; tracked?: Set<string> }) {
  const tracked = opts?.tracked ?? new Set<string>();
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      log.push(sql.slice(0, 60));
      const fail = opts?.failOn?.(sql);
      if (fail) return { success: false, error: fail };
      if (sql.startsWith('SELECT 1 FROM')) {
        const name = (params?.[0] as string) ?? '';
        return { success: true, rows: tracked.has(name) ? [{ '?column?': 1 }] : [] };
      }
      if (sql.startsWith('INSERT INTO')) {
        tracked.add((params?.[0] as string) ?? '');
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    }),
  } as unknown as Pick<DbAdapter, 'query'>;
}

describe('getBundledMigrations / splitMigrationStatements', () => {
  it('exposes the full bundled chain', () => {
    const ms = getBundledMigrations();
    // v0.26.5 squashed the 0000–0042 chain into a single baseline — the
    // contract is "the bundle is non-empty and starts with the baseline",
    // not a fixed file count (future additive migrations stay welcome).
    expect(ms.length).toBeGreaterThanOrEqual(1);
    expect(ms[0].name).toBe('0000_init');
    expect(ms[0].sql).toMatch(/--> statement-breakpoint/);
    expect(ms[0].sql).toMatch(/CREATE TABLE (IF NOT EXISTS )?"companies"/);
    expect(ms.every((m) => m.sql.length > 0)).toBe(true);
  });
  it('splits on drizzle breakpoints', () => {
    const parts = splitMigrationStatements('CREATE TABLE a (x int);--> statement-breakpoint  CREATE TABLE b (y int);');
    expect(parts).toHaveLength(2);
  });
  it('keeps a file without markers as one statement', () => {
    expect(splitMigrationStatements('SELECT 1')).toHaveLength(1);
  });
});

describe('ensureRemoteSchema', () => {
  it('applies missing migrations and tracks them', async () => {
    const log: string[] = [];
    const adapter = makeAdapter(log);
    const seen: Array<[number, number, string]> = [];
    const r = await ensureRemoteSchema(adapter, (a, t, n) => seen.push([a, t, n]));
    expect(r.success).toBe(true);
    expect(r.applied).toBe(getBundledMigrations().length);
    expect(seen.length).toBe(r.applied);
    // Second run is a no-op (everything tracked)
    const r2 = await ensureRemoteSchema(adapter);
    expect(r2.success).toBe(true);
    expect(r2.applied).toBe(0);
  });
  it('skips already-tracked migrations', async () => {
    const log: string[] = [];
    const tracked = new Set(getBundledMigrations().map((m) => m.name));
    const r = await ensureRemoteSchema(makeAdapter(log, { tracked }));
    expect(r.success).toBe(true);
    expect(r.applied).toBe(0);
  });
  it('names the failing migration file', async () => {
    const log: string[] = [];
    const r = await ensureRemoteSchema(
      makeAdapter(log, {
        // Fail inside a migration file, not on the tracking-table DDL
        // (a tracking-table failure correctly returns the raw error —
        // no file is involved there).
        failOn: (sql) => (sql.includes('CREATE TABLE') && !sql.includes('__pglite_migrations') ? 'boom' : null),
      }),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Remote migration \S+ failed: boom/);
  });
  it('returns the raw error when the tracking table itself fails', async () => {
    const log: string[] = [];
    const r = await ensureRemoteSchema(makeAdapter(log, { failOn: () => 'boom' }));
    expect(r.success).toBe(false);
    expect(r.error).toBe('boom');
  });
});

describe('isWakeRetryableError + cold-start retries', () => {
  it('classifies only wake-class failures as retryable', () => {
    expect(isWakeRetryableError(new Error('TimeoutError: signal timed out'))).toBe(true);
    expect(isWakeRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isWakeRetryableError(new Error('password authentication failed'))).toBe(false);
    expect(isWakeRetryableError(new Error('syntax error at or near "x"'))).toBe(false);
    expect(isWakeRetryableError('relation "t" does not exist')).toBe(false);
  });

  it('rides out a waking compute (two timeouts, then success)', async () => {
    const log: string[] = [];
    let calls = 0;
    const adapter = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        log.push(sql.slice(0, 60));
        calls++;
        if (calls <= 2) return { success: false, error: 'TimeoutError: signal timed out' };
        if (sql.startsWith('SELECT 1 FROM')) return { success: true, rows: [] };
        if (sql.startsWith('INSERT INTO')) return { success: true, rows: [] };
        return { success: true, rows: [] };
      }),
    } as unknown as Pick<DbAdapter, 'query'>;
    const r = await ensureRemoteSchema(adapter);
    expect(r.success).toBe(true);
    expect(calls).toBeGreaterThan(2);
  }, 30000);

  it('fails fast on auth errors without burning retries', async () => {
    let calls = 0;
    const adapter = {
      query: vi.fn(async () => {
        calls++;
        return { success: false, error: 'password authentication failed' };
      }),
    } as unknown as Pick<DbAdapter, 'query'>;
    const r = await ensureRemoteSchema(adapter);
    expect(r.success).toBe(false);
    expect(r.error).toBe('password authentication failed');
    expect(calls).toBe(1);
  });
});
