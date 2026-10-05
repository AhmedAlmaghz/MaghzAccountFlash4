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

  it('main URL parser mirrors connection.ts provider + SSL contract', () => {
    // connection.ts is the single source of truth; parseDbUrl is its manual
    // mirror (the main process cannot import TS). Any branch added on one
    // side must exist on the other or remote connections break silently.
    const conn = read('src/core/database/connection.ts');
    for (const needle of ['neon', 'supabase', 'localhost', 'sslmode']) {
      expect(conn, `connection.ts lost: ${needle}`).toMatch(new RegExp(needle));
      expect(main, `dbHandler parseDbUrl lost: ${needle}`).toMatch(new RegExp(needle));
    }
    // verify-* must pin the chain on both sides.
    expect(main).toMatch(/verify-ca.*verify-full|strictVerify/);
    expect(conn).toMatch(/verify-ca/);
  });
});
