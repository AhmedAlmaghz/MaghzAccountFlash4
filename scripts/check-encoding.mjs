#!/usr/bin/env node
/**
 * CLI wrapper around the shared encoding gate.
 *
 *   node scripts/check-encoding.mjs
 *
 * Exits non-zero and lists every file with a mojibake signature. The
 * signature list lives in `scripts/encodingSignatures.mjs` — the same file
 * the vitest gate (`src/test/encodingGate.test.ts`) imports, so the two
 * can never drift apart.
 */
import { findMojibake, ROOTS } from './encodingSignatures.mjs';

const problems = findMojibake();

if (!problems.length) {
  console.log('OK — no mojibake in ' + ROOTS.join(', '));
  process.exit(0);
}

console.log(`${problems.length} file(s) with mojibake:\n`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
