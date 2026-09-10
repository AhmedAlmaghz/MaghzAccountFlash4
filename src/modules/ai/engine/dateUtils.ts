/**
 * Local-time date helpers for AI tools and prompts.
 *
 * `new Date().toISOString().split('T')[0]` is UTC — for GMT+3 it reports
 * YESTERDAY between 00:00 and 03:00 local, silently back-dating every
 * document created late at night and telling the LLM the wrong "today".
 * These helpers always use LOCAL calendar components, matching
 * `toDateString` in `core/utils/mapPgRow` (the golden rule from Phase 75).
 */

import { toDateString } from '@/core/utils/mapPgRow';

/** Today's date as YYYY-MM-DD using LOCAL calendar components. */
export function localToday(): string {
  return toDateString(new Date()) ?? '';
}

/**
 * Default `to` bound for report date ranges — the LOCAL today, not UTC.
 * A UTC "today" excludes tonight's rows from default reports.
 */
export function localTodayOr(value: unknown): string {
  return typeof value === 'string' && value ? value : localToday();
}

/** First day of the CURRENT LOCAL month as YYYY-MM-DD. */
export function localMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Parse a YYYY-MM-DD string into LOCAL month/year numbers.
 * `new Date('2026-08-12')` parses as UTC midnight — in GMT-5 that becomes
 * 11 August local, so getMonth()/getFullYear() read the WRONG day's month.
 * Splitting the string directly has no timezone dependency at all.
 */
export function localDateParts(dateStr: string): { month: number; year: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || '').trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}
