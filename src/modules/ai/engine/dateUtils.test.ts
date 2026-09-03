import { describe, it, expect } from 'vitest';
import { localToday, localTodayOr, localMonthStart } from './dateUtils';

describe('AI dateUtils — LOCAL calendar helpers (UTC-midnight regression)', () => {
  describe('localToday', () => {
    it('returns YYYY-MM-DD', () => {
      expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('matches the LOCAL calendar day, not the UTC day', () => {
      // 2026-09-03 01:30 local GMT+3 → UTC is 2026-09-02 22:30.
      // A UTC "today" reports 09-02 (yesterday); local must report 09-03.
      const local = localToday();
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(local).toBe(expected);
    });

    it('is stable across calls within the same local day', () => {
      expect(localToday()).toBe(localToday());
    });
  });

  describe('localTodayOr', () => {
    it('keeps an explicit value', () => {
      expect(localTodayOr('2026-01-15')).toBe('2026-01-15');
    });

    it('falls back to LOCAL today on empty/invalid values', () => {
      expect(localTodayOr(undefined)).toBe(localToday());
      expect(localTodayOr('')).toBe(localToday());
      expect(localTodayOr(0 as unknown)).toBe(localToday());
    });
  });

  describe('localMonthStart', () => {
    it('is the first day of the CURRENT local month', () => {
      const ms = localMonthStart();
      expect(ms).toMatch(/^\d{4}-\d{2}-01$/);
      const now = new Date();
      expect(ms).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    });
  });
});
