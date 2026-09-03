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
    // Levantine/Egyptian month names — same months, different words
    ['كانون الثاني', 1], ['شباط', 2], ['آذار', 3], ['اذار', 3], ['نيسان', 4],
    ['أيار', 5], ['ايار', 5], ['حزيران', 6], ['تموز', 7], ['آب', 8], ['اب', 8],
    ['أيلول', 9], ['ايلول', 9], ['تشرين الأول', 10], ['تشرين الاول', 10],
    ['تشرين الثاني', 11], ['كانون الأول', 12], ['كانون الاول', 12],
  ] as Array<[string, number]>
).forEach(([name, num]) => {
  AR_MONTH_LOOKUP[foldArabic(name)] = num;
});

/**
 * HIJRI month names (folded). Used by normalizeHijriDateArg to accept
 * "15 محرم 1448" / "١ رمضان" and convert to the Gregorian calendar day the
 * system stores. Conversion is the standard Umm al-Qura-approximating
 * arithmetic (civil): Hijri epoch JD 1948439.5, year length 354.367068….
 */
const HIJRI_MONTHS: Record<string, number> = {};
(
  [
    ['محرم', 1], ['صفر', 2], ['ربيع الأول', 3], ['ربيع الاول', 3], ['ربيع الثاني', 4],
    ['جمادى الأولى', 5], ['جمادى الاولى', 5], ['جمادى الآخرة', 6], ['جمادى الاخره', 6], ['جمادى', 6],
    ['رجب', 7], ['شعبان', 8], ['رمضان', 9], ['شوال', 10],
    ['ذو القعدة', 11], ['ذو القعده', 11], ['القعدة', 11],
    ['ذو الحجة', 12], ['ذو الحجه', 12], ['الحجة', 12], ['ذي الحجة', 12], ['ذي الحجه', 12],
  ] as Array<[string, number]>
).forEach(([name, num]) => {
  HIJRI_MONTHS[foldArabic(name)] = num;
});

/** Gregorian → Julian Day Number (civil calendar arithmetic). */
function gregorianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** Julian Day Number → Gregorian Y/M/D (standard Fliegel–Van Flandern). */
function jdnToGregorian(jdn: number): { y: number; m: number; d: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d2 = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d2) / 4);
  const m2 = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m2 + 2) / 5) + 1;
  const month = m2 + 3 - 12 * Math.floor(m2 / 10);
  const year = 100 * b + d2 - 4800 + Math.floor(m2 / 10);
  return { y: year, m: month, d: day };
}

/**
 * Convert a Hijri date to Gregorian YYYY-MM-DD using the tabular civil
 * (Kuwaiti-style) algorithm: year length alternates via the standard leap
 * cycle, months alternate 30/29. Deterministic, no external library.
 *
 * Accuracy: ±1-2 days versus local moon-sighting calendars (Umm al-Qura) —
 * the caller MUST surface the converted Gregorian date to the user when a
 * critical document depends on it, so they can confirm/adjust.
 */
export function hijriToGregorian(hy: number, hm: number, hd: number): string | null {
  if (hy < 1300 || hy > 1600) return null;
  if (hm < 1 || hm > 12 || hd < 1 || hd > 30) return null;

  // Leap-day count for completed years: floor((3 + 11*(hy-1)) / 30) gives the
  // number of leap years passed (Kuwaiti cycle — matches islamic-civil).
  const completedYears = hy - 1;
  const leapDays = Math.floor((3 + 11 * completedYears) / 30);
  let days = 354 * completedYears + leapDays;
  // Months within the current year: odd months 30 days, even months 29.
  for (let m = 1; m < hm; m++) {
    days += m % 2 === 1 ? 30 : 29;
  }
  days += hd - 1;

  const hijriEpochJdn = 1948440; // 1 Muharram 1 AH ≈ 622-07-19 (civil)
  const g = jdnToGregorian(hijriEpochJdn + days);
  return `${g.y}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`;
}

/**
 * Try parsing a HIJRI date expression: "15 محرم 1448", "١ رمضان",
 * "10 ذو القعدة". Year absent → assume the CURRENT Hijri year (derived from
 * today). Returns Gregorian YYYY-MM-DD or null when not a Hijri form.
 */
export function normalizeHijriDateArg(value: string, today = new Date()): string | null {
  const s = toLatinDigits(value.trim());
  if (!s) return null;

  // Day + month-name (+ optional year). "15 محرم 1448" / "١ رمضان" / "3 رمضان"
  const m1 = s.match(/^(\d{1,2})\s+([^\s\d]+(?:\s+[^\s\d]+)?)\s*(?:(\d{4})|سنه\s*(\d{4}))?$/);
  if (!m1) return null;

  const day = Number(m1[1]);
  const monthToken = foldArabic(m1[2].trim());
  const yearStr = m1[3] || m1[4] || m1[5];
  let hy = yearStr ? Number(yearStr) : 0;
  if (!hy) {
    // Approximate current Hijri year from today (inverse of the same math)
    const jdn = gregorianToJdn(today.getFullYear(), today.getMonth() + 1, today.getDate());
    hy = Math.floor((jdn - 1948440) / 354.367068) + 1;
  }

  const hm = HIJRI_MONTHS[monthToken];
  if (!hm) return null;
  return hijriToGregorian(hy, hm, day);
}

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

  // ── Hijri month-name forms FIRST (distinct names — no Gregorian clash) ──
  // "15 محرم 1448" / "١ رمضان" → converted to the Gregorian date the system
  // stores. Returns null for non-Hijri input so we fall through safely.
  const hijri = normalizeHijriDateArg(s, today);
  if (hijri) return hijri;

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

  // Month-name forms: "15 أغسطس 2026" / "أغسطس 15 2026" — also two-word
  // Levantine months like "كانون الثاني" and "تشرين الأول".
  const mdY = s.match(/^(\d{1,2})\s+([^\s\d]+(?:\s+[^\s\d]+)?)(?:\s+(\d{4}))?$/);
  const mDy = s.match(/^([^\s\d]+(?:\s+[^\s\d]+)?)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
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
