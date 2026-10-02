import { describe, it, expect } from 'vitest';
import { summarizeResult } from './resultCards';

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

  it('carries the default creation tip when nothing specific is suggested', () => {
    // صفر نتائج بلا اقتراح مخصص يقترح أداة الإنشاء أو السؤال — لا بحث أبدِ
    // (الجلسة 2026-09-14: 15 بحثاً عن "كنافة" دون اقتراح إنشاء).
    const s = summarizeResult({ matches: [], totalMatches: 0 });
    expect(s).toContain('❌ لا توجد نتائج.');
    expect(s).toContain('أداة الإنشاء');
    expect(s).toContain('أتريد إنشاءه؟');
  });

  it('still renders normal match tables untouched', () => {
    const s = summarizeResult({
      matches: [{ id: 'c1', name: 'شركة الأمل' }],
      totalMatches: 1,
    });
    expect(s).toContain('شركة الأمل');
    expect(s).not.toContain('لا توجد نتائج');
  });

  it('never emits [object Object] for stat payloads with detail arrays (live 2026-10-02)', () => {
    const s = summarizeResult({
      total: 10,
      products: [
        { code: 'PRD-0001', name: 'شوكلاتة صغير' },
        { code: 'PRD-0002', name: 'شوكلاتة كبير' },
      ],
    });
    expect(s).not.toContain('[object Object]');
    expect(s).toContain('شوكلاتة صغير');
  });

  it('never emits [object Object] for plain arrays of objects', () => {
    const s = summarizeResult([{ a: 1 }, { b: 2 }]);
    expect(s).not.toContain('[object Object]');
  });

  it('renders totals beside detail rows as counts, not currency (live 2026-10-02)', () => {
    const s = summarizeResult({
      total: 4,
      invoices: [
        { number: 'PINV-0001', total: 100 },
        { number: 'PINV-0002', total: 200 },
      ],
    });
    expect(s).toContain('عدد النتائج: 4');
    expect(s).not.toMatch(/الإجمالي: ٤/);
  });

  it('still renders money totals with currency when no detail rows exist', () => {
    const s = summarizeResult({ total: 1500 });
    expect(s).toContain('ر.ي');
  });
});
