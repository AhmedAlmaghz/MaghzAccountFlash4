import { describe, it, expect } from 'vitest';
import {
  YER_CODE,
  getCurrency,
  getDefaultCurrency,
  getActiveCurrencies,
  convertAmount,
  convertToBase,
  convertFromBase,
  formatWithSymbol,
  formatYer,
  getBaseCurrencyConversion,
  summarizeMultiCurrency,
} from './currencyConverter';
import type { Currency } from '@/modules/core/types';

function ccy(code: string, rate: number, opts: { symbol?: string; isDefault?: boolean; isActive?: boolean } = {}): Currency {
  return {
    id: `id-${code}`,
    companyId: 'c-1',
    code,
    name: code,
    symbol: opts.symbol ?? code,
    exchangeRate: rate,
    isDefault: opts.isDefault ?? false,
    isActive: opts.isActive ?? true,
  };
}

describe('getCurrency', () => {
  const list: Currency[] = [ccy('YER', 1, { isDefault: true }), ccy('USD', 250), ccy('SAR', 66.67)];

  it('returns the matching currency', () => {
    expect(getCurrency(list, 'USD')?.code).toBe('USD');
  });

  it('returns null for unknown code', () => {
    expect(getCurrency(list, 'EUR')).toBeNull();
  });

  it('returns null for null/undefined code', () => {
    expect(getCurrency(list, null)).toBeNull();
    expect(getCurrency(list, undefined)).toBeNull();
  });
});

describe('getDefaultCurrency', () => {
  it('returns the isDefault currency', () => {
    const list = [ccy('USD', 1), ccy('YER', 250, { isDefault: true })];
    expect(getDefaultCurrency(list)?.code).toBe('YER');
  });

  it('falls back to first currency if none is default', () => {
    const list = [ccy('USD', 1), ccy('YER', 250)];
    expect(getDefaultCurrency(list)?.code).toBe('USD');
  });

  it('returns null for empty list', () => {
    expect(getDefaultCurrency([])).toBeNull();
  });
});

describe('getActiveCurrencies', () => {
  it('filters out inactive currencies', () => {
    const list = [ccy('YER', 1, { isActive: true }), ccy('USD', 250, { isActive: false })];
    expect(getActiveCurrencies(list).map((c) => c.code)).toEqual(['YER']);
  });
});

describe('convertAmount', () => {
  it('returns same value when converting same currency', () => {
    expect(convertAmount(100, 1, 1)).toBe(100);
  });

  it('converts 10 USD at rate 1500 to 15,000 YER at rate 1', () => {
    expect(convertAmount(10, 1500, 1)).toBe(15000);
  });

  it('converts 10 USD at rate 1500 to 40 SAR at rate 400 (via YER base)', () => {
    expect(convertAmount(10, 1500, 400)).toBeCloseTo(37.5, 5);
  });

  it('handles invalid value', () => {
    expect(convertAmount(NaN, 1, 250)).toBe(0);
    expect(convertAmount(Infinity, 1, 250)).toBe(0);
  });

  it('handles zero rate (returns original)', () => {
    expect(convertAmount(100, 0, 1)).toBe(100);
    expect(convertAmount(100, 1, 0)).toBe(100);
  });
});

describe('convertToBase / convertFromBase', () => {
  it('convertToBase multiplies by rate (10 USD * 1500 YER/USD = 15000 YER)', () => {
    expect(convertToBase(10, 1500)).toBe(15000);
  });

  it('convertFromBase divides by rate (15000 YER / 1500 YER/USD = 10 USD)', () => {
    expect(convertFromBase(15000, 1500)).toBe(10);
  });
});

describe('formatWithSymbol', () => {
  it('formats with symbol when available', () => {
    const usd = ccy('USD', 1, { symbol: '$' });
    expect(formatWithSymbol(1234.5, usd)).toMatch(/\$ 1,234\.50/);
  });

  it('falls back to code when no symbol', () => {
    const c = ccy('EUR', 1, { symbol: '' });
    expect(formatWithSymbol(100, c)).toMatch(/100\.00 EUR/);
  });

  it('returns dash for invalid input', () => {
    expect(formatWithSymbol(NaN, null)).toBe('-');
  });

  it('returns formatted number when no currency provided', () => {
    expect(formatWithSymbol(100, null)).toMatch(/100\.00/);
  });
});

describe('formatYer', () => {
  it('uses the ر.ي symbol', () => {
    expect(formatYer(1000)).toMatch(/ر\.ي/);
  });

  it('respects decimal places', () => {
    expect(formatYer(100, 0)).toMatch(/100$/);
    expect(formatYer(100, 2)).toMatch(/100\.00$/);
  });
});

describe('getBaseCurrencyConversion', () => {
  const list: Currency[] = [ccy('YER', 1, { isDefault: true }), ccy('USD', 1500)];

  it('returns original value when same as base', () => {
    const r = getBaseCurrencyConversion(100, 'YER', list);
    expect(r.value).toBe(100);
    expect(r.currency?.code).toBe('YER');
  });

  it('converts to base currency (10 USD at 1500 = 15,000 YER)', () => {
    const r = getBaseCurrencyConversion(10, 'USD', list);
    expect(r.value).toBe(15000);
    expect(r.currency?.code).toBe('YER');
  });

  it('returns original when currency not found', () => {
    const r = getBaseCurrencyConversion(100, 'EUR', list);
    expect(r.value).toBe(100);
  });

  it('returns base currency when no from code', () => {
    const r = getBaseCurrencyConversion(100, null, list);
    expect(r.value).toBe(100);
    expect(r.currency?.code).toBe('YER');
  });
});

describe('summarizeMultiCurrency', () => {
  const list: Currency[] = [ccy('YER', 1, { isDefault: true }), ccy('USD', 1500)];

  it('sums multiple currencies into base', () => {
    const r = summarizeMultiCurrency({ YER: 1000, USD: 10 }, list);
    expect(r.total).toBeCloseTo(1000 + 15000, 5);
    expect(r.baseCurrency?.code).toBe('YER');
  });

  it('handles empty input', () => {
    const r = summarizeMultiCurrency({}, list);
    expect(r.total).toBe(0);
  });

  it('preserves byCurrency breakdown', () => {
    const r = summarizeMultiCurrency({ YER: 500, USD: 5 }, list);
    expect(r.byCurrency['YER']).toBe(500);
    expect(r.byCurrency['USD']).toBe(5);
  });
});

describe('YER_CODE constant', () => {
  it('equals "YER"', () => {
    expect(YER_CODE).toBe('YER');
  });
});
