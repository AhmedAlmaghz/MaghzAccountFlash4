// Runs vitest and reports the summary. Captures via child_process so stdout
// stays UTF-8 - PowerShell's `>` redirection writes UTF-16LE and mangles it.
const cp = require('child_process');
const args = process.argv.slice(2);
const r = cp.spawnSync('npx.cmd', ['vitest', 'run', ...args], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
  shell: true,
});
const out = (r.stdout || '') + (r.stderr || '');
const clean = out.replace(/\u001b\[[0-9;]*m/g, '');
const lines = clean.split(/\r?\n/);
const files = lines.filter((l) => /Test Files/.test(l));
const tests = lines.filter((l) => /^\s*Tests\s/.test(l));
const dur = lines.filter((l) => /Duration/.test(l));
const fails = lines.filter((l) => /FAIL|Failed to start/.test(l));
console.log('exit code:', r.status);
console.log(files.slice(-1)[0] || 'no Test Files line');
console.log(tests.slice(-1)[0] || 'no Tests line');
console.log(dur.slice(-1)[0] || '');
if (fails.length) {
  console.log('--- failures ---');
  console.log(fails.slice(0, 20).join('\n'));
}
