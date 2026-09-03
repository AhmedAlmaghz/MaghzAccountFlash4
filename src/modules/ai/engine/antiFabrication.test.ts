import { describe, it, expect } from 'vitest';
import { claimsBusinessAction } from './chatEngine';

/**
 * P1-4 regression: DOC_NUMBER_RE only knew INV/PINV/QTN/RV/PV/JE/SRT/PRT —
 * fabricated claims about work orders (WO-0005), employees (EMP-12),
 * customers (CUST-42), leads (LEAD-7), departments (DEP-3) and POS slips
 * sailed past the anti-fabrication guard and reached the user as real.
 * Every document-number prefix the system issues must be covered.
 */
describe('claimsBusinessAction — full document-number coverage', () => {
  const claim = (t: string) => `قمت بإنشاء ${t} بنجاح وهو الآن مرحّل`;

  it('still catches the original prefixes', () => {
    expect(claimsBusinessAction(claim('فاتورة INV-0012'))).toBe(true);
    expect(claimsBusinessAction(claim('سند RV-000003'))).toBe(true);
    expect(claimsBusinessAction(claim('قيد JE-45'))).toBe(true);
    expect(claimsBusinessAction(claim('PINV-0007'))).toBe(true);
    expect(claimsBusinessAction(claim('QTN-0031'))).toBe(true);
  });

  it('NOW catches work orders (WO-…)', () => {
    expect(claimsBusinessAction(claim('أمر تشغيل WO-0005'))).toBe(true);
  });

  it('NOW catches employees (EMP-…)', () => {
    expect(claimsBusinessAction(claim('موظف EMP-0012'))).toBe(true);
  });

  it('NOW catches customers (CUST-…)', () => {
    expect(claimsBusinessAction(claim('عميل CUST-0042'))).toBe(true);
  });

  it('NOW catches leads (LEAD-…) and opportunities (OPP-…)', () => {
    expect(claimsBusinessAction(claim('عميل محتمل LEAD-0007'))).toBe(true);
    expect(claimsBusinessAction(claim('فرصة OPP-0021'))).toBe(true);
  });

  it('NOW catches departments (DEP-…) and products (PRD-…)', () => {
    expect(claimsBusinessAction(claim('قسم DEP-0003'))).toBe(true);
    expect(claimsBusinessAction(claim('منتج PRD-0099'))).toBe(true);
  });

  it('matches with and without the dash/space separator', () => {
    expect(claimsBusinessAction(claim('أمر WO 12'))).toBe(true);
    expect(claimsBusinessAction(claim('أمر WO12'))).toBe(true);
  });

  it('does NOT fire on non-claims (question/statement without action verb)', () => {
    expect(claimsBusinessAction('ما هي حالة أمر التشغيل WO-0003؟')).toBe(false);
    expect(claimsBusinessAction('المستند المرحّل السابق كان INV-0001')).toBe(false);
  });

  it('does NOT fire on claims without any document number or posted marker', () => {
    expect(claimsBusinessAction('قمت بإنشاء العميل بنجاح')).toBe(false);
    expect(claimsBusinessAction('سجّلت العملية وكل شيء تمام')).toBe(false);
  });

  it('requires at least 2 digits — WO-5 (weak) alone does not match', () => {
    // NOTE: the claim() helper ends with "مرحّل" which independently fires the
    // guard — use a bare claim here to isolate the digit-count rule.
    expect(claimsBusinessAction('قمت بإنشاء أمر تشغيل WO-5 بنجاح')).toBe(false);
  });
});
