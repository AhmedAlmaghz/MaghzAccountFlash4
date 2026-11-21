/**
 * backup-restore-repro.mjs — REAL live repro of the MAIN-HANDLER restore
 * failure (db:restore-company in electron/dbHandler.js).
 *
 * Mirrors the main handler flow: knownUserIds → BEGIN → DELETE phase
 * (BACKUP_PLAN, skipping users + upserting companies) → INSERT phase.
 *
 * Everything runs inside a transaction that ALWAYS rolls back — the dev DB
 * is never mutated.
 *
 * Usage: node --import ./scripts/ts-register.mjs scripts/backup-restore-repro.mjs
 */
import { Pool } from 'pg';
import fs from 'node:fs';

const CREDS = (() => {
  const text = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
  return { host: get('DB_HOST') || 'localhost', port: Number(get('DB_PORT') || 5432), database: get('DB_NAME'), user: get('DB_USER'), password: get('DB_PASSWORD') };
})();

const T = await import('../src/core/backup/backupTables.ts');
const E = await import('../src/core/backup/backupEngine.ts');
const { DELETE_ORDER, RESTORE_SKIP_TABLES, RESTORE_UPSERT_TABLES, selectForScope, composeRestoreBatch } = { ...T, ...E };

const pool = new Pool(CREDS);
const client = await pool.connect();
try {
  await client.query('BEGIN');

  const { rows: comps } = await client.query('SELECT id FROM companies ORDER BY created_at DESC LIMIT 1');
  if (!comps[0]) { console.log('NO COMPANY FOUND — is the dev DB seeded?'); process.exit(1); }
  const companyId = comps[0].id;
  console.log('companyId =', companyId);

  const cu = await client.query('SELECT count(*) AS n FROM currencies WHERE created_by IS NOT NULL', []).then((r) => r.rows[0].n);
  console.log('currencies with created_by:', cu);

  const { rows: before } = await client.query('SELECT (SELECT count(*) FROM users WHERE company_id = $1::uuid) AS users', [companyId]);
  console.log('before users:', before[0].users);

  // Read phase (db:backup-company equivalent).
  const tables = {};
  for (const plan of DELETE_ORDER) {
    try {
      tables[plan.table] = (await client.query(selectForScope(plan).sql, [companyId])).rows;
    } catch (e) { /* skip missing */ }
  }

  // Main-handler semantics: knownUserIds read BEFORE any delete.
  const knownUserIds = new Set((await client.query('SELECT id FROM users WHERE company_id = $1', [companyId])).rows.map((r) => String(r.id)));
  console.log('knownUserIds:', [...knownUserIds].join(','));

  // MAIN HANDLER DELETE phase — mirrors electron/dbHandler.js 8284-8301.
  let deleteErr = null;
  for (const entry of DELETE_ORDER) {
    if (RESTORE_SKIP_TABLES.includes(entry.table)) continue;
    if (RESTORE_UPSERT_TABLES.includes(entry.table)) continue;
    const { scope } = entry;
    let sql;
    if (scope.type === 'company') sql = `DELETE FROM ${entry.table} WHERE company_id = $1`;
    else if (scope.type === 'single') sql = `DELETE FROM ${entry.table} WHERE ${scope.idColumn} = $1`;
    else sql = `DELETE FROM ${entry.table} WHERE ${scope.fk} IN (SELECT id FROM ${scope.parent} WHERE company_id = $1)`;
    try { await client.query(sql, [companyId]); } catch (e) { deleteErr = { table: entry.table, message: e.message }; break; }
  }
  if (deleteErr) {
    console.log('DELETE phase error at', deleteErr.table, ':', deleteErr.message);
    await client.query('ROLLBACK'); process.exit(1);
  }
  const afterDelete = await client.query('SELECT (SELECT count(*) FROM users) AS users_all, (SELECT count(*) FROM companies) AS companies_n, (SELECT count(*) FROM currencies WHERE company_id = $1::uuid) AS currencies_co, (SELECT count(*) FROM currencies WHERE created_by IS NULL) AS currencies_nullcb', [companyId]);
  console.log('after DELETE phase (same txn):', JSON.stringify(afterDelete.rows[0]));

  // MAIN HANDLER INSERT phase — mirror with real composeRestoreBatch statements
  // (its deletes are a no-op at this point; companies is upserted here).
  const { statements } = composeRestoreBatch(companyId, tables, { knownUserIds, fallbackUserId: [...knownUserIds][0] ?? null });
  const inserts = statements.filter((s) => /^INSERT INTO/i.test(s.sql.trim()));
  console.log('insert statements:', inserts.length);
  let firstError = null;
  let executed = 0;
  for (const s of inserts) {
    try {
      await client.query(s.sql, s.params);
      executed++;
    } catch (e) {
      firstError = { executed, sql: s.sql.slice(0, 200), params: s.params.slice(0, 4), message: e.message, code: e.code };
      break;
    }
  }
  if (firstError) {
    console.log('\nFIRST INSERT ERROR after', executed, 'inserts:');
    console.log('  code:', firstError.code);
    console.log('  message:', firstError.message);
    console.log('  sql:', firstError.sql);
    console.log('  params[0..3]:', firstError.params);
  } else {
    console.log('\nNO INSERT ERROR — flow succeeds in-txn');
  }
  await client.query('ROLLBACK');
} catch (e) {
  console.log('REPRO ERROR:', e.message);
} finally {
  await client.release();
  await pool.end();
}
