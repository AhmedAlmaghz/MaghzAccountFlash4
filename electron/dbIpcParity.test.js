import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CI GATE — DB IPC shape + URL-parser parity (connection unification).
 *
 * Root cause of desktop auth/save failures: `db:test-connection` /
 * `db:update-config` handlers take `(event, config, sessionToken)` while the
 * `connections.test` bridge (and the ESM preload twin) sent a SINGLE object
 * `{...payload, sessionToken}` — the token arrived nested in `config` and the
 * handler read `undefined`, so `assertOnboardingAllowed` fell back to a
 * webContents-only lookup that dies on every reload ("Not allowed after
 * initial setup" / rejected saves on desktop).
 *
 * Contract pinned here: every `db:*` channel carries ONE object with an
 * explicit `sessionToken`, and the main-process handlers normalize the
 * legacy two-arg form too (defense in depth).
 */
const ROOT = resolve(__dirname, '..');
const CJS = 'electron/preload.cjs';
const JS = 'electron/preload.js';
const MAIN = 'electron/dbHandler.js';

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

/** Extract a balanced `{...}` block starting at the first `{` at/after `from`. */
function extractBlock(src, from) {
  const start = src.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced block');
}

/** role -> sorted permission list from a FALLBACK_PERMISSIONS literal. */
function rolePermissions(block) {
  const out = {};
  const re = /(\w+):\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  }
  return out;
}

/** All table names inside `tables: [...]` lists of a rules literal. */
function ruleTables(block) {
  const found = new Set();
  for (const m of block.matchAll(/tables:\s*\[([\s\S]*?)\]/g)) {
    for (const t of m[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)) found.add(t[1]);
  }
  return [...found].sort();
}

