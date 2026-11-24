import { useCallback, useMemo, useState } from 'react';

export type PeriodPreset = 'all' | '30' | '90' | '180' | 'year';

export interface PeriodFilterState {
  preset: PeriodPreset;
  from: string;
  to: string;
}

/** Local (non-UTC) date-of-month helpers — avoid the classic TZ-midnight bug. */
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayLocal(): string {
  return toDateString(new Date());
}

export function usePeriodFilter() {
  const [preset, setPreset] = useState<PeriodPreset>('90');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const range = useMemo<PeriodFilterState>(() => {
    const today = new Date();
    if (preset === 'all') return { preset, from: '', to: '' };
    if (preset === '30') return { preset, from: toDateString(new Date(today.getTime() - 30 * 86400000)), to: todayLocal() };
    if (preset === '90') return { preset, from: toDateString(new Date(today.getTime() - 90 * 86400000)), to: todayLocal() };
    if (preset === '180') return { preset, from: toDateString(new Date(today.getTime() - 180 * 86400000)), to: todayLocal() };
    return { preset, from: `${today.getFullYear()}-01-01`, to: todayLocal() };
  }, [preset]);

  const resetPreset = useCallback(() => {
    setPreset('90');
    setFrom('');
    setTo('');
  }, []);

  return { preset, setPreset, from, setFrom, to, setTo, range, resetPreset };
}
