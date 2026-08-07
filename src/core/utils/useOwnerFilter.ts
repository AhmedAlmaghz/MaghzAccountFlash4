import { useState, useMemo, useCallback } from 'react';
import { useAuthStore } from '@/modules/auth/store';

export function useOwnerFilter<T extends { createdBy?: string }>(
  items: T[],
  module: string
): { filtered: T[]; showToggle: boolean; isOwnOnly: boolean; toggleOwnOnly: (v: boolean) => void } {
  const user = useAuthStore((state) => state.user);
  const shouldFilter = useAuthStore((state) => state.shouldFilterByOwner);
  const canAccessOwned = useAuthStore((state) => state.canAccessOwned);

  const isForcedOwnOnly = shouldFilter(module);
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const hasOwnPerm = canAccessOwned(`${module}.own`);
  const showToggle = !isForcedOwnOnly && !isAdmin && hasOwnPerm;

  const [manualOwnOnly, setManualOwnOnly] = useState(() => {
    return localStorage.getItem(`owner_filter_${module}`) === 'true';
  });

  const isOwnOnly = isForcedOwnOnly || (showToggle && manualOwnOnly);

  const filtered = useMemo(() => {
    if (!isOwnOnly || !user?.id) return items;
    return items.filter((item) => item.createdBy === user.id || !item.createdBy);
  }, [items, isOwnOnly, user?.id]);

  const toggleOwnOnly = useCallback((v: boolean) => {
    setManualOwnOnly(v);
    if (v) {
      localStorage.setItem(`owner_filter_${module}`, 'true');
    } else {
      localStorage.removeItem(`owner_filter_${module}`);
    }
  }, [module]);

  return { filtered, showToggle, isOwnOnly, toggleOwnOnly };
}

export default useOwnerFilter;
