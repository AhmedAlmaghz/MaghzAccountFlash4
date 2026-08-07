// Test simulating the IPC seed path after clearAll
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
    // Check current state
    const companies = await pool.query('SELECT id, name FROM companies');
    console.log('Companies:', companies.rows.length);
    const users = await pool.query('SELECT id, username, role FROM users');
    console.log('Users:', users.rows.length, users.rows.map(r => `${r.username} (${r.role})`));

    // Simulate what db:seed-default does — call seedInitialData
    // It will check COUNT(*) FROM companies > 0 → skip → return existing companyId
    console.log('\n--- Simulating db:seed-default ---');
    const { seedInitialData } = await import('./electron/dbHandler.js');
    try {
      const result = await seedInitialData(null);
      console.log('seedInitialData result:', typeof result === 'string' ? `companyId=${result}` : JSON.stringify(result));
    } catch (err) {
      console.error('seedInitialData ERROR:', err.message);
      console.error('Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
    }

    // Simulate what db:seed-demo does
    console.log('\n--- Simulating db:seed-demo ---');
    const { seedComprehensiveDemoData } = await import('./electron/seedDemoData.js');
    const companyCheck = await pool.query('SELECT id FROM companies LIMIT 1');
    const companyId = companyCheck.rows[0]?.id;
    console.log('companyId:', companyId);
    if (companyId) {
      const client = pool.connect();
      try {
        const result = await seedComprehensiveDemoData(await client, companyId, 'admin1234');
        console.log('seedComprehensiveDemoData result success:', result?.success);
      } catch (err) {
        console.error('seedComprehensiveDemoData ERROR:', err.message);
        console.error('Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
      } finally {
        (await client).release();
      }
    }
  } catch (err) {
    console.error('Main ERROR:', err.message);
    console.error('Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
  } finally {
    await pool.end();
  }
}

main();