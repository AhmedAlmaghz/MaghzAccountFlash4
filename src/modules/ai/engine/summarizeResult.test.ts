import { describe, it, expect } from 'vitest';
import { summarizeResult } from './chatEngine';

describe('summarizeResult — empty-search fallback visibility', () => {
  // Real session 2026-09-10: search.accounts found nothing for "إنترنت"
  // and the card showed only "❌ لا توجد نتائج." — the expense-account
  // suggestions the tool had computed never reached the user's eyes.
  it('renders fallback suggestions on the card, not just the miss marker', () => {
    const s = summarizeResult({
      matches: [],
      totalMatches: 0,
      suggestions: [
        { id: 'a1', code: '52301', name: 'مصروفات متنوعة', type: 'expense' },
        { id: 'a2', code: '52201', name: 'مصروفات الإيجار', type: 'expense' },
      ],
      suggestionNote: 'اختر أنسب حساب وسجّل عليه.',
    });
    expect(s).toContain('❌ لا توجد نتائج.');
    expect(s).toContain('مصروفات متنوعة');
    expect(s).toContain('52301');
    expect(s).toContain('اختر أنسب حساب وسجّل عليه.');
  });

  it('stays quiet when there is nothing to suggest', () => {
    expect(summarizeResult({ matches: [], totalMatches: 0 })).toBe('❌ لا توجد نتائج.');
  });

  it('still renders normal match tables untouched', () => {
    const s = summarizeResult({
      matches: [{ id: 'c1', name: 'شركة الأمل' }],
      totalMatches: 1,
    });
    expect(s).toContain('شركة الأمل');
    expect(s).not.toContain('لا توجد نتائج');
  });
});
