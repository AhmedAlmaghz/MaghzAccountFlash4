import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAuthStore } from './store';
import type { User, Permission } from './types';

const userAdmin: User = { id: 'u-admin', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
const userManager: User = { id: 'u-manager', username: 'manager', email: 'm@b.com', role: 'manager', isActive: true };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.getState().logout();
  // window.electronAuth is undefined in jsdom — store APIs must degrade to non-Electron paths
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Multi-user (store) — 2-окна модель', () => {
  describe('login', () => {
    it('adds user to users[] + sets activeUserId', () => {
      useAuthStore.getState().login(userAdmin, ['core.view'] as Permission[]);
      const s = useAuthStore.getState();
      expect(s.isAuthenticated).toBe(true);
      expect(s.user).toEqual(userAdmin);
      expect(s.activeUserId).toBe(userAdmin.id);
      expect(s.users.map((u) => u.id)).toContain(userAdmin.id);
    });

    it('login of second user appends to users[] (both users coexist)', () => {
      useAuthStore.getState().login(userAdmin);
      useAuthStore.getState().login(userManager);
      const s = useAuthStore.getState();
      expect(s.users.map((u) => u.id)).toContain(userManager.id);
      expect(s.users.map((u) => u.id)).toContain(userAdmin.id);
      expect(s.activeUserId).toBe(userManager.id);
    });

    it('re-login of the same user keeps it in the list without duplicates', () => {
      useAuthStore.getState().login(userAdmin);
      useAuthStore.getState().login(userAdmin);
      expect(useAuthStore.getState().users.filter((u) => u.id === userAdmin.id)).toHaveLength(1);
    });
  });

  describe('switchUser', () => {
    it('switches activeUserId + user + permissions (Electron path)', async () => {
      useAuthStore.getState().login(userAdmin);
      vi.stubGlobal('electronAuth', {
        switchUser: vi.fn(async () => ({
          success: true,
          user: userManager,
          permissions: ['accounting.view', 'sales.create'],
        })),
      });
      const res = await useAuthStore.getState().switchUser(userManager.id);
      expect(res.success).toBe(true);
      const s = useAuthStore.getState();
      expect(s.activeUserId).toBe(userManager.id);
      expect(s.user?.username).toBe('manager');
      expect(s.permissions).toEqual(['accounting.view', 'sales.create']);
      expect(s.users.map((u) => u.id)).toContain(userManager.id);
    });

    it('returns failure on error from main process', async () => {
      vi.stubGlobal('electronAuth', {
        switchUser: vi.fn(async () => ({ success: false, error: 'Wrong password' })),
      });
      const res = await useAuthStore.getState().switchUser('nonexistent');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Wrong password');
      expect(useAuthStore.getState().activeUserId).toBeNull();
    });
  });

  describe('logout', () => {
    it('switch-away: removes the user from users[] but keeps the session active', () => {
      useAuthStore.getState().login(userAdmin);
      useAuthStore.getState().login(userManager);
      useAuthStore.getState().logout(userAdmin.id);
      const s = useAuthStore.getState();
      expect(s.users.map((u) => u.id)).not.toContain(userAdmin.id);
      expect(s.activeUserId).toBe(userManager.id);
      expect(s.isAuthenticated).toBe(true);
    });

    it('full logout: clears user state', () => {
      useAuthStore.getState().login(userAdmin);
      useAuthStore.getState().logout();
      const s = useAuthStore.getState();
      expect(s.isAuthenticated).toBe(false);
      expect(s.user).toBeNull();
      expect(s.users).toEqual([]);
      expect(s.activeUserId).toBeNull();
    });
  });
});
