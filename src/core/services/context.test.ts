import { describe, it, expect, vi } from 'vitest';
import {
  getContextFromStore,
  requireContext,
  hasPermission,
  assertPermission,
  assertCompanyMatch,
  type ServiceContext,
} from './context';

// Mock the auth store
const mockUser = {
  id: 'user-123',
  username: 'admin',
  role: 'admin',
  companyId: 'company-abc',
  isActive: true,
};

const mockState = {
  user: mockUser,
  permissions: ['sales.view', 'sales.create', 'sales.post'],
};

vi.mock('@/modules/auth/store', () => ({
  useAuthStore: {
    getState: () => mockState,
  },
}));

describe('context', () => {
  describe('getContextFromStore', () => {
    it('returns context from store when user is authenticated', () => {
      const ctx = getContextFromStore();
      expect(ctx).not.toBeNull();
      expect(ctx?.companyId).toBe('company-abc');
      expect(ctx?.userId).toBe('user-123');
      expect(ctx?.role).toBe('admin');
      expect(ctx?.permissions).toEqual(['sales.view', 'sales.create', 'sales.post']);
    });

    it('returns null when no user', () => {
      mockState.user = null;
      expect(getContextFromStore()).toBeNull();
      mockState.user = mockUser;
    });
  });

  describe('requireContext', () => {
    it('returns context when user exists', () => {
      const ctx = requireContext();
      expect(ctx.companyId).toBe('company-abc');
    });

    it('throws when no user', () => {
      mockState.user = null;
      expect(() => requireContext()).toThrow('Authentication required');
      mockState.user = mockUser;
    });
  });

  describe('hasPermission', () => {
    const ctx: ServiceContext = {
      companyId: 'company-abc',
      userId: 'user-123',
      role: 'admin',
      permissions: ['sales.view', 'sales.create'],
    };

    it('returns true for super_admin', () => {
      const superCtx: ServiceContext = { ...ctx, role: 'super_admin', permissions: [] };
      expect(hasPermission(superCtx, 'anything')).toBe(true);
    });

    it('returns true for admin on non-restricted permission', () => {
      expect(hasPermission(ctx, 'sales.view')).toBe(true);
    });

    it('returns false for admin on restricted permission', () => {
      expect(hasPermission(ctx, 'core.edit')).toBe(false);
    });

    it('returns true when permissions include wildcard', () => {
      const wildcardCtx: ServiceContext = { ...ctx, role: 'custom', permissions: ['*'] };
      expect(hasPermission(wildcardCtx, 'anything')).toBe(true);
    });

    it('returns true when permission is in list', () => {
      expect(hasPermission(ctx, 'sales.create')).toBe(true);
    });

    it('returns false when permission is not in list', () => {
      expect(hasPermission(ctx, 'sales.delete')).toBe(false);
    });
  });

  describe('assertPermission', () => {
    const ctx: ServiceContext = {
      companyId: 'company-abc',
      userId: 'user-123',
      role: 'admin',
      permissions: ['sales.view'],
    };

    it('returns null when permission is granted', () => {
      expect(assertPermission(ctx, 'sales.view')).toBeNull();
    });

    it('returns PERMISSION_DENIED result when permission is denied', () => {
      const result = assertPermission(ctx, 'sales.delete');
      expect(result).not.toBeNull();
      if (result && !result.success) {
        expect(result.code).toBe('PERMISSION_DENIED');
        expect(result.error).toContain('sales.delete');
      }
    });
  });

  describe('assertCompanyMatch', () => {
    const ctx: ServiceContext = {
      companyId: 'company-abc',
      userId: 'user-123',
      role: 'admin',
      permissions: [],
    };

    it('returns true when companyId matches', () => {
      expect(assertCompanyMatch(ctx, 'company-abc')).toBe(true);
    });

    it('returns false when companyId does not match', () => {
      expect(assertCompanyMatch(ctx, 'company-xyz')).toBe(false);
    });
  });
});
