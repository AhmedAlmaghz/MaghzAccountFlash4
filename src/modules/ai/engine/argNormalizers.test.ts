import { describe, it, expect } from 'vitest';
import {
  toLatinDigits,
  parseFlexibleNumber,
  normalizeDateArg,
  normalizeHijriDateArg,
  hijriToGregorian,
  sanitizeToolArgs,
} from './argNormalizers';

describe('toLatinDigits', () => {
  it('converts Arabic-Indic digits', () => {
    expect(toLatinDigits('١٣٢٬٥٠٠')).toBe('132٬500');
  });

  it('converts Persian digits', () => {
    expect(toLatinDigits('۱۲۳')).toBe('123');
  });

  it('leaves Latin text untouched', () => {
    expect(toLatinDigits('INV-0001')).toBe('INV-0001');
  });
});

describe('parseFlexibleNumber', () => {
  it('passes plain numbers through', () => {
    expect(parseFlexibleNumber(1250)).toBe(1250);
  });

  it('parses thousands separators and spaces', () => {
    expect(parseFlexibleNumber('132,500')).toBe(132500);
    expect(parseFlexibleNumber('1 250')).toBe(1250);
  });

  it('parses Arabic-Indic digits with Arabic comma', () => {
    expect(parseFlexibleNumber('١٣٢٬٥٠٠')).toBe(132500);
  });

  it('strips currency words/symbols', () => {
    expect(parseFlexibleNumber('50000 ريال')).toBe(50000);
    expect(parseFlexibleNumber('6,500 ر.ي')).toBe(6500);
  });

  it('returns undefined for non-numeric garbage', () => {
    expect(parseFlexibleNumber('abc')).toBeUndefined();
    expect(parseFlexibleNumber('')).toBeUndefined();
    expect(parseFlexibleNumber(null)).toBeUndefined();
  });
});

describe('normalizeDateArg (today = 2026-08-25)', () => {
  const TODAY = new Date('2026-08-25T10:00:00');

  it('accepts canonical YYYY-MM-DD', () => {
    expect(normalizeDateArg('2026-08-15', TODAY)).toBe('2026-08-15');
  });

  it('slices ISO timestamps', () => {
    expect(normalizeDateArg('2026-08-15T09:30:00Z', TODAY)).toBe('2026-08-15');
  });

  it('normalizes day-month of the current year ("12-8")', () => {
    expect(normalizeDateArg('12-8', TODAY)).toBe('2026-08-12');
    expect(normalizeDateArg('5/3', TODAY)).toBe('2026-03-05');
  });

  it('swaps when the month field exceeds 12 ("8-25" → Aug 25)', () => {
    expect(normalizeDateArg('8/25', TODAY)).toBe('2026-08-25');
  });

  it('parses "15 أغسطس 2026"', () => {
    expect(normalizeDateArg('15 أغسطس 2026', TODAY)).toBe('2026-08-15');
  });

  it('parses reversed order "أغسطس 15" without year', () => {
    expect(normalizeDateArg('أغسطس 15', TODAY)).toBe('2026-08-15');
  });

  it('tolerates alef/yeh/teh-marbuta variants ("ابريل")', () => {
    expect(normalizeDateArg('1 ابريل 2027', TODAY)).toBe('2027-04-01');
  });

  it('handles Date objects via local components', () => {
    expect(normalizeDateArg(new Date('2026-07-13'), TODAY)).toBe('2026-07-13');
  });

  it('returns null for nonsense', () => {
    expect(normalizeDateArg('بكرة الصبح', TODAY)).toBeNull();
    expect(normalizeDateArg('', TODAY)).toBeNull();
  });
});

