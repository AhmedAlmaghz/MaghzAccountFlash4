import { BaseService } from '@/core/services/BaseService';
import { toDateString } from '@/core/utils/mapPgRow';

/** LOCAL calendar day — a UTC date is yesterday for GMT+3 between 00:00–03:00. */
const localToday = (): string => toDateString(new Date()) ?? new Date().toISOString().split('T')[0];

/**
 * Accounting Service — read-side financial reporting.
 *
 * Encapsulates the company-scoped financial statements (trial balance,
 * balance sheet, P&L). Used by `accounting/api.ts` and the AI report tools.
 *
 * Scope note (Phase 102): the write-side methods that used to live here
 * (createAccount/updateAccount/postTransaction/reverseTransaction) had ZERO
 * production callers and were deleted — the sanctioned write paths are
 * `accountingApi.createTransaction`/`postTransaction` (draft-only flip +
 * period/fiscal gates + balanced check) and `src/modules/accounting/
 * reversal.ts` for reversals. Do NOT re-add service-level write methods:
 * any posting must go through the API layer's gates, not around them.
 */
export class AccountingService extends BaseService {
  /**
   * Get trial balance as of a specific date
   *
   * Balance = SUM of ALL posted journal entries only — the single source of
   * truth. Opening balances are already posted as balanced JEs through the
   * Opening Balance Equity account, so they are included automatically.
   * NEVER add `a.balance` on top of the SUM: account balances are a display
   * mirror that opening flows also bump, so `balance + SUM(je)` double-counts
   * every opening amount.
   */
  async getTrialBalance(asOfDate?: string) {
    this.requirePermission('accounting.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const date = asOfDate || localToday();

      const result = await this.query(
        `SELECT
          a.id,
          a.code,
          a.name_ar as account_name,
          a.name_en as account_name_en,
          a.type,
          a.nature,
          COALESCE(SUM(je.debit), 0) as debit,
          COALESCE(SUM(je.credit), 0) as credit,
          COALESCE(SUM(je.debit - je.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_entries je ON je.account_id = a.id
          AND je.transaction_id IN (
            SELECT id FROM transactions
            WHERE company_id = $1::uuid
            AND date <= $2
            AND status = 'posted'
          )
        WHERE a.company_id = $1::uuid
        GROUP BY a.id, a.code, a.name_ar, a.name_en, a.type, a.nature
        ORDER BY a.code`,
        [companyId, date]
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to get trial balance');
      }

      return { success: true, data: result.rows || [] };
    }, 'getTrialBalance');
  }

  /**
   * Get balance sheet as of a specific date
   */
  async getBalanceSheet(asOfDate?: string) {
    this.requirePermission('accounting.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const date = asOfDate || localToday();

      const result = await this.query(
        `SELECT
          a.id,
          a.code,
          a.name_ar as name_ar,
          a.name_en as name_en,
          a.type,
          a.nature,
          COALESCE(SUM(je.debit - je.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_entries je ON je.account_id = a.id
          AND je.transaction_id IN (
            SELECT id FROM transactions
            WHERE company_id = $1::uuid
            AND date <= $2
            AND status = 'posted'
          )
        WHERE a.company_id = $1::uuid
          AND a.type IN ('asset', 'liability', 'equity')
        GROUP BY a.id, a.code, a.name_ar, a.name_en, a.type, a.nature
        ORDER BY a.code`,
        [companyId, date]
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to get balance sheet');
      }

      return { success: true, data: result.rows || [] };
    }, 'getBalanceSheet');
  }

  /**
   * Get profit and loss statement for a period
   */
  async getProfitLoss(startDate: string, endDate: string) {
    this.requirePermission('accounting.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();

      const result = await this.query(
        `SELECT
          a.id,
          a.code,
          a.name_ar as name_ar,
          a.name_en as name_en,
          a.type,
          a.nature,
          COALESCE(SUM(je.debit - je.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_entries je ON je.account_id = a.id
          AND je.transaction_id IN (
            SELECT id FROM transactions
            WHERE company_id = $1::uuid
            AND date BETWEEN $2 AND $3
            AND status = 'posted'
          )
        WHERE a.company_id = $1::uuid
          AND a.type IN ('revenue', 'expense')
        GROUP BY a.id, a.code, a.name_ar, a.name_en, a.type, a.nature
        ORDER BY a.code`,
        [companyId, startDate, endDate]
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to get profit and loss');
      }

      return { success: true, data: result.rows || [] };
    }, 'getProfitLoss');
  }
}

// Singleton instance
export const accountingService = new AccountingService();
