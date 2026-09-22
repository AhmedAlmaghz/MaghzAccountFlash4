import { getDbAdapter, getDbMode } from '@/core/database/adapters';
import { mapRows } from '@/core/utils/mapPgRow';

/**
 * Main-process auth bridge — authoritative ONLY when the desktop app runs
 * on server Postgres (db mode 'pg'). In PGlite/remote-web modes the users
 * table lives in the ACTIVE adapter (renderer-side) while the main pool
 * points elsewhere (usually nowhere): routing auth there rejects perfectly
 * valid accounts with "wrong username or password". Returns null on web,
 * in tests, or whenever the mode is not server-PG.
 */
function mainAuthBridge(): Window['electronAuth'] | null {
  try {
    if (typeof window === 'undefined' || !window.electronAuth) return null;
    // getDbMode may be absent in unit-test module mocks — treat unreadable
    // mode as "not server-PG" (adapter path), never as main.
    if (typeof getDbMode !== 'function' || getDbMode() !== 'pg') return null;
    return window.electronAuth;
  } catch {
    return null;
  }
}
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

async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  const parts = typeof storedHash === 'string' ? storedHash.split(':') : [];
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 100000 || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(expected)) return false;
  try {
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
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      expected.length / 2 * 8
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const actualHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return constantTimeEqual(actualHex.toLowerCase(), expected.toLowerCase());
  } catch {
    return false;
  }
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
    userId: (row.user_id as string) || (row.userId as string) || '',
    companyId: (row.company_id as string) || (row.companyId as string) || '',
    tableName: (row.table_name as string) || (row.tableName as string) || '',
    recordId: row.record_id != null ? String(row.record_id) : ((row.recordId as string) || ''),
    ipAddress: (row.ip_address as string) || (row.ipAddress as string),
    createdAt: (row.created_at as string) || (row.createdAt as string),
  } as AuditLog;
}

// ─── PGlite rate-limit (browser fallback) ────────────────────────────────────
const pgliteLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const PGLITE_LOGIN_LIMIT = 5;
const PGLITE_LOGIN_WINDOW = 60_000;
const PGLITE_LOGIN_LOCKOUT = 5 * 60_000;

