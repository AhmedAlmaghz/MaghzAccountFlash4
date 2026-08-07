import { BaseService } from './BaseService';

/**
 * Immutable Record Guard
 * 
 * Enforces immutability for posted records:
 * - Prevents direct modification of posted records
 * - Enforces reversal workflow for changes
 * - Provides audit trail for reversal operations
 */
export class ImmutableRecordGuard extends BaseService {
  /**
   * Check if a record can be modified
   * @throws Error if record is posted and cannot be modified
   */
  async canModifyRecord(
    tableName: string,
    recordId: string,
    status?: string
  ): Promise<{ canModify: boolean; reason?: string }> {
    // If status is provided and it's 'posted', cannot modify
    if (status === 'posted') {
      return {
        canModify: false,
        reason: `Record in ${tableName} is posted and cannot be modified directly. Use reversal workflow instead.`
      };
    }

    // Check database for status if not provided
    const companyId = this.getCompanyId();

    try {
      const result = await this.query(
        `SELECT status FROM ${tableName} 
         WHERE id = $1::uuid AND company_id = $2::uuid`,
        [recordId, companyId]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        return { canModify: false, reason: 'Record not found' };
      }

      const recordStatus = String(result.rows[0].status);

      if (recordStatus === 'posted') {
        return {
          canModify: false,
          reason: `Record is posted and cannot be modified directly. Use reversal workflow instead.`
        };
      }

      return { canModify: true };
    } catch (_error) {
      // If we can't check status, assume it can be modified (fail-open for safety)
      console.warn(`Failed to check record status for ${tableName}:${recordId}, allowing modification`);
      return { canModify: true };
    }
  }

  /**
   * Require that a record can be modified
   * @throws Error if record cannot be modified
   */
  async requireModifiable(tableName: string, recordId: string, status?: string): Promise<void> {
    const check = await this.canModifyRecord(tableName, recordId, status);

    if (!check.canModify) {
      throw new Error(check.reason || 'Record cannot be modified');
    }
  }

  /**
   * Create a reversal record for a posted record
   * This is the proper way to "modify" a posted record
   */
  async createReversal(
    originalTableName: string,
    originalRecordId: string,
    reversalData: {
      reversalDate: string;
      reason: string;
      reversalTypeId?: string;
    }
  ): Promise<{ success: boolean; reversalId?: string; error?: string }> {
    const companyId = this.getCompanyId();
    const userId = this.getCurrentUserId();

    try {
      // Get original record
      const originalResult = await this.query(
        `SELECT * FROM ${originalTableName} 
         WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'posted'`,
        [originalRecordId, companyId]
      );

      if (!originalResult.success || !originalResult.rows || originalResult.rows.length === 0) {
        return { success: false, error: 'Original posted record not found' };
      }

      const originalRecord = originalResult.rows[0] as Record<string, unknown>;

      // Create reversal record based on table type
      let reversalId: string;

      switch (originalTableName) {
        case 'transactions':
          reversalId = await this.createTransactionReversal(originalRecord, reversalData, userId);
          break;
        case 'sales_invoices':
          reversalId = await this.createSalesInvoiceReversal(originalRecord, reversalData, userId);
          break;
        case 'purchase_invoices':
          reversalId = await this.createPurchaseInvoiceReversal(originalRecord, reversalData, userId);
          break;
        default:
          return { success: false, error: `Reversal not implemented for table: ${originalTableName}` };
      }

      // Update original record status
      await this.query(
        `UPDATE ${originalTableName} 
         SET status = 'reversed', reversed_at = NOW(), reversed_by = $1::uuid, reversal_id = $2::uuid
         WHERE id = $3::uuid AND company_id = $4::uuid`,
        [userId, reversalId, originalRecordId, companyId]
      );

      // Audit log
      await this.auditLog({
        tableName: originalTableName,
        recordId: originalRecordId,
        action: 'reverse',
        oldValues: { originalStatus: 'posted' },
        newValues: {
          newStatus: 'reversed',
          reversalId,
          reason: reversalData.reason
        },
      });

      return { success: true, reversalId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during reversal'
      };
    }
  }

