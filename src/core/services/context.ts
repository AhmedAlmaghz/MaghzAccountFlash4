/**
 * ServiceContext — the authenticated context passed to every service method.
 *
 * This is the single source of truth for "who is calling" inside the service
 * layer. It replaces the ad-hoc `_userId?: string` parameter scattered across
 * API methods with a structured, validated object that carries:
 *
 *  - `companyId`  — the tenant boundary (always required)
 *  - `userId`     — the actor (nullable for system/bootstrap operations)
 *  - `role`       — the actor's role (for RBAC shortcuts)
 *  - `permissions`— explicit permission list (from DB or fallback)
 *
 * Services use `assertPermission(ctx, 'sales.post')` to enforce RBAC at the
 * service layer, not just in the UI.
 */

import { useAuthStore } from '@/modules/auth/store';
import { permissionDenied, type ServiceResult } from './errors';

export interface ServiceContext {
  companyId: string;
  userId?: string;
  role?: string;
  permissions: string[];
}

/**
 * Build a `ServiceContext` from the current Zustand auth store.
 * Returns `null` if no user is authenticated or no company is selected.
 */
export function getContextFromStore(): ServiceContext | null {
  const state = useAuthStore.getState();
  if (!state.user) return null;
  if (!state.user.companyId) return null;
  return {
    companyId: state.user.companyId,
    userId: state.user.id,
    role: state.user.role,
    permissions: state.permissions,
  };
}

/**
 * Require a context — throws if no user is authenticated. Use in service
 * methods that are never callable without a session.
 */
export function requireContext(): ServiceContext {
  const ctx = getContextFromStore();
  if (!ctx) {
    throw new Error('Authentication required');
  }
  return ctx;
}

/**
 * Check whether a context grants a specific permission.
 * Mirrors `useAuthStore.hasPermission` but operates on a snapshot, so it is
 * safe to call inside service methods without subscribing to the store.
 */
export function hasPermission(ctx: ServiceContext, permission: string): boolean {
  if (ctx.role === 'super_admin') return true;
  if (ctx.role === 'admin') {
    const restricted: string[] = ['core.edit'];
    return !restricted.includes(permission);
  }
  if (ctx.permissions.includes('*')) return true;
  return ctx.permissions.includes(permission);
}

/**
 * Assert a permission or return a `PERMISSION_DENIED` result.
 */
export function assertPermission(ctx: ServiceContext, permission: string): ServiceResult<never> | null {
  if (hasPermission(ctx, permission)) return null;
  return permissionDenied(permission);
}

/**
 * Validate that a context's companyId matches an expected value. This is a
 * defense-in-depth check against cross-tenant parameter injection.
 */
export function assertCompanyMatch(ctx: ServiceContext, companyId: string): boolean {
  return ctx.companyId === companyId;
}
