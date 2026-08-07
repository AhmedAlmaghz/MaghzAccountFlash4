import { getDbAdapter } from '@/core/database/adapters';
import { mapRows } from '@/core/utils/mapPgRow';
import { validateInput, companyIdSchema, idCompanySchema } from '@/core/utils/validation';
import type {
  User,
  Permission,
  Role,
  AuditLog,
  LoginCredentials,
  UserFilters,
  RoleFilters,
  AuditLogFilters,
} from './types';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 32;
const KEY_LENGTH = 256;

function generateSalt(): string {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hashHex}`;
}

function mapRowToRole(row: Record<string, unknown>): Role {
  return {
    ...row,
    isSystem: row.is_system as boolean | undefined,
    permissions: Array.isArray(row.permissions)
      ? row.permissions
      : JSON.parse((row.permissions as string) || '[]'),
  } as Role;
}

function mapRowToAuditLog(row: Record<string, unknown>): AuditLog {
  const rawNew = row.new_values as unknown;
  const newValues = typeof rawNew === 'string' ? safeJsonParse(rawNew) : (rawNew as Record<string, unknown> | undefined);
  const rawOld = row.old_values as unknown;
  const oldValues = typeof rawOld === 'string' ? safeJsonParse(rawOld) : (rawOld as Record<string, unknown> | undefined);

  const username = (row.username as string)
    || (newValues?._username as string)
    || '';
  const recordLabel = (newValues?._label as string) || '';

  return {
    ...row,
    oldValues,
    newValues,
    username,
    recordLabel,
    createdAt: (row.created_at as string) || (row.createdAt as string),
  } as AuditLog;
}

function safeJsonParse(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export const authApi = {
  async login(credentials: LoginCredentials): Promise<{ success: boolean; user?: User; permissions?: Permission[]; error?: string }> {
    try {
      if (!window.electronAuth) return { success: false, error: 'خدمة المصادقة غير متاحة' };
      const result = await window.electronAuth.login({
        username: credentials.username,
        password: credentials.password,
      });
      if (!result.success || !result.user) return { success: false, error: result.error || 'اسم المستخدم أو كلمة المرور غير صحيحة' };

      if (credentials.rememberMe) {
        localStorage.setItem('auth_remember', credentials.username);
      }

      return { success: true, user: result.user as User, permissions: (result.permissions || []) as Permission[] };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء تسجيل الدخول' };
    }
  },

  async logout(): Promise<void> {
    try {
      await window.electronAuth?.logout();
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_remember');
    } catch {
      // silently ignore storage errors
    }
  },

  async getCurrentUser(): Promise<User | null> {
    try {
      const stored = localStorage.getItem('auth_user');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  },

  async getUsers(companyId: string, filters?: UserFilters): Promise<{ success: boolean; data?: User[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (window.electronAuth) {
        const result = await window.electronAuth.listUsers();
        if (!result.success) return { success: false, error: result.error };
        let users = mapRows<User>(result.data || []);
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          users = users.filter((u) => (u.username?.toLowerCase() || '').includes(q) || (u.email && u.email.toLowerCase().includes(q)));
        }
        if (filters?.role) users = users.filter((u) => u.role === filters.role);
        if (filters?.branchId) users = users.filter((u) => u.branchId === filters.branchId);
        if (filters?.isActive !== undefined) users = users.filter((u) => u.isActive === filters.isActive);
        return { success: true, data: users };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'SELECT * FROM users WHERE company_id = $1 ORDER BY username',
        [companyId]
      );
      if (result.success) {
        let users = mapRows<User>(result.rows);
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          users = users.filter((u) => (u.username?.toLowerCase() || '').includes(q) || (u.email && u.email.toLowerCase().includes(q)));
        }
        if (filters?.role) {
          users = users.filter((u) => u.role === filters.role);
        }
        if (filters?.branchId) {
          users = users.filter((u) => u.branchId === filters.branchId);
        }
        if (filters?.isActive !== undefined) {
          users = users.filter((u) => u.isActive === filters.isActive);
        }
        return { success: true, data: users };
      }
      return { success: false, error: result.error };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء جلب المستخدمين' };
    }
  },

  async getUserById(companyId: string, id: string): Promise<{ success: boolean; data?: User; error?: string }> {
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query('SELECT * FROM users WHERE id = $1 AND company_id = $2', [id, companyId]);
      if (result.success && result.rows && result.rows.length > 0) {
        return { success: true, data: mapRows<User>(result.rows)[0] };
      }
      return { success: false, error: result.error || 'User not found' };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء جلب المستخدم' };
    }
  },

  async createUser(data: Omit<User, 'id'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const pw = (data as Record<string, unknown>).password as string | undefined;
      if (!pw) {
        return { success: false, error: 'كلمة المرور مطلوبة' };
      }
      if (window.electronAuth) {
        return window.electronAuth.createUser({
          username: data.username,
          email: data.email,
          fullName: data.fullName,
          phone: data.phone,
          role: data.role,
          roleId: data.roleId,
          branchId: data.branchId,
          isActive: data.isActive,
          password: pw,
        });
      }
      const passwordHash = await hashPassword(pw);
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO users (company_id, username, email, full_name, phone, role, role_id, branch_id, is_active, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          data.companyId,
          data.username,
          data.email,
          data.fullName,
          data.phone,
          data.role,
          data.roleId,
          data.branchId,
          data.isActive,
          passwordHash,
          new Date().toISOString(),
        ]
      );
      if (result.success && result.rows?.[0]) {
        return { success: true, id: (result.rows[0] as Record<string, unknown>).id as string };
      }
      return { success: false, error: result.error };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء إنشاء المستخدم' };
    }
  },

  async updateUser(companyId: string, id: string, data: Partial<User>): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAuth) return window.electronAuth.updateUser(id, data as Record<string, unknown>);
      const adapter = await getDbAdapter();
      return adapter.query(
        `UPDATE users SET username = $1, email = $2, full_name = $3, phone = $4, role = $5, role_id = $6, branch_id = $7, is_active = $8, updated_at = $9 WHERE id = $10 AND company_id = $11`,
        [data.username, data.email, data.fullName, data.phone, data.role, data.roleId, data.branchId, data.isActive, new Date().toISOString(), id, companyId]
      );
    } catch {
      return { success: false, error: 'حدث خطأ أثناء تحديث المستخدم' };
    }
  },

  async deleteUser(companyId: string, id: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAuth) return window.electronAuth.deleteUser(id);
      const adapter = await getDbAdapter();
      return adapter.query('DELETE FROM users WHERE id = $1 AND company_id = $2', [id, companyId]);
    } catch {
      return { success: false, error: 'حدث خطأ أثناء حذف المستخدم' };
    }
  },

  async resetPassword(companyId: string, id: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cidValidation = validateInput(idCompanySchema, { id, companyId });
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (window.electronAuth) return window.electronAuth.resetPassword(id, newPassword);
      const adapter = await getDbAdapter();
      const passwordHash = await hashPassword(newPassword);
      return adapter.query(
        'UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3 AND company_id = $4',
        [passwordHash, new Date().toISOString(), id, companyId]
      );
    } catch {
      return { success: false, error: 'حدث خطأ أثناء إعادة تعيين كلمة المرور' };
    }
  },

  async getRoles(companyId: string, filters?: RoleFilters): Promise<{ success: boolean; data?: Role[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (window.electronAuth?.listRoles) {
        const result = await window.electronAuth.listRoles();
        if (!result.success) return { success: false, error: result.error };
        let roles = (result.data || []).map((row) => mapRowToRole(row as Record<string, unknown>)) as Role[];
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          roles = roles.filter((r) => (r.name?.toLowerCase() || '').includes(q));
        }
        return { success: true, data: roles };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('SELECT * FROM roles WHERE company_id = $1 OR company_id IS NULL ORDER BY name', [companyId]);
      if (result.success) {
        let roles = (result.rows || []).map((row) => mapRowToRole(row as Record<string, unknown>)) as Role[];
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          roles = roles.filter((r) => (r.name?.toLowerCase() || '').includes(q));
        }
        return { success: true, data: roles };
      }
      return { success: false, error: result.error };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء جلب الأدوار' };
    }
  },

  async getRoleById(companyId: string, id: string): Promise<{ success: boolean; data?: Role; error?: string }> {
    try {
      const roles = await this.getRoles(companyId);
      if (roles.success && roles.data) {
        const role = roles.data.find((r) => r.id === id);
        if (role) return { success: true, data: role };
      }
      return { success: false, error: 'Role not found' };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء جلب الدور' };
    }
  },

  async createRole(data: Omit<Role, 'id'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (window.electronAuth?.createRole) {
        const result = await window.electronAuth.createRole({
          name: data.name,
          description: data.description,
          permissions: data.permissions,
          isSystem: data.isSystem ?? false,
        });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, id: result.id };
      }
      const adapter = await getDbAdapter();
      const permsJson = JSON.stringify(data.permissions);
      const result = await adapter.query(
        `INSERT INTO roles (company_id, name, description, permissions, is_system, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [data.companyId, data.name, data.description, permsJson, data.isSystem ?? false, new Date().toISOString()]
      );
      if (result.success && result.rows?.[0]) {
        return { success: true, id: (result.rows[0] as Record<string, unknown>).id as string };
      }
      return { success: false, error: result.error };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء إنشاء الدور' };
    }
  },

  async updateRole(companyId: string, id: string, data: Partial<Role>): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAuth?.updateRole) {
        const result = await window.electronAuth.updateRole(id, {
          name: data.name,
          description: data.description,
          permissions: data.permissions,
          isSystem: data.isSystem,
        });
        return result.success ? { success: true } : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const permsJson = data.permissions ? JSON.stringify(data.permissions) : undefined;
      return adapter.query(
        `UPDATE roles SET name = $1, description = $2, permissions = $3, is_system = $4, updated_at = $5 WHERE id = $6 AND company_id = $7`,
        [data.name, data.description, permsJson, data.isSystem, new Date().toISOString(), id, companyId]
      );
    } catch {
      return { success: false, error: 'حدث خطأ أثناء تحديث الدور' };
    }
  },

  async deleteRole(companyId: string, id: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAuth?.deleteRole) {
        const result = await window.electronAuth.deleteRole(id);
        return result.success ? { success: true } : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      return adapter.query('DELETE FROM roles WHERE id = $1 AND company_id = $2', [id, companyId]);
    } catch {
      return { success: false, error: 'حدث خطأ أثناء حذف الدور' };
    }
  },

  async getAuditLogs(companyId: string, filters?: AuditLogFilters): Promise<{ success: boolean; data?: AuditLog[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (window.electronAuth?.getAuditLogs) {
        const result = await window.electronAuth.getAuditLogs(filters);
        if (!result.success) return { success: false, error: result.error };
        const logs = (result.data || []).map((row) => mapRowToAuditLog(row as Record<string, unknown>)) as AuditLog[];
        return { success: true, data: logs };
      }
      const adapter = await getDbAdapter();

      // JOIN users to get username for the audit log
      let sql = `SELECT al.id, al.user_id, al.action, al.table_name, al.record_id,
                        al.old_values, al.new_values, al.ip_address, al.company_id, al.created_at,
                        u.username
                   FROM audit_logs al
                   LEFT JOIN users u ON u.id = al.user_id
                   WHERE al.company_id = $1`;
      const params: unknown[] = [companyId];

      if (filters?.userId) {
        sql += ' AND al.user_id = $' + (params.length + 1);
        params.push(filters.userId);
      }
      if (filters?.tableName) {
        sql += ' AND al.table_name = $' + (params.length + 1);
        params.push(filters.tableName);
      }
      if (filters?.action) {
        sql += ' AND al.action = $' + (params.length + 1);
        params.push(filters.action);
      }
      if (filters?.fromDate) {
        sql += ' AND al.created_at >= $' + (params.length + 1);
        params.push(filters.fromDate);
      }
      if (filters?.toDate) {
        sql += ' AND al.created_at <= $' + (params.length + 1);
        params.push(filters.toDate);
      }

      sql += ' ORDER BY al.created_at DESC LIMIT 1000';

      const result = await adapter.query(sql, params);
      if (result.success) {
        const logs = (result.rows || []).map((row) => mapRowToAuditLog(row as Record<string, unknown>)) as AuditLog[];
        return { success: true, data: logs };
      }
      return { success: false, error: result.error };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء جلب سجل المراجعة' };
    }
  },
};
