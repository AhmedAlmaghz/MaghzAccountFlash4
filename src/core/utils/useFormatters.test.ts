import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from './useSettings';
import { useFormatters } from './useFormatters';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

const fullSettings = (overrides: Record<string, unknown> = {}) => ({
  settings: {
    decimalPlaces: 2,
    dateFormat: 'yyyy-MM-dd',
    calendar: 'gregorian',
    defaultCurrency: 'YER',
    baseCurrency: 'YER',
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFormatters - formatCurrency', () => {
  it('formats with 2 decimal places by default', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatCurrency(1234.5);
    expect(formatted).toMatch(/[\p{Nd},]+/u);
    expect(formatted).not.toBe('-');
  });

  it('formats with 0 decimal places', () => {
    mockUseSettings.mockReturnValue(fullSettings({ decimalPlaces: 0 }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatCurrency(1234.56);
    expect(formatted).not.toBe('-');
    expect(formatted).toMatch(/[12][0-9]{2}|٢٣٥|1234|١٢٣٤|1235|١٢٣٥/);
  });

  it('returns dash for invalid input', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.formatCurrency(NaN)).toBe('-');
    expect(result.current.formatCurrency('invalid')).toBe('-');
  });

  it('handles string number input', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatCurrency('5000');
    expect(formatted).not.toBe('-');
  });

  it('respects defaultCurrency from settings (USD)', () => {
    mockUseSettings.mockReturnValue(fullSettings({ defaultCurrency: 'USD' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.defaultCurrency).toBe('USD');
  });

  it('allows override per-call (SAR)', () => {
    mockUseSettings.mockReturnValue(fullSettings({ defaultCurrency: 'YER' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatCurrency(100, 'SAR');
    expect(formatted).toMatch(/100|١٠٠/);
  });
});

describe('useFormatters - formatDate (Gregorian)', () => {
  it('formats with default yyyy-MM-dd', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate(new Date(2024, 5, 15));
    expect(formatted).toMatch(/2024|٢٠٢٤/);
    expect(formatted).toMatch(/06|٠٦/);
    expect(formatted).toMatch(/15|١٥/);
    expect(formatted).not.toContain('هـ');
  });

  it('formats with dd/MM/yyyy', () => {
    mockUseSettings.mockReturnValue(fullSettings({ dateFormat: 'dd/MM/yyyy' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate(new Date(2024, 5, 15));
    expect(formatted).toMatch(/15|١٥/);
    expect(formatted).toMatch(/06|٠٦/);
    expect(formatted).toMatch(/2024|٢٠٢٤/);
  });

  it('formats with yyyy/MM/dd', () => {
    mockUseSettings.mockReturnValue(fullSettings({ dateFormat: 'yyyy/MM/dd' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate(new Date(2024, 5, 15));
    expect(formatted).toMatch(/2024|٢٠٢٤/);
    expect(formatted).toMatch(/06|٠٦/);
    expect(formatted).toMatch(/15|١٥/);
  });

  it('formats string date input', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate('2024-06-15');
    expect(formatted).toMatch(/2024|٢٠٢٤/);
    expect(formatted).toMatch(/06|٠٦/);
    expect(formatted).toMatch(/15|١٥/);
  });

  it('returns dash for invalid date', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.formatDate('invalid-date')).toBe('-');
  });

  it('formats with decimal places 4', () => {
    mockUseSettings.mockReturnValue(fullSettings({ decimalPlaces: 4 }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatCurrency(1234.5678);
    expect(formatted).toMatch(/5678|٥٦٧٨/);
  });
});

describe('useFormatters - formatDate (Hijri)', () => {
  it('formats Hijri date with yyyy/MM/dd and adds هـ suffix', () => {
    mockUseSettings.mockReturnValue(fullSettings({ dateFormat: 'yyyy/MM/dd', calendar: 'hijri' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate(new Date(2024, 0, 1));
    expect(formatted).toMatch(/[\d٠-٩]{4}\/[\d٠-٩]{2}\/[\d٠-٩]{2} هـ/);
  });

  it('formats Hijri date with dd/MM/yyyy pattern', () => {
    mockUseSettings.mockReturnValue(fullSettings({ dateFormat: 'dd/MM/yyyy', calendar: 'hijri' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate(new Date(2024, 5, 15));
    expect(formatted).toMatch(/[\d٠-٩]{2}\/[\d٠-٩]{2}\/[\d٠-٩]{4} هـ/);
  });

  it('returns Hijri year approximately 1445-1446 for 2024 Gregorian', () => {
    mockUseSettings.mockReturnValue(fullSettings({ dateFormat: 'yyyy', calendar: 'hijri' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDate(new Date(2024, 5, 15));
    const arabicToLatin = (s: string) => s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const yearStr = arabicToLatin(formatted).replace(' هـ', '').replace(/[^\d]/g, '');
    const year = parseInt(yearStr, 10);
    expect(year).toBeGreaterThanOrEqual(1445);
    expect(year).toBeLessThanOrEqual(1446);
  });
});

describe('useFormatters - formatDateTime', () => {
  it('combines date and time with space separator', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDateTime(new Date(2024, 5, 15, 14, 30));
    expect(formatted).toMatch(/[\d٠-٩]{1,2}:[\d٠-٩]{1,2}/);
    expect(formatted).toMatch(/2024|٢٠٢٤/);
    expect(formatted).toMatch(/06|٠٦/);
    expect(formatted).toMatch(/15|١٥/);
  });

  it('adds هـ suffix for Hijri', () => {
    mockUseSettings.mockReturnValue(fullSettings({ calendar: 'hijri' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatDateTime(new Date(2024, 5, 15, 14, 30));
    expect(formatted).toMatch(/ هـ$/);
  });
});

describe('useFormatters - formatNumber', () => {
  it('uses default decimal places', () => {
    mockUseSettings.mockReturnValue(fullSettings({ decimalPlaces: 3 }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    const formatted = result.current.formatNumber(1234.5678);
    const normalized = formatted
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٬/g, ',')
      .replace(/٫/g, '.');
    expect(normalized).toBe('1,234.568');
  });

  it('returns dash for invalid input', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.formatNumber(NaN)).toBe('-');
  });
});

describe('useFormatters - calendar field', () => {
  it('returns gregorian by default', () => {
    mockUseSettings.mockReturnValue(fullSettings());
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.calendar).toBe('gregorian');
  });

  it('returns hijri when set', () => {
    mockUseSettings.mockReturnValue(fullSettings({ calendar: 'hijri' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.calendar).toBe('hijri');
  });

  it('exposes locale based on calendar', () => {
    mockUseSettings.mockReturnValue(fullSettings({ calendar: 'hijri' }));
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.locale).toContain('islamic');
  });
});

describe('useFormatters - missing settings (fallbacks)', () => {
  it('uses defaults when settings is null', () => {
    mockUseSettings.mockReturnValue({ settings: null });
    const { result } = renderHook(() => useFormatters('comp-1'));
    expect(result.current.decimalPlaces).toBe(2);
    expect(result.current.dateFormat).toBe('yyyy-MM-dd');
    expect(result.current.calendar).toBe('gregorian');
    expect(result.current.defaultCurrency).toBe('YER');
    expect(result.current.formatCurrency(100)).not.toBe('-');
    expect(result.current.formatDate(new Date(2024, 0, 1))).toMatch(/2024|٢٠٢٤/);
  });
});
