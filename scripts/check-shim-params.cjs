// Scan every `post(sql, [params])` in the e2e shim and compare the number
// of $N placeholders with the number of params passed. A mismatch makes
// PostgreSQL reject the statement ("supplies N parameters, but the
// prepared statement requires M") and the write silently fails.
const fs = require('fs');
const s = fs.readFileSync('e2e/vite-e2e-plugin.ts', 'utf8');
const body = s.slice(s.indexOf('window.electronDB={'));

// find post( "SQL" , [ ... ] )
const re = /post\(\s*(["'`])([\s\S]*?)\1\s*,\s*\[/g;
let m;
const problems = [];
let checked = 0;

function countTopLevel(s) {
  let depth = 0;
  let count = 0;
  let inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) count++;
  }
  return count + (s.trim() ? 1 : 0);
}

while ((m = re.exec(body)) !== null) {
  const sql = m[2];
  // the params array: balance brackets from the '[' after the SQL
  const arrStart = m.index + m[0].length - 1;
  let depth = 0;
  let end = arrStart;
  for (let i = arrStart; i < body.length; i++) {
    if (body[i] === '[') depth++;
    else if (body[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const arrText = body.slice(arrStart + 1, end);
  const placeholders = new Set((sql.match(/\$(\d+)/g) || []).map((x) => Number(x.slice(1))));
  const maxPh = placeholders.size ? Math.max(...placeholders) : 0;
  const paramCount = countTopLevel(arrText);
  checked++;
  if (paramCount !== maxPh) {
    // find the enclosing method name
    const before = body.slice(Math.max(0, m.index - 500), m.index);
    const names = [...before.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:async\s+)?(?:function\s*)?\(/g)];
    problems.push({
      method: names.length ? names[names.length - 1][1] : '?',
      placeholders: maxPh,
      params: paramCount,
      sql: sql.replace(/\s+/g, ' ').slice(0, 110),
    });
  }
}

console.log(`checked ${checked} shim queries`);
if (problems.length === 0) { console.log('all placeholder/param counts match'); process.exit(0); }
console.log(`\n${problems.length} MISMATCHES:\n`);
for (const p of problems) {
  console.log(`  ${p.method}: ${p.placeholders} placeholders vs ${p.params} params`);
  console.log(`     ${p.sql}`);
}
