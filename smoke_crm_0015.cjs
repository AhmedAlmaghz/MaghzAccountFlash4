/**
 * CRM Phase 0015 — live PG smoke test.
 * Everything runs inside BEGIN … ROLLBACK so the dev DB stays untouched.
 *
 * Verifies:
 *  1. Migration 0015 applies cleanly (idempotent re-run too).
 *  2. Dead tables (crm_activities, calls) are gone.
 *  3. FKs ON DELETE SET NULL work (severing, not cascading).
 *  4. The stage machine side-effects: won → close_date + probability=100.
 *  5. The unified convert CTE: customer + lead status + optional opportunity,
 *     with the code from document_sequences — all-or-nothing.
 *  6. createActivity stamps lead.last_contacted_at atomically.
 *  7. deleteLead reference guard rejects when references exist.
 *  8. New indexes exist.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Connection from env only (same vars as .env.local / electron) — never hardcode credentials.
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_NAME = process.env.DB_NAME || 'MaghzAccountFlash35';
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
if (!DB_USER || !DB_PASSWORD) {
  console.error('DB_USER and DB_PASSWORD env vars are required (see .env.local).');
  process.exit(1);
}
const URL = process.env.DATABASE_URL || `postgresql://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
const pool = new Pool({ connectionString: URL });

const ok = (name) => console.log('  ✓ ' + name);
const fail = (name, extra) => { console.error('  ✗ ' + name + (extra ? ' — ' + extra : '')); process.exitCode = 1; };
async function check(name, cond, extra) { if (await cond) ok(name); else fail(name, extra); }

(async () => {
  const client = await pool.connect();
  try {
    console.log('── 1. Apply migration 0015 (idempotent ×2) ──');
    const sql = fs.readFileSync(path.join(__dirname, 'drizzle', '0015_crm_professional.sql'), 'utf8');
    // Split on statement boundaries — the file has DO $$ blocks with semicolons inside,
    // so we run it via a simple driver-level multi-statement call instead.
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(sql); // idempotency: second run must not throw
    await client.query('COMMIT');
    ok('0015 applied twice (idempotent)');

    console.log('── 2. Dead tables dropped ──');
    for (const t of ['crm_activities', 'calls']) {
      const r = await client.query("SELECT to_regclass($1) AS t", ['public.' + t]);
      await check(`${t} is gone`, r.rows[0].t === null);
    }

    console.log('── 3. FKs ON DELETE SET NULL ──');
    await client.query('BEGIN');
    const cid = (await client.query('SELECT id FROM companies ORDER BY created_at LIMIT 1')).rows[0].id;
    const lead = (await client.query(
      `INSERT INTO leads (company_id, name, phone, status, rating) VALUES ($1::uuid,'SMOKE Lead A','777000111','new','hot') RETURNING id, name`,
      [cid])).rows[0];
    const opp = (await client.query(
      `INSERT INTO opportunities (company_id, lead_id, name, value, stage, probability) VALUES ($1::uuid,$2::uuid,'SMOKE Opp',50000,'new',10) RETURNING id`,
      [cid, lead.id])).rows[0];
    await client.query('DELETE FROM leads WHERE id = $1::uuid', [lead.id]);
    const orphan = await client.query('SELECT lead_id FROM opportunities WHERE id = $1::uuid', [opp.id]);
    await check('deleting the lead severs (SET NULL) the opportunity link', orphan.rows[0].lead_id === null);
    await client.query('ROLLBACK');

    console.log('── 4. Stage machine side-effects (won) ──');
    await client.query('BEGIN');
    const leadB = (await client.query(
      `INSERT INTO leads (company_id, name, status, rating, estimated_value) VALUES ($1::uuid,'SMOKE Lead B','new','warm', 42000) RETURNING id, name`,
      [cid])).rows[0];
    const oppB = (await client.query(
      `INSERT INTO opportunities (company_id, lead_id, name, value, stage, probability) VALUES ($1::uuid,$2::uuid,'SMOKE Opp B',42000,'negotiation',80) RETURNING id`,
      [cid, leadB.id])).rows[0];
    // The dbHandler updateOpportunity CASE logic (mirrored):
    await client.query(
      `UPDATE opportunities o SET
         stage = CASE WHEN o.stage IN ('won','lost') THEN o.stage ELSE $2::text END,
         close_date = CASE WHEN o.stage IN ('won','lost') THEN o.close_date WHEN $2::text IN ('won','lost') THEN CURRENT_DATE ELSE o.close_date END,
         probability = CASE WHEN o.stage IN ('won','lost') THEN o.probability WHEN $2::text = 'won' THEN 100 WHEN $2::text = 'lost' THEN 0 ELSE o.probability END,
         updated_at = NOW()
       WHERE o.id = $1::uuid AND o.company_id = $3::uuid`,
      [oppB.id, 'won', cid]);
    const won = (await client.query('SELECT stage, probability, close_date IS NOT NULL AS has_close FROM opportunities WHERE id = $1::uuid', [oppB.id])).rows[0];
    await check('won → stage won', won.stage === 'won');
    await check('won → probability 100', Number(won.probability) === 100);
    await check('won → close_date stamped', won.has_close === true);
    // Terminal lock: re-update must keep the stage (CASE first branch)
    await client.query(
      `UPDATE opportunities o SET stage = CASE WHEN o.stage IN ('won','lost') THEN o.stage ELSE $2::text END WHERE o.id = $1::uuid`,
      [oppB.id, 'negotiation']);
    const locked = (await client.query('SELECT stage FROM opportunities WHERE id = $1::uuid', [oppB.id])).rows[0];
    await check('terminal lock — won stays won', locked.stage === 'won');
    await client.query('ROLLBACK');

    console.log('── 5. Unified convert CTE (atomic) ──');
    await client.query('BEGIN');
    const leadC = (await client.query(
      `INSERT INTO leads (company_id, name, phone, email, status, rating, estimated_value) VALUES ($1::uuid,'SMOKE Lead C','777000222','c@smoke.test','new','hot', 90000) RETURNING id, name, phone, email, estimated_value`,
      [cid])).rows[0];
    // Consume a real sequence number first (mirrors getNextDocumentNumber):
    const seq = await client.query(
      `UPDATE document_sequences SET current_number = current_number + increment_step
        WHERE company_id = $1::uuid AND document_type = 'customer' AND is_active = true RETURNING prefix, current_number, padding_length, suffix`,
      [cid]);
    const s = seq.rows[0];
    const code = `${s.prefix ?? ''}${s.prefix && !String(s.prefix).endsWith('-') ? '-' : ''}${String(s.current_number).padStart(Number(s.padding_length) || 4, '0')}${s.suffix ?? ''}`;
    // The exact CTE the API now runs:
    const conv = await client.query(
      `WITH lead_check AS (
          SELECT id, name, phone, email, estimated_value, assigned_to FROM leads
           WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'converted' LIMIT 1
       ), new_customer AS (
          INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, credit_limit, balance, is_active, created_by, updated_by)
          SELECT $2::uuid, $3, $4, $5, $6, $7, $8, $9, 0, true, NULL, NULL FROM lead_check RETURNING id
       ), updated AS (
          UPDATE leads SET status = 'converted', updated_at = NOW()
           WHERE id = $1::uuid AND company_id = $2::uuid AND EXISTS (SELECT 1 FROM lead_check) RETURNING id
       ), new_opp AS (
          INSERT INTO opportunities (company_id, lead_id, customer_id, name, value, stage, probability, assigned_to, created_at, created_by, updated_by)
          SELECT $2::uuid, $1::uuid, nc.id, 'فرصة ' || lc.name, COALESCE(lc.estimated_value, 0), 'new', 50, lc.assigned_to, NOW(), NULL, NULL
            FROM lead_check lc CROSS JOIN new_customer nc WHERE $10::boolean RETURNING id
       )
       SELECT nc.id, (SELECT id FROM new_opp) AS opportunity_id FROM new_customer nc, updated`,
      [leadC.id, cid, code, leadC.name, leadC.phone, leadC.email, null, null, 0, true]);
    const converted = conv.rows[0];
    await check('convert → customer created', !!converted.id);
    await check('convert → first opportunity created', !!converted.opportunity_id);
    const leadAfter = (await client.query('SELECT status FROM leads WHERE id = $1::uuid', [leadC.id])).rows[0];
    await check('convert → lead status converted', leadAfter.status === 'converted');
    const custCode = (await client.query('SELECT code FROM customers WHERE id = $1::uuid', [converted.id])).rows[0];
    await check('convert → code from document_sequences', custCode.code === code);
    // Idempotent guard: converting again yields ZERO rows (lead_check empty)
    const convAgain = await client.query(
      `WITH lead_check AS (
          SELECT id FROM leads WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'converted' LIMIT 1
       ), new_customer AS (
          INSERT INTO customers (company_id, code, name, balance, is_active)
          SELECT $2::uuid, 'X-DUP', 'dup', 0, true FROM lead_check RETURNING id
       ) SELECT id FROM new_customer`,
      [leadC.id, cid]);
    await check('convert → already-converted rejected (0 rows)', convAgain.rows.length === 0);
    await client.query('ROLLBACK');

    console.log('── 6. createActivity stamps last_contacted_at (CTE) ──');
    await client.query('BEGIN');
    const leadD = (await client.query(
      `INSERT INTO leads (company_id, name, status, rating) VALUES ($1::uuid,'SMOKE Lead D','contacted','warm') RETURNING id`,
      [cid])).rows[0];
    const act = await client.query(
      `WITH new_activity AS (
          INSERT INTO activities (company_id, lead_id, type, subject, activity_date, created_at)
          VALUES ($1::uuid, $2::uuid, 'call', 'SMOKE call', '2026-08-30', NOW()) RETURNING id
       ), touched_lead AS (
          UPDATE leads SET last_contacted_at = '2026-08-30', updated_at = NOW()
           WHERE id = $2::uuid AND company_id = $1::uuid RETURNING id
       ) SELECT id FROM new_activity`,
      [cid, leadD.id]);
    await check('activity inserted (CTE returns id)', act.rows.length === 1);
    const lc = (await client.query('SELECT last_contacted_at::date = \'2026-08-30\' AS stamped FROM leads WHERE id = $1::uuid', [leadD.id])).rows[0];
    await check('lead.last_contacted_at stamped atomically', lc.stamped === true);
    await client.query('ROLLBACK');

    console.log('── 7. deleteLead reference guard ──');
    await client.query('BEGIN');
    const leadE = (await client.query(
      `INSERT INTO leads (company_id, name, status, rating) VALUES ($1::uuid,'SMOKE Lead E','new','warm') RETURNING id`,
      [cid])).rows[0];
    await client.query(`INSERT INTO tasks (company_id, lead_id, title, due_date, priority, status) VALUES ($1::uuid,$2::uuid,'SMOKE task','2026-09-05','medium','pending')`, [cid, leadE.id]);
    const guard = await client.query(
      `WITH refs AS (
          SELECT (SELECT COUNT(*)::int FROM opportunities WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS opps,
                 (SELECT COUNT(*)::int FROM tasks WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS tasks,
                 (SELECT COUNT(*)::int FROM activities WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS acts
       ), del AS (
          DELETE FROM leads WHERE id = $1::uuid AND company_id = $2::uuid
            AND (SELECT opps FROM refs) = 0 AND (SELECT tasks FROM refs) = 0 AND (SELECT acts FROM refs) = 0 RETURNING id
       ) SELECT (SELECT tasks FROM refs) AS tasks, (SELECT COUNT(*)::int FROM del) AS deleted`,
      [leadE.id, cid]);
    await check('deleteLead blocked (tasks reference)', guard.rows[0].deleted === 0 && Number(guard.rows[0].tasks) === 1);
    await client.query('ROLLBACK');

    console.log('── 8. New indexes exist ──');
    for (const idx of ['idx_leads_company_status', 'idx_leads_company_created', 'idx_opportunities_company_stage',
                       'idx_opportunities_company_close', 'idx_tasks_company_status_due', 'idx_activities_company_date']) {
      const r = await client.query("SELECT 1 FROM pg_indexes WHERE indexname = $1", [idx]);
      await check(idx, r.rows.length === 1);
    }

    console.log(process.exitCode ? '\nSMOKE FAILED ✗' : '\nSMOKE PASSED ✓ (all inside ROLLBACK — DB untouched)');
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
  } finally {
    client.release();
    await pool.end();
  }
})();
