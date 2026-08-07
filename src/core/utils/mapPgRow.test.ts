import { describe, it, expect } from 'vitest';
import { toDateString } from './mapPgRow';

describe('toDateString', () => {
  it('converts a Date object to YYYY-MM-DD', () => {
    const d = new Date('2026-07-13T00:00:00Z');
    expect(toDateString(d)).toBe('2026-07-13');
  });

  it('converts a Date in GMT+0300 to the correct local date', () => {
    // 2026-07-13 00:00:00 GMT+0300 is 2026-07-12 21:00:00 UTC
    const d = new Date('2026-07-13T00:00:00+03:00');
    expect(toDateString(d)).toBe('2026-07-13');
  });

  it('returns null for an invalid Date', () => {
    const d = new Date('not-a-date');
    expect(toDateString(d)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(toDateString('')).toBeNull();
  });

  it('returns null/undefined unchanged', () => {
    expect(toDateString(null)).toBeNull();
    expect(toDateString(undefined)).toBeUndefined();
  });

  it('passes through YYYY-MM-DD strings unchanged', () => {
    expect(toDateString('2026-07-13')).toBe('2026-07-13');
  });

  it('extracts the date portion from ISO strings with time', () => {
    expect(toDateString('2026-07-13T10:30:00Z')).toBe('2026-07-13');
  });

  it('does not produce the locale-formatted string that breaks PG', () => {
    // This is the format node-postgres returns via Date.prototype.toString().
    // We must NEVER return this format from toDateString.
    const d = new Date('2026-07-13T00:00:00+03:00');
    const result = toDateString(d);
    expect(result).not.toMatch(/GMT/);
    expect(result).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
  });

  it('reformats locale-formatted strings into YYYY-MM-DD', () => {
    const localeString = new Date('2026-07-13T00:00:00+03:00').toString();
    const result = toDateString(localeString);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
