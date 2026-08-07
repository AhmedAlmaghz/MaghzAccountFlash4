import { getDbAdapter } from '@/core/database/adapters';
import { AuditLogger, type AuditAction } from '@/core/audit';
import { useAuthStore } from '@/modules/auth/store';
import { errorHandler, tryCatchAsync } from '@/core/errorHandling';
import { serviceLogger } from '@/core/errorHandling';

/**
 * Base Service Class
 *
 * Provides common functionality for all service layers:
 * - Database access through adapter
 * - Audit logging
 * - Permission checking
 * - Multi-tenancy support
 * - Error handling
 */
export abstract class BaseService {
  /**
   * Get the current company ID from auth state
   */
  protected getCompanyId(): string {
    const user = useAuthStore.getState().user;
    if (!user?.companyId) {
      throw new Error('No company context available');
    }
    return user.companyId;
  }

  /**
   * Get the current user ID from auth state
   */
  protected getCurrentUserId(): string {
    const user = useAuthStore.getState().user;
    if (!user?.id) {
      throw new Error('No authenticated user');
    }
    return user.id;
  }

  /**
   * Check if current user has a specific permission
   */
  protected hasPermission(permission: string): boolean {
    return useAuthStore.getState().hasPermission(permission);
  }

  /**
   * Check if current user has any of the specified permissions
   */
  protected hasAnyPermission(permissions: string[]): boolean {
    return permissions.some(perm => this.hasPermission(perm));
  }

  /**
   * Get database adapter
   */
  protected async getDb() {
    return await getDbAdapter();
  }

  /**
   * Execute a database query with automatic company_id filtering
   */
  protected async query(sql: string, params: unknown[] = [], autoAddCompanyId = true) {
    const adapter = await this.getDb();

    if (autoAddCompanyId) {
      // Guard: throws if no company context (multi-tenancy safety)
      this.getCompanyId();
      // Ensure query already has company_id filter (defense-in-depth)
      if (!sql.toLowerCase().includes('company_id')) {
        throw new Error('Query must include company_id filter for security');
      }
    }

    return adapter.query(sql, params);
  }

  /**
   * Execute a transaction with automatic company_id filtering
   */
  protected async transaction(queries: { sql: string; params?: unknown[] }[], autoAddCompanyId = true) {
    const adapter = await this.getDb();

    if (autoAddCompanyId) {
      // Guard: throws if no company context (multi-tenancy safety)
      this.getCompanyId();
      // Ensure all queries have company_id filter
      for (const q of queries) {
        if (!q.sql.toLowerCase().includes('company_id')) {
          throw new Error('All queries in transaction must include company_id filter for security');
        }
      }
    }

    return adapter.transaction(queries);
  }

  /**
   * Log an audit entry
   */
  protected async auditLog(entry: {
    tableName: string;
    recordId: string;
    action: AuditAction;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    companyId?: string;
  }): Promise<void> {
    await AuditLogger.log({
      ...entry,
      companyId: entry.companyId || this.getCompanyId(),
    });
  }

  /**
   * Validate required permissions before executing an operation
   */
  protected requirePermission(permission: string): void {
    if (!this.hasPermission(permission)) {
      throw new Error(`Permission required: ${permission}`);
    }
  }

  /**
   * Validate required permissions before executing an operation (any of multiple)
   */
  protected requireAnyPermission(permissions: string[]): void {
    if (!this.hasAnyPermission(permissions)) {
      throw new Error(`One of these permissions required: ${permissions.join(', ')}`);
    }
  }

  /**
   * Handle errors consistently across services
   */
  protected handleError(error: unknown, context: string): never {
    serviceLogger.error(`Service error in ${context}`, { error }, error instanceof Error ? error : undefined);

    // Use central error handler
    throw errorHandler.handle(error, {
      context,
      service: this.constructor.name,
    });
  }

  /**
   * Execute an operation with error handling
   */
  protected async executeWithErrorHandling<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    serviceLogger.debug(`Executing: ${context}`);

    return tryCatchAsync(async () => {
      const result = await operation();
      serviceLogger.debug(`Completed: ${context}`);
      return result;
    }, { context });
  }
}
