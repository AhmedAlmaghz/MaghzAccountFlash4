const { Pool } = require('pg');
const p = new Pool({ host: 'localhost', port: 5432, database: 'MaghzAccountFlash35', user: 'maghz', password: 'Zaamla26' });
(async () => {
  const s = await p.query('select id, status, opened_at, closed_at, cash_box_id from pos_shifts order by opened_at desc');
  console.log('pos_shifts:', JSON.stringify(s.rows, null, 1));
  const open = s.rows.filter((r) => r.status === 'open');
  if (open.length) {
    // A leftover OPEN shift blocks the next e2e run: the partial unique
    // index allows only one open shift per cashier, so "open shift" fails
    // and the POS renders the gate instead of the terminal (no <aside>).
    const del = await p.query('delete from pos_shifts where status = $1 returning id', ['open']);
    console.log('deleted stale open shifts:', del.rowCount);
  }
  const after = await p.query('select count(*)::int c from pos_shifts');
  console.log('remaining shifts:', after.rows[0].c);
  p.end();
})().catch((e) => { console.log('ERR', e.message); p.end(); });
