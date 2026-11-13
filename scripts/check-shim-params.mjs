#!/usr/bin/env node
/**
 * Every STATIC `post(sql, [params])` in the e2e shim must pass as many
 * parameters as it has $N placeholders.
 *
 *   node scripts/check-shim-params.cjs
 *
 * PostgreSQL rejects the statement otherwise ("supplies N parameters, but
 * the prepared statement requires M") and the write fails — under test
 * only, which is why it survived.
 *
 * Dynamic statements (SQL built by concatenation, params built in a loop)
 * are decided at runtime and are skipped on purpose.
 *
 * The analysis lives in `scripts/shimChecks.mjs` — the same module the CI
 * gate (`src/test/e2eShimParity.test.ts`) imports.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkStaticParamCounts } from './shimChecks.mjs';

const SHIM_PATH = resolve(process.cwd(), 'e2e/vite-e2e-plugin.ts');
const source = readFileSync(SHIM_PATH, 'utf8');
const body = source.slice(source.indexOf('window.electronDB={'));

const { checked, skipped, problems } = checkStaticParamCounts(body);

console.log(`checked ${checked} static shim queries (skipped ${skipped} dynamic ones)`);

if (problems.length === 0) {
  console.log('OK — every static query passes as many params as it has placeholders');
  process.exit(0);
}

console.log(`\n${problems.length} MISMATCHES:\n`);
for (const p of problems) {
  console.log(`  ${p.method}: ${p.placeholders} placeholders vs ${p.params} params`);
  console.log(`     ${p.sql}`);
}
process.exit(1);
