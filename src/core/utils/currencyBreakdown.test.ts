import { describe, it, expect } from 'vitest';
import { buildCurrencyBreakdown } from './currencyBreakdown';
import type { Currency } from '@/modules/core/types';

const CURRENCIES: Currency[] = [
  { id: '1', companyId: 'c1', code: 'YER', name: 'Yemeni Rial', symbol: 'ر.ي', exchangeRate: 1, isDefault: true, isActive: true, decimalPlaces: 2, createdAt: '', updatedAt: '' },
  { id: '2', companyId: 'c1', code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 1500, isDefault: false, isActive: true, decimalPlaces: 2, createdAt: '', updatedAt: '' },
  { id: '3', companyId: 'c1', code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', exchangeRate: 400, isDefault: false, isActive: true, decimalPlaces: 2, createdAt: '', updatedAt: '' },
];

describe('buildCurrencyBreakdown', () => {
  it('returns empty result for empty input', () => {
    const r = buildCurrencyBreakdown([], CURRENCIES);
    expect(r.items).toEqual([]);
    expect(r.totalInBase).toBe(0);
    expect(r.hasMultipleCurrencies).toBe(false);
    expect(r.uniqueCurrencyCount).toBe(0);
  });

  it('groups amounts by currency code', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'USD', amount: 100 },
        { code: 'USD', amount: 200 },
        { code: 'YER', amount: 5000 },
      ],
      CURRENCIES,
    );
    expect(r.items).toHaveLength(2);
    const usd = r.items.find((i) => i.code === 'USD');
    const yer = r.items.find((i) => i.code === 'YER');
    expect(usd?.amount).toBe(300);
    expect(yer?.amount).toBe(5000);
  });

  it('computes base equivalent using exchange rate', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'USD', amount: 100 },
        { code: 'YER', amount: 5000 },
      ],
      CURRENCIES,
    );
    const usd = r.items.find((i) => i.code === 'USD')!;
    const yer = r.items.find((i) => i.code === 'YER')!;
    expect(usd.baseEquivalent).toBe(150000);
    expect(yer.baseEquivalent).toBe(5000);
  });

  it('sums totalInBase in base currency (YER)', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'USD', amount: 10 },
        { code: 'SAR', amount: 100 },
      ],
      CURRENCIES,
    );
    expect(r.totalInBase).toBe(10 * 1500 + 100 * 400);
  });

  it('detects multiple currencies', () => {
    const single = buildCurrencyBreakdown([{ code: 'YER', amount: 100 }], CURRENCIES);
    expect(single.hasMultipleCurrencies).toBe(false);
    const multi = buildCurrencyBreakdown(
      [
        { code: 'YER', amount: 100 },
        { code: 'USD', amount: 50 },
      ],
      CURRENCIES,
    );
    expect(multi.hasMultipleCurrencies).toBe(true);
  });

  it('sorts items by amount descending', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'YER', amount: 100 },
        { code: 'USD', amount: 1000 },
        { code: 'SAR', amount: 500 },
      ],
      CURRENCIES,
    );
    expect(r.items[0].code).toBe('USD');
    expect(r.items[1].code).toBe('SAR');
    expect(r.items[2].code).toBe('YER');
  });

  it('computes percent of total base equivalent', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'USD', amount: 10 },
        { code: 'YER', amount: 5000 },
      ],
      CURRENCIES,
    );
    const usd = r.items.find((i) => i.code === 'USD')!;
    expect(usd.percent).toBe(75);
  });

  it('skips entries with missing currency code', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: '', amount: 999 },
        { code: 'USD', amount: 100 },
      ],
      CURRENCIES,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].code).toBe('USD');
  });

  it('handles NaN/Infinity amounts as 0', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'USD', amount: Number.NaN },
        { code: 'USD', amount: Number.POSITIVE_INFINITY },
        { code: 'YER', amount: 100 },
      ],
      CURRENCIES,
    );
    const usd = r.items.find((i) => i.code === 'USD')!;
    expect(usd.amount).toBe(0);
  });

  it('treats unknown currency as rate=0 (no conversion, amount=base)', () => {
    const r = buildCurrencyBreakdown([{ code: 'XYZ', amount: 500 }], CURRENCIES);
    expect(r.items[0].baseEquivalent).toBe(500);
  });

  it('works with no currencies configured (default YER rate=1)', () => {
    const r = buildCurrencyBreakdown(
      [
        { code: 'YER', amount: 1000 },
        { code: 'USD', amount: 50 },
      ],
      [],
    );
    const usd = r.items.find((i) => i.code === 'USD')!;
    expect(usd.baseEquivalent).toBe(50);
  });
});
