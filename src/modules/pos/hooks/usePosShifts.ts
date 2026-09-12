import { useCallback, useEffect, useState } from 'react';
import { posApi } from '../api';
import type { PosShift, PosShiftSummary } from '../types';
import { useAuthStore } from '@/modules/auth/store';

/** Paginated shift history (PosShiftsPage table). */
export function usePosShifts(companyId: string) {
  const [shifts, setShifts] = useState<PosShift[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const result = await posApi.getShiftsPaginated(companyId, page, pageSize);
    if (result.success && result.data) {
      setShifts(result.data.items);
      setTotal(result.data.total);
    }
    setIsLoading(false);
  }, [companyId, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  return {
    shifts, total, page, pageSize, isLoading,
    goToPage: (p: number) => setPage(Math.max(1, p)),
    changePageSize: (n: number) => { setPage(1); setPageSize(n); },
    reload: load,
  };
}

/** The cashier's own open shift (POS terminal gate). */
export function useActivePosShift(companyId: string) {
  const userId = useAuthStore((s) => s.user?.id) || null;
  const [shift, setShift] = useState<PosShift | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const result = await posApi.getActiveShift(companyId, userId ?? undefined);
    // Fail-safe: a transient bridge/RPC error must NOT kick the cashier out
    // of their open shift — only a successful "no open shift" answer clears it.
    if (result.success) setShift(result.data ?? null);
    setIsLoading(false);
  }, [companyId, userId]);

  useEffect(() => { load(); }, [load]);

  return { shift, isLoading, reload: load };
}

/** Z-report totals for the close dialog and the shift report. */
export function useShiftSummary(companyId: string, shiftId: string | null) {
  const [summary, setSummary] = useState<PosShiftSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !shiftId) { setSummary(null); return; }
    setIsLoading(true);
    const result = await posApi.getShiftSummary(companyId, shiftId);
    setSummary(result.success ? result.data ?? null : null);
    setIsLoading(false);
  }, [companyId, shiftId]);

  useEffect(() => { load(); }, [load]);

  return { summary, isLoading, reload: load };
}
