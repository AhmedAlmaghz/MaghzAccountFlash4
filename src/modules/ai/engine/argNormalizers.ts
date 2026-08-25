/**
 * Tool-argument normalizers — the single hygiene layer every LLM-supplied
 * argument passes through before a tool executes.
 *
 * LLMs emit messy values even when the user was clear: Arabic-Indic digits
 * (١٢٠٠), thousands separators ("132,500"), currency suffixes ("50000 ريال"),
 * free-form dates ("12-8", "15 أغسطس 2026"). Left raw, these crash PG or
 * silently corrupt documents. Normalizing HERE means every tool — present
 * and future — inherits the protection through one choke point
 * (executeToolCall).
 */
import { toDateString } from '@/core/utils/mapPgRow';

const AR_DIGITS = /[٠-٩]/g;
const FA_DIGITS = /[۰-۹]/g;

/** Convert Arabic-Indic / Persian digits to Latin digits. */
export function toLatinDigits(s: string): string {
  return s
    .replace(AR_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(FA_DIGITS, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/**
 * Parse a number from any user/model formatting: Arabic digits, thousands
 * separators (٬ , ،), inner spaces and trailing currency words.
 * Returns undefined when nothing numeric remains.
 */
export function parseFlexibleNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;

  let s = toLatinDigits(v).trim();
  if (!s) return undefined;
  // Longest-first so "ريال" isn't eaten by the shorter "ر.ي" alternative
  s = s.replace(/ريال|ر\.?\s?ي\.?|YER|SAR|USD/gi, '');
  s = s.replace(/[٬,،\s]/g, '');

  // A lone trailing dot or stray non-numerics → reject cleanly
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Arabic month-name lookup (spelling variants fold onto the same month).
 * A Map — NOT an array — so adding a variant never shifts month numbers.
 */
function foldArabic(token: string): string {
  return token.replace(/[ىي]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/[أإآ]/g, 'ا');
}

const AR_MONTH_LOOKUP: Record<string, number> = {};
(
  [
    ['يناير', 1], ['فبراير', 2], ['مارس', 3], ['أبريل', 4], ['ابريل', 4],
    ['مايو', 5], ['يونيو', 6], ['يوليو', 7], ['يوليه', 7],
    ['أغسطس', 8], ['اغسطس', 8], ['سبتمبر', 9],
    ['أكتوبر', 10], ['اكتوبر', 10], ['نوفمبر', 11], ['ديسمبر', 12],
  ] as Array<[string, number]>
).forEach(([name, num]) => {
  AR_MONTH_LOOKUP[foldArabic(name)] = num;
});

function monthFromName(token: string): number | null {
  return AR_MONTH_LOOKUP[foldArabic(token)] ?? null;
}

/**
 * Normalize a free-form date into strict YYYY-MM-DD.
 *
 * Accepted shapes (beyond Date / ISO / YYYY-MM-DD):
 *  - "12-8" / "12/8" / "12.8"   → day/month of the current year (Arabic
 *    convention is day-first; swapped when the second field > 12)
 *  - "15 أغسطس 2026" / "أغسطس 15 2026"
 * Returns null when nothing sensible can be derived.
 */
export function normalizeDateArg(value: unknown, today = new Date()): string | null {
  if (value instanceof Date) return toDateString(value) ?? null;
  if (typeof value === 'number') return null;
  if (typeof value !== 'string') return null;

  const s = toLatinDigits(value.trim());
  if (!s) return null;

  // Already canonical (or full ISO timestamp) → take the date part
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const y = today.getFullYear();

  // Day-Month without year: "12-8", "12/8", "12.8"
  const dm = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (dm) {
    let d = Number(dm[1]);
    let m = Number(dm[2]);
    if (m > 12 && d <= 12) [d, m] = [m, d];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }

  // Month-name forms: "15 أغسطس 2026" أو "أغسطس 15 2026"
  const mdY = s.match(/^(\d{1,2})\s+([^\s\d]+)(?:\s+(\d{4}))?$/);
  const mDy = s.match(/^([^\s\d]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  const fromName = (day: number, nameToken: string, yearStr?: string): string | null => {
    const m = monthFromName(nameToken);
    if (!m || day < 1 || day > 31) return null;
    return `${yearStr ?? y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  if (mdY) return fromName(Number(mdY[1]), mdY[2], mdY[3]);
  if (mDy) return fromName(Number(mDy[2]), mDy[1], mDy[3]);

  // Last resort: native parsing with LOCAL components (never UTC-shifted)
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return toDateString(parsed) ?? null;
  return null;
}

/** Argument keys that carry dates on the built-in write/read tools. */
const DATE_ARG_KEYS = new Set([
  'date', 'dueDate', 'expiryDate', 'expectedDate', 'checkDate',
  'fromDate', 'toDate', 'startDate', 'endDate', 'terminationDate',
]);

/** Argument keys that carry numbers (amounts, quantities, prices…). */
const NUMBER_ARG_KEYS = new Set([
  'amount', 'amountApplied', 'quantity', 'unitPrice', 'openingBalance',
  'creditLimit', 'openingStockQty', 'totalAmount', 'debit', 'credit',
  'discountPercent', 'vatPercent', 'probability', 'durationMinutes',
  'baseCurrencyAmount', 'exchangeRate', 'systemQty', 'actualQty',
]);

export interface SanitizedArgs {
  /** Cleaned shallow copy — never mutates the caller's object. */
  args: Record<string, unknown>;
  /** Top-level keys that were corrected (for debugging/audit). */
  changed: string[];
}

/**
 * Coerce known date/number fields on a tool-call argument object.
 * Unknown keys are passed through untouched; unparseable values are left
 * as-is so tool-level validation reports them naturally.
 */
export function sanitizeToolArgs(args: Record<string, unknown>): SanitizedArgs {
  if (!args || typeof args !== 'object') return { args: args ?? {}, changed: [] };

  const out: Record<string, unknown> = { ...args };
  const changed: string[] = [];

  for (const key of Object.keys(out)) {
    if (DATE_ARG_KEYS.has(key)) {
      const fixed = normalizeDateArg(out[key]);
      if (fixed !== null && fixed !== out[key]) {
        out[key] = fixed;
        changed.push(key);
      }
    } else if (NUMBER_ARG_KEYS.has(key)) {
      const fixed = parseFlexibleNumber(out[key]);
      if (fixed !== undefined && fixed !== out[key]) {
        out[key] = fixed;
        changed.push(key);
      }
    }
  }

  return { args: out, changed };
}
