import { getDbAdapter, isElectronPg } from '@/core/database/adapters';

type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

/** The audit surface on the Electron bridge, or null off-desktop. */
function auditRpc() {
  return (typeof window !== 'undefined' && window.electronDB?.audit) || null;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'post'
  | 'cancel'
  | 'login'
  | 'logout'
  | 'reset_password'
  | 'toggle_active'
  // Phase 4: policy-override trail (negative stock/cashbox, credit overlimit).
  | 'override';

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
    const enrichedNewValues = entry.recordLabel
      ? { ...(entry.newValues || {}), _label: entry.recordLabel, _username: entry.username }
      : entry.newValues;

    // On desktop the insert goes through a typed channel that takes the company
    // AND the user id from the authenticated session. The renderer used to
    // supply both, which meant any authenticated caller could file an entry
    // against another company — and 71 call sites in 30 files did supply them.
    // An audit entry is a claim about who did what, so the writer must not be
    // the one choosing the company.
    if (isElectronPg() && auditRpc()) {
      const res = (await auditRpc()!.log({
        action: entry.action,
        tableName: entry.tableName,
        recordId: entry.recordId,
        oldValues: entry.oldValues || null,
        newValues: enrichedNewValues || null,
        ipAddress: entry.ipAddress || null,
      })) as RpcEnvelope;
      // Audit failures are swallowed on purpose: a missing trail entry must not
      // roll back a posted invoice. Same contract as the fallback below.
      void res;
      return;
    }

    const adapter = await getDbAdapter();
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
    // Same reasoning as the write: the filter shape is composed in the main
    // process, and the company comes from the session rather than a parameter
    // that any caller could hand us.
    if (isElectronPg() && auditRpc()) {
      const res = (await auditRpc()!.list({
        userId: filters?.userId,
        tableName: filters?.tableName,
        action: filters?.action,
        fromDate: filters?.fromDate,
        toDate: filters?.toDate,
      })) as RpcEnvelope;
      if (!res.success) return { success: false, error: res.error, data: [] };
      return { success: true, rows: res.rows || [], data: res.rows || [] };
    }

    const adapter = await getDbAdapter();
    const params: unknown[] = [companyId];
    const conditions = ['company_id = $N'];

    if (filters?.userId) {
      params.push(filters.userId);
      conditions.push(`user_id = $N`);
    }
    if (filters?.tableName) {
      params.push(filters.tableName);
      conditions.push(`table_name = $N`);
    }
    if (filters?.action) {
      params.push(filters.action);
      conditions.push(`action = $N`);
    }
    if (filters?.fromDate) {
      params.push(filters.fromDate);
      conditions.push(`created_at >= $N`);
    }
    if (filters?.toDate) {
      params.push(filters.toDate);
      conditions.push(`created_at <= $N`);
    }

    // $N is a placeholder token; resolve it to the real index now that the
    // parameter order is final.
    const where = conditions
      .map((c, i) => (c.startsWith('company_id') ? `company_id = $1` : c.replace('$N', '$' + (i + 1))))
      .join(' AND ');

    const result = await adapter.query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT 1000`,
      params
    );
    return result;
  } catch (error) {
    return { success: false, error: String(error), data: [] };
  }
}

export default logAudit;
