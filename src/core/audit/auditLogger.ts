import { getDbAdapter } from '@/core/database/adapters';
import { useAuthStore } from '@/modules/auth/store';

export type AuditAction = 'create' | 'update' | 'delete' | 'post' | 'cancel' | 'reverse' | 'login' | 'logout' | 'export' | 'import';

export interface AuditLogEntry {
  tableName: string;
  recordId: string;
  action: AuditAction;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  companyId?: string;
}

/**
 * Centralized Audit Logger
 * 
 * This service provides a unified way to log sensitive operations across all modules.
 * All critical operations (create, update, delete, post, cancel, etc.) should be logged
 * through this service for security and compliance purposes.
 */
export class AuditLogger {
  /**
   * Log an audit entry
   * 
   * @param entry The audit log entry to record
   * @returns Promise resolving to success status
   */
  static async log(entry: AuditLogEntry): Promise<{ success: boolean; error?: string }> {
    try {
      const authState = useAuthStore.getState();
      const user = authState.user;
      
      if (!user) {
        return { success: false, error: 'No authenticated user' };
      }

      const companyId = entry.companyId || user.companyId;
      if (!companyId) {
        return { success: false, error: 'No company context' };
      }

      const adapter = await getDbAdapter();
      
      const result = await adapter.query(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, company_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)`,
        [
          user.id,
          entry.action,
          entry.tableName,
          entry.recordId,
          entry.oldValues ? JSON.stringify(entry.oldValues) : null,
          entry.newValues ? JSON.stringify(entry.newValues) : null,
          companyId,
        ]
      );

      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (error) {
      console.error('Audit log failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Log a create operation
   */
  static async logCreate(tableName: string, recordId: string, newValues: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'create',
      newValues,
      companyId,
    });
  }

  /**
   * Log an update operation
   */
  static async logUpdate(tableName: string, recordId: string, oldValues: Record<string, unknown>, newValues: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'update',
      oldValues,
      newValues,
      companyId,
    });
  }

  /**
   * Log a delete operation
   */
  static async logDelete(tableName: string, recordId: string, oldValues: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'delete',
      oldValues,
      companyId,
    });
  }

  /**
   * Log a post operation (for financial documents)
   */
  static async logPost(tableName: string, recordId: string, values: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'post',
      newValues: values,
      companyId,
    });
  }

  /**
   * Log a cancel operation
   */
  static async logCancel(tableName: string, recordId: string, oldValues: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'cancel',
      oldValues,
      companyId,
    });
  }

  /**
   * Log a reverse operation
   */
  static async logReverse(tableName: string, recordId: string, oldValues: Record<string, unknown>, newValues: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'reverse',
      oldValues,
      newValues,
      companyId,
    });
  }

  /**
   * Log login event
   */
  static async logLogin(): Promise<void> {
    const authState = useAuthStore.getState();
    const user = authState.user;
    
    if (!user) return;

    await this.log({
      tableName: 'users',
      recordId: user.id,
      action: 'login',
      newValues: { username: user.username, role: user.role },
      companyId: user.companyId,
    });
  }

  /**
   * Log logout event
   */
  static async logLogout(): Promise<void> {
    const authState = useAuthStore.getState();
    const user = authState.user;
    
    if (!user) return;

    await this.log({
      tableName: 'users',
      recordId: user.id,
      action: 'logout',
      oldValues: { username: user.username, role: user.role },
      companyId: user.companyId,
    });
  }

  /**
   * Log export operation
   */
  static async logExport(tableName: string, recordId: string, filters?: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'export',
      newValues: filters,
      companyId,
    });
  }

  /**
   * Log import operation
   */
  static async logImport(tableName: string, recordId: string, values: Record<string, unknown>, companyId?: string): Promise<void> {
    await this.log({
      tableName,
      recordId,
      action: 'import',
      newValues: values,
      companyId,
    });
  }
}

/**
 * Higher-order function to wrap operations with audit logging
 * 
 * @param operation The operation to execute
 * @param auditConfig Audit configuration
 * @returns Result of the operation with audit logging
 */
export async function withAuditLog<T>(
  operation: () => Promise<T>,
  auditConfig: {
    tableName: string;
    recordId: string;
    action: AuditAction;
    oldValues?: Record<string, unknown>;
    getNewValues?: (result: T) => Record<string, unknown>;
    companyId?: string;
  }
): Promise<T> {
  try {
    const result = await operation();
    
    const newValues = auditConfig.getNewValues ? auditConfig.getNewValues(result) : undefined;
    
    await AuditLogger.log({
      tableName: auditConfig.tableName,
      recordId: auditConfig.recordId,
      action: auditConfig.action,
      oldValues: auditConfig.oldValues,
      newValues,
      companyId: auditConfig.companyId,
    });
    
    return result;
  } catch (error) {
    console.error('Operation failed, audit log skipped:', error);
    throw error;
  }
}
