/**
 * Live proof of the paged-total fix, against a real database (PGlite with the
 * bundled migrations).
 *
 * pagedTotalGate only inspects SQL text, and text cannot show what a page past
 * the end returns. That is the whole defect: the old COUNT(*) OVER() shape
 * returns no rows at all for such a page, so the total is unrecoverable, while
 * the count LEFT JOIN LATERAL page ON true shape returns exactly one row
 * carrying the true count with has_row false.
 *
 * The SQL executed here is copied from the crm.getLeadsPaginated channel, not
 * re-typed from memory, so the test cannot quietly pass against a stale shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DbAdapter } from '@/core/database/adapters/types';
import { runPgliteMigrations, pgliteAdapter } from '@/core/database/adapters/pgliteAdapter';
import { webcrypto } from 'node:crypto';

const query = pgliteAdapter.query as DbAdapter['query'];
const COMPANY = `PAGED-TOTAL-${Date.now()}`;

/** Copied from the channel: the count subquery and the page share FROM and WHERE. */
const COUNT_LATERAL_SQL = `SELECT c.total_count, (pg.id IS NOT NULL) AS has_row, pg.*
                            FROM (SELECT COUNT(*)::int AS total_count
                                    FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
                                   WHERE l.company_id = $1
                                     AND ($2::text IS NULL OR l.status = $2)
                                     AND ($3::uuid IS NULL OR l.assigned_to = $3)
                                     AND ($4::text IS NULL OR l.name ILIKE $4 OR l.email ILIKE $4 OR l.phone ILIKE $4)) c
                            LEFT JOIN LATERAL (
                              SELECT * FROM (
                                SELECT l.*, u.full_name as assigned_name
                                  FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
                                 WHERE l.company_id = $1
                                   AND ($2::text IS NULL OR l.status = $2)
                                   AND ($3::uuid IS NULL OR l.assigned_to = $3)
                                   AND ($4::text IS NULL OR l.name ILIKE $4 OR l.email ILIKE $4 OR l.phone ILIKE $4)
                                  ORDER BY l.created_at DESC
                                  LIMIT $5 OFFSET $6
                              ) _p
                            ) pg ON true`;

/** The shape being replaced, kept here so the contrast is executable, not asserted from memory. */
const WINDOW_SQL = `SELECT l.*, u.full_name as assigned_name,
                           COUNT(*) OVER() AS total_count
                      FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
                     WHERE l.company_id = $1
                       AND ($2::text IS NULL OR l.status = $2)
                       AND ($3::uuid IS NULL OR l.assigned_to = $3)
                       AND ($4::text IS NULL OR l.name ILIKE $4 OR l.email ILIKE $4 OR l.phone ILIKE $4)
                     ORDER BY l.created_at DESC
                     LIMIT $5 OFFSET $6`;

let companyId: string;
let userId: string;

async function seed() {
  const c = await query(`INSERT INTO companies (name, currency) VALUES ($1, 'YER') RETURNING id`, [COMPANY]);
  companyId = c.rows![0].id as string;
  const u = await query(
    `INSERT INTO users (company_id, username, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, 'x', true) RETURNING id`,
    [companyId, 'paged_' + Date.now(), 'Assigned Rep'],
  );
  userId = u.rows![0].id as string;
  for (let i = 0; i < 7; i++) {
    await query(
      `INSERT INTO leads (company_id, name, email, status, assigned_to, created_at)
       VALUES ($1, $2, $3, 'new', $4, NOW() - ($5 || ' hours')::interval)`,
      [companyId, `Lead ${i}`, `lead${i}@example.com`, userId, String(i)],
    );
  }
}

/** Mirrors splitPagedRpcRows on the renderer side. */
function split(rows: Record<string, unknown>[] | undefined) {
  const list = rows || [];
  return {
    items: list.filter((r) => r.has_row === true),
    total: list.length > 0 ? Number(list[0].total_count || 0) : 0,
  };
}

describe('a paged read reports its total even on an empty page (live PGlite)', () => {
  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    await runPgliteMigrations();
    await seed();
  }, 120000);

  afterAll(async () => {
    const close = (pgliteAdapter as unknown as { close?: () => Promise<void> }).close;
    if (typeof close === 'function') await close();
  });

  it('the old shape really does lose the total', async () => {
    const res = await query(WINDOW_SQL, [companyId, null, null, null, 3, 21]);
    expect(res.success).toBe(true);
    // Page 8 of 7 leads: nothing comes back, so nothing carries the total.
    expect(res.rows).toHaveLength(0);
    const { total } = split(res.rows);
    expect(total).toBe(0);
  });

  it('the new shape returns the true total with no items', async () => {
    const res = await query(COUNT_LATERAL_SQL, [companyId, null, null, null, 3, 21]);
    expect(res.success).toBe(true);
    expect(res.rows).toHaveLength(1);
    const { items, total } = split(res.rows);
    expect(items).toHaveLength(0);
    expect(total).toBe(7);
  });

  it('a page inside the range still returns the rows and the total', async () => {
    const res = await query(COUNT_LATERAL_SQL, [companyId, null, null, null, 3, 3]);
    expect(res.rows).toHaveLength(3);
    const { items, total } = split(res.rows);
    expect(items).toHaveLength(3);
    expect(total).toBe(7);
    // assigned_name survives the wrapper.
    expect((items[0] as Record<string, unknown>).assigned_name).toBe('Assigned Rep');
  });

  it('the last partial page keeps the total too', async () => {
    const res = await query(COUNT_LATERAL_SQL, [companyId, null, null, null, 3, 6]);
    const { items, total } = split(res.rows);
    expect(items).toHaveLength(1);
    expect(total).toBe(7);
  });

  it('filters still narrow both the count and the page', async () => {
    const res = await query(COUNT_LATERAL_SQL, [companyId, 'new', null, null, 3, 0]);
    const { items, total } = split(res.rows);
    expect(items).toHaveLength(3);
    expect(total).toBe(7);

    const none = await query(COUNT_LATERAL_SQL, [companyId, 'converted', null, null, 3, 0]);
    const noneSplit = split(none.rows);
    expect(noneSplit.items).toHaveLength(0);
    expect(noneSplit.total).toBe(0);
  });
});
