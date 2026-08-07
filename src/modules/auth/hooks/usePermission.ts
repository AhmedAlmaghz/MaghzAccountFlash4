import { useAuthStore } from '@/modules/auth/store';
import type { Permission } from '@/modules/auth/types';

function checkPermission(permission: Permission): boolean {
  return useAuthStore.getState().hasPermission(permission);
}

export function usePermission(permission: Permission): boolean {
  useAuthStore((s) => s.user);
  useAuthStore((s) => s.permissions);
  return checkPermission(permission);
}

export function usePermissions(permissions: Permission[]): Record<string, boolean> {
  useAuthStore((s) => s.user);
  useAuthStore((s) => s.permissions);
  return permissions.reduce<Record<string, boolean>>((acc, p) => {
    acc[p] = checkPermission(p);
    return acc;
  }, {});
}

export function useHasRole(roles: string[]): boolean {
  useAuthStore((s) => s.user);
  return useAuthStore.getState().hasRole(roles);
}

type Module = 'core' | 'accounting' | 'inventory' | 'sales' | 'purchases' | 'manufacturing' | 'hr' | 'crm' | 'reports' | 'settings' | 'ai';

export function useCanView(module: Module): boolean {
  return usePermission(`${module}.view` as Permission);
}

export function useCanCreate(module: Module): boolean {
  return usePermission(`${module}.create` as Permission);
}

export function useCanEdit(module: Module): boolean {
  return usePermission(`${module}.edit` as Permission);
}

export function useCanDelete(module: Module): boolean {
  return usePermission(`${module}.delete` as Permission);
}

export function useCanPost(module: Module): boolean {
  return usePermission(`${module}.post` as Permission);
}

export function useCanExport(): boolean {
  return usePermission('reports.export');
}

export function useCanAccessModule(module: Module): boolean {
  useAuthStore((s) => s.user);
  useAuthStore((s) => s.permissions);
  const state = useAuthStore.getState();
  if (!state.user) return false;
  if (state.user.role === 'super_admin') return true;
  if (state.hasPermission(`${module}.view` as Permission)) return true;
  if (state.hasPermission(`${module}.own` as Permission)) return true;
  if (state.hasPermission(`${module}.create` as Permission)) return true;
  return false;
}

export function useModulePermissions(module: Module) {
  useAuthStore((s) => s.user);
  useAuthStore((s) => s.permissions);
  return {
    canView: checkPermission(`${module}.view` as Permission),
    canCreate: checkPermission(`${module}.create` as Permission),
    canEdit: checkPermission(`${module}.edit` as Permission),
    canDelete: checkPermission(`${module}.delete` as Permission),
    canPost: checkPermission(`${module}.post` as Permission),
  };
}

export function useShouldFilterByOwner(module: Module): boolean {
  useAuthStore((s) => s.user);
  return useAuthStore.getState().shouldFilterByOwner(module);
}
