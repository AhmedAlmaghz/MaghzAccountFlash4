import { getDbAdapter } from '@/core/database/adapters';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'post'
  | 'cancel'
  | 'login'
  | 'logout'
  | 'reset_password'
  | 'toggle_active';

interface AuditLogEntry {
  userId: string;
  username?: string;
  action: AuditAction;
  tableName: string;
  recordId: string;
  recordLabel?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  companyId: string;
}

function safeStringify(value: Record<string, unknown> | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const adapter = await getDbAdapter();

    const enrichedNewValues = entry.recordLabel
      ? { ...(entry.newValues || {}), _label: entry.recordLabel, _username: entry.username }
      : entry.newValues;

    await adapter.query(
      `INSERT INTO audit_logs (id, user_id, action, table_name, record_id, old_values, new_values, ip_address, company_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        crypto.randomUUID(),
        entry.userId,
        entry.action,
        entry.tableName,
        entry.recordId,
        safeStringify(entry.oldValues),
        safeStringify(enrichedNewValues),
        entry.ipAddress || null,
        entry.companyId,
      ]
    );
  } catch (_error) {
    // Silently fail audit logs - don't block main operations
  }
}

export async function getAuditLogs(
  companyId: string,
  filters?: { userId?: string; tableName?: string; action?: string; fromDate?: string; toDate?: string }
) {
  try {
    const adapter = await getDbAdapter();
    
    let sql = `SELECT * FROM audit_logs WHERE company_id = $1`;
    const params: unknown[] = [companyId];
    
    if (filters?.userId) {
      sql += ` AND user_id = $${params.length + 1}`;
      params.push(filters.userId);
    }
    if (filters?.tableName) {
      sql += ` AND table_name = $${params.length + 1}`;
      params.push(filters.tableName);
    }
    if (filters?.action) {
      sql += ` AND action = $${params.length + 1}`;
      params.push(filters.action);
    }
    if (filters?.fromDate) {
      sql += ` AND created_at >= $${params.length + 1}`;
      params.push(filters.fromDate);
    }
    if (filters?.toDate) {
      sql += ` AND created_at <= $${params.length + 1}`;
      params.push(filters.toDate);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT 1000`;
    
    const result = await adapter.query(sql, params);
    return result;
  } catch (error) {
    return { success: false, error: String(error), data: [] };
  }
}

export default logAudit;