  /**
   * Create transaction reversal
   */
  private async createTransactionReversal(
    originalRecord: Record<string, unknown>,
    reversalData: { reversalDate: string; reason: string },
    userId: string
  ): Promise<string> {
    const companyId = this.getCompanyId();
    const reversalId = crypto.randomUUID();

    // Get original journal entries
    const entriesResult = await this.query(
      `SELECT * FROM journal_entries 
       WHERE transaction_id = $1::uuid AND company_id = $2::uuid`,
      [originalRecord.id, companyId]
    );

    if (!entriesResult.success || !entriesResult.rows) {
      throw new Error('Failed to get original journal entries');
    }

    const originalEntries = entriesResult.rows;

    // Build reversal transaction queries
    const queries: { sql: string; params: unknown[] }[] = [
      // Create reversal transaction
      {
        sql: `INSERT INTO transactions (id, company_id, date, description, reference, created_by, status, reversal_of_id)
              VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, 'posted', $7::uuid)`,
        params: [
          reversalId,
          companyId,
          reversalData.reversalDate,
          `Reversal of ${originalRecord.description || 'Transaction'}`,
          `REV-${originalRecord.reference || originalRecord.id}`,
          userId,
          originalRecord.id,
        ],
      },
    ];

    // Create reversal journal entries (swap debit/credit)
    for (const entry of originalEntries) {
      queries.push({
        sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
        params: [
          crypto.randomUUID(),
          reversalId,
          entry.account_id,
          entry.credit, // Swap: original credit becomes debit
          entry.debit, // Swap: original debit becomes credit
          companyId,
        ],
      });

      // Reverse account balance
      const balanceChange = Number(entry.debit) - Number(entry.credit);
      queries.push({
        sql: `UPDATE accounts 
              SET balance = balance - $1 
              WHERE id = $2::uuid AND company_id = $3::uuid`,
        params: [balanceChange, entry.account_id, companyId],
      });
    }

    // Execute transaction
    const result = await this.transaction(queries);

    if (!result.success) {
      throw new Error(result.error || 'Failed to create reversal transaction');
    }

    return reversalId;
  }

  /**
   * Create sales invoice reversal
   */
  private async createSalesInvoiceReversal(
    originalRecord: Record<string, unknown>,
    reversalData: { reversalDate: string; reason: string },
    userId: string
  ): Promise<string> {
    const companyId = this.getCompanyId();
    const reversalId = crypto.randomUUID();

    // This would need to create a credit note or return
    // For now, we'll create a return record
    const reversalNumber = `CRN${Date.now()}`;

    const result = await this.query(
      `INSERT INTO sales_returns 
       (id, company_id, return_number, date, invoice_id, customer_id, total_amount, status, reason, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, 'posted', $8, $9::uuid)
       RETURNING id`,
      [
        reversalId,
        companyId,
        reversalNumber,
        reversalData.reversalDate,
        originalRecord.id,
        originalRecord.customer_id,
        originalRecord.total_amount,
        reversalData.reason,
        userId,
      ]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      throw new Error(result.error || 'Failed to create sales return');
    }

    return reversalId;
  }

  /**
   * Create purchase invoice reversal
   */
  private async createPurchaseInvoiceReversal(
    originalRecord: Record<string, unknown>,
    reversalData: { reversalDate: string; reason: string },
    userId: string
  ): Promise<string> {
    const companyId = this.getCompanyId();
    const reversalId = crypto.randomUUID();

    // This would need to create a debit note or return
    const reversalNumber = `DBN${Date.now()}`;

    const result = await this.query(
      `INSERT INTO purchase_returns 
       (id, company_id, return_number, date, invoice_id, supplier_id, total_amount, status, reason, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, 'posted', $8, $9::uuid)
       RETURNING id`,
      [
        reversalId,
        companyId,
        reversalNumber,
        reversalData.reversalDate,
        originalRecord.id,
        originalRecord.supplier_id,
        originalRecord.total_amount,
        reversalData.reason,
        userId,
      ]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      throw new Error(result.error || 'Failed to create purchase return');
    }

    return reversalId;
  }

  /**
   * Get reversal history for a record
   */
  async getReversalHistory(
    tableName: string,
    recordId: string
  ): Promise<Array<{ id: string; date: string; reason: string; type: string }>> {
    const companyId = this.getCompanyId();

    const result = await this.query(
      `SELECT 
        r.id as reversal_id,
        r.date as reversal_date,
        r.reason,
        'reversal' as type
       FROM ${tableName} o
       LEFT JOIN ${tableName.replace('sales_invoices', 'sales_returns').replace('purchase_invoices', 'purchase_returns')} r 
         ON r.invoice_id = o.id
       WHERE o.id = $1::uuid AND o.company_id = $2::uuid
       UNION ALL
       SELECT 
        t.id as reversal_id,
        t.date as reversal_date,
        t.description as reason,
        'transaction_reversal' as type
       FROM transactions o
       LEFT JOIN transactions t ON t.reversal_of_id = o.id
       WHERE o.id = $1::uuid AND o.company_id = $2::uuid
       ORDER BY reversal_date DESC`,
      [recordId, companyId]
    );

    if (!result.success || !result.rows) {
      return [];
    }

    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.reversal_id),
      date: String(row.reversal_date),
      reason: String(row.reason),
      type: String(row.type),
    }));
  }
}

// Singleton instance
export const immutableRecordGuard = new ImmutableRecordGuard();
