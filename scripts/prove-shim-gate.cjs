// Reverse proof for the shim gates: inject a real defect, confirm the gate
// fails, then restore the file.
//
// The backup is taken ONCE (the first injection) and kept next to the file,
// so a later `restore` always returns the file to its pre-injection state —
// never to a state that was already broken.
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../e2e/vite-e2e-plugin.ts');
const backup = file + '.proof.bak';
const text = fs.readFileSync(file, 'utf8');

const mode = process.argv[2] || 'params';

if (mode === 'params') {
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(file));
  const m = /post\('([^']*\$2[^']*)',\s*\[([^\[\]]*)\]\)/.exec(text);
  if (!m) { console.log('no 2-placeholder static query found'); process.exit(1); }
  const broken = m[0].replace(/,\s*\[[^\[\]]*\]\)/, ',[])');
  fs.writeFileSync(file, text.replace(m[0], broken), 'utf8');
  console.log('injected a placeholder/param mismatch into the shim');
} else if (mode === 'parse') {
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(file));
  const broken = text.replace(/(\\\\)'([^'\\\n]+)\\\\'(?=\s*::varchar)/g, "$1'$2'");
  if (broken === text) { console.log('no SQL literal to break'); process.exit(1); }
  fs.writeFileSync(file, broken, 'utf8');
  console.log('injected a broken SQL escape into the shim');
} else if (mode === 'restore') {
  if (!fs.existsSync(backup)) { console.log('no backup to restore'); process.exit(1); }
  fs.writeFileSync(file, fs.readFileSync(backup));
  fs.unlinkSync(backup);
  console.log('restored the shim from the backup');
} else {
  console.log('usage: prove-shim-gate.cjs [params|parse|restore]');
  process.exit(1);
}
