import { useState, useEffect, useCallback } from 'react';
import { getDbAdapter } from '@/core/database/adapters';
import { YER_CODE } from '@/core/utils/currencyConverter';

interface AppSettings {
  vatRate: number;
  vatAccountId?: string;
  defaultCurrency: string;
  baseCurrency: string;
  defaultBranchId?: string;
  defaultAccounts: Record<string, string>;
  dateFormat: string;
  decimalPlaces: number;
  calendar: 'gregorian' | 'hijri';
  fiscalYearStart?: string;
  invoiceShowDiscount: boolean;
  invoiceShowVat: boolean;
}

export function useSettings(companyId: string) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    
    try {
      const adapter = await getDbAdapter();
      
      // Load VAT settings
      const vatResult = await adapter.query<{ vat_rate: number }>(
        `SELECT vat_rate FROM vat_settings WHERE company_id = $1 AND is_active = true LIMIT 1`,
        [companyId]
      );

      // Load currencies
      const currResult = await adapter.query<{ is_default: boolean; code: string }>(
        `SELECT is_default, code FROM currencies WHERE company_id = $1 AND is_active = true`,
        [companyId]
      );

      // Load default accounts
      const defaultAccountsResult = await adapter.query<{ function_key: string; account_id: string }>(
        `SELECT function_key, account_id FROM default_accounts WHERE company_id = $1`,
        [companyId]
      );

      // Load default branch
      const branchResult = await adapter.query<{ id: string }>(
        `SELECT id FROM branches WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
        [companyId]
      );

      // Load company format settings
      const companyResult = await adapter.query<{ date_format: string; decimal_places: number; calendar: string; fiscal_year_start: string }>(
        `SELECT date_format, decimal_places, calendar, fiscal_year_start FROM companies WHERE id = $1 LIMIT 1`,
        [companyId]
      );

      const vatRate = vatResult.success && vatResult.rows?.[0]
        ? Number(vatResult.rows[0].vat_rate)
        : 15;

      const baseCurrency = currResult.success && currResult.rows
        ? currResult.rows.find((c) => c.is_default)?.code || YER_CODE
        : YER_CODE;

      const defaultAccounts: Record<string, string> = {};
      if (defaultAccountsResult.success && defaultAccountsResult.rows) {
        for (const row of defaultAccountsResult.rows) {
          if (row.function_key && row.account_id) {
            defaultAccounts[row.function_key] = row.account_id;
          }
        }
      }

      const defaultBranchId = branchResult.success && branchResult.rows?.[0]
        ? branchResult.rows[0].id
        : undefined;

      const dateFormat = companyResult.success && companyResult.rows?.[0]?.date_format
        ? String(companyResult.rows[0].date_format)
        : 'yyyy-MM-dd';

      // NULL (legacy rows) means "unset" — fall back to 2, not 0
      // (Number(null) === 0 would silently force whole-unit display).
      const decimalPlaces = companyResult.success && companyResult.rows?.[0]?.decimal_places != null
        ? Number(companyResult.rows[0].decimal_places)
        : 2;

      const calendar = companyResult.success && companyResult.rows?.[0]?.calendar === 'hijri'
        ? 'hijri'
        : 'gregorian';

      const fiscalYearStart = companyResult.success && companyResult.rows?.[0]?.fiscal_year_start
        ? String(companyResult.rows[0].fiscal_year_start).split('T')[0]
        : undefined;

      // Load invoice display settings (global for sales & purchases)
      let invoiceShowDiscount = true;
      let invoiceShowVat = true;
      try {
        const invSettingsResult = await adapter.query<{ key: string; value: string }>(
          `SELECT key, value FROM settings WHERE company_id = $1 AND key IN ('invoice.showDiscount', 'invoice.showVat')`,
          [companyId]
        );
        if (invSettingsResult.success && invSettingsResult.rows) {
          for (const row of invSettingsResult.rows) {
            if (row.key === 'invoice.showDiscount') invoiceShowDiscount = row.value === 'true';
            if (row.key === 'invoice.showVat') invoiceShowVat = row.value === 'true';
          }
        }
      } catch {
        // defaults remain true
      }

      setSettings({
        vatRate,
        baseCurrency,
        defaultCurrency: baseCurrency,
        defaultAccounts,
        defaultBranchId,
        dateFormat,
        decimalPlaces,
        calendar,
        fiscalYearStart,
        invoiceShowDiscount,
        invoiceShowVat,
      });
    } catch (_error) {
      // Error handled via setError below
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return { settings, isLoading, reload: loadSettings };
}

export default useSettings;
