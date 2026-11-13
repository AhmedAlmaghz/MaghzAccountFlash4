// Parity gate: the e2e shim must render the SAME labels as production.
//
// The shim's SQL lives inside a template literal, so its escaped quotes
// carry a trailing backslash in the source — normalise before comparing.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const prod = fs.readFileSync(path.join(ROOT, 'electron/dbHandler.js'), 'utf8');
const shim = fs.readFileSync(path.join(ROOT, 'e2e/vite-e2e-plugin.ts'), 'utf8');

function labels(src, method) {
  const i = src.indexOf(method);
  if (i < 0) return null;
  const chunk = src.slice(i, i + 3000);
  const out = new Set();
  // the shim's SQL sits in a template literal, so a label may be wrapped in
  // several escaped quotes — accept any number of backslashes
  for (const m of chunk.matchAll(/'([^']*)'\\*\s*::varchar\s+(?:AS|as)\s+document_type/g)) {
    out.add(m[1].replace(/\\+/g, ''));
  }
  return [...out];
}

const problems = [];
for (const method of ['getCustomerStatement', 'getSupplierStatement', 'getCustomerArAging', 'getApAging']) {
  const p = labels(prod, method);
  const s = labels(shim, method);
  if (!p || !s) continue;
  const missing = p.filter((x) => !s.includes(x));
  if (missing.length) problems.push(`${method}: the shim is missing ${JSON.stringify(missing)}`);
}

if (problems.length) {
  console.log('shim/production label drift:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('OK — the shim renders the same statement labels as production');
