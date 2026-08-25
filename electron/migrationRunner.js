import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Deterministic schema-sync migration runner.
 *
 * Why not drizzle-kit `migrate()` at runtime?
 * Databases provisioned through legacy paths (resetDatabase.js, manual SQL)
 * have no `__drizzle_migrations` table, so drizzle's migrate() would attempt
 * to replay 0000_unified_schema from scratch and crash — leaving the app on
 * the mock fallback while the live schema silently drifts behind the code
 * (this exact failure shipped missing columns like sales_invoices.attachments
 * and broke invoice creation).
 *
 * Instead we keep ONE tracking table (`app_schema_migrations`) and replay any
 * drizzle/*.sql file that isn't recorded yet. Repo convention makes every
 * migration idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
 * WHERE NOT EXISTS guards — enforced by drizzle/migrations.test.ts), so
 * replaying over a partially-migrated database safely heals drift.
 */
/**
 * Normalize a generated migration into an idempotent one.
 *
 * drizzle-kit emits bare `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ...
 * ADD CONSTRAINT`, which break when replayed over an existing database (the
 * whole point of our self-healing sync). Repo convention requires every
 * migration to be safely re-runnable, so we normalize in-memory at load time:
 *   - CREATE TABLE / INDEX / UNIQUE INDEX → add IF NOT EXISTS
 *   - ALTER TABLE ... ADD CONSTRAINT <name> → wrapped in a DO $$ guard keyed
 *     on the constraint name.
 */
function normalizeIdempotent(rawSql) {
  let sql = rawSql;

  // Tables & indexes
  sql = sql.replace(/\bCREATE TABLE (?!IF NOT EXISTS)/g, 'CREATE TABLE IF NOT EXISTS ');
  sql = sql.replace(/\bCREATE UNIQUE INDEX (?!IF NOT EXISTS)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  sql = sql.replace(/\bCREATE INDEX (?!IF NOT EXISTS)/g, 'CREATE INDEX IF NOT EXISTS ');

  // Constraints: wrap each ADD CONSTRAINT in an existence-guarded DO block.
  // Matches both drizzle-kit forms:
  //   ALTER TABLE ONLY "t"    ADD CONSTRAINT "c" FOREIGN KEY ...
  //   ALTER TABLE "t"         ADD CONSTRAINT "c" FOREIGN KEY ...
  const constraintRe = /^ALTER TABLE (?:ONLY )?("[^"]+"|[\w.]+)\s+ADD CONSTRAINT\s+("[^"]+"|[\w.]+)([^;]*);/gm;
  const guarded = [];
  let last = 0;
  let m;
  while ((m = constraintRe.exec(sql)) !== null) {
    const conname = m[2].replace(/"/g, '');
    guarded.push(sql.slice(last, m.index));
    guarded.push(
      `DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${conname}') THEN\n    ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[2]}${m[3]};\n  END IF;\nEND $$;`
    );
    last = m.index + m[0].length;
  }
  guarded.push(sql.slice(last));
  sql = guarded.join('\n');

  return sql;
}

/**
 * Run schema sync. Accepts an optional connection config override (used by
 * dbHandler's self-heal to reuse the EXACT working pool config — host,
 * credentials, SSL — rather than re-reading env).
 */
export async function runDrizzleMigrations(overrideConfig = null) {
  console.log('[Schema] Starting PostgreSQL schema sync...');
  // Sanitize env values: .env files may carry BOM/CRLF/invisible padding that
  // silently breaks pg connections ("connection terminated", bad hostnames).
  const env = (k, fallback) => {
    const v = String(process.env[k] ?? '').replace(/^[\uFEFF\s]+|[\s\r]+$/g, '');
    return v || fallback;
  };
  const base = {
    host: env('DB_HOST', 'localhost'),
    port: parseInt(env('DB_PORT', '5432'), 10),
    database: env('DB_NAME', ''),
    user: env('DB_USER', ''),
    password: env('DB_PASSWORD', ''),
    connectionTimeoutMillis: 15000,
  };
  const pool = new Pool(overrideConfig ? { ...base, ...overrideConfig } : base);

  const migrationsFolder = path.join(__dirname, '../drizzle');

  try {
    // 1) Tracking table (our single source of truth at runtime).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 2) Ordered list of migration files.
    const files = fs.readdirSync(migrationsFolder)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => {
        const na = parseInt(a.split('_')[0], 10) || 0;
        const nb = parseInt(b.split('_')[0], 10) || 0;
        return na - nb || a.localeCompare(b);
      });

    const applied = new Set(
      (await pool.query('SELECT filename FROM app_schema_migrations')).rows.map((r) => r.filename)
    );

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const raw = normalizeIdempotent(fs.readFileSync(path.join(migrationsFolder, file), 'utf8'));
      // Split on Drizzle breakpoints so each statement runs cleanly.
      const statements = raw
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const stmt of statements) {
          await client.query(stmt);
        }
        await client.query('INSERT INTO app_schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedCount++;
        console.log('[Schema] applied:', file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    if (appliedCount === 0) {
      console.log('[Schema] Database schema is fully up to date.');
    } else {
      console.log(`[Schema] Applied ${appliedCount} migration(s). Schema is up to date.`);
    }
  } catch (err) {
    console.error('[Schema] Sync encountered an error:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}
