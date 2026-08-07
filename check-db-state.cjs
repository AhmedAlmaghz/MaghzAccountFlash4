const pg = require('pg');
require('dotenv').config({ path: '.env.local' });

async function main() {
  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    console.log('Tables count:', tables.rows.length);

    const companies = await pool.query('SELECT COUNT(*)::int as cnt FROM companies');
    console.log('companies:', companies.rows[0].cnt);

    const users = await pool.query('SELECT COUNT(*)::int as cnt FROM users');
    console.log('users:', users.rows[0].cnt);

    const userCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position");
    console.log('users columns:', userCols.rows.map(r => r.column_name).join(', '));

    const accountCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='accounts' ORDER BY ordinal_position");
    console.log('accounts columns:', accountCols.rows.map(r => r.column_name).join(', '));

    const activityLogs = await pool.query("SELECT COUNT(*)::int as cnt FROM activity_logs");
    console.log('activity_logs count:', activityLogs.rows[0].cnt);

    const auditLogs = await pool.query("SELECT COUNT(*)::int as cnt FROM audit_logs");
    console.log('audit_logs count:', auditLogs.rows[0].cnt);
  } catch (err) {
    console.error('ERR:', err.message);
  } finally {
    await pool.end();
  }
}

main();