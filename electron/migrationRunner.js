import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runDrizzleMigrations() {
  console.log('[Drizzle] Starting PostgreSQL database migrations...');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000,
  });

  const db = drizzle(pool);

  // Path to the drizzle migrations folder
  const migrationsFolder = path.join(__dirname, '../drizzle');
  
  try {
    console.log('[Drizzle] Applying migrations from:', migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log('[Drizzle] Database schema is fully up to date.');
  } catch (err) {
    console.error('[Drizzle] Running migrations encountered an error:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}
