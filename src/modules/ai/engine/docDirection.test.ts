import { describe, it, expect } from 'vitest';
import {
  classifyDirection,
  directionBadge,
  mirrorToolFor,
  normalizePhone,
} from './docDirection';

const COMPANY = {
  name: 'شركة الأمل للتجارة',
  nameEn: 'AlAmal Trading',
  taxNumber: '123456',
  phone: '777123456',
};

describe('classifyDirection', () => {
  it('matches identical tax numbers as same with full confidence', () => {
    const v = classifyDirection({ name: 'جهة أخرى', taxNumber: '123456' }, COMPANY);
    expect(v.direction).toBe('same');
    expect(v.confidence).toBe(1);
    expect(v.matchedOn).toEqual(['taxNumber']);
  });

  it('treats differing tax numbers as external', () => {
    const v = classifyDirection({ name: 'مؤسسة الخير', taxNumber: '999999' }, COMPANY);
    expect(v.direction).toBe('external');
    expect(v.matchedOn).toEqual(['taxNumber']);
  });

  it('asks on name-tax conflict instead of assuming', () => {
    const v = classifyDirection({ name: 'شركة الأمل للتجارة', taxNumber: '999999' }, COMPANY);
    expect(v.direction).toBe('ambiguous');
  });

  it('matches company phones across formats (967/0 prefixes)', () => {
    expect(classifyDirection({ phone: '967777123456' }, COMPANY).direction).toBe('same');
    expect(classifyDirection({ phone: '0777123456' }, COMPANY).direction).toBe('same');
    expect(classifyDirection({ phone: '777123456' }, COMPANY).direction).toBe('same');
  });

  it('matches the company name despite legal suffixes and spelling variants', () => {
    // generic suffix stripped: "للتجارة" must not dilute the match
    expect(classifyDirection({ name: 'شركه الامل' }, COMPANY).direction).toBe('same');
    expect(classifyDirection({ name: 'الأمل للتجارة' }, COMPANY).direction).toBe('same');
    expect(classifyDirection({ nameEn: 'alamal trading' }, COMPANY).direction).toBe('same');
  });

  it('treats a clearly different name as external', () => {
    const v = classifyDirection({ name: 'مؤسسة النور للاستيراد' }, COMPANY);
    expect(v.direction).toBe('external');
  });

  it('matches the distinctive core even as a single token', () => {
    // remainder after generic-strip is exactly the company core
    expect(classifyDirection({ name: 'الأمل' }, COMPANY).direction).toBe('same');
  });

  it('asks on generic-only issuer names (no identifying remainder)', () => {
    const v = classifyDirection({ name: 'للتجارة' }, COMPANY);
    expect(v.direction).toBe('ambiguous');
    expect(v.matchedOn).toEqual(['none']);
  });

  it('asks when no issuer identity exists at all', () => {
    const v = classifyDirection({}, COMPANY);
    expect(v.direction).toBe('ambiguous');
    expect(v.matchedOn).toEqual(['none']);
  });
});

describe('normalizePhone', () => {
  it('strips country code and trunk', () => {
    expect(normalizePhone('+967-777-123-456')).toBe('777123456');
    expect(normalizePhone('0777123456')).toBe('777123456');
    expect(normalizePhone('777123456')).toBe('777123456');
  });
});

describe('mirrorToolFor', () => {
  it('mirrors invoice/voucher/post pairs both ways', () => {
    expect(mirrorToolFor('sales.create_invoice')).toBe('purchases.create_invoice');
    expect(mirrorToolFor('purchases.create_invoice')).toBe('sales.create_invoice');
    expect(mirrorToolFor('accounting.create_receipt_voucher')).toBe('accounting.create_payment_voucher');
    expect(mirrorToolFor('sales.create_and_post_invoice')).toBe('purchases.create_and_post_invoice');
    expect(mirrorToolFor('sales.create_sales_return')).toBe('purchases.create_purchase_return');
  });

  it('returns null when no mirror exists (quotation, expense)', () => {
    expect(mirrorToolFor('sales.create_quotation')).toBeNull();
    expect(mirrorToolFor('accounting.create_expense_voucher')).toBeNull();
    expect(mirrorToolFor('nope.tool')).toBeNull();
  });
});

describe('directionBadge', () => {
  it('badges same/external/ambiguous distinctly', () => {
    expect(directionBadge({ direction: 'same', confidence: 1, matchedOn: ['name'], reason: '' }, 'sales.create_invoice', null))
      .toMatch(/كما هو/);
    expect(directionBadge({ direction: 'external', confidence: 0.9, matchedOn: ['name'], reason: '' }, 'sales.create_invoice', 'مورّد'))
      .toContain('purchases.create_invoice');
    expect(directionBadge({ direction: 'ambiguous', confidence: 0.5, matchedOn: ['name'], reason: 'تشابه' }, 'sales.create_invoice', null))
      .toMatch(/غامض/);
  });
});
