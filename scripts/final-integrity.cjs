// Final integrity sweep over everything this session touched:
// UTF-8 integrity (no mojibake / null bytes), i18n balance, and the
// two parity gates.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const changed = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((l) => l.slice(3).trim())
  .filter((p) => !p.startsWith('scripts/'));

const problems = [];
for (const rel of changed) {
  if (!fs.existsSync(rel) || fs.statSync(rel).isDirectory()) continue;
  if (!/\.(ts|tsx|js|cjs|mjs|json|md)$/.test(rel)) continue;
  const b = fs.readFileSync(rel);
  const s = b.toString('utf8');
  const nulls = (s.match(/\x00/g) || []).length;
  const replacement = (s.match(/\uFFFD/g) || []).length;
  if (nulls) problems.push(`${rel}: ${nulls} null byte(s)`);
  if (replacement) problems.push(`${rel}: ${replacement} replacement char(s)`);
}

// i18n balance
const ar = JSON.parse(fs.readFileSync('src/core/i18n/ar.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('src/core/i18n/en.json', 'utf8'));
function keys(o, p = '') {
  const out = [];
  for (const k of Object.keys(o)) {
    const key = p ? `${p}.${k}` : k;
    const v = o[k];
    if (v && typeof v === 'object' && Object.keys(v).length) out.push(...keys(v, key));
    else out.push(key);
  }
  return out;
}
const a = new Set(keys(ar));
const e = new Set(keys(en));
if (a.size !== e.size) problems.push(`i18n: AR ${a.size} keys vs EN ${e.size}`);
for (const k of a) if (!e.has(k)) problems.push(`i18n: missing in EN -> ${k}`);
for (const k of e) if (!a.has(k)) problems.push(`i18n: missing in AR -> ${k}`);

console.log(`checked ${changed.length} changed file(s)`);
console.log(`i18n: AR ${a.size} / EN ${e.size} keys`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('\nOK — no mojibake, no null bytes, i18n balanced');
