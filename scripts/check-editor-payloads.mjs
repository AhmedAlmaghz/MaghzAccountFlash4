// CLI view of the editor-payload gate (the same logic the vitest gate uses).
//
//   node --experimental-strip-types scripts/check-editor-payloads.mjs
import { findEditorPayloadProblems } from '../src/test/editorPayloadCheck.ts';

const problems = findEditorPayloadProblems();
if (!problems.length) {
  console.log('OK — every editor payload satisfies its create schema');
  process.exit(0);
}
console.log(`${problems.length} editor(s) fail validation silently:\n`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
