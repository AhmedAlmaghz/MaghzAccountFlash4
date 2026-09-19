/**
 * United Arab Emirates — FTA (Phase 3 tax profile).
 * Standard rate 5% since 1 Jan 2018. Mandatory registration at AED 375,000
 * (voluntary from 187,500). Standard tax period is quarterly (monthly for
 * large businesses on FTA assignment). E-invoicing (Peppol-based) announced
 * with phased rollout — not yet mandatory at the time of writing.
 */
import type { CountryTaxProfile } from '../types';

export const aeProfile: CountryTaxProfile = {
  countryCode: 'AE',
  countryNameAr: 'الإمارات العربية المتحدة',
  countryNameEn: 'United Arab Emirates',
  timezone: 'Asia/Dubai',
  vat: {
    standard: 0.05,
    reduced: [],
    zeroRated: ['الصادرات', 'النقل الدولي', 'الذهب الاستثماري', 'العقارات السكنية الجديدة (3 سنوات)', 'التعليم والرعاية الصحية المؤهلة'],
    exempt: ['الخدمات المالية', 'العقارات السكنية (إعادة البيع/التأجير)', 'النقل المحلي للركاب'],
  },
  registration: {
    mandatoryThreshold: 375000,
    voluntaryThreshold: 187500,
    currency: 'AED',
  },
  filing: {
    frequencies: ['quarterly', 'monthly'],
    defaultFrequencyNote: 'ربع سنوية افتراضياً — شهرية بقرار من الهيئة للمنشآت الكبيرة',
  },
  eInvoicing: {
    required: false,
    phases: 'الفوترة الإلكترونية (Peppol) معلنة بتطبيق مرحلي — ليست إلزامية بعد حتى تاريخ كتابة هذا الملف',
    documentRequirements: ['seller-trn', 'invoice-timestamp', 'vat-breakdown'],
  },
  notes: [
    'ضريبة الشركات 9% مطبقة منذ يونيو 2023 — خارج نطاق محرك ضريبة القيمة المضافة (تُعامل كامتداد مستقبلي).',
    'الرقم الضريبي (TRN) من 15 رقماً إلزامي على الفواتير الضريبية.',
  ],
  validateDocument: (doc) => {
    const issues: string[] = [];
    if (!doc.sellerTaxNumber) issues.push('missing-seller-trn');
    if (!doc.date) issues.push('missing-invoice-timestamp');
    if (doc.totalAmount <= 0) issues.push('non-positive-total');
    const expected = Math.round(doc.subtotal * 0.05 * 100) / 100;
    if (Math.abs(doc.vatAmount - expected) > 0.02 && doc.vatAmount > 0) {
      issues.push('vat-not-5pct-of-net');
    }
    return issues;
  },
};
