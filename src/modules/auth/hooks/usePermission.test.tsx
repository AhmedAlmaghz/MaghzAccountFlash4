import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { 
  usePermission, 
  useCanView, 
  useCanCreate, 
  useCanEdit,
  useCanDelete,
  useCanPost,
  useCanExport,
  usePermissions,
  useHasRole,
  useShouldFilterByOwner,
  useCanAccessModule,
  useModulePermissions 
} from './usePermission';
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

function Probe({ perm }: { perm: Permission }) {
  const v = usePermission(perm);
  return <span data-testid="probe">{String(v)}</span>;
}

function ProbeViewCreate({ module }: { module: 'sales' | 'accounting' }) {
  const canView = useCanView(module);
  const canCreate = useCanCreate(module);
  return (
    <span data-testid="probe">
      {canView ? 'V' : '-'}:{canCreate ? 'C' : '-'}
    </span>
  );
}

function ProbeModule({ module }: { module: 'sales' | 'hr' }) {
  const perms = useModulePermissions(module);
  return (
    <span data-testid="probe">
      {JSON.stringify(perms)}
    </span>
  );
}

describe('usePermission', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('returns false when no user is logged in', () => {
    render(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('returns true when user has the permission (manager + fallback)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('returns false when user lacks the permission', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('super_admin returns true for any permission', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('super_admin'));
    });
    render(<Probe perm="settings.roles" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('re-renders when user changes (login)', () => {
    const { rerender } = render(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');

    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    rerender(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('re-renders when user changes (logout)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    const { rerender } = render(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');

    act(() => {
      useAuthStore.getState().logout();
    });
    rerender(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('re-renders when permissions are updated', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    const { rerender } = render(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');

    act(() => {
      useAuthStore.getState().setPermissions(['sales.create', 'sales.view']);
    });
    rerender(<Probe perm="sales.create" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });
});

describe('useCanView / useCanCreate', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('view+create shortcuts for manager', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeViewCreate module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('V:C');
  });

  it('viewer has view but not create', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<ProbeViewCreate module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('V:-');
  });

  it('sales_rep with own perm has no module.view', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('sales_rep'));
    });
    render(<ProbeViewCreate module="accounting" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('-:-');
  });
});

describe('useModulePermissions', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('returns all false when not logged in', () => {
    render(<ProbeModule module="sales" />);
    const text = screen.getByTestId('probe').textContent ?? '';
    expect(text).toContain('"canView":false');
    expect(text).toContain('"canCreate":false');
    expect(text).toContain('"canEdit":false');
    expect(text).toContain('"canDelete":false');
    expect(text).toContain('"canPost":false');
  });

  it('manager has canView + canCreate + canEdit + canPost for sales', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeModule module="sales" />);
    const text = screen.getByTestId('probe').textContent ?? '';
    expect(text).toContain('"canView":true');
    expect(text).toContain('"canCreate":true');
    expect(text).toContain('"canEdit":true');
    expect(text).toContain('"canPost":true');
  });
});

describe('usePermissions', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  function ProbeBatch({ perms }: { perms: Permission[] }) {
    const result = usePermissions(perms);
    return <span data-testid="probe">{JSON.stringify(result)}</span>;
  }

  it('returns object with boolean values for each permission', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeBatch perms={['sales.create', 'sales.view', 'accounting.create']} />);
    const text = screen.getByTestId('probe').textContent ?? '';
    expect(text).toContain('"sales.create":true');
    expect(text).toContain('"sales.view":true');
  });

  it('returns false for permissions user does not have', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<ProbeBatch perms={['sales.create', 'sales.view']} />);
    const text = screen.getByTestId('probe').textContent ?? '';
    expect(text).toContain('"sales.create":false');
    expect(text).toContain('"sales.view":true');
  });
});

describe('useHasRole', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  function ProbeRole({ roles }: { roles: string[] }) {
    const result = useHasRole(roles);
    return <span data-testid="probe">{String(result)}</span>;
  }

  it('returns true when user has one of the roles', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeRole roles={['admin', 'manager']} />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('returns false when user does not have any of the roles', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<ProbeRole roles={['admin', 'manager']} />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('returns false when no user is logged in', () => {
    render(<ProbeRole roles={['admin']} />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});

describe('useCanEdit / useCanDelete / useCanPost', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  function ProbeActions({ module }: { module: 'sales' | 'accounting' }) {
    const canEdit = useCanEdit(module);
    const canDelete = useCanDelete(module);
    const canPost = useCanPost(module);
    return (
      <span data-testid="probe">
        E:{canEdit ? '1' : '0'}:D:{canDelete ? '1' : '0'}:P:{canPost ? '1' : '0'}
      </span>
    );
  }

  it('manager has edit/post but not delete for sales', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeActions module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('E:1:D:0:P:1');
  });

  it('viewer has no edit/delete/post', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<ProbeActions module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('E:0:D:0:P:0');
  });
});

describe('useCanExport', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  function ProbeExport() {
    const result = useCanExport();
    return <span data-testid="probe">{String(result)}</span>;
  }

  it('returns true for manager (has reports.export via fallback)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeExport />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('returns false for viewer', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<ProbeExport />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});

describe('useShouldFilterByOwner', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  function ProbeOwner({ module }: { module: 'sales' | 'accounting' }) {
    const result = useShouldFilterByOwner(module);
    return <span data-testid="probe">{String(result)}</span>;
  }

  it('returns true for sales_rep (has sales.own)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('sales_rep'));
    });
    render(<ProbeOwner module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('returns false for manager (has sales.view, no need to filter)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('manager'));
    });
    render(<ProbeOwner module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});

describe('useCanAccessModule', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  function ProbeAccess({ module }: { module: 'sales' | 'accounting' | 'hr' }) {
    const result = useCanAccessModule(module);
    return <span data-testid="probe">{String(result)}</span>;
  }

  it('returns false when no user is logged in', () => {
    render(<ProbeAccess module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('returns true for super_admin for any module', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('super_admin'));
    });
    render(<ProbeAccess module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('returns true for sales_rep on sales (has sales.own)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('sales_rep'));
    });
    render(<ProbeAccess module="sales" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('returns false for viewer on hr (no hr permissions)', () => {
    act(() => {
      useAuthStore.getState().login(makeUser('viewer'));
    });
    render(<ProbeAccess module="hr" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});
