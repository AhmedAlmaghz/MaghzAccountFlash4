import type { Currency } from '@/modules/core/types';
import { YER_CODE, getDefaultCurrency, convertToBase } from './currencyConverter';

export interface CurrencyAmount {
  code: string;
  amount: number;
}

export interface CurrencyBreakdownItem {
  code: string;
  amount: number;
  percent: number;
  baseEquivalent: number;
}

export interface CurrencyBreakdownResult {
  items: CurrencyBreakdownItem[];
  totalInBase: number;
  hasMultipleCurrencies: boolean;
  uniqueCurrencyCount: number;
}

export function buildCurrencyBreakdown(
  amounts: CurrencyAmount[],
  currencies: Currency[],
): CurrencyBreakdownResult {
  if (amounts.length === 0) {
    return {
      items: [],
      totalInBase: 0,
      hasMultipleCurrencies: false,
      uniqueCurrencyCount: 0,
    };
  }

  const defaultCurrency = getDefaultCurrency(currencies);
  const baseCode = defaultCurrency?.code ?? YER_CODE;
  const baseRate = defaultCurrency?.exchangeRate ?? 1;

  const map = new Map<string, number>();
  for (const a of amounts) {
    if (!a.code) continue;
    const value = Number.isFinite(a.amount) ? a.amount : 0;
    map.set(a.code, (map.get(a.code) ?? 0) + value);
  }

  const items: CurrencyBreakdownItem[] = [];
  let totalInBase = 0;
  for (const [code, amount] of map.entries()) {
    const c = currencies.find((x) => x.code === code);
    const rate = c?.exchangeRate ?? (code === baseCode ? 1 : 0);
    const baseEquivalent = rate > 0 ? convertToBase(amount, rate, baseRate) : amount;
    totalInBase += baseEquivalent;
    items.push({ code, amount, percent: 0, baseEquivalent });
  }

  items.sort((a, b) => b.amount - a.amount);
  for (const i of items) {
    i.percent = totalInBase > 0 ? Math.round((i.baseEquivalent / totalInBase) * 100) : 0;
  }

  return {
    items,
    totalInBase,
    hasMultipleCurrencies: items.length > 1,
    uniqueCurrencyCount: items.length,
  };
}
