/**
 * PostgreSQL failure classification — the single place that turns a SQLSTATE
 * into a stable key plus a sentence a human can act on.
 *
 * Why this lives in the renderer and not in the main process: the main process
 * only EXTRACTS (`pgFailurePayload` in electron/dbHandler.js) and never words
 * the message, so this table has exactly one home and no mirror to keep in
 * sync. PGlite (browser / worker) never crosses the IPC boundary, yet it
 * raises the same SQLSTATEs on the same `DatabaseError` shape — so both drivers
 * classify through this one function.
 *
 * Rule: classify by CODE, never by message text. English PG prose moves with
 * the server locale and the PG version; a regex over it silently stops
 * matching on the day the user upgrades the database.
 */
import ar from '@/core/i18n/ar.json';
import en from '@/core/i18n/en.json';
import { useAppStore } from '@/core/store';

export type PgFailureCode =
  | 'FK_VIOLATION'
  | 'UNIQUE_VIOLATION'
  | 'NOT_NULL_VIOLATION'
  | 'CHECK_VIOLATION'
  | 'VALUE_TOO_LONG'
  | 'INVALID_TEXT_REPRESENTATION'
  | 'SERIALIZATION_FAILURE'
  | 'DEADLOCK_DETECTED'
  | 'DB_ERROR';

export interface PgFailure {
  /** Stable key — safe for programmatic branching, never localised. */
  code: PgFailureCode;
  /** The original five-character SQLSTATE, for logs and support. */
  pgCode: string | null;
  constraint: string | null;
  table: string | null;
  /** The driver's own message. Diagnostics only — never show this raw. */
  message: string;
}

const PG_STATE_CODES: Record<string, PgFailureCode> = {
  '23503': 'FK_VIOLATION',
  '23505': 'UNIQUE_VIOLATION',
  '23502': 'NOT_NULL_VIOLATION',
  '23514': 'CHECK_VIOLATION',
  '22001': 'VALUE_TOO_LONG',
  '22P02': 'INVALID_TEXT_REPRESENTATION',
  '40001': 'SERIALIZATION_FAILURE',
  '40P01': 'DEADLOCK_DETECTED',
};

/**
 * The i18n key for each class (`module.feature.element`, per the house rule).
 * The sentence itself lives in ar.json/en.json; these are routes, not text.
 */
export const PG_MESSAGE_KEYS: Record<PgFailureCode, string> = {
  FK_VIOLATION: 'errors.db.fkViolation',
  UNIQUE_VIOLATION: 'errors.db.uniqueViolation',
  NOT_NULL_VIOLATION: 'errors.db.notNullViolation',
  CHECK_VIOLATION: 'errors.db.checkViolation',
  VALUE_TOO_LONG: 'errors.db.valueTooLong',
  INVALID_TEXT_REPRESENTATION: 'errors.db.invalidText',
  SERIALIZATION_FAILURE: 'errors.db.serializationFailure',
  DEADLOCK_DETECTED: 'errors.db.deadlockDetected',
  DB_ERROR: 'errors.db.dbError',
};

/**
 * The Arabic sentences, verbatim. They are the FALLBACK (a missing key must
 * never leak "errors.db.fkViolation" into a toast), and they are also what the
 * AI taxonomy exact-matches against — a caller that forwards only the sentence
 * still lands on the same stable key, because THESE strings are constants, not
 * prose that moves with a server upgrade.
 */
export const PG_AR_SENTENCES: Record<PgFailureCode, string> = {
  FK_VIOLATION: 'مرجع غير صالح — السجل المرتبط غير موجود أو لا يخص هذه الشركة',
  UNIQUE_VIOLATION: 'القيمة مستخدمة مسبقاً — لا يمكن التكرار',
  NOT_NULL_VIOLATION: 'حقل إلزامي مفقود',
  CHECK_VIOLATION: 'قيمة غير مسموح بها لقاعدة التحقق',
  VALUE_TOO_LONG: 'القيمة أطول من المسموح',
  INVALID_TEXT_REPRESENTATION: 'صيغة قيمة غير صحيحة',
  SERIALIZATION_FAILURE: 'تعارض في التزامن — أعد المحاولة',
  DEADLOCK_DETECTED: 'تعارض في معالجة الطلبات — أعد المحاولة',
  DB_ERROR: 'خطأ في قاعدة البيانات',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const STABLE_CODES = new Set<string>(Object.keys(PG_AR_SENTENCES));

function toFailure(raw: Record<string, unknown>): PgFailure | null {
  const code = typeof raw.code === 'string' ? raw.code : null;
  // A SQLSTATE is five characters, digits for class 00-42 and letters for the
  // rest (XX000 internal_error, P0001 raise_exception, 23503 a violation) — so
  // this cannot be narrowed to digits.
  const pgCode = code && /^[0-9A-Za-z]{5}$/.test(code) ? code : null;
  // A five-digit code is a raw SQLSTATE (pg / PGlite); anything else in
  // STABLE_CODES is an envelope this app produced earlier and re-passed.
  const stable = code && !pgCode && STABLE_CODES.has(code) ? (code as PgFailureCode) : null;
  if (!pgCode && !stable) return null;
  return {
    code: stable ?? (pgCode ? PG_STATE_CODES[pgCode] ?? 'DB_ERROR' : 'DB_ERROR'),
    pgCode,
    constraint: typeof raw.constraint === 'string' ? raw.constraint : null,
    table: typeof raw.table === 'string' ? raw.table : null,
    message: typeof raw.message === 'string' && raw.message ? raw.message : 'Database error',
  };
}

/**
 * Accepts, in order of preference:
 *   1. a driver error (`pg` / PGlite `DatabaseError` — five-digit `.code`),
 *   2. a main-process failure envelope (`{ pgFailure }`),
 *   3. an adapter result (`{ success: false, error, pgFailure? }`).
 * Returns null for anything that is not a database failure, so a caller can
 * fall back to its own message without guessing.
 */
export function classifyPgFailure(input: unknown): PgFailure | null {
  if (!isRecord(input)) return null;
  if (isRecord(input.pgFailure)) return toFailure(input.pgFailure);
  return toFailure(input);
}

/**
 * The sentence to hand back through the `{ success: false, error }` contract.
 * Reads the store language at call time (no hooks — adapters call this from
 * plain functions), so an English UI toasts English and an Arabic UI Arabic.
 * A missing key falls back to the Arabic constant: a sentence in the wrong
 * language is recoverable, a leaked key path is not.
 */
export function pgFailureMessage(failure: PgFailure, lang?: 'ar' | 'en'): string {
  const language = lang ?? safeLanguage();
  try {
    const dict = (language === 'en' ? en : ar) as unknown as Record<string, unknown>;
    let value: unknown = dict;
    for (const k of PG_MESSAGE_KEYS[failure.code].split('.')) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        value = undefined;
        break;
      }
    }
    if (typeof value === 'string' && value) return value;
  } catch {
    /* fall through to the constant */
  }
  return PG_AR_SENTENCES[failure.code] ?? PG_AR_SENTENCES.DB_ERROR;
}

function safeLanguage(): 'ar' | 'en' {
  try {
    const language = useAppStore.getState().language;
    return language === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}
