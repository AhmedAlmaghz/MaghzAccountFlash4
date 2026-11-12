// The demo seed creates the admin with a RANDOM password (the operator's
// password when supplied, otherwise a generated one). The e2e fixture
// expects admin/admin1234 — so a fresh dev DB cannot log in.
//
// DEV ONLY: re-hash the dev admin with the fixture password.
// Uses the SAME hash function the seed uses (api/_lib/dbPasswords.js), so
// the stored format is identical to production.
const path = require('path');
const { Pool } = require('pg');
const { hashPasswordNode } = require(path.resolve(__dirname, '../api/_lib/dbPasswords.js'));

const PASSWORD = 'admin1234';

(async () => {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'MaghzAccountFlash35',
    user: 'maghz',
    password: 'Zaamla26',
  });
  const hash = await hashPasswordNode(PASSWORD);
  const res = await pool.query(
    `UPDATE users SET password_hash = $1 WHERE username = 'admin' RETURNING id, username, role`,
    [hash]
  );
  console.log('updated rows:', res.rowCount, res.rows);
  await pool.end();
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
