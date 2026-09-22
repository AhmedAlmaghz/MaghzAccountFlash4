import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from './types';
import { ensureRemoteSchema } from './remoteSchema';
import { getBundledMigrations, splitMigrationStatements } from './pgliteAdapter';

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
    expect(ms.length).toBeGreaterThanOrEqual(38);
    expect(ms[0].name).toBe('0000_init');
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
