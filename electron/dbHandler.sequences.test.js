import { describe, it, expect } from 'vitest';
import pg from 'pg';

/**
 * Phase 3 (multi-user): the Electron allocator is atomic —
 * `WITH bumped AS (UPDATE document_sequences ... RETURNING *)` — so N parallel
 * allocator statements must produce N unique bumped cursors. Here we call the
 * same statement N times in parallel against the live dev database
 * (localhost:5432, same env as electron/migrationRunner.js) and assert the
 * allocated numbers are unique.
 *
 * Skips gracefully when no live PostgreSQL is reachable.
 */

const ALLOCATOR_SQL = `WITH bumped AS (
          UPDATE document_sequences
             SET current_number = current_number + increment_step, updated_by = NULL, updated_at = NOW()
           WHERE company_id = $1::uuid AND document_type = $2 AND is_active = true
          RETURNING *
        )
        SELECT row_to_json(bumped) AS sequence FROM bumped`;

function probePool() {
  const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'MaghzERP',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    connectionTimeoutMillis: 3000,
  });
  return pool
    .query('SELECT 1')
    .then(() => ({ available: true, pool }))
    .catch(async () => {
      await pool.end().catch(() => {});
      return { available: false, pool: null };
    });
}

describe('core.getNextDocumentNumber: parallel allocators produce unique numbers (Phase 3)', () => {
  it('10 parallel allocations → 10 unique sequence bumps (live PG)', async () => {
    const probe = await probePool();
    if (!probe.available) {
      console.log('[dbHandler.sequences.test] no live PostgreSQL at localhost:5432 — test skipped');
      return; // skipped path: graceful pass without allocations
    }
    const pool = probe.pool;
    try {
      // Pick a live sequence for the first company/type.
      const seqs = await pool.query(
        'SELECT s.id, s.company_id, s.document_type, s.current_number, s.increment_step FROM document_sequences s JOIN companies c ON c.id = s.company_id LIMIT 1',
      );
      if (!seqs.rows.length) {
        console.log('[dbHandler.sequences.test] no document_sequences rows — test skipped');
        return;
      }
      const s0 = seqs.rows[0];
      const before = Number(s0.current_number);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => pool.query(ALLOCATOR_SQL, [s0.company_id, s0.document_type])),
      );
      const allocated = [];
      for (const r of results) {
        const seq = r.rows && r.rows[0] && r.rows[0].sequence;
        if (seq) allocated.push(Number(seq.current_number) - Number(seq.increment_step));
      }
      expect(allocated).toHaveLength(10);
      expect(new Set(allocated).size).toBe(10);
      expect(allocated.includes(before)).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
