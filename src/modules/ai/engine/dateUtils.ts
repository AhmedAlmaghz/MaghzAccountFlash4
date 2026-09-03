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