describe('Hijri dates (المرحلة ج — اللهجات والثقافة)', () => {
  const TODAY = new Date('2026-08-25T10:00:00');

  describe('hijriToGregorian', () => {
    it('converts 1 Muharram 1448 to mid-June 2026 (±2 days of Umm al-Qura)', () => {
      const g = hijriToGregorian(1448, 1, 1);
      expect(g).toMatch(/^2026-06-1[4-9]$/);
    });

    it('converts 1 Ramadan 1447 to February 2026', () => {
      const g = hijriToGregorian(1447, 9, 1);
      expect(g).toMatch(/^2026-02-(1[6-9]|2[0-1])$/);
    });

    it('converts 10 Thul-Hijjah 1447 (Eid al-Adha) to late May 2026', () => {
      const g = hijriToGregorian(1447, 12, 10);
      expect(g).toMatch(/^2026-05-2[5-9]$/);
    });

    it('stays monotonic within the same Hijri year', () => {
      const d1 = hijriToGregorian(1448, 1, 1);
      const d2 = hijriToGregorian(1448, 2, 1);
      expect(d2! > d1!).toBe(true);
    });

    it('rejects out-of-range components', () => {
      expect(hijriToGregorian(1200, 1, 1)).toBeNull();
      expect(hijriToGregorian(1700, 1, 1)).toBeNull();
      expect(hijriToGregorian(1448, 13, 1)).toBeNull();
      expect(hijriToGregorian(1448, 1, 31)).toBeNull();
    });
  });

  describe('normalizeHijriDateArg', () => {
    it('parses "15 محرم 1448" with explicit year (June/July 2026 window)', () => {
      const g = normalizeHijriDateArg('15 محرم 1448');
      expect(g).toMatch(/^2026-0(6-2[4-9]|6-30|7-0[1-3])$/);
    });

    it('parses "١ رمضان" (Arabic digit, no year → current Hijri year)', () => {
      const g = normalizeHijriDateArg('١ رمضان', TODAY);
      expect(g).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('parses two-word Hijri months (ذو القعدة، ربيع الأول)', () => {
      expect(normalizeHijriDateArg('10 ذو القعدة 1447')).toMatch(/^2026-0(4-2[5-9]|5-0[0-3])$/);
      expect(normalizeHijriDateArg('3 ربيع الأول 1448')).toMatch(/^2026/);
    });

    it('tolerates orthography variants (الحجة/الحجه)', () => {
      expect(normalizeHijriDateArg('5 ذو الحجه 1447')).toMatch(/^2026-05/);
    });

    it('returns null for Gregorian month names (no false Hijri match)', () => {
      expect(normalizeHijriDateArg('15 أغسطس 2026')).toBeNull();
      expect(normalizeHijriDateArg('نص عشرة')).toBeNull();
    });
  });

  describe('normalizeDateArg with Hijri integration', () => {
    it('routes Hijri forms through the conversion inside normalizeDateArg', () => {
      const g = normalizeDateArg('15 محرم 1448', TODAY);
      expect(g).toMatch(/^2026-0(6|7)/);
    });

    it('still handles Gregorian forms identically after the integration', () => {
      expect(normalizeDateArg('15 أغسطس 2026', TODAY)).toBe('2026-08-15');
      expect(normalizeDateArg('12-8', TODAY)).toBe('2026-08-12');
    });
  });

  describe('Levantine month names (شباط/آذار…)', () => {
    it('parses single-word Levantine months', () => {
      expect(normalizeDateArg('10 شباط 2027', TODAY)).toBe('2027-02-10');
      expect(normalizeDateArg('5 آذار 2026', TODAY)).toBe('2026-03-05');
    });

    it('parses two-word Levantine months (كانون الثاني/الأول)', () => {
      expect(normalizeDateArg('1 كانون الثاني 2027', TODAY)).toBe('2027-01-01');
      expect(normalizeDateArg('25 كانون الأول 2026', TODAY)).toBe('2026-12-25');
    });
  });
});

describe('sanitizeToolArgs', () => {
  it('coerces known number and date keys in one pass', () => {
    const { args, changed } = sanitizeToolArgs({
      amount: '132,500',
      dueDate: '12-8',
      customerId: 'cust-1',
      notes: 'دفعة أولى',
    });

    expect(args.amount).toBe(132500);
    expect(args.dueDate).toBe(`${new Date().getFullYear()}-08-12`);
    expect(args.customerId).toBe('cust-1'); // untouched
    expect(changed.sort()).toEqual(['amount', 'dueDate']);
  });

  it('does not mutate the caller object', () => {
    const original = { amount: '١٢٠٠' };
    sanitizeToolArgs(original);
    expect(original.amount).toBe('١٢٠٠');
  });

  it('leaves unparseable values for tool-level validation', () => {
    const { args, changed } = sanitizeToolArgs({ amount: 'نصف مليون', date: 'غداً' });
    expect(args.amount).toBe('نصف مليون');
    expect(args.date).toBe('غداً');
    expect(changed).toEqual([]);
  });

  it('handles null/undefined input safely', () => {
    expect(sanitizeToolArgs(null as unknown as Record<string, unknown>).args).toEqual({});
  });
});
