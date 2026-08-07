import { useMemo } from 'react';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';

export function useBranchFilter<T>(items: T[]): T[] {
  const selectedBranchId = useAppStore((state) => state.selectedBranchId);
  const user = useAuthStore((state) => state.user);

  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  return useMemo(() => {
    if (isAdmin) return items;

    const effectiveBranch = selectedBranchId || user?.branchId;
    if (!effectiveBranch) return items;

    return items.filter((item) => {
      const branchId = (item as { branchId?: string }).branchId;
      if (!branchId) return true;
      return branchId === effectiveBranch;
    });
  }, [items, selectedBranchId, isAdmin, user?.branchId]);
}

export default useBranchFilter;
