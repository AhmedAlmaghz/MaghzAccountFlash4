/**
 * backup-roundtrip-smoke.mjs — full .mab round-trip against the live dev DB.
 *
 * 1. Read rows (mirror db:backup-company).
 * 2. encodeBackup → manifest.
 * 3. decodeBackup → verify checksum/gzip round-trip.
 * 4. Mirror db:restore-company: knownUserIds → DELETEs → INSERTs — all inside
 *    a transaction that always rolls back.
 *
 * Usage: node --import ./scripts/ts-register.mjs scripts/backup-roundtrip-smoke.mjs
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
let failures = 0;
const check = (ok, label, detail = '') => { console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };

// ---------- 1. read (mirror db:backup-company) ----------
const { rows: comps } = await client.query('SELECT id, name FROM companies ORDER BY created_at DESC LIMIT 1');
if (!comps[0]) { console.log('no company — skipping'); process.exit(1); }
const companyId = comps[0].id;
console.log('1) read (db:backup-company mirror)');
const tables = {};
const readWarnings = [];
for (const plan of DELETE_ORDER) {
  try { tables[plan.table] = (await client.query(selectForScope(plan).sql, [companyId])).rows; }
  catch (e) { readWarnings.push(`${plan.table}: ${e.message}`); }
}
const totalRows = Object.values(tables).reduce((n, r) => n + r.length, 0);
console.log(`   tables=${Object.keys(tables).length} rows=${totalRows} warnings=${readWarnings.length}`);
check(readWarnings.length === 0, 'backup read has no warnings');
check(tables.currencies?.length === 3, 'currencies read', `count=${tables.currencies?.length}`);

// ---------- 2. encode → manifest ----------
console.log('2) encodeBackup → decodeBackup round-trip');
const envelope = await E.encodeBackup(tables, { companyId, companyName: comps[0].name });
const decoded = await E.decodeBackup(envelope);
check(decoded.manifest.totalRows === totalRows, 'manifest totalRows matches', `${decoded.manifest.totalRows} vs ${totalRows}`);
check(decoded.tables.currencies?.length === 3, 'decoded currencies present');
const roundTripCurrency = JSON.stringify(decoded.tables.currencies?.find((c) => c.company_id === companyId));
const rawCurrency = JSON.stringify(tables.currencies?.find((c) => c.company_id === companyId));
check(roundTripCurrency === rawCurrency, 'currency row byte-identical after round-trip', roundTripCurrency?.slice(0, 120));

// ---------- 3+4. restore mirror inside ROLLBACK ----------
console.log('3) restore mirror (db:restore-company) inside ROLLBACK');
await client.query('BEGIN');
const knownUserIds = new Set((await client.query('SELECT id FROM users WHERE company_id = $1', [companyId])).rows.map((r) => String(r.id)));
for (const entry of DELETE_ORDER) {
  if (RESTORE_SKIP_TABLES.includes(entry.table)) continue;
  if (RESTORE_UPSERT_TABLES.includes(entry.table)) continue;
  const { scope } = entry;
  let sql;
  if (scope.type === 'company') sql = `DELETE FROM ${entry.table} WHERE company_id = $1`;
  else if (scope.type === 'single') sql = `DELETE FROM ${entry.table} WHERE ${scope.idColumn} = $1`;
  else sql = `DELETE FROM ${entry.table} WHERE ${scope.fk} IN (SELECT id FROM ${scope.parent} WHERE company_id = $1)`;
  await client.query(sql, [companyId]);
}
const { statements, warnings } = composeRestoreBatch(companyId, decoded.tables, { knownUserIds, fallbackUserId: [...knownUserIds][0] ?? null });
let executed = 0;
let firstError = null;
for (const s of statements) {
  try { await client.query(s.sql, s.params); executed++; }
  catch (e) { firstError = { executed, sql: s.sql.slice(0, 200), message: e.message, code: e.code }; break; }
}
check(!firstError, 'insert phase has no errors', firstError ? `after ${executed} inserts: ${firstError.message} [${firstError.code || ''}]` : '');
check(warnings.length === 0, 'compose warnings are empty', warnings.join('; '));
await client.query('ROLLBACK');

console.log(failures === 0 ? '\nROUND-TRIP: ALL PASS' : `\nROUND-TRIP: ${failures} FAILURES`);
await client.release();
await pool.end();
process.exit(failures === 0 ? 0 : 1);
