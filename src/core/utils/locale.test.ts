import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/store', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    })),
  },
}));

import { useAppStore } from '@/core/store';
import { DEFAULT_LOCALE, formatNumber, formatCurrencyValue, formatDateValue, formatDateTime, getCompanyDecimalPlaces, roundMoney } from './locale';

const mockUseAppStore = useAppStore as unknown as { getState: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mockUseAppStore.getState.mockReturnValue({
    activeCompany: {
      id: 'c-1',
      decimalPlaces: 2,
      dateFormat: 'yyyy-MM-dd',
      calendar: 'gregorian',
      currency: 'YER',
    },
  });
});

describe('locale utility', () => {
  it('exports DEFAULT_LOCALE as ar-YE', () => {
    expect(DEFAULT_LOCALE).toBe('ar-YE');
  });

  it('formatNumber uses default locale', () => {
    const result = formatNumber(1234.5);
    expect(result).toMatch(/[\d,.]*/);
    expect(result).not.toBe('-');
  });

  it('formatNumber respects decimalPlaces from settings', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 4,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatNumber(1234.56789);
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٬/g, ',')
      .replace(/٫/g, '.');
    expect(normalized).toBe('1,234.5679');
  });

  it('formatNumber returns - for NaN', () => {
    expect(formatNumber('not a number')).toBe('-');
    expect(formatNumber(NaN)).toBe('-');
  });

  it('formatCurrencyValue includes currency symbol', () => {
    const result = formatCurrencyValue(1000, 'YER');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٬/g, ',')
      .replace(/٫/g, '.');
    expect(normalized).toMatch(/1,000|YER|ر.ي/);
  });

  it('formatCurrencyValue uses default currency from settings', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'SAR',
      },
    });
    const result = formatCurrencyValue(500);
    expect(result).toMatch(/SAR|ر.س|500/);
  });

  it('formatDateValue returns formatted date', () => {
    const result = formatDateValue('2026-01-15T10:30:00Z');
    expect(result).toMatch(/2026|٢٠٢٦/);
    expect(result).toMatch(/01|٠١/);
  });

  it('formatDateValue uses Hijri calendar when set', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'hijri',
        currency: 'YER',
      },
    });
    const result = formatDateValue('2024-06-15T10:30:00Z');
    expect(result).toMatch(/1445|١٤٤٥|1446|١٤٤٦/);
  });

  it('formatDateTime includes time component', () => {
    // The instant 2026-01-15T10:30:00Z renders at different local hours per
    // machine zone (GMT+3 → 13:30, UTC → 10:30), and Intl may use a 12- or
    // 24-hour cycle per ICU data — so derive the expectation from the local
    // components and accept either cycle (digits normalized like the other
    // tests in this file).
    const d = new Date('2026-01-15T10:30:00Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const latin = (s: string) =>
      s.replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
    const result = latin(formatDateTime(d));
    const h24 = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const h12raw = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    const h12 = `${pad(h12raw)}:${pad(d.getMinutes())}`;
    expect(result.includes(h24) || result.includes(h12)).toBe(true);
  });

  it('formatDateTime uses Hijri when set', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'hijri',
        currency: 'YER',
      },
    });
    const result = formatDateTime('2024-06-15T10:30:00Z');
    expect(result).toMatch(/1445|١٤٤٥|1446|١٤٤٦/);
  });

  it('all functions accept custom locale override', () => {
    const en = formatNumber(1234.5, 'en-US');
    const normalized = en.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٬/g, ',')
      .replace(/٫/g, '.');
    expect(normalized).toBe('1,234.50');
  });

  it('returns - when no active company and invalid input', () => {
    mockUseAppStore.getState.mockReturnValue({ activeCompany: null });
    expect(formatNumber('not a number')).toBe('-');
    expect(formatDateValue('not a date')).toBe('-');
  });

  it('formatDateValue respects dd/MM/yyyy dateFormat pattern', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'dd/MM/yyyy',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateValue('2026-01-15T10:30:00Z');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toBe('15/01/2026');
  });

  it('formatDateValue respects yyyy/MM/dd dateFormat pattern', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy/MM/dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateValue('2026-01-15T10:30:00Z');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toBe('2026/01/15');
  });

  it('formatDateValue respects dd-MM-yyyy dateFormat pattern', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'dd-MM-yyyy',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateValue('2026-01-15T10:30:00Z');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toBe('15-01-2026');
  });

  it('formatDateValue respects yyyy-MM-dd dateFormat pattern', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateValue('2026-01-15T10:30:00Z');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toBe('2026-01-15');
  });

  it('formatDateValue handles Date object input', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateValue(new Date('2026-01-15T10:30:00Z'));
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toBe('2026-01-15');
  });

  it('formatDateTime respects dd/MM/yyyy dateFormat pattern', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'dd/MM/yyyy',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateTime('2026-01-15T10:30:00Z');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toMatch(/^15\/01\/2026 \d{2}:\d{2}$/);
  });

  it('formatDateTime respects yyyy-MM-dd dateFormat pattern with time', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    const result = formatDateTime('2026-01-15T10:30:00Z');
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    expect(normalized).toMatch(/^2026-01-15 \d{2}:\d{2}$/);
  });

  it('formatDateValue returns - for invalid Date', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    expect(formatDateValue('invalid-date')).toBe('-');
    expect(formatDateValue(new Date('invalid'))).toBe('-');
  });

  it('formatDateTime returns - for invalid Date', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: {
        id: 'c-1',
        decimalPlaces: 2,
        dateFormat: 'yyyy-MM-dd',
        calendar: 'gregorian',
        currency: 'YER',
      },
    });
    expect(formatDateTime('invalid-date')).toBe('-');
  });

  it('getCompanyDecimalPlaces honors an explicit 0 (whole-unit display)', () => {
    mockUseAppStore.getState.mockReturnValue({ activeCompany: { id: 'c-1', decimalPlaces: 0 } });
    expect(getCompanyDecimalPlaces()).toBe(0);
  });

  it('getCompanyDecimalPlaces falls back to 2 when unset and clamps to 0-6', () => {
    mockUseAppStore.getState.mockReturnValue({ activeCompany: null });
    expect(getCompanyDecimalPlaces()).toBe(2);
    mockUseAppStore.getState.mockReturnValue({ activeCompany: { id: 'c-1' } });
    expect(getCompanyDecimalPlaces()).toBe(2);
    mockUseAppStore.getState.mockReturnValue({ activeCompany: { id: 'c-1', decimalPlaces: 9 } });
    expect(getCompanyDecimalPlaces()).toBe(6);
    mockUseAppStore.getState.mockReturnValue({ activeCompany: { id: 'c-1', decimalPlaces: -3 } });
    expect(getCompanyDecimalPlaces()).toBe(0);
  });

  it('formatNumber renders zero decimals when the company sets 0', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: { id: 'c-1', decimalPlaces: 0, dateFormat: 'yyyy-MM-dd', calendar: 'gregorian', currency: 'YER' },
    });
    const result = formatNumber(1234.56);
    const normalized = result.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٬/g, ',')
      .replace(/٫/g, '.');
    expect(normalized).toBe('1,235');
  });

  it('formatCurrencyValue renders zero decimals when the company sets 0', () => {
    mockUseAppStore.getState.mockReturnValue({
      activeCompany: { id: 'c-1', decimalPlaces: 0, dateFormat: 'yyyy-MM-dd', calendar: 'gregorian', currency: 'YER' },
    });
    const result = formatCurrencyValue(1234.56, 'USD', 'en-US');
    expect(result).toBe('$1,235');
  });

  it('roundMoney rounds to company decimals including 0', () => {
    mockUseAppStore.getState.mockReturnValue({ activeCompany: { id: 'c-1', decimalPlaces: 0 } });
    expect(roundMoney(1234.56)).toBe(1235);
    expect(roundMoney(100.4)).toBe(100);
    mockUseAppStore.getState.mockReturnValue({ activeCompany: { id: 'c-1', decimalPlaces: 2 } });
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1234.567, 0)).toBe(1235);
  });
});
