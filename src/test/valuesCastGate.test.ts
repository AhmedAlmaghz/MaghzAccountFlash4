import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A bare `$N` inside a VALUES list is typed as text by PostgreSQL, and the
 * INSERT is rejected for every numeric column:
 *   `column "quantity" is of type numeric but expression is of type text`
 *
 * This is not theoretical: the sales update paths shipped without casts while
 * `createInvoice` (same file, same columns) carried them — so on the web engine
 * (PGlite, which runs the raw SQL) EVERY draft line edit failed, while the
 * Electron typed-RPC path (which composes its own SQL in the main process) kept
 * working. Mock-based tests cannot see it: they never execute SQL.
 *
 * Rule: in a multi-row VALUES builder, every placeholder must carry an explicit
 * cast (`::uuid`, `::numeric`, `::varchar`, `::date`, `::jsonb`, …).
 *
 * The probe below is proven backwards: `barePlaceholders` flags the pattern, and
 * the fixture cases show it separating a complete row from an incomplete one.
 */
const SRC = join(process.cwd(), 'src', 'modules');

/** `($${off + 1}::uuid, $${off + 2}::numeric, …)` style row builders. */
const ROW_BUILDER = /`\(\$\$\{off \+ 1\}[^`]*\)`/g;
const BARE = /\$\$\{off \+ (\d+)\}(?!::)/g;

function apiFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      apiFiles(full, out);
    } else if (entry === 'api.ts') {
      out.push(full);
    }
  }
  return out;
}

/** A placeholder is complete when a cast follows it. */
function barePlaceholders(row: string): string[] {
  return [...row.matchAll(BARE)].map((h) => h[1]);
}

const findings: string[] = [];
for (const file of apiFiles(SRC)) {
  const rel = file.replace(process.cwd() + '\\', '').replace(/\\/g, '/');
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const m of line.matchAll(ROW_BUILDER)) {
        const bare = barePlaceholders(m[0]);
        if (bare.length === 0) continue;
        findings.push(`${rel}:${i + 1} — placeholders #${bare.join(', #')} lack a cast`);
      }
    });
}

describe('VALUES placeholders always carry an explicit cast', () => {
  it('the detector separates a complete row from an incomplete one', () => {
    const complete = '`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}::numeric)`';
    const incomplete = '`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3})`';
    expect(barePlaceholders(complete)).toEqual([]);
    expect(barePlaceholders(incomplete)).toEqual(['3']);
  });

  it('the scanner reaches the VALUES builders (no blind spot)', () => {
    const all = apiFiles(SRC).flatMap((f) => {
      const rel = f.replace(process.cwd() + '\\', '').replace(/\\/g, '/');
      return readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .flatMap((line, i) => [...line.matchAll(ROW_BUILDER)].map((m) => `${rel}:${i + 1} ${barePlaceholders(m[0]).length}`));
    });
    // at least a handful of row builders exist, and most are already complete
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.filter((x) => x.endsWith(' 0')).length).toBeGreaterThanOrEqual(4);
  });

  it('no VALUES builder passes a bare placeholder to a typed column', () => {
    expect(findings.join('\n')).toBe('');
  });
});
