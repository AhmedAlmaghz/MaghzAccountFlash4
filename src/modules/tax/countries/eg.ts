/**
 * Egypt — ETA (Phase 3 tax profile).
 * Standard VAT 14% + schedule (table) tax on listed goods/services + 0%
 * exports. Registration threshold EGP 500,000. Monthly filing. E-invoicing
 * via the ETA portal is MANDATORY (phased since 2020, fully enforced).
 */
import type { CountryTaxProfile } from '../types';

export const egProfile: CountryTaxProfile = {
  countryCode: 'EG',
  countryNameAr: 'جمهورية مصر العربية',
  countryNameEn: 'Egypt',
  timezone: 'Africa/Cairo',
  vat: {
    standard: 0.14,
    reduced: [
      { rate: 0.05, scope: 'آلات ومعدات الإنتاج' },
    ],
    zeroRated: ['الصادرات', 'السلع والخدمات للمناطق الحرة والاقتصادية بشروط'],
    exempt: ['قائمة السلع المعفاة (57 مجموعة — الألبان والخبز والأدوية وغيرها)', 'الخدمات المالية والمصرفية', 'التعليم والصحة'],
  },
  registration: {
    mandatoryThreshold: 500000,
    voluntaryThreshold: 500000,
    currency: 'EGP',
  },
  filing: {
    frequencies: ['monthly'],
    defaultFrequencyNote: 'إقرار شهري يقدم خلال الشهر التالي لانتهاء الفترة',
  },
  eInvoicing: {
    required: true,
    phases: 'منظومة الفاتورة الإلكترونية إلزامية بالكامل عبر بوابة مصلحة الضرائب (توقيع إلكتروني + تكويد GS1/EGS)',
    documentRequirements: [
      'seller-tax-number',
      'einvoice-uuid',
      'digital-signature',
      'item-coding',
      'invoice-timestamp',
    ],
  },
  notes: [
    'ضريبة الجدول تُفرض مع/بدون ضريبة القيمة المضافة حسب السلعة — تُعامل كامتداد (سطر ضريبي إضافي) لا كجزء من هذا المحرك الأساسي.',
    'الخصم من المنبع (withholding) مطبق بنسب متفاوتة (1%/3%/5%) — امتداد مستقبلي.',
  ],
  validateDocument: (doc) => {
    const issues: string[] = [];
    if (!doc.sellerTaxNumber) issues.push('missing-seller-tax-number');
    if (!doc.date) issues.push('missing-invoice-timestamp');
    if (doc.totalAmount <= 0) issues.push('non-positive-total');
    const expected = Math.round(doc.subtotal * 0.14 * 100) / 100;
    if (Math.abs(doc.vatAmount - expected) > 0.02 && doc.vatAmount > 0) {
      issues.push('vat-not-14pct-of-net');
    }
    return issues;
  },
};
