import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * CI GATE — encoding integrity for user-facing / model-facing text.
 *
 * A single UTF-8 → Windows-1256 re-encoding pass in the v0.15.18 release
 * turned all 21 tools in `readTools.ts` into mojibake: the model received
 * `ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط´ط±ظƒط©` instead of `معلومات الشركة` for months.
 * Tests stayed green because none asserted the Arabic payload.
 *
 * This gate scans the surfaces where corrupted Arabic would directly harm the
 * user or the agent (AI module, i18n dictionaries, Electron AI transport) and
 * fails on the unambiguous mojibake signatures. It is intentionally narrow:
 * ASCII/typographic dashes in unrelated comments are ignored elsewhere.
 */

const MOJIBAKE = [
  'ط§ظ„', // "ال"
  'ظ„ط§', // "لا"
  'ط£ظ†', // "أن"
  'ط¹ظ„', // "عل"
  'ط§ط', // "ا…"
  'â€”', // UTF-8 em dash decoded as cp1252
  'â”€', // UTF-8 box drawing decoded as cp1252
  '\uFFFD', // replacement character — irreversible corruption
];
// One pass per file (the per-signature indexOf loop was the bottleneck on a
// slow CI/jsdom run and blew the default 5s test timeout).
const MOJIBAKE_RE = new RegExp(
  MOJIBAKE.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);

const ROOTS = [
  'src/modules/ai',
  'src/core/i18n',
  'electron',
];

const EXTENSIONS = ['.ts', '.tsx', '.json', '.js', '.cjs'];

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

function offenders(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const match = MOJIBAKE_RE.exec(text);
  if (!match) return [];
  const line = text.slice(0, match.index).split('\n').length;
  return [`${match[0]} (line ${line})`];
}

describe('encoding gate — no mojibake in agent-facing text', () => {
  const files = ROOTS.flatMap((root) => {
    try {
      return walk(root);
    } catch {
      return [];
    }
  });

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every scanned file is free of mojibake signatures', () => {
    const broken = files
      .map((f) => ({ file: relative(process.cwd(), f), hits: offenders(f) }))
      .filter((entry) => entry.hits.length > 0);
    expect(
      broken,
      `mojibake detected (likely a UTF-8 → cp1256 round-trip):\n${broken
        .map((b) => `  ${b.file}: ${b.hits.join(', ')}`)
        .join('\n')}`,
    ).toEqual([]);
  }, 30_000);
});
