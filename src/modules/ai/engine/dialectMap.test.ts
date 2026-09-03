import { describe, it, expect } from 'vitest';
import { expandDialectText, canonicalPaymentMethod } from './dialectMap';

/**
 * Dialect contracts: a Yemeni/Gulf/Egyptian user phrase must land on the
 * CANONICAL vocabulary before anything downstream (entity resolution, tools,
 * the model) reads it — and payment words must map deterministically onto the
 * paymentMethod enum.
 */
describe('expandDialectText', () => {
  it('rewrites Yemeni e-wallet phrases to the canonical term', () => {
    const { text, changed } = expandDialectText('ادفع من محفظة جيب مبلغ 5000');
    expect(text).toContain('حوالة إلكترونية (bank)');
    expect(changed.length).toBeGreaterThan(0);
  });

  it('rewrites Egyptian discount words (كسر) to خصم', () => {
    const { text } = expandDialectText('اعمل الفاتورة بكسر في السعر عشرة بالمية');
    expect(text).toContain('خصم');
    expect(text).not.toMatch(/(?<![\u0600-\u06FF])كسر(?![\u0600-\u06FF])/);
  });

  it('rewrites Egyptian إيصال to سند قبض', () => {
    const { text } = expandDialectText('اطبع لي الإيصال الأخير للعميل');
    // "الإيصال" — the el- prefix is glued; standalone form matches
    expect(text).not.toContain('إيصال ');
  });

  it('tolerates orthography variants (ة/ه، أ/ا) in dialect words', () => {
    // "محفظه جيب" with teh-marbuta instead of teh — folds to the same match
    const { text } = expandDialectText('حوّل عبر محفظه جيب');
    expect(text).toContain('حوالة إلكترونية');
  });

  it('never replaces mid-word (Arabic-letter lookarounds)', () => {
    // "صراف" must not hit inside "منصراف" or a name containing it as a substring
    const { text } = expandDialectText('الشركة المنصرافية للتجارة');
    expect(text).toBe('الشركة المنصرافية للتجارة');
  });

  it('leaves canonical text untouched (changed stays empty)', () => {
    const { text, changed } = expandDialectText('أنشئ فاتورة مبيعات لعميل شركة الأمل بخصم 5%');
    expect(changed).toEqual([]);
    expect(text).toContain('فاتورة مبيعات');
  });

  it('handles empty/null gracefully', () => {
    expect(expandDialectText('')).toEqual({ text: '', changed: [] });
  });
});

describe('canonicalPaymentMethod', () => {
  it('maps Yemeni wallet phrases to bank', () => {
    expect(canonicalPaymentMethod('حوالة عبر المنصة')).toBe('bank');
    expect(canonicalPaymentMethod('محفظة جيب')).toBe('bank');
    expect(canonicalPaymentMethod('دفع عبر كريم')).toBe('bank');
  });

  it('maps Gulf money words', () => {
    expect(canonicalPaymentMethod('الصراف')).toBe('cash');
    expect(canonicalPaymentMethod('فلوس حاضرة')).toBe('cash');
  });

  it('maps Egyptian and standard words', () => {
    expect(canonicalPaymentMethod('كاش')).toBe('cash');
    expect(canonicalPaymentMethod('نقداً')).toBe('cash');
    expect(canonicalPaymentMethod('شيك رقم 12345')).toBe('check');
  });

  it('returns null when no payment word present', () => {
    expect(canonicalPaymentMethod('فاتورة آجلة للعميل')).toBeNull();
    expect(canonicalPaymentMethod('')).toBeNull();
  });

  it('prioritizes deterministically when several words appear', () => {
    // "نقدي" wins (checked first) over a later "بنك" mention
    expect(canonicalPaymentMethod('ادفع نقدي من حساب البنك')).toBe('cash');
  });
});
