import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every documentation page carries the release stamp, and it matches the
 * package version.
 *
 * The version badge lives in the frontmatter of all 142 pages under Docs/ in
 * both languages. A release bump that misses one page leaves the docs claiming
 * a version that no longer exists, and nothing in the build notices - the
 * in-app badge is injected from package.json at build time, so only the written
 * docs can drift.
 */
const ROOT = process.cwd();
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

function mdFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) mdFiles(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const pages = mdFiles(join(ROOT, 'Docs'));

describe('documentation carries the current release stamp', () => {
  it('the docs tree is large enough for the check to mean anything', () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  it('every page declares a version in its frontmatter', () => {
    const missing = pages
      .filter((f) => !/^version:\s*"[^"]+"/m.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(ROOT + '\\', ''));
    expect(missing, 'a page without a version stamp would silently keep an old badge').toEqual([]);
  });

  it('every page matches package.json', () => {
    const rel = PKG.version.replace(/^v/, '');
    const stale = pages
      .map((f) => ({ f: f.replace(ROOT + '\\', ''), m: /version:\s*"([^"]+)"/.exec(readFileSync(f, 'utf8')) }))
      .filter((x) => x.m && x.m[1] !== rel)
      .map((x) => `${x.f}: ${x.m![1]}`);
    expect(stale).toEqual([]);
  });

  it('the docs index is stamped like every other page', () => {
    // Docs/README.md uses the same frontmatter key as the pages (no "v" prefix),
    // so the same predicate covers it — this test exists to say that explicitly.
    const readme = readFileSync(join(ROOT, 'Docs', 'README.md'), 'utf8');
    expect(readme).toMatch(new RegExp('^version:\\s*"' + PKG.version.replace(/^v/, '') + '"', 'm'));
  });
});
