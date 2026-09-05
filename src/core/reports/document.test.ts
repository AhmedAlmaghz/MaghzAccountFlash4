import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/store', () => ({
  useAppStore: {
    getState: vi.fn(() => ({ activeCompany: { id: 'c-1', decimalPlaces: 2 } })),
  },
}));

import { buildReportHtml } from './document';
import type { ReportSpec } from './types';

function makeSpec(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return {
    columns: [
      { key: 'name', header: 'الاسم' },
      { key: 'amount', header: 'المبلغ', format: 'money', align: 'end' },
    ],
    rows: [
      { name: 'بند أ', amount: 1500.5 },
      { name: 'بند ب', amount: 250 },
    ],
    meta: { title: 'تقرير اختبار', subtitle: 'سطر فرعي', periodLabel: 'الفترة: 2026' },
    branding: {
      companyName: 'شركة الاختبار',
      taxNumber: '123',
      currency: 'YER',
      logoUrl: 'data:image/png;base64,AAA',
    },
    filename: 'test-report',
    ...overrides,
  };
}

describe('buildReportHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a standalone RTL Arabic document with branding', () => {
    const html = buildReportHtml(makeSpec());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('تقرير اختبار');
    expect(html).toContain('شركة الاختبار');
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('الرقم الضريبي: 123');
    expect(html).toContain('الفترة: 2026');
  });

  it('renders rows, human numbers, and totals', () => {
    const html = buildReportHtml(makeSpec({
      totals: { label: 'الإجمالي', values: { amount: 1750.5 } },
    }));
    expect(html).toContain('بند أ');
    expect(html).toContain('١٬٧٥٠٫٥٠');
    expect(html).toContain('الإجمالي');
    expect(html).toContain('<tfoot>');
  });

  it('renders LTR English documents', () => {
    const html = buildReportHtml(makeSpec({
      rows: [],
      meta: { title: 'Test Report', direction: 'ltr' },
      branding: { companyName: 'Test Co', currency: 'USD' },
    }));
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('No data');
  });

  it('renders an empty state when there are no rows', () => {
    const html = buildReportHtml(makeSpec({ rows: [] }));
    expect(html).toContain('لا توجد بيانات');
  });

  it('escapes XSS in headers, cells, and branding', () => {
    const html = buildReportHtml(makeSpec({
      columns: [{ key: 'x', header: '<script>alert(1)</script>' }],
      rows: [{ x: '<img src=x onerror=alert(1)>' }],
      branding: { companyName: '<svg onload=alert(1)>', currency: 'YER' },
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<svg onload');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a logo fallback when no logoUrl is set', () => {
    const html = buildReportHtml(makeSpec({ branding: { companyName: 'شركة الاختبار', currency: 'YER' } }));
    expect(html).toContain('logo-fallback');
  });
});
