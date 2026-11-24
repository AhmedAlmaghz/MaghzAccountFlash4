import { useCallback, useEffect, useState } from 'react';
import { invalidateQueryCache } from '@/core/utils/queryCache';


export type LiveRow = Record<string, unknown>;

export function useLiveReportData<T extends object[]>(
  companyId: string,
  key: string,
  queryFn: () => Promise<T>,
): { data: T | null; isLoading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) { setData(null); setIsLoading(false); setError(null); return; }
    invalidateQueryCache(key);
    setIsLoading(true); setError(null);
    try {
      const rows = await queryFn();
      setData(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error'); setData(null);
    } finally { setIsLoading(false); }
  }, [companyId, key, queryFn]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { data, isLoading, error, refresh };
}
