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
export async function runDrizzleMigrations() {
  console.log('[Schema] Starting PostgreSQL schema sync...');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000,
  });

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

      const raw = fs.readFileSync(path.join(migrationsFolder, file), 'utf8');
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