describe('relay guard parity with the main process (CI)', () => {
  const main = read(MAIN);
  const relay = read('api/_lib/relayGuard.js');

  it('FALLBACK_PERMISSIONS are identical per role', () => {
    const a = rolePermissions(extractBlock(main, main.indexOf('FALLBACK_PERMISSIONS')));
    const b = rolePermissions(extractBlock(relay, relay.indexOf('FALLBACK_PERMISSIONS')));
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const role of Object.keys(a)) {
      expect(b[role], `role ${role} drifted between dbHandler and relayGuard`).toEqual(a[role]);
    }
  });

  it('SQL_MODULE_TABLE_RULES cover the identical table set', () => {
    const a = ruleTables(extractBlock(main, main.indexOf('SQL_MODULE_TABLE_RULES = [')));
    const b = ruleTables(extractBlock(relay, relay.indexOf('SQL_MODULE_TABLE_RULES = [')));
    expect(b).toEqual(a);
  });

  it('guard patterns and rule keys are identical', () => {
    for (const name of ['FORBIDDEN_STATEMENT_PATTERN', 'RAW_SQL_FORBIDDEN_COLUMN_PATTERN']) {
      const grab = (src) => {
        const i = src.indexOf(`${name} = /`);
        const end = src.indexOf('/i', i);
        return src.slice(i, end + 2);
      };
      expect(grab(relay), `${name} drifted`).toBe(grab(main));
    }
    const keys = (src, mapName) => {
      const i = src.indexOf(`${mapName} = new Map([`);
      const end = src.indexOf(']);', i);
      const slice = src.slice(i, end);
      return [...slice.matchAll(/\['([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]).sort();
    };
    expect(keys(relay, 'FINANCIAL_UPDATE_RULES')).toEqual(keys(main, 'FINANCIAL_UPDATE_RULES'));
    expect(keys(relay, 'RAW_SQL_CHILD_PARENT_RULES')).toEqual(keys(main, 'RAW_SQL_CHILD_PARENT_RULES'));
  });
});

describe('db IPC shape parity (CI)', () => {
  const cjs = read(CJS);
  const js = read(JS);
  const main = read(MAIN);

  it('preload twins send testConnection/updateConfig as ONE object with sessionToken', () => {
    for (const [name, src] of [['preload.cjs', cjs], ['preload.js', js]]) {
      expect(src, `${name}: testConnection must carry sessionToken`).toMatch(
        /testConnection:\s*\(config\)\s*=>\s*ipcRenderer\.invoke\('db:test-connection',\s*\{\s*\.\.\.\(config\s*\|\|\s*\{\}\),\s*sessionToken\s*\}\)/,
      );
      expect(src, `${name}: updateConfig must carry sessionToken`).toMatch(
        /updateConfig:\s*\(config\)\s*=>\s*ipcRenderer\.invoke\('db:update-config',\s*\{\s*\.\.\.\(config\s*\|\|\s*\{\}\),\s*sessionToken\s*\}\)/,
      );
    }
  });

  it('main handlers normalize the legacy two-arg form (config.sessionToken fallback)', () => {
    for (const channel of ['db:test-connection', 'db:update-config']) {
      const at = main.indexOf(`ipcMain.handle('${channel}'`);
      expect(at, `missing handler ${channel}`).toBeGreaterThan(-1);
      const block = main.slice(at, at + 600);
      expect(block, `${channel} must normalize config.sessionToken`).toMatch(
        /sessionToken\s*===\s*undefined\s*&&[\s\S]{0,120}config\.sessionToken/,
      );
    }
  });

  it('preload purchases surfaces expose the invoice write channels (both twins)', () => {
    for (const [name, src] of [['preload.cjs', cjs], ['preload.js', js]]) {
      for (const method of ['createInvoice', 'updateInvoice', 'deleteInvoice']) {
        expect(src, `${name}: purchases surface missing ${method}`).toMatch(
          new RegExp(`db:rpc:purchases\\.${method}`),
        );
      }
    }
  });

  it('URL parsing has ONE source: every runtime imports api/_lib/dbCore.js', () => {
    // The old world had three hand-mirrors (connection.ts, dbHandler.js,
    // relayHandler.js) plus a behavior-parity test. Now there is one
    // implementation; this gate fails loudly if anyone reintroduces a
    // local `function parseDbUrl|parseDatabaseUrl|normalizeIdempotent`
    // definition or a manual provider/SSL branch.
    const relay = read('api/_lib/relayHandler.js');
    const guard = read('api/_lib/relayGuard.js');
    const migrationRunner = read('electron/migrationRunner.js');
    const seed = read('electron/seedDemoData.js');
    const conn = read('src/core/database/connection.ts');
    const pglite = read('src/core/database/adapters/pgliteAdapter.ts');
    for (const [name, src] of [
      ['dbHandler', main],
      ['relayHandler', relay],
      ['migrationRunner', migrationRunner],
      ['seedDemoData', seed],
      ['connection.ts', conn],
      ['pgliteAdapter', pglite],
    ]) {
      // A delegating wrapper (same name, body calls the shared import) is
      // fine; what is forbidden is a local implementation that constructs
      // URLs itself — that is the drift that broke remote connections.
      const localParsers = [...src.matchAll(/function parse(?:DbUrl|DatabaseUrl)\s*\([^)]*\)\s*\{([\s\S]{0,2000}?)\n\}/g)];
      for (const m of localParsers) {
        expect(m[1], `${name} reintroduced a local URL parser`).not.toMatch(/new URL\(/);
      }
      expect(src, `${name} reintroduced local migration normalization`).not.toMatch(/function normalizeIdempotent\s*\(/);
    }
    for (const [name, src, spec] of [
      ['dbHandler', main, 'dbCore.js'],
      ['relayHandler', relay, 'dbCore.js'],
      ['relayGuard', guard, 'dbCore.js'],
      ['migrationRunner', migrationRunner, 'dbCore.js'],
      ['seedDemoData', seed, 'dbPasswords.js'],
      ['relayAuth', read('api/_lib/relayAuth.js'), 'dbPasswords.js'],
    ]) {
      expect(src, `${name} must consume the shared core`).toContain(spec);
    }
    // No local password-hash implementations remain outside dbPasswords.
    // (verifyAdminPassword is a different function — credential checking,
    // not hashing — and is intentionally not matched.)
    for (const [name, src] of [
      ['dbHandler', main],
      ['seedDemoData', seed],
      ['relayAuth', read('api/_lib/relayAuth.js')],
    ]) {
      expect(src, `${name} reintroduced local password hashing`).not.toMatch(
        /function (hashPasswordNode|verifyPasswordNode|verifyRelayPassword|hashPassword)\s*\(/,
      );
    }
  });

  it('dbCore parses every provider contract (behavior battery)', async () => {
    const { parseDbUrl, detectProvider, poolConfigFromParsed, redactDatabaseUrl } = await import('../api/_lib/dbCore.js');
    expect(parseDbUrl('postgres://u:p@ep-x.aws.neon.tech:5432/db?sslmode=require')).toMatchObject({
      host: 'ep-x.aws.neon.tech', port: 5432, database: 'db', user: 'u', ssl: true, provider: 'neon',
    });
    expect(parseDbUrl('postgresql://postgres:secret@db.xyz.supabase.co/postgres')).toMatchObject({
      port: 5432, provider: 'supabase', ssl: true,
    });
    expect(parseDbUrl('postgres://maghz:pw@localhost:5433/app?sslmode=disable')).toMatchObject({
      host: 'localhost', port: 5433, ssl: false, provider: 'localhost',
    });
    expect(parseDbUrl('postgres://u:p@10.0.0.5/db').provider).toBe('generic');
    expect(() => parseDbUrl('mysql://u:p@h/db')).toThrow(/postgres:\/\//);
    expect(() => parseDbUrl('postgres://u:p@h:0/db')).toThrow(/port/);
    expect(detectProvider('NEON.TECH')).toBe('neon');
    expect(detectProvider('db.a.supabase.in')).toBe('supabase');
    const cfg = poolConfigFromParsed(parseDbUrl('postgres://u:p@h/db?sslmode=verify-full'));
    expect(cfg).toMatchObject({ ssl: { rejectUnauthorized: true }, max: 20 });
    expect(poolConfigFromParsed(parseDbUrl('postgres://u:p@localhost/db'), { max: 5, statementTimeoutMs: 1 })).toMatchObject({
      max: 5, statement_timeout: 1,
    });
    expect(redactDatabaseUrl('postgres://u:secret@h/db')).not.toContain('secret');
  });
});
