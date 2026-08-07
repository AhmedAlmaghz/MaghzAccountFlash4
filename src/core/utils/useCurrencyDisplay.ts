import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import type { Currency } from '@/modules/core/types';
import {
  getDefaultCurrency,
  formatWithSymbol,
  convertAmount,
  getBaseCurrencyConversion,
  summarizeMultiCurrency,
} from './currencyConverter';

export function useCurrencies(companyId: string) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setCurrencies([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query<{
        id: string;
        company_id: string;
        code: string;
        name: string;
        symbol: string | null;
        exchange_rate: string | number;
        is_default: boolean;
        is_active: boolean;
      }>(
        `SELECT id, company_id, code, name, symbol, exchange_rate, is_default, is_active FROM currencies WHERE company_id = $1 ORDER BY is_default DESC, code ASC`,
        [companyId]
      );
      if (result.success && result.rows) {
        setCurrencies(
          result.rows.map((r) => ({
            id: r.id,
            companyId: r.company_id,
            code: r.code,
            name: r.name,
            symbol: r.symbol ?? r.code,
            exchangeRate: Number(r.exchange_rate),
            isDefault: r.is_default,
            isActive: r.is_active,
          }))
        );
      }
    } catch {
      setCurrencies([]);
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  return { currencies, isLoading, reload: load };
}

export function useCurrencyDisplay() {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { currencies, isLoading, reload } = useCurrencies(activeCompany?.id || '');

  const defaultCurrency = getDefaultCurrency(currencies);

  const formatWithCurrency = useCallback(
    (value: number | string, currencyCode?: string | null) => {
      const code = currencyCode ?? defaultCurrency?.code;
      const c = currencies.find((x) => x.code === code);
      return formatWithSymbol(value, c);
    },
    [currencies, defaultCurrency]
  );

  const convert = useCallback(
    (value: number, fromCode: string, toCode?: string) => {
      const target = toCode ?? defaultCurrency?.code;
      if (!target) return value;
      const from = currencies.find((c) => c.code === fromCode);
      const to = currencies.find((c) => c.code === target);
      if (!from || !to) return value;
      return convertAmount(value, from.exchangeRate, to.exchangeRate);
    },
    [currencies, defaultCurrency]
  );

  const toBase = useCallback(
    (value: number, fromCode: string | null | undefined) => {
      return getBaseCurrencyConversion(value, fromCode, currencies);
    },
    [currencies]
  );

  const summarize = useCallback(
    (valuesByCurrency: Record<string, number>) => summarizeMultiCurrency(valuesByCurrency, currencies),
    [currencies]
  );

  return {
    currencies,
    defaultCurrency,
    isLoading,
    reload,
    formatWithCurrency,
    convert,
    toBase,
    summarize,
  };
}
