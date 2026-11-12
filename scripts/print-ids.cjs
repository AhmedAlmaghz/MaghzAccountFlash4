const { Pool } = require('pg');
const p = new Pool({ host: 'localhost', port: 5432, database: 'MaghzAccountFlash35', user: 'maghz', password: 'Zaamla26' });
(async () => {
  const c = await p.query('select id, name from companies limit 1');
  const u = await p.query("select id, username, role, company_id from users where username = 'admin' limit 1");
  console.log('company:', JSON.stringify(c.rows[0]));
  console.log('admin:  ', JSON.stringify(u.rows[0]));
  p.end();
})().catch((e) => { console.log('ERR', e.message); p.end(); });
