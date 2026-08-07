import { useState, useEffect, useCallback } from 'react';
import { getDbAdapter } from '@/core/database/adapters';

export interface DefaultPaymentAccounts {
  defaultCashBoxId: string | null;
  defaultBankId: string | null;
  isLoading: boolean;
  reload: () => void;
}

/**
 * Hook to get default cash box and bank IDs for the active company.
 * Reads from default_accounts table (function_key = 'default_cash' / 'default_bank')
 * and finds the cash_box/bank that uses that account_id.
 */
export function useDefaultPaymentAccounts(companyId: string): DefaultPaymentAccounts {
  const [defaultCashBoxId, setDefaultCashBoxId] = useState<string | null>(null);
  const [defaultBankId, setDefaultBankId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setDefaultCashBoxId(null);
      setDefaultBankId(null);
      return;
    }
    setIsLoading(true);
    try {
      const adapter = await getDbAdapter();

      // 1. Get default_cash and default_bank account_ids from default_accounts
      const defaultsResult = await adapter.query<{
        function_key: string;
        account_id: string | null;
      }>(
        `SELECT function_key, account_id FROM default_accounts WHERE company_id = $1 AND function_key IN ('default_cash', 'default_bank')`,
        [companyId]
      );

      const defaultsMap: Record<string, string | null> = {};
      if (defaultsResult.success && defaultsResult.rows) {
        for (const row of defaultsResult.rows) {
          defaultsMap[row.function_key] = row.account_id;
        }
      }

      const defaultCashAccountId = defaultsMap.default_cash;
      const defaultBankAccountId = defaultsMap.default_bank;

      // 2. Find the cash_box that uses the default_cash account
      if (defaultCashAccountId) {
        const cashResult = await adapter.query<{ id: string }>(
          `SELECT id FROM cash_boxes WHERE company_id = $1 AND account_id = $2 AND is_active = true LIMIT 1`,
          [companyId, defaultCashAccountId]
        );
        setDefaultCashBoxId(cashResult.success && cashResult.rows?.[0] ? cashResult.rows[0].id : null);
      } else {
        // Fallback: first active cash box
        const fallbackCash = await adapter.query<{ id: string }>(
          `SELECT id FROM cash_boxes WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
          [companyId]
        );
        setDefaultCashBoxId(fallbackCash.success && fallbackCash.rows?.[0] ? fallbackCash.rows[0].id : null);
      }

      // 3. Find the bank that uses the default_bank account
      if (defaultBankAccountId) {
        const bankResult = await adapter.query<{ id: string }>(
          `SELECT id FROM banks WHERE company_id = $1 AND account_id = $2 AND is_active = true LIMIT 1`,
          [companyId, defaultBankAccountId]
        );
        setDefaultBankId(bankResult.success && bankResult.rows?.[0] ? bankResult.rows[0].id : null);
      } else {
        // Fallback: first active bank
        const fallbackBank = await adapter.query<{ id: string }>(
          `SELECT id FROM banks WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
          [companyId]
        );
        setDefaultBankId(fallbackBank.success && fallbackBank.rows?.[0] ? fallbackBank.rows[0].id : null);
      }
    } catch {
      setDefaultCashBoxId(null);
      setDefaultBankId(null);
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  return { defaultCashBoxId, defaultBankId, isLoading, reload: load };
}
