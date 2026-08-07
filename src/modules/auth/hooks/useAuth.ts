import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { authApi } from '../api';
import type {
  User,
  Role,
  AuditLog,
  LoginCredentials,
  UserFilters,
  RoleFilters,
  AuditLogFilters,
} from '../types';

export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const storeLogin = useAuthStore((state) => state.login);
  const storeLogout = useAuthStore((state) => state.logout);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setError(null);
    const result = await authApi.login(credentials);
    if (result.success && result.user) {
      storeLogin(result.user, result.permissions);
      if (result.user.roleId && result.user.companyId) {
        try {
          const roleResult = await authApi.getRoleById(result.user.companyId, result.user.roleId);
          if (roleResult.success && roleResult.data?.permissions) {
            useAuthStore.getState().setPermissions(roleResult.data.permissions);
          }
        } catch {
          // Permissions will use fallback map
        }
      }
      return true;
    }
    setError(result.error || 'Login failed');
    return false;
  }, [storeLogin]);

  const logout = useCallback(() => {
    authApi.logout();
    storeLogout();
  }, [storeLogout]);

  return { user, isAuthenticated, isLoading, error, login, logout };
}

export function useUsers(companyId: string, filters?: UserFilters) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await authApi.getUsers(companyId, filters);
      if (result.success && result.data) {
        setUsers(result.data);
      }
      setIsLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filters?.search, filters?.role, filters?.branchId, filters?.isActive]);

  const create = useCallback(async (data: Omit<User, 'id'>) => {
    const result = await authApi.createUser(data);
    if (result.success && result.id) {
      setUsers((prev) => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<User>) => {
    const result = await authApi.updateUser(companyId, id, data);
    if (result.success) {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...data } : u)));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await authApi.deleteUser(companyId, id);
    if (result.success) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
    }
    return result;
  }, [companyId]);

  const resetPassword = useCallback(async (id: string, newPassword: string) => {
    return authApi.resetPassword(companyId, id, newPassword);
  }, [companyId]);

  const toggleActive = useCallback(async (id: string, isActive: boolean) => {
    const result = await authApi.updateUser(companyId, id, { isActive });
    if (result.success) {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive } : u)));
    }
    return result;
  }, [companyId]);

  return { users, isLoading, create, update, remove, resetPassword, toggleActive };
}

export function useRoles(companyId: string, filters?: RoleFilters) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await authApi.getRoles(companyId, filters);
      if (result.success && result.data) {
        setRoles(result.data);
      }
      setIsLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filters?.search]);

  const create = useCallback(async (data: Omit<Role, 'id'>) => {
    const result = await authApi.createRole(data);
    if (result.success && result.id) {
      setRoles((prev) => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Role>) => {
    const result = await authApi.updateRole(companyId, id, data);
    if (result.success) {
      setRoles((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await authApi.deleteRole(companyId, id);
    if (result.success) {
      setRoles((prev) => prev.filter((r) => r.id !== id));
    }
    return result;
  }, [companyId]);

  return { roles, isLoading, create, update, remove };
}

export function useAuditLogs(companyId: string, filters?: AuditLogFilters) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await authApi.getAuditLogs(companyId, filters);
      if (result.success && result.data) {
        setLogs(result.data);
      }
      setIsLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filters?.userId, filters?.tableName, filters?.action, filters?.fromDate, filters?.toDate]);

  return { logs, isLoading };
}
