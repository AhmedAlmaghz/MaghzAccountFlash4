// Prove the parity DETECTION works: reintroduce a known bug and show the
// scanner flags it. (The vitest gate wraps the same logic; the vitest
// workers are unreliable on this machine, so the proof runs the scanner.)
const fs = require('fs');
const { execFileSync } = require('child_process');

const file = 'e2e/vite-e2e-plugin.ts';
const original = fs.readFileSync(file, 'utf8');

function scan() {
  try {
    return execFileSync('node', ['scripts/check-shim-params.cjs'], { encoding: 'utf8' });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const CASES = [
  {
    name: 'audit.log — 9 placeholders vs 8 params',
    // drop the generated id from the params array (the original bug)
    needle: '[rid,null,String(p.action',
    replacement: '[null,String(p.action',
    expect: /placeholders vs 8 params/,
  },
  {
    name: 'getApAgingTotal — 1 placeholder vs 4 params',
    // pass the company id four times for the single $1 placeholder
    needle: /getApAgingTotal:/,
    replacement: null, // handled below (index-based)
    expect: /placeholders vs 4 params/,
  },
];

let allCaught = true;
for (const c of CASES) {
  let broken = original;
  if (c.replacement === null) {
    // index-based: swap the params array right after the method
    const start = original.search(c.needle);
    if (start < 0) { console.log(`SKIP  ${c.name} (needle not found)`); allCaught = false; continue; }
    const at = original.indexOf('[cid]);}', start);
    if (at < 0) { console.log(`SKIP  ${c.name} (params array not found)`); allCaught = false; continue; }
    broken = original.slice(0, at) + '[cid,cid,cid,cid]);}' + original.slice(at + '[cid]);}'.length);
  } else {
    broken = original.replace(c.needle, c.replacement);
  }
  if (broken === original) {
    console.log(`SKIP  ${c.name} (the needle did not match)`);
    allCaught = false;
    continue;
  }
  fs.writeFileSync(file, broken, 'utf8');
  const out = scan();
  const caught = c.expect.test(out);
  if (!caught) allCaught = false;
  console.log(`${caught ? 'OK  ' : 'FAIL'}  the scan flags: ${c.name}`);
  if (!caught) {
    console.log(out.split('\n').filter((l) => /placeholders vs/.test(l)).join('\n'));
  }
}

fs.writeFileSync(file, original, 'utf8');
console.log('\nshim restored');
console.log(allCaught ? 'ALL injected bugs were detected' : 'SOME injected bugs slipped through');
process.exit(allCaught ? 0 : 1);
