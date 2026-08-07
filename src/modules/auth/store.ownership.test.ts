import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const initialState = useAuthStore.getState();

describe('Auth store ownership filters', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    localStorage.clear();
  });

  it('shouldFilterByOwner returns false when no user', () => {
    useAuthStore.setState({ user: null, permissions: [] });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
  });

  it('admin role bypasses owner filter', () => {
    useAuthStore.setState({
      user: { id: 'admin-1', role: 'admin', username: 'admin', isActive: true } as User,
      permissions: ['sales.view', 'sales.create', 'sales.edit'],
    });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
  });

  it('super_admin role bypasses owner filter', () => {
    useAuthStore.setState({
      user: { id: 'sa-1', role: 'super_admin', username: 'sa', isActive: true } as User,
      permissions: ['sales.view', 'sales.create'],
    });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
  });

  it('user with view permission only -> no owner filter', () => {
    useAuthStore.setState({
      user: { id: 'mgr-1', role: 'manager', username: 'mgr', isActive: true } as User,
      permissions: ['sales.view', 'sales.create'],
    });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
  });

  it('user with only .own permission -> owner filter enabled', () => {
    useAuthStore.setState({
      user: { id: 'rep-1', role: 'sales_rep', username: 'rep', isActive: true } as User,
      permissions: ['sales.own', 'sales.create', 'crm.own', 'inventory.own'],
    });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(true);
    expect(useAuthStore.getState().shouldFilterByOwner('inventory')).toBe(true);
    expect(useAuthStore.getState().shouldFilterByOwner('crm')).toBe(true);
  });

  it('user with .own permission for one module only filters that module', () => {
    useAuthStore.setState({
      user: { id: 'rep-1', role: 'sales_rep', username: 'rep', isActive: true } as User,
      permissions: ['sales.own', 'sales.create'],
    });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(true);
    expect(useAuthStore.getState().shouldFilterByOwner('accounting')).toBe(false);
    expect(useAuthStore.getState().shouldFilterByOwner('inventory')).toBe(false);
  });

  it('user with both .view and .own -> view wins (no filter)', () => {
    useAuthStore.setState({
      user: { id: 'mgr-1', role: 'manager', username: 'mgr', isActive: true } as User,
      permissions: ['sales.view', 'sales.own', 'sales.create'],
    });
    expect(useAuthStore.getState().shouldFilterByOwner('sales')).toBe(false);
  });

  it('hasPermission correctly checks granted permission', () => {
    useAuthStore.setState({
      user: { id: 'u1', role: 'user', username: 'u1', isActive: true } as User,
      permissions: ['sales.view', 'sales.create'],
    });
    expect(useAuthStore.getState().hasPermission('sales.view')).toBe(true);
    expect(useAuthStore.getState().hasPermission('sales.create')).toBe(true);
    expect(useAuthStore.getState().hasPermission('sales.delete')).toBe(false);
    expect(useAuthStore.getState().hasPermission('accounting.view')).toBe(false);
  });
});

describe('Auth session management', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    localStorage.clear();
  });

  it('login sets user and permissions', () => {
    useAuthStore.getState().login(
      { id: 'u1', username: 'u1', role: 'user', isActive: true } as User,
      ['sales.view']
    );
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe('u1');
    expect(useAuthStore.getState().permissions).toContain('sales.view');
  });

  it('logout clears user and localStorage', () => {
    useAuthStore.getState().login(
      { id: 'u1', username: 'u1', role: 'user', isActive: true } as User,
      ['sales.view']
    );
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('auth_user')).toBeNull();
  });

  it('recordActivity updates lastActivityAt', () => {
    useAuthStore.getState().recordActivity();
    expect(useAuthStore.getState().lastActivityAt).not.toBeNull();
    expect(localStorage.getItem('auth_last_activity')).not.toBeNull();
  });
});

