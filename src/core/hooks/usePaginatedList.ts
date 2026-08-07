import { useState, useCallback, useEffect, useRef } from 'react';
import type { PaginatedQueryResult } from '@/core/utils/pagination';

export type PaginatedFetchFn<T> = (page: number, pageSize: number) => Promise<PaginatedQueryResult<T>>;

export interface UsePaginatedListOptions {
  initialPage?: number;
  initialPageSize?: number;
  autoLoad?: boolean;
}

export function usePaginatedList<T>(
  fetchFn: PaginatedFetchFn<T>,
  deps: ReadonlyArray<unknown>,
  options: UsePaginatedListOptions = {}
) {
  const { initialPage = 1, initialPageSize = 25, autoLoad = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFnRef = useRef(fetchFn);
  useEffect(() => { fetchFnRef.current = fetchFn; });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchFnRef.current(page, pageSize);
      if (result.success && result.data) {
        setItems(result.data.items);
        setTotal(result.data.total);
      } else {
        setItems([]);
        setTotal(0);
        if (result.error) setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    if (autoLoad) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, autoLoad, ...deps]);

  const goToPage = useCallback((p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages || 1)));
  }, [totalPages]);

  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setPage(initialPage);
    setPageSize(initialPageSize);
  }, [initialPage, initialPageSize]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    error,
    goToPage,
    changePageSize,
    setPage,
    setPageSize,
    reload: load,
    reset,
  };
}
