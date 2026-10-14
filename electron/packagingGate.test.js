import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
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
    //
    // Location rule: the stage lives INSIDE the repo (node_modules/.cache,
    // always gitignored) — never os.tmpdir(). A stage outside the project
    // root loads fine under plain node but fails under the vitest module
    // runner, which only serves files inside its fs scope; that produced a
    // bare ERR_MODULE_NOT_FOUND for a file that was provably copied.
    const stage = join(ROOT, 'node_modules', '.cache', `maghz-pack-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const staged = [
      'electron/seedDemoData.js',
      'electron/migrationRunner.js',
      'api/_lib/dbCore.js',
      'api/_lib/dbPasswords.js',
    ];
    try {
      for (const rel of staged) {
        if (!coveredByFiles(rel)) continue;
        const dest = join(stage, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(ROOT, rel), dest);
      }
      const missing = staged.filter((rel) => !existsSync(join(stage, rel)));
      expect(
        missing,
        `staging failed (not an import problem): these files never landed in the stage — check coverage list and copy step, not the modules: ${missing.join(', ')}`,
      ).toEqual([]);
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

/**
 * Renderer-base gate: the desktop exe loads dist/index.html over file://,
 * where root-absolute asset URLs (/assets/…) resolve to file:///assets and
 * 404 — a white screen on launch. The web build needs base '/' (deep-route
 * refresh at /settings/company resolves ./assets/* to /settings/assets/*,
 * same white screen). One dist cannot serve both, so the base is chosen by
 * vite mode: electron builds MUST pass --mode electron (base './'), the
 * plain web build MUST NOT (base '/').
 *
 * This broke silently once already (v0.26.23 shipped a web-based dist inside
 * the exe): the failure is invisible until install, so it is pinned here in
 * the same static style as the asar-contents checks above.
 */
describe('renderer base mode (desktop file:// vs web)', () => {
  it("vite base is conditional on mode ('./' electron, '/' web)", () => {
    const cfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(cfg, 'vite base must branch on mode').toMatch(/base:\s*mode\s*===\s*['"]electron['"]\s*\?\s*['"]\.\/['"]\s*:\s*['"]\/['"]/);
  });

  it('every electron build path passes --mode electron', () => {
    const scripts = pkg.scripts || {};
    for (const name of Object.keys(scripts).filter((s) => s.startsWith('electron:build'))) {
      expect(String(scripts[name]), `${name} must build the renderer with --mode electron`).toMatch(/--mode\s+electron/);
    }
    expect(
      Object.keys(scripts).filter((s) => s.startsWith('electron:build')).length,
      'no electron:build script found to guard',
    ).toBeGreaterThan(0);
  });

  it('the plain web build stays mode-free (base \'/\')', () => {
    const build = String((pkg.scripts || {}).build || '');
    expect(build, 'plain `npm run build` is the web build and must not set a mode').not.toMatch(/--mode/);
  });

  it('the release workflow builds the packaged renderer in electron mode', () => {
    const yml = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
    const lines = yml.split('\n');
    const idx = lines.findIndex((l) => /Build renderer/.test(l));
    expect(idx, 'release workflow lost its renderer-build step').toBeGreaterThan(-1);
    const step = lines.slice(idx, idx + 8).join('\n');
    expect(step, 'release must package an electron-mode (base ./) renderer, never the web dist').toMatch(/--mode\s+electron/);
  });
});
