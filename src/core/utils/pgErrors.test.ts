import { describe, it, expect, afterEach } from 'vitest';
import { classifyPgFailure, pgFailureMessage, PG_AR_SENTENCES, PG_MESSAGE_KEYS, type PgFailureCode } from './pgErrors';
import { useAppStore } from '@/core/store';
import ar from '@/core/i18n/ar.json';
import en from '@/core/i18n/en.json';

/**
 * The classifier is the only place that knows how a SQLSTATE becomes a
 * sentence. Two things must hold for it to be worth having: it must key off
 * the CODE (English PG prose moves with the server locale — a regex over it
 * silently stops matching the day the user upgrades the database), and it must
 * return null rather than guess when there is nothing to classify.
 */
describe('classifyPgFailure', () => {
  it('maps a foreign-key violation by its SQLSTATE, not its message', () => {
    // pg (node-postgres) and PGlite both raise this shape: five-digit `code`.
    const err = Object.assign(new Error('insert or update on table "leaves" violates foreign key constraint "leaves_approved_by_fkey"'), {
      code: '23503',
      constraint: 'leaves_approved_by_fkey',
      table: 'leaves',
    });
    const failure = classifyPgFailure(err);
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('FK_VIOLATION');
    expect(failure!.pgCode).toBe('23503');
    expect(failure!.constraint).toBe('leaves_approved_by_fkey');
    // The user's sentence must not leak the constraint name or the English prose.
    expect(pgFailureMessage(failure!)).not.toMatch(/leaves_approved_by_fkey/);
    expect(pgFailureMessage(failure!)).not.toMatch(/violates foreign key/i);
  });

  it('classifies the sibling violations the same way', () => {
    const cases: Array<[string, string]> = [
      ['23505', 'UNIQUE_VIOLATION'],
      ['23502', 'NOT_NULL_VIOLATION'],
      ['23514', 'CHECK_VIOLATION'],
      ['22P02', 'INVALID_TEXT_REPRESENTATION'],
      ['40001', 'SERIALIZATION_FAILURE'],
      ['40P01', 'DEADLOCK_DETECTED'],
    ];
    for (const [sqlState, expected] of cases) {
      const failure = classifyPgFailure({ code: sqlState, message: 'x' });
      expect(failure?.code, sqlState).toBe(expected);
    }
  });

  it('an unmapped SQLSTATE still classifies, as DB_ERROR', () => {
    const failure = classifyPgFailure({ code: 'XX000', message: 'internal error' });
    expect(failure?.code).toBe('DB_ERROR');
    expect(failure?.pgCode).toBe('XX000');
  });

  it('reads the main-process envelope without re-deriving anything', () => {
    // What crosses the IPC boundary is { error, pgFailure: { code, pgCode, ... } }.
    const failure = classifyPgFailure({
      success: false,
      error: 'violates unique constraint "accounts_code_company_key"',
      pgFailure: {
        code: 'UNIQUE_VIOLATION',
        pgCode: '23505',
        constraint: 'accounts_code_company_key',
        table: 'accounts',
        message: 'violates unique constraint "accounts_code_company_key"',
      },
    });
    expect(failure?.code).toBe('UNIQUE_VIOLATION');
    expect(pgFailureMessage(failure!)).toMatch(/مستخدمة مسبقاً/);
  });

  it('re-wraps an envelope it produced itself (stable key, no SQLSTATE)', () => {
    const failure = classifyPgFailure({ code: 'FK_VIOLATION', message: 'anything' });
    expect(failure?.code).toBe('FK_VIOLATION');
  });

  it('returns null for anything that is not a database failure', () => {
    // The caller must be able to fall back to its own message without guessing.
    for (const input of [null, undefined, '', 'plain text', 42, {}, { code: 'oops' }, []]) {
      expect(classifyPgFailure(input), JSON.stringify(input)).toBeNull();
    }
  });

  it('never throws on a hostile shape', () => {
    expect(() => classifyPgFailure({ pgFailure: 'not an object' })).not.toThrow();
    expect(classifyPgFailure({ pgFailure: 'not an object' })).toBeNull();
  });
});

describe('pgFailureMessage', () => {
  afterEach(() => {
    // The store is module-global: an 'en' leak would poison every later test
    // in this file that asserts on the default language.
    useAppStore.setState({ language: 'ar' });
  });

  it('has a distinct sentence per class — a generic one would hide the cause', () => {
    const codes = ['FK_VIOLATION', 'UNIQUE_VIOLATION', 'NOT_NULL_VIOLATION', 'CHECK_VIOLATION'] as const;
    const seen = new Set(codes.map((c) => pgFailureMessage({ code: c, pgCode: '', constraint: null, table: null, message: '' })));
    expect(seen.size).toBe(codes.length);
  });

  it('falls back to the generic sentence for an unknown class', () => {
    const message = pgFailureMessage({
      code: 'SOMETHING_NEW' as never,
      pgCode: null,
      constraint: null,
      table: null,
      message: '',
    });
    expect(message).toMatch(/قاعدة البيانات/);
  });

  it('renders the store language — an English UI never toasts Arabic', () => {
    const failure = { code: 'FK_VIOLATION' as const, pgCode: '23503', constraint: null, table: null, message: '' };
    useAppStore.setState({ language: 'en' });
    expect(pgFailureMessage(failure)).toMatch(/Invalid reference/);
    useAppStore.setState({ language: 'ar' });
    expect(pgFailureMessage(failure)).toMatch(/مرجع غير صالح/);
  });

  it('an explicit lang argument wins over the store', () => {
    const failure = { code: 'UNIQUE_VIOLATION' as const, pgCode: '23505', constraint: null, table: null, message: '' };
    useAppStore.setState({ language: 'ar' });
    expect(pgFailureMessage(failure, 'en')).toMatch(/already in use/);
  });

  it('the Arabic constants ARE the ar.json values — the taxonomy exact-matches them', () => {
    // If these drift, the taxonomy's exact layer silently stops recognising
    // database sentences and FK failures fall back to regex prose matching.
    const db = (ar as unknown as Record<string, Record<string, Record<string, string>>>).errors.db;
    expect(Object.keys(db).sort()).toEqual(Object.keys(PG_AR_SENTENCES).map((c) => PG_MESSAGE_KEYS[c as PgFailureCode].split('.').pop()!).sort());
    for (const code of Object.keys(PG_AR_SENTENCES) as PgFailureCode[]) {
      const key = PG_MESSAGE_KEYS[code].split('.').pop()!;
      expect(PG_AR_SENTENCES[code], code).toBe(db[key]);
    }
    // ...and every class has an English twin, or the English toast leaks Arabic.
    const enDb = (en as unknown as Record<string, Record<string, Record<string, string>>>).errors.db;
    for (const code of Object.keys(PG_AR_SENTENCES) as PgFailureCode[]) {
      const key = PG_MESSAGE_KEYS[code].split('.').pop()!;
      expect(typeof enDb[key], code).toBe('string');
      expect(enDb[key].length, code).toBeGreaterThan(0);
    }
  });
});
