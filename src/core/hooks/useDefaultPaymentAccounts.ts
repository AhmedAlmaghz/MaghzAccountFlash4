import { useState, useEffect, useCallback } from 'react';
import { getDbAdapter } from '@/core/database/adapters';

export interface DefaultPaymentAccounts {
  defaultCashBoxId: string | null;
  isLoading: boolean;
  reload: () => void;
}

/**
 * Hook to get the default treasury (cash box) ID for the active company.
 *
 * Banks were unified away (migration 0002): cash boxes — "النقدية والخزائن" —
 * are the single payment-location concept. Reads default_accounts
 * (function_key = 'default_cash') and finds the cash box linked to that
 * GL account; falls back to the first active box.
 */
export function useDefaultPaymentAccounts(companyId: string): DefaultPaymentAccounts {
  const [defaultCashBoxId, setDefaultCashBoxId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setDefaultCashBoxId(null);
      return;
    }
    setIsLoading(true);
    try {
      const adapter = await getDbAdapter();

      const defaultsResult = await adapter.query<{
        account_id: string | null;
      }>(
        `SELECT account_id FROM default_accounts WHERE company_id = $1 AND function_key = 'default_cash' LIMIT 1`,
        [companyId]
      );

      const defaultCashAccountId = defaultsResult.success
        ? defaultsResult.rows?.[0]?.account_id ?? null
        : null;

      if (defaultCashAccountId) {
        const cashResult = await adapter.query<{ id: string }>(
          `SELECT id FROM cash_boxes WHERE company_id = $1 AND account_id = $2 AND is_active = true LIMIT 1`,
          [companyId, defaultCashAccountId]
        );
        setDefaultCashBoxId(cashResult.success && cashResult.rows?.[0] ? cashResult.rows[0].id : null);
      }

      // Fallback: first active cash box
      if (!defaultCashAccountId) {
        const fallbackCash = await adapter.query<{ id: string }>(
          `SELECT id FROM cash_boxes WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
          [companyId]
        );
        setDefaultCashBoxId(fallbackCash.success && fallbackCash.rows?.[0] ? fallbackCash.rows[0].id : null);
      }
    } catch {
      setDefaultCashBoxId(null);
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  return { defaultCashBoxId, isLoading, reload: load };
}
