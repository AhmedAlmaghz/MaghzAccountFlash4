import { BaseService } from '@/core/services/BaseService';
import { transactionManager } from '@/core/services/TransactionManager';
import { immutableRecordGuard } from '@/core/services/ImmutableRecordGuard';
import { z } from 'zod';

// Validation schemas
const CreateAccountSchema = z.object({
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  nature: z.enum(['debit', 'credit']),
  isGroup: z.boolean(),
  balance: z.number().default(0),
});

const CreateTransactionSchema = z.object({
  date: z.string(),
  description: z.string().min(1),
  entries: z.array(z.object({
    accountId: z.string().uuid(),
    debit: z.number().min(0),
    credit: z.number().min(0),
  })).min(2),
  reference: z.string().optional(),
});

export type CreateAccountDto = z.infer<typeof CreateAccountSchema>;
export type CreateTransactionDto = z.infer<typeof CreateTransactionSchema>;

/**
 * Accounting Service
 * 
 * Encapsulates all business logic for accounting operations:
 * - Account management
 * - Transaction posting
 * - Trial balance generation
 * - Financial statements
 * - Posting rules and validation
 */
export class AccountingService extends BaseService {
  /**
   * Create a new account
   */
  async createAccount(data: CreateAccountDto) {
    this.requirePermission('accounting.create');

    return this.executeWithErrorHandling(async () => {
      // Validate input
      const validated = CreateAccountSchema.parse(data);
      const companyId = this.getCompanyId();

      // Check if code already exists
      const existing = await this.query(
        'SELECT id FROM accounts WHERE company_id = $1::uuid AND code = $2',
        [companyId, validated.code]
      );

      if (existing.success && existing.rows && existing.rows.length > 0) {
        throw new Error('Account code already exists');
      }

      // Create account
      const result = await this.query(
        `INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9)
         RETURNING id`,
        [
          companyId,
          validated.code,
          validated.nameAr,
          validated.nameEn,
          validated.parentId,
          validated.type,
          validated.nature,
          validated.isGroup,
          validated.balance,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create account');
      }

      const accountId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'accounts',
        recordId: accountId,
        action: 'create',
        newValues: validated,
      });

      return { success: true, id: accountId };
    }, 'createAccount');
  }

  /**
   * Update an account (only if no posted entries exist)
   */
  async updateAccount(accountId: string, data: Partial<CreateAccountDto>) {
    this.requirePermission('accounting.edit');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();

      // Check if account has posted journal entries
      const entriesCheck = await this.query(
        `SELECT COUNT(*) as count FROM journal_entries je
         JOIN transactions t ON je.transaction_id = t.id
         WHERE je.account_id = $1::uuid AND je.company_id = $2::uuid AND t.status = 'posted'`,
        [accountId, companyId]
      );

      if (entriesCheck.success && entriesCheck.rows && Number(entriesCheck.rows[0].count) > 0) {
        throw new Error('Cannot modify account with posted journal entries. Use reversal workflow instead.');
      }

      // Validate and update
      const validated = CreateAccountSchema.partial().parse(data);

      const fields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (validated.nameAr !== undefined) {
        fields.push(`name_ar = $${paramIndex++}`);
        values.push(validated.nameAr);
      }
      if (validated.nameEn !== undefined) {
        fields.push(`name_en = $${paramIndex++}`);
        values.push(validated.nameEn);
      }
      if (validated.parentId !== undefined) {
        fields.push(`parent_id = $${paramIndex++}::uuid`);
        values.push(validated.parentId);
      }
      if (validated.type !== undefined) {
        fields.push(`type = $${paramIndex++}`);
        values.push(validated.type);
      }
      if (validated.nature !== undefined) {
        fields.push(`nature = $${paramIndex++}`);
        values.push(validated.nature);
      }
      if (validated.isGroup !== undefined) {
        fields.push(`is_group = $${paramIndex++}`);
        values.push(validated.isGroup);
      }

      if (fields.length === 0) {
        return { success: true };
      }

      values.push(accountId, companyId);

      const result = await this.query(
        `UPDATE accounts SET ${fields.join(', ')} WHERE id = $${paramIndex}::uuid AND company_id = $${paramIndex + 1}::uuid`,
        values
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to update account');
      }

      // Audit log
      await this.auditLog({
        tableName: 'accounts',
        recordId: accountId,
        action: 'update',
        newValues: validated,
      });

      return { success: true };
    }, 'updateAccount');
  }

  /**
   * Post a journal entry transaction
   * 
   * This is a critical operation that:
   * 1. Validates the transaction (debits = credits)
   * 2. Updates account balances
   * 3. Creates the transaction and journal entries
   * 4. Is performed atomically (transaction-safe)
   * 5. Includes retry logic for deadlocks
   */
  async postTransaction(data: CreateTransactionDto) {
    this.requirePermission('accounting.post');

    return this.executeWithErrorHandling(async () => {
      // Validate input
      const validated = CreateTransactionSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Validate debits equal credits
      const totalDebit = validated.entries.reduce((sum, e) => sum + e.debit, 0);
      const totalCredit = validated.entries.reduce((sum, e) => sum + e.credit, 0);

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Transaction not balanced: debit=${totalDebit}, credit=${totalCredit}`);
      }

      if (totalDebit === 0) {
        throw new Error('Transaction amount cannot be zero');
      }

      // Execute with retry logic for deadlock handling
      return await transactionManager.executeWithRetry(async () => {
        // Get transaction ID
        const transactionId = crypto.randomUUID();

        // Build transaction queries
        const queries: { sql: string; params: unknown[] }[] = [
          // Create transaction
          {
            sql: `INSERT INTO transactions (id, company_id, date, description, reference, created_by, status)
                  VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, 'posted')`,
            params: [transactionId, companyId, validated.date, validated.description, validated.reference || null, userId],
          },
        ];

        // Add journal entries
        for (const entry of validated.entries) {
          queries.push({
            sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
                  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
            params: [crypto.randomUUID(), transactionId, entry.accountId, entry.debit, entry.credit, companyId],
          });

          // Update account balance
          const balanceChange = entry.debit - entry.credit;
          queries.push({
            sql: `UPDATE accounts 
                  SET balance = balance + $1 
                  WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [balanceChange, entry.accountId, companyId],
          });
        }

        // Execute transaction atomically
        const result = await this.transaction(queries);

        if (!result.success) {
          throw new Error(result.error || 'Failed to post transaction');
        }

        // Validate transaction consistency
        const validation = await transactionManager.validateTransactionConsistency(
          transactionId,
          totalDebit,
          totalCredit
        );

        if (!validation.valid) {
          throw new Error(
            `Transaction consistency check failed: expected debits=${totalDebit}, credits=${totalCredit}, ` +
            `actual debits=${validation.actualDebits}, credits=${validation.actualCredits}`
          );
        }

        // Audit log
        await this.auditLog({
          tableName: 'transactions',
          recordId: transactionId,
          action: 'post',
          newValues: {
            date: validated.date,
            description: validated.description,
            totalAmount: totalDebit,
            entryCount: validated.entries.length,
          },
        });

        return { success: true, transactionId };
      }, 'postTransaction');
    }, 'postTransaction');
  }

  /**
   * Get trial balance as of a specific date
   */
  async getTrialBalance(asOfDate?: string) {
    this.requirePermission('accounting.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const date = asOfDate || new Date().toISOString().split('T')[0];

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
          a.balance + COALESCE(SUM(je.debit - je.credit), 0) as balance
        FROM accounts a
        LEFT JOIN journal_entries je ON je.account_id = a.id
          AND je.transaction_id IN (
            SELECT id FROM transactions 
            WHERE company_id = $1::uuid 
            AND date <= $2 
            AND status = 'posted'
          )
        WHERE a.company_id = $1::uuid
        GROUP BY a.id, a.code, a.name_ar, a.name_en, a.type, a.nature, a.balance
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
      const date = asOfDate || new Date().toISOString().split('T')[0];

      const result = await this.query(
        `SELECT 
          a.id,
          a.code,
          a.name_ar as name_ar,
          a.name_en as name_en,
          a.type,
          a.nature,
          a.balance + COALESCE(SUM(je.debit - je.credit), 0) as balance
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
        GROUP BY a.id, a.code, a.name_ar, a.name_en, a.type, a.nature, a.balance
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

  /**
   * Get account ledger
   */
  async getAccountLedger(accountId: string, startDate?: string, endDate?: string) {
    this.requirePermission('accounting.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();

      let whereClause = 'je.company_id = $1::uuid AND je.account_id = $2::uuid';
      const params: unknown[] = [companyId, accountId];
      let paramIndex = 3;

      if (startDate) {
        whereClause += ` AND t.date >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        whereClause += ` AND t.date <= $${paramIndex}`;
        params.push(endDate);
      }

      const result = await this.query(
        `SELECT 
          je.id,
          t.date,
          t.description,
          je.debit,
          je.credit,
          je.debit - je.credit as net_change,
          a.name_ar as account_name,
          a.code as account_code
        FROM journal_entries je
        JOIN transactions t ON je.transaction_id = t.id
        JOIN accounts a ON je.account_id = a.id
        WHERE ${whereClause}
        ORDER BY t.date ASC, je.id ASC`,
        params
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to get account ledger');
      }

      return { success: true, data: result.rows || [] };
    }, 'getAccountLedger');
  }

  /**
   * Reverse a posted transaction
   * This is the proper way to "modify" a posted transaction
   */
  async reverseTransaction(transactionId: string, reversalDate: string, reason: string) {
    this.requirePermission('accounting.post');

    return this.executeWithErrorHandling(async () => {
      const result = await immutableRecordGuard.createReversal(
        'transactions',
        transactionId,
        { reversalDate, reason }
      );

      return result;
    }, 'reverseTransaction');
  }
}

// Singleton instance
export const accountingService = new AccountingService();
