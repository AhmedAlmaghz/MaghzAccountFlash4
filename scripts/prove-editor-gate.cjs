// Prove the editor-payload gate FAILS when the original bug is reintroduced
// (a missing companyId in a create payload).
//
// The check runs the SHARED checker (scripts/editorPayloadCheck.cjs) — the
// same code the vitest gate uses — so the proof does not depend on the
// vitest workers, which are unreliable on this machine.
const fs = require('fs');
const { execFileSync } = require('child_process');

const file = 'src/modules/sales/components/SalesInvoiceEditorPage.tsx';
const original = fs.readFileSync(file, 'utf8');

// reintroduce the bug: drop companyId from the create payload
const start = original.indexOf('const payload = {');
const at = original.indexOf('companyId,', start);
if (at < 0) { console.log('could not find companyId in the payload'); process.exit(1); }
const broken = original.slice(0, at) + original.slice(at + 'companyId,'.length);

fs.writeFileSync(file, broken, 'utf8');
try {
  const out = execFileSync('node', ['--experimental-strip-types', 'scripts/check-editor-payloads.mjs'], { encoding: 'utf8' });
  console.log('FAIL: the check did NOT catch the missing companyId');
  console.log(out);
  process.exitCode = 1;
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  const caught = /is missing/.test(out) && /companyId/.test(out);
  console.log(caught ? 'OK  : the check CAUGHT the missing companyId' : 'FAIL: the check did not flag it');
  console.log(out.split('\n').filter((l) => /is missing/.test(l)).slice(0, 2).join('\n'));
} finally {
  fs.writeFileSync(file, original, 'utf8');
  console.log('restored the editor');
}
