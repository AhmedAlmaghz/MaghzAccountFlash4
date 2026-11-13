#!/usr/bin/env node
/**
 * Does the e2e bridge shim still PARSE?
 *
 *   node scripts/check-shim-parse.cjs
 *
 * The shim is one enormous template literal. A single lost escaping
 * backslash in a SQL literal turns the whole shim into a syntax error —
 * `window.electronDB` is then never defined, and every page in the app
 * shows "cannot connect to the database" with no hint about the cause.
 *
 * The analysis lives in `scripts/shimChecks.mjs` — the same module the CI
 * gate (`src/test/e2eShimParity.test.ts`) imports.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractShimCode, parseShimCode } from './shimChecks.mjs';

const SHIM_PATH = resolve(process.cwd(), 'e2e/vite-e2e-plugin.ts');

let code;
try {
  code = extractShimCode(readFileSync(SHIM_PATH, 'utf8'));
} catch (err) {
  console.log('FAIL — the shim template is broken:');
  console.log('  ' + String(err.message || err).slice(0, 400));
  process.exit(1);
}

const result = parseShimCode(code);
if (!result.ok) {
  console.log('FAIL — the generated shim does not parse:');
  console.log('  ' + result.error);
  if (result.context) {
    console.log('  at generated line ' + result.line);
    for (const line of result.context) console.log('    ' + line);
  }
  process.exit(1);
}

console.log('OK — the shim evaluates and parses');
console.log('backticks in the generated code:', (code.match(/`/g) || []).length);
