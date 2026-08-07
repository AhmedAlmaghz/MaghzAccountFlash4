import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionGate, Can } from './PermissionGate';
import { useAuthStore } from '@/modules/auth/store';
import type { User, Permission } from '@/modules/auth/types';

function makeUser(role: string, _permissions: Permission[] = []): User {
  return {
    id: 'u-1',
    companyId: 'c-1',
    username: 'tester',
    fullName: 'Test User',
    role,
    roleId: 'r-1',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function setUser(user: User | null, _permissions: Permission[] = []) {
  const store = useAuthStore.getState();
  if (user) {
    store.login(user, _permissions);
  } else {
    store.logout();
  }
}

describe('PermissionGate', () => {
  beforeEach(() => {
    setUser(null);
  });

  it('renders children when user has the permission', () => {
    setUser(makeUser('sales_rep'), ['sales.create']);
    render(
      <PermissionGate permission="sales.create">
        <button>Create Invoice</button>
      </PermissionGate>
    );
    expect(screen.getByText('Create Invoice')).toBeInTheDocument();
  });

  it('hides children when user lacks the permission', () => {
    setUser(makeUser('viewer'));
    render(
      <PermissionGate permission="sales.create" fallback={<span>nope</span>}>
        <button>Create Invoice</button>
      </PermissionGate>
    );
    expect(screen.queryByText('Create Invoice')).toBeNull();
    expect(screen.getByText('nope')).toBeInTheDocument();
  });

  it('renders nothing by default when access denied', () => {
    setUser(makeUser('viewer'));
    const { container } = render(
      <PermissionGate permission="sales.create">
        <span>secret</span>
      </PermissionGate>
    );
    expect(container.textContent).toBe('');
  });

  it('super_admin has all permissions via store hasPermission', () => {
    const store = useAuthStore.getState();
    setUser(makeUser('super_admin'));
    expect(store.hasPermission('sales.create')).toBe(true);
    expect(store.hasPermission('settings.roles')).toBe(true);
  });

  it('admin has all permissions except core.edit', () => {
    const store = useAuthStore.getState();
    setUser(makeUser('admin'));
    expect(store.hasPermission('sales.create')).toBe(true);
    expect(store.hasPermission('settings.roles')).toBe(true);
    expect(store.hasPermission('core.edit')).toBe(false);
  });

  it('Can shorthand works for module.action', () => {
    setUser(makeUser('manager'), ['accounting.view', 'accounting.create']);
    render(
      <Can action="create" module="accounting">
        <button>New Journal</button>
      </Can>
    );
    expect(screen.getByText('New Journal')).toBeInTheDocument();
  });

  it('Can hides content for non-permitted action', () => {
    setUser(makeUser('viewer'));
    render(
      <Can action="delete" module="sales" fallback={<span>denied</span>}>
        <button>Delete</button>
      </Can>
    );
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('permissions list with requireAll=true', () => {
    setUser(makeUser('manager'), ['sales.view', 'sales.create']);
    const { rerender } = render(
      <PermissionGate permissions={['sales.view', 'sales.create']} requireAll>
        <span>full</span>
      </PermissionGate>
    );
    expect(screen.getByText('full')).toBeInTheDocument();

    setUser(makeUser('viewer'), ['sales.view']);
    rerender(
      <PermissionGate permissions={['sales.view', 'sales.create']} requireAll>
        <span>full</span>
      </PermissionGate>
    );
    expect(screen.queryByText('full')).toBeNull();
  });

  it('permissions list with requireAll=false (any)', () => {
    setUser(makeUser('viewer'), ['sales.view']);
    render(
      <PermissionGate permissions={['sales.view', 'sales.create']} requireAll={false}>
        <span>partial</span>
      </PermissionGate>
    );
    expect(screen.getByText('partial')).toBeInTheDocument();
  });

  it('role check restricts by role name', () => {
    setUser(makeUser('admin'));
    render(
      <PermissionGate role="super_admin" fallback={<span>no</span>}>
        <span>yes</span>
      </PermissionGate>
    );
    expect(screen.queryByText('yes')).toBeNull();
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('role array accepts any of the listed roles', () => {
    setUser(makeUser('accountant'));
    render(
      <PermissionGate role={['accountant', 'manager']}>
        <span>ok</span>
      </PermissionGate>
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('hides content when no user is logged in', () => {
    setUser(null);
    render(
      <PermissionGate permission="sales.create" fallback={<span>guest</span>}>
        <span>secret</span>
      </PermissionGate>
    );
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('guest')).toBeInTheDocument();
  });
});