function pgliteCheckRateLimit(username: string): { allowed: boolean; retryAfterMs?: number } {
  const key = `u:${username.trim().toLowerCase()}`;
  const now = Date.now();
  const bucket = pgliteLoginAttempts.get(key);
  if (!bucket || now >= bucket.resetAt) return { allowed: true };
  if (bucket.count >= PGLITE_LOGIN_LIMIT) return { allowed: false, retryAfterMs: bucket.resetAt - now };
  return { allowed: true };
}
function pgliteRecordFailed(username: string): void {
  const key = `u:${username.trim().toLowerCase()}`;
  const now = Date.now();
  const bucket = pgliteLoginAttempts.get(key);
  if (!bucket || now >= bucket.resetAt) {
    pgliteLoginAttempts.set(key, { count: 1, resetAt: now + PGLITE_LOGIN_WINDOW + (bucket ? PGLITE_LOGIN_LOCKOUT : 0) });
    return;
  }
  bucket.count += 1;
  if (bucket.count >= PGLITE_LOGIN_LIMIT) bucket.resetAt = now + PGLITE_LOGIN_LOCKOUT;
}
function pgliteClearAttempts(username: string): void {
  pgliteLoginAttempts.delete(`u:${username.trim().toLowerCase()}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
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
      const mainAuth = mainAuthBridge();
      if (!mainAuth) {
        // Browser/PGlite fallback — verify against the users table directly.
        const rate = pgliteCheckRateLimit(credentials.username);
        if (!rate.allowed) {
          const mins = Math.ceil((rate.retryAfterMs || 0) / 60000);
          return { success: false, error: `محاولات كثيرة — حاول بعد ${mins} دقيقة` };
        }
        const adapter = await getDbAdapter();
        const result = await adapter.query(
          `SELECT id, company_id, username, email, full_name, phone, photo_url, role, branch_id, is_active, password_hash
             FROM users WHERE username = $1`,
          [credentials.username.trim()]
        );
        if (!result.success) return { success: false, error: result.error || 'حدث خطأ أثناء تسجيل الدخول' };
        const rows = (result.rows || []) as Array<Record<string, unknown>>;
        let row: Record<string, unknown> | undefined;
        for (const candidate of rows) {
          if (candidate.is_active && await verifyPassword(credentials.password, candidate.password_hash as string | null)) {
            row = candidate;
            break;
          }
        }
        if (!row) { pgliteRecordFailed(credentials.username); return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }; }
        pgliteClearAttempts(credentials.username);

        let permissions: Permission[] = [];
        let roleId: string | undefined;
        const roleName = row.role ? String(row.role) : undefined;
        if (roleName) {
          const rolesResult = await adapter.query(
            'SELECT id, permissions FROM roles WHERE name = $1 AND company_id = $2',
            [roleName, String(row.company_id)]
          );
          if (rolesResult.success && rolesResult.rows?.[0]) {
            const roleRow = rolesResult.rows[0] as Record<string, unknown>;
            roleId = roleRow.id ? String(roleRow.id) : undefined;
            const raw = roleRow.permissions as unknown;
            if (Array.isArray(raw)) permissions = raw as Permission[];
            else if (typeof raw === 'string') {
              try { permissions = JSON.parse(raw) as Permission[]; } catch { permissions = []; }
            }
          }
        }

        const user: User = {
          id: String(row.id),
          companyId: String(row.company_id),
          username: String(row.username),
          email: row.email ? String(row.email) : undefined,
          fullName: row.full_name ? String(row.full_name) : undefined,
          phone: row.phone ? String(row.phone) : undefined,
          photoUrl: row.photo_url ? String(row.photo_url) : undefined,
          role: (roleName || 'viewer') as User['role'],
          roleId,
          branchId: row.branch_id ? String(row.branch_id) : null,
          isActive: Boolean(row.is_active),
        };

        if (row.id && row.company_id) {
          await adapter.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1 AND company_id = $2',
            [String(row.id), String(row.company_id)]
          );
        }

        if (credentials.rememberMe) {
          localStorage.setItem('auth_remember', credentials.username);
        }

        return { success: true, user, permissions };
      }
      const result = await mainAuth.login({
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
      const mainAuth = mainAuthBridge();
      if (mainAuth) {
        const result = await mainAuth.listUsers();
        if (!result.success) return { success: false, error: result.error };
        let users = mapRows<User>(result.data || []);
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          users = users.filter((u) => (u.username?.toLowerCase() || '').includes(q) || (u.fullName?.toLowerCase() || '').includes(q) || (u.email && u.email.toLowerCase().includes(q)));
        }
        if (filters?.role) users = users.filter((u) => u.role === filters.role);
        if (filters?.branchId) users = users.filter((u) => u.branchId === filters.branchId);
        if (filters?.isActive !== undefined) users = users.filter((u) => u.isActive === filters.isActive);
        return { success: true, data: users };
      }
      const adapter = await getDbAdapter();
      // Server-side filtering with ILIKE for search (username, full_name, email)
      const conditions: string[] = ['company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.search) {
        const q = `%${filters.search}%`;
        params.push(q);
        conditions.push(`(username ILIKE $${params.length} OR full_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
      }
      if (filters?.role) {
        params.push(filters.role);
        conditions.push(`role = $${params.length}`);
      }
      if (filters?.branchId) {
        params.push(filters.branchId);
        conditions.push(`branch_id = $${params.length}::uuid`);
      }
      if (filters?.isActive !== undefined) {
        params.push(filters.isActive);
        conditions.push(`is_active = $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const result = await adapter.query(
        `SELECT * FROM users WHERE ${where} ORDER BY username LIMIT 500`,
        params
      );
      if (result.success) {
        return { success: true, data: mapRows<User>(result.rows) };
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
      const pw = (data as Record<string, unknown>).password as string | undefined;
      if (!pw) {
        return { success: false, error: 'كلمة المرور مطلوبة' };
      }
      const mainAuth = mainAuthBridge();
      if (mainAuth) {
        return mainAuth.createUser({
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
      // PGlite/browser fallback: validate via Zod and use direct SQL (no role_id column)
      const { validateInput: _validate, createUserSchema: _schema } = await import('@/core/utils/validation');
      const parsed = _validate(_schema, { ...data, password: pw });
      if (!parsed.success) return { success: false, error: parsed.error };
      const passwordHash = await hashPassword(pw);
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO users (company_id, username, email, full_name, phone, role, branch_id, is_active, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, NOW()) RETURNING id`,
        [
          parsed.data.companyId,
          parsed.data.username,
          parsed.data.email || null,
          parsed.data.fullName || parsed.data.username,
          parsed.data.phone || null,
          parsed.data.role,
          parsed.data.branchId || null,
          parsed.data.isActive !== false,
          passwordHash,
        ]
      );
      if (result.success && result.rows?.[0]) {
        return { success: true, id: (result.rows[0] as Record<string, unknown>).id as string };
      }
      return { success: false, error: result.error || 'Username already exists' };
    } catch (e) {
      const msg = String((e as Error).message || '');
      if (msg.includes('23505') || msg.toLowerCase().includes('duplicate')) return { success: false, error: 'Username already exists' };
      return { success: false, error: 'حدث خطأ أثناء إنشاء المستخدم' };
    }
  },

  async updateUser(companyId: string, id: string, data: Partial<User>): Promise<{ success: boolean; error?: string }> {
    try {
      const mainAuth = mainAuthBridge();
      if (mainAuth) return mainAuth.updateUser(id, data as Record<string, unknown>);
      const { validateInput: _validate, updateUserSchema: _schema } = await import('@/core/utils/validation');
      const parsed = _validate(_schema, data);
      if (!parsed.success) return { success: false, error: parsed.error };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (parsed.data.username !== undefined) { fields.push(`username = $${idx++}`); values.push(parsed.data.username); }
      if (parsed.data.email !== undefined) { fields.push(`email = $${idx++}`); values.push(parsed.data.email || null); }
      if (parsed.data.fullName !== undefined) { fields.push(`full_name = $${idx++}`); values.push(parsed.data.fullName || null); }
      if (parsed.data.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(parsed.data.phone || null); }
      if (parsed.data.role !== undefined) { fields.push(`role = $${idx++}`); values.push(parsed.data.role); }
      if (parsed.data.branchId !== undefined) { fields.push(`branch_id = $${idx++}::uuid`); values.push(parsed.data.branchId || null); }
      if (parsed.data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(parsed.data.isActive); }
      if ((parsed.data as Record<string, unknown>).photoUrl !== undefined) { fields.push(`photo_url = $${idx++}`); values.push((parsed.data as Record<string, unknown>).photoUrl || null); }
      if (fields.length === 0) return { success: false, error: 'No fields to update' };
      fields.push(`updated_at = NOW()`);
      values.push(id, companyId);
      return adapter.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx++}::uuid AND company_id = $${idx}::uuid`,
        values
      );
    } catch (e) {
      const msg = String((e as Error).message || '');
      if (msg.includes('23505')) return { success: false, error: 'Username already exists' };
      return { success: false, error: 'حدث خطأ أثناء تحديث المستخدم' };
    }
  },

  async deleteUser(companyId: string, id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const mainAuth = mainAuthBridge();
      if (mainAuth) return mainAuth.deleteUser(id);
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
      const mainAuth = mainAuthBridge();
      if (mainAuth) return mainAuth.resetPassword(id, newPassword);
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

  /**
   * Client-side mirror of the main-process password policy
   * (`validateNewPassword` in electron/dbHandler.js): min 12 chars with at
   * least one letter (Latin or Arabic) and one digit. The server always
   * re-enforces it — this only gives instant form feedback.
   */
  meetsPasswordPolicy(password: string): boolean {
    return (
      typeof password === 'string' &&
      password.length >= 12 &&
      /[A-Za-z\u0600-\u06FF]/.test(password) &&
      /\d/.test(password)
    );
  },

  /**
   * Self-service profile update (own row only: full name, phone, photo).
   * In Electron this goes through the session-scoped `auth:update-profile`
   * channel (no settings.edit needed); elsewhere it falls back to a direct
   * guarded UPDATE.
   */
  async updateProfile(
    companyId: string,
    id: string,
    data: { fullName?: string | null; phone?: string | null; photoUrl?: string | null },
  ): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const cidValidation = validateInput(idCompanySchema, { id, companyId });
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const mainAuth = mainAuthBridge();
      if (mainAuth?.updateProfile) {
        const result = await mainAuth.updateProfile({
          fullName: data.fullName ?? null,
          phone: data.phone ?? null,
          photoUrl: data.photoUrl ?? null,
        });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, user: result.user as User | undefined };
      }
      const adapter = await getDbAdapter();
      const fullName = typeof data.fullName === 'string' ? data.fullName.trim().slice(0, 255) || null : null;
      const phone = typeof data.phone === 'string' ? data.phone.trim().slice(0, 50) || null : null;
      const photoUrl = typeof data.photoUrl === 'string' && data.photoUrl.length <= 3000000 ? data.photoUrl : null;
      const result = await adapter.query(
        `UPDATE users SET full_name = $1, phone = $2, photo_url = $3, updated_at = $4
          WHERE id = $5 AND company_id = $6`,
        [fullName, phone, photoUrl, new Date().toISOString(), id, companyId],
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true };
    } catch {
      return { success: false, error: 'حدث خطأ أثناء تحديث الملف الشخصي' };
    }
  },

  /**
   * Self-service password change: verifies the CURRENT password first.
   * The current session stays alive; other sessions are revoked server-side.
   */
  async changePasswordSelf(
    companyId: string,
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const cidValidation = validateInput(idCompanySchema, { id, companyId });
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (!this.meetsPasswordPolicy(newPassword)) {
        return { success: false, error: 'كلمة المرور الجديدة لا تطابق السياسة (12 حرفاً على الأقل مع حرف ورقم)' };
      }
      const mainAuth = mainAuthBridge();
      if (mainAuth?.changePassword) {
        return mainAuth.changePassword(currentPassword, newPassword);
      }
      const adapter = await getDbAdapter();
      const found = await adapter.query(
        'SELECT password_hash FROM users WHERE id = $1 AND company_id = $2',
        [id, companyId],
      );
      if (!found.success) return { success: false, error: found.error };
      const row = (found.rows?.[0] ?? null) as Record<string, unknown> | null;
      if (!row) return { success: false, error: 'User not found' };
      if (!(await verifyPassword(currentPassword, row.password_hash as string | null))) {
        return { success: false, error: 'كلمة المرور الحالية غير صحيحة' };
      }
      const passwordHash = await hashPassword(newPassword);
      return adapter.query(
        'UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3 AND company_id = $4',
        [passwordHash, new Date().toISOString(), id, companyId],
      );
    } catch {
      return { success: false, error: 'حدث خطأ أثناء تغيير كلمة المرور' };
    }
  },

  async getRoles(companyId: string, filters?: RoleFilters): Promise<{ success: boolean; data?: Role[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const mainAuth = mainAuthBridge();
      if (mainAuth?.listRoles) {
        const result = await mainAuth.listRoles();
        if (!result.success) return { success: false, error: result.error };
        let roles = (result.data || []).map((row) => mapRowToRole(row as Record<string, unknown>)) as Role[];
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          roles = roles.filter((r) => (r.name?.toLowerCase() || '').includes(q));
        }
        return { success: true, data: roles };
      }
      const adapter = await getDbAdapter();
      const conditions: string[] = ['(company_id = $1 OR company_id IS NULL)'];
      const params: unknown[] = [companyId];
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`name ILIKE $${params.length}`);
      }
      const where = conditions.join(' AND ');
      const result = await adapter.query(`SELECT * FROM roles WHERE ${where} ORDER BY name`, params);
      if (result.success) {
        const roles = (result.rows || []).map((row) => mapRowToRole(row as Record<string, unknown>)) as Role[];
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
      const mainAuth = mainAuthBridge();
      if (mainAuth?.createRole) {
        const result = await mainAuth.createRole({
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
      const mainAuth = mainAuthBridge();
      if (mainAuth?.updateRole) {
        const result = await mainAuth.updateRole(id, {
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
      const mainAuth = mainAuthBridge();
      if (mainAuth?.deleteRole) {
        const result = await mainAuth.deleteRole(id);
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
      const mainAuth = mainAuthBridge();
      if (mainAuth?.getAuditLogs) {
        const result = await mainAuth.getAuditLogs(filters);
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
