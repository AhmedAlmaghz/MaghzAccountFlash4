// Integrity check for the e2e bridge plugin after the automated fixes.
const fs = require('fs');
const s = fs.readFileSync('e2e/vite-e2e-plugin.ts', 'utf8');
const body = s.slice(s.indexOf('window.electronDB={'));

const ARROW_RE = /:async\(([^()]*)\)=>\{/g;
let m;
let arrowsWithCid = 0;
while ((m = ARROW_RE.exec(body)) !== null) {
  if (/this\._cid\(\)/.test(body.slice(m.index, m.index + 400))) arrowsWithCid++;
}

const checks = [
  ['imports intact', s.includes("from 'vite'") && s.includes("from 'pg'")],
  ['bridge middleware intact', s.includes("middlewares.use('/__e2e/db'") && s.includes("middlewares.use('/__e2e/ping'")],
  ['SQL guard intact', s.includes('FORBIDDEN_SQL_PATTERNS') && s.includes('function isSqlAllowed')],
  ['normalizePagedRows present', s.includes('function normalizePagedRows') && s.includes('normalizePagedRows(body.sql, result.rows)')],
  ['accounting defines _cid', /accounting:\{_cid/.test(body)],
  ['no arrow uses this._cid()', arrowsWithCid === 0],
  ['no duplicated member names', (s.match(/([A-Za-z0-9_]+):\1:/g) || []).length === 0],
  ['shim not truncated', s.length > 170000],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'OK  ' : 'FAIL'}  ${name}`);
  if (!pass) ok = false;
}
console.log('\nfile length:', s.length, '| arrows still using this._cid():', arrowsWithCid);
process.exit(ok ? 0 : 1);
