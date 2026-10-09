import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Packaging gate: the desktop app runs from an asar containing ONLY
 * package.json `build.files`. Any `electron/*` import that escapes the
 * packaged set works in dev (full source tree) and dies in production
 * with ERR_MODULE_NOT_FOUND at startup — exactly the v0.26.18
 * `../api/_lib/dbPasswords.js` outage from seedDemoData.js.
 *
 * Two layers:
 *  1. Static: every `../…` import in electron/* must be covered by a
 *     build.files entry (no new shared file can sneak in uncovered).
 *  2. Live: the two import-safe main-process modules (seedDemoData,
 *     migrationRunner — no `electron` import) are staged into a fake
 *     packaged layout (only build.files entries) and really imported,
 *     proving module resolution works in the packaged shape.
 *     (dbHandler.js needs the Electron runtime, so it is static-only.)
 */
const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const FILES = pkg.build.files;

function coveredByFiles(relPosix) {
  return FILES.some((pattern) => {
    const p = String(pattern).replace(/\\/g, '/');
    if (p.endsWith('/**/*')) return relPosix.startsWith(p.slice(0, -5)) || relPosix === p.slice(0, -5);
    if (p.endsWith('/**')) return relPosix.startsWith(p.slice(0, -3));
    return relPosix === p;
  });
}

function electronSources() {
  return readdirSync(join(ROOT, 'electron')).filter((f) => f.endsWith('.js') || f.endsWith('.cjs'));
}

function escapingImports(src) {
  const out = [];
  const re = /(?:import\s+(?:[^'"]*?\s+from\s+)?|require\()\s*['"](\.\.\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

describe('packaging gate (electron asar contents)', () => {
  it('every ../ import in electron/* is covered by build.files', () => {
    const uncovered = [];
    for (const file of electronSources()) {
      if (/\.test\.(js|cjs)$/.test(file)) continue;
      const src = readFileSync(join(ROOT, 'electron', file), 'utf8');
      for (const spec of escapingImports(src)) {
        const resolved = resolve(join(ROOT, 'electron'), spec);
        const rel = resolved.slice(ROOT.length + 1).split(sep).join('/');
        if (!coveredByFiles(rel)) uncovered.push(`${file} -> ${spec} (${rel})`);
      }
    }
    expect(uncovered, 'imports escaping the packaged set').toEqual([]);
  });

  it('build.files still carries the two shared single-source modules', () => {
    expect(FILES).toContain('api/_lib/dbCore.js');
    expect(FILES).toContain('api/_lib/dbPasswords.js');
  });

  it('seedDemoData + migrationRunner import cleanly in the packaged layout', async () => {
    // Fidelity rule: the stage contains ONLY what build.files covers — the
    // test stages through the same list the packager reads, so deleting an
    // entry reproduces the production ERR_MODULE_NOT_FOUND here.
    const stage = join(tmpdir(), `maghz-pack-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    try {
      for (const rel of [
        'electron/seedDemoData.js',
        'electron/migrationRunner.js',
        'api/_lib/dbCore.js',
        'api/_lib/dbPasswords.js',
      ]) {
        if (!coveredByFiles(rel)) continue;
        const dest = join(stage, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(ROOT, rel), dest);
      }
      const seed = await import(pathToFileURL(join(stage, 'electron/seedDemoData.js')).href);
      expect(typeof seed.seedComprehensiveDemoData).toBe('function');
      const mig = await import(pathToFileURL(join(stage, 'electron/migrationRunner.js')).href);
      expect(typeof mig.runDrizzleMigrations).toBe('function');
      // The shared modules themselves resolve (this exact import killed v0.26.18).
      const pw = await import(pathToFileURL(join(stage, 'api/_lib/dbPasswords.js')).href);
      expect(typeof pw.hashPasswordNode).toBe('function');
      const core = await import(pathToFileURL(join(stage, 'api/_lib/dbCore.js')).href);
      expect(typeof core.normalizeIdempotent).toBe('function');
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  });
});
