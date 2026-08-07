// Simulates exactly what db:seed-demo IPC handler does
const pg = require('pg');
require('dotenv').config({ path: '.env.local' });

let querySeq = 0;

// Copy of wrapClient from dbHandler.js
function wrapClient(client) {
  const origQuery = client.query.bind(client);
  client.query = (sql, params) => {
    if (params && params.length > 0) {
      return origQuery(`/*_q${querySeq++}_*/${sql}`, params);
    }
    return origQuery(sql, params);
  };
  return client;
}

async function main() {
  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  try {
    // 1. Check current state
    const companies = await pool.query('SELECT COUNT(*)::int as cnt FROM companies');
    console.log('companies count:', companies.rows[0].cnt);

    const companyCheck = await pool.query('SELECT id FROM companies LIMIT 1');
    console.log('companyCheck rows:', companyCheck.rows.length);

    // 2. Simulate db:seed-demo flow
    let companyId;
    if (companyCheck.rows.length === 0) {
      console.log('No company found — would call seedInitialData');
      // Can't call seedInitialData from dbHandler.js in Node (electron import fails)
      // Skip this path for now
      console.log('SKIP: seedInitialData requires Electron context');
      return;
    } else {
      companyId = companyCheck.rows[0].id;
      console.log('Using existing companyId:', companyId);
    }

    // 3. Connect + wrap + seed exactly like db:seed-demo handler
    const client = wrapClient(await pool.connect());
    try {
      await client.query('BEGIN');
      await client.query('DEALLOCATE ALL');

      const { seedComprehensiveDemoData } = await import('./electron/seedDemoData.js');
      const demoResult = await seedComprehensiveDemoData(client, companyId, 'admin1234');
      console.log('demoResult success:', demoResult?.success);
      console.log('demoResult adminPassword:', demoResult?.adminPassword ? 'SET' : 'none');

      await client.query('COMMIT');
      console.log('COMMIT OK — seed succeeded via IPC path');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('SEED FAILED VIA IPC PATH:');
      console.error('  error:', err.message);
      console.error('  stack:', err.stack?.split('\n').slice(0, 6).join('\n  '));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Main ERROR:', err.message);
  } finally {
    await pool.end();
  }
}

main();