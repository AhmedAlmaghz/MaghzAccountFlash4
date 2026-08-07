import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RolesPage } from './RolesPage';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User, Permission, Role } from '../types';

vi.mock('../hooks/useAuth', () => ({
  useRoles: vi.fn(),
}));

import { useRoles } from '../hooks/useAuth';

const mockUseRoles = vi.mocked(useRoles);

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

const SYSTEM_ROLE: Role = {
  id: 'role-admin',
  name: 'مدير النظام',
  description: 'دور نظامي',
  permissions: ['*'],
  isSystem: true,
  companyId: 'c-1',
};

const CUSTOM_ROLE: Role = {
  id: 'role-manager',
  name: 'مدير',
  description: 'دور مخصص',
  permissions: ['sales.view', 'sales.create', 'sales.edit'],
  isSystem: false,
  companyId: 'c-1',
};

function renderPage(initialPath = '/roles') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RolesPage', () => {
  beforeEach(() => {
    setUser(null);
    useAppStore.setState({
      activeCompany: { id: 'c-1', name: 'Test Co' } as ReturnType<typeof useAppStore.getState>['activeCompany'],
    });
    mockUseRoles.mockReturnValue({
      roles: [],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
  });

  it('redirects to home when user lacks settings.roles', () => {
    setUser(makeUser('viewer'));
    mockUseRoles.mockReturnValue({
      roles: [CUSTOM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('shows the page when user has settings.roles (super_admin)', () => {
    setUser(makeUser('super_admin'));
    mockUseRoles.mockReturnValue({
      roles: [CUSTOM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    expect(screen.getAllByText('الأدوار والصلاحيات').length).toBeGreaterThan(0);
  });

  it('admin can access roles page', () => {
    setUser(makeUser('admin'));
    mockUseRoles.mockReturnValue({
      roles: [CUSTOM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    expect(screen.getAllByText('الأدوار والصلاحيات').length).toBeGreaterThan(0);
  });

  it('shows create button for super_admin', () => {
    setUser(makeUser('super_admin'));
    renderPage();
    expect(screen.getAllByText('دور جديد').length).toBeGreaterThan(0);
  });

  it('shows system role badge with lock icon for isSystem roles', () => {
    setUser(makeUser('super_admin'));
    mockUseRoles.mockReturnValue({
      roles: [SYSTEM_ROLE, CUSTOM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    const badges = screen.getAllByText('نظامي');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('hides delete button for isSystem role', () => {
    setUser(makeUser('super_admin'));
    mockUseRoles.mockReturnValue({
      roles: [SYSTEM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    const systemCard = screen.getByText('مدير النظام').closest('.p-5');
    expect(systemCard).toBeInTheDocument();
    expect(within(systemCard as HTMLElement).queryByText('حذف')).toBeNull();
    expect(within(systemCard as HTMLElement).queryByText('نسخ')).not.toBeNull();
  });

  it('shows edit and delete for non-system role', () => {
    setUser(makeUser('super_admin'));
    mockUseRoles.mockReturnValue({
      roles: [CUSTOM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    const customCard = screen.getByText('مدير').closest('.p-5');
    expect(customCard).toBeInTheDocument();
    expect(within(customCard as HTMLElement).queryByText('تعديل الدور')).not.toBeNull();
    expect(within(customCard as HTMLElement).queryByText('حذف')).not.toBeNull();
    expect(within(customCard as HTMLElement).queryByText('نسخ')).not.toBeNull();
  });

  it('opens edit modal with isSystem read-only state', () => {
    setUser(makeUser('super_admin'));
    mockUseRoles.mockReturnValue({
      roles: [SYSTEM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    const systemCard = screen.getByText('مدير النظام').closest('.p-5');
    const editButton = within(systemCard as HTMLElement).getByText('تعديل الدور');
    fireEvent.click(editButton);
    expect(screen.getByText('دور نظامي — للقراءة فقط')).toBeInTheDocument();
    expect(screen.getByText('للقراءة فقط')).toBeInTheDocument();
  });

  it('opens new role modal when clone button is clicked', () => {
    setUser(makeUser('super_admin'));
    mockUseRoles.mockReturnValue({
      roles: [CUSTOM_ROLE],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });
    renderPage();
    const customCard = screen.getByText('مدير').closest('.p-5');
    const cloneButton = within(customCard as HTMLElement).getByText('نسخ');
    fireEvent.click(cloneButton);
    const nameInput = screen.getByDisplayValue('مدير - نسخة') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.tagName).toBe('INPUT');
  });
});
