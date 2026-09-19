/**
 * Yemen — default profile (Phase 3 tax profile).
 * No VAT regime: Yemeni companies run VAT-free documents by default. The
 * profile keeps the engine total (rate 0, no filing) so multi-country code
 * never special-cases "no tax" — it is simply a zero-rate profile.
 */
import type { CountryTaxProfile } from '../types';

export const yeProfile: CountryTaxProfile = {
  countryCode: 'YE',
  countryNameAr: 'الجمهورية اليمنية',
  countryNameEn: 'Yemen',
  timezone: 'Asia/Aden',
  vat: {
    standard: 0,
    reduced: [],
    zeroRated: [],
    exempt: ['جميع التوريدات — لا يوجد نظام ضريبة قيمة مضافة'],
  },
  registration: {
    mandatoryThreshold: 0,
    voluntaryThreshold: 0,
    currency: 'YER',
  },
  filing: {
    frequencies: [],
    defaultFrequencyNote: 'لا توجد إقرارات ضريبة قيمة مضافة في اليمن',
  },
  eInvoicing: {
    required: false,
    phases: 'لا يوجد نظام فوترة إلكترونية حكومي',
    documentRequirements: [],
  },
  notes: [
    'ضريبة المبيعات العامة اليمنية خارج نطاق هذا المحرك — تُعامل كامتداد مستقبلي عند الحاجة.',
  ],
  validateDocument: (doc) => {
    const issues: string[] = [];
    if (doc.totalAmount <= 0) issues.push('non-positive-total');
    if (doc.vatAmount > 0) issues.push('vat-charged-under-zero-rate-profile');
    return issues;
  },
};
