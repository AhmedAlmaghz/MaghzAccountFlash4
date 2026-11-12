// Remove the e2e test residue from the dev database (suppliers/customers
// created by the probe runs).
const { Pool } = require('pg');
const p = new Pool({ host: 'localhost', port: 5432, database: 'MaghzAccountFlash35', user: 'maghz', password: 'Zaamla26' });
(async () => {
  const s = await p.query("DELETE FROM suppliers WHERE name LIKE '%اختبار e2e%' OR name LIKE '%e2e%' RETURNING name");
  console.log('deleted suppliers:', s.rows.map((r) => r.name));
  const c = await p.query("DELETE FROM customers WHERE name LIKE '%اختبار e2e%' OR name LIKE '%e2e%' RETURNING name");
  console.log('deleted customers:', c.rows.map((r) => r.name));
  p.end();
})().catch((e) => { console.log('ERR', e.message); p.end(); });
