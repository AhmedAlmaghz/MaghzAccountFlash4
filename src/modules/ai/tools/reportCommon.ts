import { getDbAdapter } from '@/core/database/adapters';
import { guardSqlQuery } from '../security/sqlGuard';
import { localToday, localTodayOr, localMonthStart } from '../engine/dateUtils';

/**
 * Shared helpers for AI read/report tools.
 * Extracted from reportTools.ts / detailedReportTools.ts / diagnosticTools.ts
 * to eliminate duplication (Phase 5).
 */

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
}

export function dateRange(from?: string, to?: string): { from: string; to: string } {
  // LOCAL calendar bounds — a UTC "to" excludes tonight's rows from reports
  return {
    from: typeof from === 'string' && from ? from : localMonthStart(),
    to: localTodayOr(to) ?? localToday(),
  };
}

// Run every SQL statement through the allow-list guard before hitting the DB.
export async function guardedQuery(sql: string, params: unknown[]) {
  const check = guardSqlQuery(sql);
  if (!check.ok) return { success: false as const, error: check.error, rows: [] as unknown[] };
  const adapter = await getDbAdapter();
  return adapter.query(check.sql, params);
}

// Base-currency aggregate expressions — seed/legacy rows have base_currency_amount = 0
export const BASE_AMOUNT_SUM =
  'COALESCE(SUM(COALESCE(NULLIF(base_currency_amount, 0), total_amount)), 0)';
export const BASE_VOUCHER_SUM =
  'COALESCE(SUM(COALESCE(NULLIF(base_currency_amount, 0), amount)), 0)';
