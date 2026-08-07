import { useEffect, useState } from 'react';
import { useAppStore } from '@/core/store';
import { authApi } from '@/modules/auth/api';

const userMapCache: Map<string, Map<string, string>> = new Map();

async function fetchUserMap(companyId: string): Promise<Map<string, string>> {
  if (userMapCache.has(companyId)) {
    return userMapCache.get(companyId)!;
  }
  try {
    const res = await authApi.getUsers(companyId);
    if (res.success && res.data) {
      const map = new Map<string, string>();
      for (const u of res.data) {
        map.set(u.id, u.fullName || u.username);
      }
      userMapCache.set(companyId, map);
      return map;
    }
  } catch {
    return new Map();
  }
  return new Map();
}

export function useUserMap(): { getUserName: (id?: string) => string; refresh: () => void } {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());

  const load = async () => {
    if (!companyId) return;
    const map = await fetchUserMap(companyId);
    setUserMap(map);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return {
    getUserName: (id?: string) => {
      if (!id) return '-';
      return userMap.get(id) || id.substring(0, 8);
    },
    refresh: () => {
      userMapCache.delete(companyId);
      load();
    },
  };
}

export default useUserMap;
