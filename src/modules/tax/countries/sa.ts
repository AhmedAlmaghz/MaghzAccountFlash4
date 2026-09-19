/**
 * Saudi Arabia — ZATCA (Phase 3 tax profile).
 * Sources of record: ZATCA VAT Implementing Regulation + Fatoorah specs.
 * Standard rate 15% since 1 Jul 2020. Mandatory registration at SAR 375,000
 * (voluntary from 187,500). Monthly filing above SAR 40M annual supplies,
 * otherwise quarterly. E-invoicing mandatory in two phases (generation since
 * Dec 2021; integration waves by turnover since Jan 2023).
 */
import type { CountryTaxProfile } from '../types';

export const saProfile: CountryTaxProfile = {
  countryCode: 'SA',
  countryNameAr: 'المملكة العربية السعودية',
  countryNameEn: 'Saudi Arabia',
  timezone: 'Asia/Riyadh',
  vat: {
    standard: 0.15,
    reduced: [],
    zeroRated: ['الصادرات خارج الخليج', 'النقل الدولي', 'الأدوية والمعدات الطبية المؤهلة', 'الذهب والفضة والبلاتين الاستثماري'],
    exempt: ['الخدمات المالية', 'التأجير السكني', 'الرعاية الصحية المؤهلة', 'التعليم الأهلي المؤهل'],
  },
  registration: {
    mandatoryThreshold: 375000,
    voluntaryThreshold: 187500,
    currency: 'SAR',
  },
  filing: {
    frequencies: ['monthly', 'quarterly'],
    defaultFrequencyNote: 'شهرية لمن تجاوزت توريداته السنوية 40 مليون ريال، وربع سنوية لغيرهم',
  },
  eInvoicing: {
    required: true,
    phases: 'المرحلة 1 (الإصدار) إلزامية منذ ديسمبر 2021 — المرحلة 2 (الربط) موجات حسب الإيرادات منذ يناير 2023',
    documentRequirements: [
      'seller-vat-number',
      'invoice-timestamp',
      'vat-breakdown',
      'sequential-counter',
    ],
  },
  notes: [
    'الفواتير المبسطة (B2C) تتطلب رمز QR؛ الفواتير الضريبية (B2B) تتطلب الرقم الضريبي للمشتري.',
    'الغرامات والفوائد على التأخير يحددها نظام ضريبة القيمة المضافة ولائحته.',
  ],
  validateDocument: (doc) => {
    const issues: string[] = [];
    if (!doc.sellerTaxNumber) issues.push('missing-seller-vat-number');
    if (!doc.date) issues.push('missing-invoice-timestamp');
    if (doc.totalAmount <= 0) issues.push('non-positive-total');
    const expected = Math.round(doc.subtotal * 0.15 * 100) / 100;
    if (Math.abs(doc.vatAmount - expected) > 0.02 && doc.vatAmount > 0) {
      issues.push('vat-not-15pct-of-net');
    }
    return issues;
  },
};
