import { create } from 'zustand';
import type { User, Permission } from '@/modules/auth/types';
import { AuditLogger } from '@/core/audit';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const FALLBACK_PERMISSIONS: Record<string, Permission[]> = {
  manager: [
    'core.view', 'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'sales.view', 'sales.create', 'sales.edit', 'sales.post',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post',
    'reports.view', 'reports.export',
    'settings.view',
    'ai.use',
  ],
  accountant: [
    'core.view',
    'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view',
    'sales.view', 'sales.create', 'sales.edit',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view',
    'reports.view', 'reports.export',
    'ai.use',
  ],
  sales_rep: [
    'sales.own', 'sales.create', 'sales.edit',
    'inventory.own',
    'crm.own', 'crm.create', 'crm.edit',
    'reports.view',
    'ai.use',
  ],
  viewer: [
    'core.view', 'accounting.view', 'inventory.view', 'sales.view',
    'purchases.view', 'manufacturing.view', 'reports.view',
  ],
};

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  permissions: Permission[];
  lastActivityAt: number | null;

  setUser: (user: User | null) => void;
  login: (user: User, permissions?: Permission[]) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setPermissions: (permissions: Permission[]) => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (roles: string[]) => boolean;
  checkSession: () => boolean;
  recordActivity: () => void;
  canAccessOwned: (modulePermission: string) => boolean;
  shouldFilterByOwner: (module: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  permissions: [],
  lastActivityAt: null,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  login: (user, permissions = []) => {
    set({ user, isAuthenticated: true, isLoading: false, permissions, lastActivityAt: Date.now() });
    void AuditLogger.logLogin();
  },

  logout: () => {
    const user = get().user;
    void window.electronAuth?.logout();
    set({ user: null, isAuthenticated: false, isLoading: false, permissions: [], lastActivityAt: null });
    if (user) {
      void AuditLogger.logLogout();
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setPermissions: (permissions) => set({ permissions }),

  hasPermission: (permission: string) => {
    const { user, permissions } = get();
    if (!user) return false;

    if (user.role === 'super_admin') return true;

    if (user.role === 'admin') {
      const restricted: string[] = ['core.edit'];
      return !restricted.includes(permission);
    }

    if (permissions.length > 0) {
      if (permissions.includes('*')) return true;
      return permissions.includes(permission as Permission);
    }

    const fallback = FALLBACK_PERMISSIONS[user.role] || [];
    return fallback.includes(permission as Permission);
  },

  hasRole: (roles: string[]) => {
    const { user } = get();
    if (!user) return false;
    return roles.includes(user.role);
  },

  checkSession: () => {
    const { lastActivityAt } = get();
    if (!lastActivityAt) return false;
    if (Date.now() - lastActivityAt > SESSION_TIMEOUT_MS) {
      get().logout();
      return false;
    }
    return true;
  },

  recordActivity: () => {
    const now = Date.now();
    set({ lastActivityAt: now });
  },

  canAccessOwned: (modulePermission: string) => {
    return get().hasPermission(modulePermission);
  },

  shouldFilterByOwner: (module: string) => {
    const { user } = get();
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'admin') return false;
    const fullPerm = `${module}.view` as Permission;
    const ownPerm = `${module}.own` as Permission;
    if (get().hasPermission(fullPerm)) return false;
    if (get().hasPermission(ownPerm)) return true;
    return false;
  },
}));

export async function initAuth(): Promise<void> {
  if (!window.electronAuth) {
    // No Electron auth available - this should not happen in production
    useAuthStore.getState().setLoading(false);
    return;
  }

  const session = await window.electronAuth.getSession();
  if (session.success && session.user) {
    useAuthStore.getState().login(session.user as User, (session.permissions || []) as Permission[]);
  } else {
    useAuthStore.getState().logout();
  }
  useAuthStore.getState().setLoading(false);
}
