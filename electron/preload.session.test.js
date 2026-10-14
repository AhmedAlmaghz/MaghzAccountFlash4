import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Preload session survival across renderer reloads.
 *
 * The boot-time company probe (and every later IPC call) authenticates with
 * the preload-closure token — which dies on every reload, landing logged-out
 * boots in the onboarding wizard instead of the login page. The token must
 * therefore persist in sessionStorage (per-window lifetime, cleared with the
 * window — same posture as the web relay JWT), be restored at preload
 * evaluation, and be wiped on logout. Both preload twins (.cjs + .js) carry
 * the identical logic.
 */

const holder = { exposed: {}, calls: [] };

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name, api) => {
      holder.exposed[name] = api;
    },
  },
  ipcRenderer: {
    invoke: async (channel, payload) => {
      holder.calls.push({ channel, payload });
      if (channel === 'auth:login') {
        return { success: true, sessionToken: 'tok-1', user: { id: 'u1' } };
      }
      if (channel === 'auth:logout') return { success: true };
      return { success: true, rows: [] };
    },
  },
}));

const TOKEN_KEY = 'maghz-session-token';

async function loadPreload(rel) {
  vi.resetModules();
  holder.exposed = {};
  holder.calls = [];
  sessionStorage.clear();
  await import(rel);
  return holder.exposed;
}

function lastCall(channel) {
  const found = [...holder.calls].reverse().find((c) => c.channel === channel);
  return found?.payload;
}

for (const rel of ['./preload.cjs', './preload.js']) {
  describe(`preload session persistence (${rel})`, () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    it('sends a null token before any login', async () => {
      const exposed = await loadPreload(rel);
      await exposed.electronAuth.getSession();
      expect(lastCall('auth:get-session')).toEqual({ sessionToken: null });
    });

    it('persists the token on login and sends it afterwards', async () => {
      const exposed = await loadPreload(rel);
      const result = await exposed.electronAuth.login({ username: 'a', password: 'b' });
      // Never leaks to the renderer…
      expect(result.sessionToken).toBeUndefined();
      // …but survives in sessionStorage for the post-reload boot probe…
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-1');
      await exposed.electronAuth.getSession();
      expect(lastCall('auth:get-session')).toEqual({ sessionToken: 'tok-1' });
    });

    it('restores a stored token at evaluation (the reload path)', async () => {
      sessionStorage.setItem(TOKEN_KEY, 'tok-restored');
      vi.resetModules();
      holder.exposed = {};
      holder.calls = [];
      await import(rel);
      await holder.exposed.electronAuth.getSession();
      expect(lastCall('auth:get-session')).toEqual({ sessionToken: 'tok-restored' });
    });

    it('wipes the token on logout', async () => {
      const exposed = await loadPreload(rel);
      await exposed.electronAuth.login({ username: 'a', password: 'b' });
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-1');
      await exposed.electronAuth.logout();
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      await exposed.electronAuth.getSession();
      expect(lastCall('auth:get-session')).toEqual({ sessionToken: null });
    });
  });
}
