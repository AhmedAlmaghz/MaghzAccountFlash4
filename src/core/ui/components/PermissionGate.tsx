import React from 'react';
import { useAuthStore } from '@/modules/auth/store';
import type { Permission } from '@/modules/auth/types';

type Module = 'accounting' | 'inventory' | 'sales' | 'purchases' | 'manufacturing' | 'hr' | 'crm' | 'reports' | 'settings';
type Action = 'view' | 'create' | 'edit' | 'delete' | 'post' | 'export';

function checkPermissionSet(
  hasPermission: (p: Permission) => boolean,
  permissions: Permission[] | undefined,
  requireAll: boolean,
): boolean {
  if (!permissions || permissions.length === 0) return true;
  return requireAll
    ? permissions.every((p) => hasPermission(p))
    : permissions.some((p) => hasPermission(p));
}

function checkModuleAction(
  hasPermission: (p: Permission) => boolean,
  module: Module,
  action: Action,
): boolean {
  return hasPermission(`${module}.${action}` as Permission);
}

interface PermissionGateProps {
  permission?: Permission;
  permissions?: Permission[];
  requireAll?: boolean;
  module?: Module;
  action?: Action;
  role?: string | string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  permission,
  permissions,
  requireAll = false,
  module,
  action,
  role,
  fallback = null,
  children,
}) => {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const hasRole = useAuthStore((s) => s.hasRole);

  if (!user) return <>{fallback}</>;

  if (role) {
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (!hasRole(allowedRoles)) return <>{fallback}</>;
  }

  if (permission && !hasPermission(permission)) return <>{fallback}</>;

  if (permissions && !checkPermissionSet(hasPermission, permissions, requireAll)) return <>{fallback}</>;

  if (module && action && !checkModuleAction(hasPermission, module, action)) return <>{fallback}</>;

  return <>{children}</>;
};

interface CanProps {
  action: Action;
  module: Module;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const Can: React.FC<CanProps> = ({ action, module, fallback = null, children }) => (
  <PermissionGate module={module} action={action} fallback={fallback}>
    {children}
  </PermissionGate>
);
