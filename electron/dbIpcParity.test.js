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
