/**
 * Pure aggregate helpers for professional reports.
 */
export type AggRow = object;

export function pickNum(row: AggRow | null | undefined, key: string): number {
  const v = (row as Record<string, unknown> | null)?.[key as string];
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function sumCol<T extends AggRow>(rows: T[], key: string): number {
  return rows.reduce((acc, r) => acc + pickNum(r, key), 0);
}

export function avgCol<T extends AggRow>(rows: T[], key: string): number {
  if (rows.length === 0) return 0;
  return sumCol(rows, key) / rows.length;
}

export function percentOf(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function deltaWithPct(current: number, previous: number): { delta: number; pct: number | null } {
  if (previous === 0) return { delta: current, pct: current !== 0 ? null : 0 };
  const delta = current - previous;
  return { delta, pct: Math.round((delta / Math.abs(previous)) * 10000) / 100 };
}

export function groupBy<T extends AggRow>(rows: T[], key: string): { [k: string]: T[] } {
  const out: { [k: string]: T[] } = {};
  for (const r of rows) {
    const k = String((r as Record<string, unknown>)[key as string] ?? '');
    if (!out[k]) out[k] = [];
    out[k].push(r);
  }
  return out;
}

export interface GroupedValue<T extends AggRow = AggRow> {
  key: string;
  rows: T[];
  sum: number;
}

export function topBy<T extends AggRow>(rows: T[], key: string, count = 10): GroupedValue<T>[] {
  return Object.entries(groupBy(rows, key))
    .map(([k, v]) => ({ key: k, rows: v, sum: sumCol(v, key) }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, count);
}
