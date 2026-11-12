// E2E bridge fixes — applied in one pass so the shim stays coherent.
//
// 1. normalizePagedRows: the renderer reads paged RPC results with
//    splitPagedRpcRows(), which keeps only rows carrying `has_row === true`
//    and takes the total from the FIRST row. Production answers paged reads
//    with `count LEFT JOIN LATERAL page ON true` (always one row: the real
//    rows carry has_row=true, an empty page still emits one row with
//    has_row=false plus the true total). Some shim channels were still
//    written the old way with `COUNT(*) OVER() AS total_count` — that shape
//    cannot express an empty page and has NO has_row column, so
//    splitPagedRpcRows() dropped EVERY row and the list rendered EMPTY
//    while the KPI cards showed the real count.
//
// 2. the accounting surface must define `_cid`.
//
// 3. a shim method that calls `this._cid()` MUST be a regular function.
//    An arrow captures `this` lexically (the page scope), so `this._cid`
//    is undefined and the call dies with "this._cid is not a function".
const fs = require('fs');
const file = 'e2e/vite-e2e-plugin.ts';
let s = fs.readFileSync(file, 'utf8');
const before = s.length;

// ── 1. normalizePagedRows ───────────────────────────────────────────────
if (!s.includes('normalizePagedRows')) {
  const helper = `/**
 * The renderer reads every paged read over typed RPC with
 * splitPagedRpcRows(), which keeps only rows carrying \`has_row === true\`
 * and reads the total from the FIRST row.
 *
 * Production answers paged reads with \`count LEFT JOIN LATERAL page ON true\`,
 * which ALWAYS emits one row: the real rows carry has_row=true, and an empty
 * page still emits a single row with has_row=false plus the true total.
 *
 * Some shim channels are still written the old way, with
 * \`COUNT(*) OVER() AS total_count\`. That shape cannot express an empty page
 * (it returns NO rows, taking the total with it), and it has no \`has_row\`
 * column at all — so splitPagedRpcRows() dropped every row and the page
 * rendered EMPTY while the KPI cards showed the real count.
 *
 * Normalizing here keeps the bridge faithful to production for every
 * channel, present and future, instead of hand-editing each SQL string:
 *   - real rows  → has_row = true
 *   - empty page → one synthetic row { total_count: 0, has_row: false }
 */
function normalizePagedRows(sql: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const isWindowPaged = /COUNT\\(\\s*\\*\\s*\\)\\s*OVER/i.test(sql || '');
  if (!isWindowPaged) return rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ total_count: 0, has_row: false }];
  }
  return rows.map((r) => (r && typeof r === 'object' ? { ...r, has_row: true } : r));
}

`;
  // The file uses CRLF — match with \r?\n so the replacement is found.
  s = s.replace(/interface E2EPluginOptions \{/, helper + 'interface E2EPluginOptions {');
  s = s.replace(
    /const result = await pool\.query\(body\.sql, body\.params \?\? \[\]\);\r?\n(\s*)res\.end\(JSON\.stringify\(\{ success: true, rows: result\.rows, rowCount: result\.rowCount \?\? 0 \}\)\);/,
    'const result = await pool.query(body.sql, body.params ?? []);\r\n$1const rows = normalizePagedRows(body.sql, result.rows);\r\n$1res.end(JSON.stringify({ success: true, rows, rowCount: rows.length }));'
  );
}

// ── 2. the accounting surface must define _cid ─────────────────────────
const CID_DEF = `_cid:async()=>{const c=await post('SELECT id FROM companies LIMIT 1',[]);return c.rows?.[0]?.id}`;
if (!s.includes('accounting:{' + CID_DEF)) {
  s = s.replace('accounting:{getAccounts:', 'accounting:{' + CID_DEF + ',getAccounts:');
}

// ── 3. arrow → regular function for every method using this._cid() ─────
const start = s.indexOf('window.electronDB={');
if (start < 0) { console.log('shim code not found'); process.exit(1); }
const body = s.slice(start);
const ARROW_RE = /:async\(([^()]*)\)=>\{/g;
let out = s.slice(0, start); // KEEP the preamble (imports, middleware, …)
let cursor = start;
let fixed = 0;
const names = [];
let m;
while ((m = ARROW_RE.exec(body)) !== null) {
  const abs = start + m.index;
  if (abs < cursor) continue;
  const window400 = body.slice(m.index, m.index + 400);
  if (!/this\._cid\(\)/.test(window400)) continue;
  // the identifier before ':async(' already sits in the slice — keep it
  out += s.slice(cursor, abs);
  out += `:async function(${m[1]}){`;
  cursor = abs + m[0].length;
  fixed++;
  const nm = /([A-Za-z0-9_]+):async\(/.exec(s.slice(abs - 40, abs + 10));
  if (nm) names.push(nm[1]);
}
out += s.slice(cursor);
s = out;

fs.writeFileSync(file, s, 'utf8');
console.log('shim fixes applied');
console.log('  arrows converted to regular functions:', fixed);
console.log('  distinct methods:', [...new Set(names)].length);
console.log('  size', before, '->', s.length);
