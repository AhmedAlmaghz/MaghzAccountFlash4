import type { Currency } from '@/modules/core/types';

export const YER_CODE = 'YER';

export function getCurrency(currencies: Currency[], code: string | null | undefined): Currency | null {
  if (!code) return null;
  return currencies.find((c) => c.code === code) ?? null;
}

export function getDefaultCurrency(currencies: Currency[]): Currency | null {
  if (currencies.length === 0) return null;
  const def = currencies.find((c) => c.isDefault);
  return def ?? currencies[0] ?? null;
}

export function getActiveCurrencies(currencies: Currency[]): Currency[] {
  return currencies.filter((c) => c.isActive);
}

export function convertAmount(
  value: number,
  fromRate: number,
  toRate: number,
): number {
  if (!isFinite(value)) return 0;
  if (fromRate <= 0 || toRate <= 0) return value;
  return (value * fromRate) / toRate;
}

export function convertToBase(
  value: number,
  fromRate: number,
  baseRate = 1,
): number {
  if (!isFinite(value)) return 0;
  if (fromRate <= 0 || baseRate <= 0) return value;
  return (value * fromRate) / baseRate;
}

export function convertFromBase(
  value: number,
  toRate: number,
  baseRate = 1,
): number {
  if (!isFinite(value)) return 0;
  if (toRate <= 0 || baseRate <= 0) return value;
  return (value * baseRate) / toRate;
}

export function formatWithSymbol(
  value: number | string,
  currency: Currency | null | undefined,
  decimalPlaces = 2,
): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!isFinite(num)) return '-';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(num);
  if (!currency) return formatted;
  if (currency.symbol) {
    return `${currency.symbol} ${formatted}`;
  }
  return `${formatted} ${currency.code}`;
}

export function formatYer(value: number | string, decimalPlaces = 2): string {
  return formatWithSymbol(value, { code: YER_CODE, name: 'ريال يمني', symbol: 'ر.ي' } as Currency, decimalPlaces);
}

export function getBaseCurrencyConversion(
  value: number,
  fromCurrencyCode: string | null | undefined,
  currencies: Currency[],
): { value: number; currency: Currency | null; originalValue: number } {
  const originalValue = value;
  const from = getCurrency(currencies, fromCurrencyCode);
  const base = getDefaultCurrency(currencies);
  if (!from || !base) {
    return { value, currency: base, originalValue };
  }
  if (from.code === base.code) {
    return { value, currency: base, originalValue };
  }
  const converted = convertAmount(value, from.exchangeRate, base.exchangeRate);
  return { value: converted, currency: base, originalValue };
}

export function summarizeMultiCurrency(
  valuesByCurrency: Record<string, number>,
  currencies: Currency[],
): { total: number; byCurrency: Record<string, number>; baseCurrency: Currency | null } {
  const base = getDefaultCurrency(currencies);
  const byCurrency: Record<string, number> = {};
  let total = 0;
  for (const [code, amount] of Object.entries(valuesByCurrency)) {
    byCurrency[code] = amount;
    const c = getCurrency(currencies, code);
    if (c && base) {
      total += convertAmount(amount, c.exchangeRate, base.exchangeRate);
    } else {
      total += amount;
    }
  }
  return { total, byCurrency, baseCurrency: base };
}
