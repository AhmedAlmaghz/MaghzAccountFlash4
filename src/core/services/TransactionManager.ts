import { BaseService } from './BaseService';

/**
 * Transaction Manager
 * 
 * Provides advanced transaction management capabilities:
 * - Retry logic for failed transactions
 * - Deadlock detection and handling
 * - Transaction isolation levels
 * - Distributed transaction coordination (future)
 */
export class TransactionManager extends BaseService {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;

  /**
   * Execute a transaction with automatic retry on deadlock
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a deadlock error (PostgreSQL error code 40P01)
        if (this.isDeadlockError(lastError)) {
          console.warn(`Deadlock detected in ${context}, retry attempt ${attempt}/${this.MAX_RETRIES}`);
          
          if (attempt < this.MAX_RETRIES) {
            await this.delay(this.RETRY_DELAY_MS * attempt);
            continue;
          }
        }
        
        // Not a deadlock or max retries reached
        throw lastError;
      }
    }
    
    throw lastError;
  }

  /**
   * Execute a complex transaction with validation phases
   */
  async executeWithValidation(
    phases: Array<{
      name: string;
      validate: () => Promise<boolean>;
      execute: () => Promise<void>;
      rollback?: () => Promise<void>;
    }>,
    context: string
  ): Promise<void> {
    const completedPhases: string[] = [];
    
    try {
      for (const phase of phases) {
        // Validate phase
        const isValid = await phase.validate();
        if (!isValid) {
          throw new Error(`Validation failed for phase: ${phase.name}`);
        }
        
        // Execute phase
        await phase.execute();
        completedPhases.push(phase.name);
      }
    } catch (error) {
      // Rollback completed phases in reverse order
      console.error(`Transaction failed in ${context}, rolling back phases:`, completedPhases);
      
      for (let i = completedPhases.length - 1; i >= 0; i--) {
        const phaseName = completedPhases[i];
        const phase = phases.find(p => p.name === phaseName);
        
        if (phase?.rollback) {
          try {
            await phase.rollback();
          } catch (rollbackError) {
            console.error(`Rollback failed for phase ${phaseName}:`, rollbackError);
          }
        }
      }
      
      throw error;
    }
  }

  /**
   * Check if error is a deadlock error
   */
  private isDeadlockError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    return errorMessage.includes('deadlock') || 
           errorMessage.includes('40p01') ||
           errorMessage.includes('could not serialize');
  }

  /**
   * Delay for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate transaction consistency
   */
  async validateTransactionConsistency(
    transactionId: string,
    expectedDebits: number,
    expectedCredits: number
  ): Promise<{ valid: boolean; actualDebits: number; actualCredits: number }> {
    const companyId = this.getCompanyId();
    
    const result = await this.query(
      `SELECT 
        COALESCE(SUM(debit), 0) as total_debit,
        COALESCE(SUM(credit), 0) as total_credit
       FROM journal_entries
       WHERE transaction_id = $1::uuid AND company_id = $2::uuid`,
      [transactionId, companyId]
    );
    
    if (!result.success || !result.rows || result.rows.length === 0) {
      return { valid: false, actualDebits: 0, actualCredits: 0 };
    }
    
    const row = result.rows[0] as Record<string, unknown>;
    const actualDebits = Number(row.total_debit) || 0;
    const actualCredits = Number(row.total_credit) || 0;
    
    const valid = Math.abs(actualDebits - expectedDebits) < 0.01 &&
                  Math.abs(actualCredits - expectedCredits) < 0.01 &&
                  Math.abs(actualDebits - actualCredits) < 0.01;
    
    return { valid, actualDebits, actualCredits };
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId: string): Promise<{
    exists: boolean;
    status: string;
    hasEntries: boolean;
    isBalanced: boolean;
  }> {
    const companyId = this.getCompanyId();
    
    const result = await this.query(
      `SELECT 
        t.status,
        COUNT(je.id) as entry_count,
        COALESCE(SUM(je.debit), 0) as total_debit,
        COALESCE(SUM(je.credit), 0) as total_credit
       FROM transactions t
       LEFT JOIN journal_entries je ON je.transaction_id = t.id
       WHERE t.id = $1::uuid AND t.company_id = $2::uuid
       GROUP BY t.status`,
      [transactionId, companyId]
    );
    
    if (!result.success || !result.rows || result.rows.length === 0) {
      return { exists: false, status: 'unknown', hasEntries: false, isBalanced: false };
    }
    
    const row = result.rows[0] as Record<string, unknown>;
    const totalDebit = Number(row.total_debit) || 0;
    const totalCredit = Number(row.total_credit) || 0;
    
    return {
      exists: true,
      status: String(row.status),
      hasEntries: Number(row.entry_count) > 0,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  }
}

// Singleton instance
export const transactionManager = new TransactionManager();
