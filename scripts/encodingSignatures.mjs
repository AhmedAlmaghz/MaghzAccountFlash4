/**
 * SHARED mojibake signatures + scanner.
 *
 * One source of truth for two consumers:
 *  - `scripts/check-encoding.mjs`  → the plain-node CLI (runs on any machine,
 *    no vitest worker needed);
 *  - `src/test/encodingGate.test.ts` → the CI gate.
 *
 * Why a shared file: the two lists drifted once already — the CLI knew the
 * latin1/cp1252 signatures while the vitest gate knew the cp1256 ones, so
 * neither covered the other's corruption. A gate that only catches half the
 * failures is worse than no gate, because it looks green.
 *
 * The signatures are written as \u escapes on purpose: a literal mojibake
 * string in a source file is exactly what the gate is supposed to catch, and
 * an editor that re-encodes this file would silently disarm it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/**
 * Signatures of a UTF-8 → single-byte-codepage round-trip.
 *
 * The cp1256 group is what the v0.15.18 incident produced (Arabic bytes read
 * as Windows-1256); the latin1/cp1252 group is the same class of damage from
 * a different code page (the "â€”" em dash and the "Ø±ØµÙ" letters).
 */
export const MOJIBAKE = [
  // --- cp1256 (the historical incident) ---
  '\u0637\u00a7\u0638\u201e', // Arabic "al" re-encoded through cp1256
  '\u0638\u201e\u0637\u00a7', // Arabic "la" re-encoded through cp1256
  '\u0637\u00a3\u0638\u2020', // Arabic "an" re-encoded through cp1256
  '\u0637\u00b9\u0638\u201e', // Arabic "al" (final) re-encoded through cp1256
  '\u0637\u00a7\u0637', // Arabic "a…" re-encoded through cp1256
  // --- cp1252 (typographic characters) ---
  '\u00e2\u20ac\u201d', // UTF-8 em dash decoded as cp1252
  '\u00e2\u201d\u20ac', // UTF-8 box drawing decoded as cp1252
  // --- irreversible ---
  '\ufffd', // U+FFFD replacement character
];

/**
 * A run of two or more latin-1 supplement characters is the fingerprint of
 * "UTF-8 bytes read as latin1/cp1252" — the Arabic letters come out as
 * "Ø±ØµÙ". A single accented letter is legitimate text in French, Turkish
 * or Portuguese, so the rule demands a RUN rather than one letter.
 */
export const LATIN1_RUN = /[\u00a0-\u00ff]{2,}/g;

/**
 * The surfaces where corrupted Arabic would directly harm the user or the
 * agent. Narrow on purpose — a broad sweep would fire on unrelated files.
 */
export const ROOTS = [
  'src/modules/ai',
  'src/core/i18n',
  'electron',
  // The e2e bridge shim embeds the SQL that RENDERS Arabic labels (the
  // statement rows carry 'رصيد افتتاحي', 'فاتورة', …) — mojibake there makes
  // the reports render garbled text under test only.
  'e2e',
];

export const EXTENSIONS = ['.ts', '.tsx', '.json', '.js', '.cjs', '.mjs'];

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);

/** One pass per file — the per-signature indexOf loop blew the 5s test budget. */
const MOJIBAKE_RE = new RegExp(
  MOJIBAKE.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);

export function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** Every scanned file (relative to the repo root). */
export function scannedFiles() {
  return ROOTS.flatMap((root) => walk(path.join(ROOT, root)));
}

/**
 * @returns {string[]} one entry per offending file:
 *   `path:line — <matched signature>`
 */
export function findMojibake() {
  const problems = [];
  for (const file of scannedFiles()) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const literal = MOJIBAKE_RE.exec(text);
    const latin = LATIN1_RUN.exec(text);
    if (!literal && !latin) continue;
    const hit = literal || latin;
    const line = text.slice(0, hit.index).split('\n').length;
    problems.push(`${path.relative(ROOT, file)}:${line} — ${JSON.stringify(hit[0])}`);
  }
  return problems;
}
