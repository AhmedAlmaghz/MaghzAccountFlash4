import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore, initAuth } from './store';
import type { User } from './types';

// Clear localStorage before each test
beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().logout();
});

describe('Auth Store', () => {
  describe('login', () => {
    it('sets user and authentication state', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(user);
      expect(localStorage.getItem('auth_user')).toBeTruthy();
    });
  });

  describe('logout', () => {
    it('clears user and auth state', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('returns false when not authenticated', () => {
      expect(useAuthStore.getState().hasPermission('core.view')).toBe(false);
    });

    it('super_admin has all permissions', () => {
      const user: User = { id: '1', username: 'super', email: 's@b.com', role: 'super_admin', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasPermission('any.permission')).toBe(true);
    });

    it('admin has most permissions except restricted', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasPermission('core.view')).toBe(true);
      expect(useAuthStore.getState().hasPermission('settings.roles')).toBe(true);
      expect(useAuthStore.getState().hasPermission('core.edit')).toBe(false);
    });

    it('accountant has accounting permissions', () => {
      const user: User = { id: '2', username: 'acc', email: 'a@b.com', role: 'accountant', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasPermission('accounting.post')).toBe(true);
      expect(useAuthStore.getState().hasPermission('sales.create')).toBe(true);
      expect(useAuthStore.getState().hasPermission('hr.view')).toBe(false);
    });

    it('sales_rep has sales and crm permissions', () => {
      const user: User = { id: '3', username: 'sales', email: 's@b.com', role: 'sales_rep', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasPermission('sales.create')).toBe(true);
      expect(useAuthStore.getState().hasPermission('accounting.view')).toBe(false);
    });

    it('viewer has read-only permissions', () => {
      const user: User = { id: '4', username: 'view', email: 'v@b.com', role: 'viewer', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasPermission('sales.view')).toBe(true);
      expect(useAuthStore.getState().hasPermission('sales.create')).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('returns true for matching role', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasRole(['admin', 'manager'])).toBe(true);
    });

    it('returns false for non-matching role', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      expect(useAuthStore.getState().hasRole(['viewer'])).toBe(false);
    });
  });

  describe('initAuth', () => {
    it('restores auth from localStorage', async () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      localStorage.setItem('auth_user', JSON.stringify(user));

      await initAuth();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user?.username).toBe('admin');
    });

    it('handles invalid stored data', async () => {
      localStorage.setItem('auth_user', 'invalid-json');
      await initAuth();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('rejects persisted auth when session fingerprint is missing', async () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      const payload = { version: 1, issuedAt: Date.now(), fingerprint: 'tab-fingerprint', user };
      localStorage.setItem('auth_user', JSON.stringify(payload));
      sessionStorage.removeItem('auth_session_fingerprint');

      await initAuth();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_user')).toBeNull();
    });

    it('clears expired session from localStorage', async () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      localStorage.setItem('auth_user', JSON.stringify(user));
      const expiredTime = Date.now() - (31 * 60 * 1000); // 31 minutes ago
      localStorage.setItem('auth_last_activity', String(expiredTime));

      await initAuth();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_user')).toBeNull();
      expect(localStorage.getItem('auth_last_activity')).toBeNull();
    });

    it('sets loading to false when no stored user', async () => {
      localStorage.clear();
      await initAuth();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('clears stale user from localStorage when DB user no longer exists', async () => {
      const validUuid = '27ab12b2-a7f1-4465-ad47-db2ed461b731';
      const staleUuid = '3776241e-a274-434b-9dc5-6e6798531eca';
      const user: User = { id: staleUuid, username: 'old', email: 'o@b.com', role: 'admin', isActive: true };
      localStorage.setItem('auth_user', JSON.stringify(user));

      // Mock getDbAdapter to return adapter that says user doesn't exist
      const adapters = await import('@/core/database/adapters');
      vi.spyOn(adapters, 'getDbAdapter').mockResolvedValue({
        ping: async () => ({ success: true }),
        query: async (_sql: string, params: unknown[]) => {
          if (params[0] === staleUuid) {
            return { success: true, rows: [] };
          }
          return { success: true, rows: [{ '?column?': 1 }] };
        },
      } as never);

      await initAuth();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_user')).toBeNull();
      vi.restoreAllMocks();
      void validUuid;
    });
  });

  describe('checkSession', () => {
    it('returns false when no activity recorded', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      useAuthStore.setState({ lastActivityAt: null });
      
      expect(useAuthStore.getState().checkSession()).toBe(false);
    });

    it('returns true when activity is recent', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().checkSession()).toBe(true);
    });

    it('returns false and logs out when session expired', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      const expiredTime = Date.now() - (31 * 60 * 1000);
      useAuthStore.setState({ lastActivityAt: expiredTime });

      expect(useAuthStore.getState().checkSession()).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('recordActivity', () => {
    it('updates lastActivityAt timestamp', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      const before = Date.now();
      
      useAuthStore.getState().recordActivity();
      const after = Date.now();
      
      const activityTime = useAuthStore.getState().lastActivityAt;
      expect(activityTime).toBeGreaterThanOrEqual(before);
      expect(activityTime).toBeLessThanOrEqual(after);
    });

    it('saves activity to localStorage', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      
      useAuthStore.getState().recordActivity();
      
      const stored = localStorage.getItem('auth_last_activity');
      expect(stored).toBeTruthy();
      expect(Number(stored)).toBe(useAuthStore.getState().lastActivityAt);
    });
  });

  describe('canAccessOwned', () => {
    it('returns true when user has module permission', () => {
      const user: User = { id: '1', username: 'manager', email: 'm@b.com', role: 'manager', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().canAccessOwned('sales.view')).toBe(true);
    });

    it('returns false when user lacks permission', () => {
      const user: User = { id: '1', username: 'viewer', email: 'v@b.com', role: 'viewer', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().canAccessOwned('sales.create')).toBe(false);
    });
  });

  describe('shouldFilterByOwner', () => {
    it('returns false when not authenticated', () => {
      expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
    });

    it('returns false for super_admin', () => {
      const user: User = { id: '1', username: 'super', email: 's@b.com', role: 'super_admin', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
    });

    it('returns false for admin', () => {
      const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
    });

    it('returns false when user has full view permission', () => {
      const user: User = { id: '1', username: 'manager', email: 'm@b.com', role: 'manager', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
    });

    it('returns true when user has only own permission', () => {
      const user: User = { id: '1', username: 'sales', email: 's@b.com', role: 'sales_rep', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(true);
    });

    it('returns false when user has no permissions for module', () => {
      const user: User = { id: '1', username: 'viewer', email: 'v@b.com', role: 'viewer', isActive: true };
      useAuthStore.getState().login(user);
      
      expect(useAuthStore.getState().shouldFilterByOwner('hr')).toBe(false);
    });
  });
});
