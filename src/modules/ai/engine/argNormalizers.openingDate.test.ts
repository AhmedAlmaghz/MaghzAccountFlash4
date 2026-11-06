import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeToolArgs } from './argNormalizers';

/**
 * openingDate is a first-class date argument for every opening-balance tool
 * (customers/suppliers/products/accounts). The engine must normalize it at the
 * single hygiene choke-point so tools only ever see YYYY-MM-DD — including
 * Arabic month names and Hijri dates.
 */
describe('sanitizeToolArgs — openingDate', () => {
  afterEach(() => vi.useRealTimers());

  it('normalizes an Arabic month-name date', () => {
    const { args, changed } = sanitizeToolArgs({ openingDate: '15 أغسطس 2026' });
    expect(args.openingDate).toBe('2026-08-15');
    expect(changed).toContain('openingDate');
  });

  it('normalizes a day/month short date using the current year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 4, 12, 0, 0));
    const { args } = sanitizeToolArgs({ openingDate: '12-8' });
    expect(args.openingDate).toBe('2026-08-12');
  });

  it('normalizes a Hijri date to Gregorian', () => {
    const { args } = sanitizeToolArgs({ openingDate: '15 محرم 1448' });
    // Deterministic tabular conversion: 15 Muharram 1448 → 2026-06-30.
    expect(String(args.openingDate)).toBe('2026-06-30');
  });

  it('leaves an already-canonical date untouched', () => {
    const { args, changed } = sanitizeToolArgs({ openingDate: '2025-01-15' });
    expect(args.openingDate).toBe('2025-01-15');
    expect(changed).not.toContain('openingDate');
  });

  it('passes an unparseable value through so tool validation reports it', () => {
    const { args } = sanitizeToolArgs({ openingDate: 'not-a-date' });
    expect(args.openingDate).toBe('not-a-date');
  });
});
