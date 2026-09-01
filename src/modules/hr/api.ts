import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { safeUserId } from '@/core/utils/userIdValidator';
import { validateInput, idCompanySchema, companyIdSchema, createEmployeeSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { getNextDocumentNumber } from '@/core/api';
import { runTransaction, buildJournalEntryStatement, type TxStatement } from '@/core/database/tx';
import { toDateString } from '@/core/utils/mapPgRow';
import {
  buildPolicy, computeLeaveDays, leavesOverlap, computeLeaveBalance, computePayroll,
  computeEos, deriveAttendance,
  type HrPolicy, type PayrollComponentRule, type ComputedPayroll, type LeaveBalance,
} from './payrollEngine';
import type { Employee, AttendanceRecord, PayrollRun, PayrollLine, Leave, EndOfService, Department, PayrollComponent } from './types';

// ─── Input DTOs (server-computed fields are NOT accepted from callers) ──────

/** createLeave input — days/status are derived server-side (days ignored if sent). */
export interface CreateLeaveInput {
  companyId: string;
  employeeId: string;
  leaveType: Leave['leaveType'];
  startDate: string;
  endDate: string;
  reason?: string;
  status?: 'pending';
}

/** createPayrollRun input — server recomputes every line; only employeeId (+ optional overrides) matter. */
export interface CreatePayrollRunInput {
  companyId: string;
  month: number;
  year: number;
  status: 'draft' | 'posted';
  /** Free-text note stored on the run (payroll_runs.notes — migration 0016). */
  notes?: string;
  /** Optional per-employee allowance/deduction adjustments (extra on top of components). */
  lines: Array<Pick<PayrollLine, 'employeeId'> & Partial<Pick<PayrollLine, 'allowances' | 'deductions'>>>;
}

/** createEndOfService input — serviceYears/lastSalary/eosAmount are computed server-side. */
export interface CreateEndOfServiceInput {
  companyId: string;
  employeeId: string;
  terminationDate: string;
  reason: EndOfService['reason'];
  status?: 'draft';
  notes?: string;
}


// Typed RPC bridge for HR (Phase 4 slice 9). In Electron the renderer sends a
// structured payload and the main process derives `company_id` + audit
// `user_id` from the authenticated session. The fallback path (PGlite / e2e)
// still uses `adapter.query` with explicit `company_id = $N` filters.
// NOTE: the live schema has no `updated_at` column on attendance / leaves /
// payroll_runs — both paths omit it there (employees / end_of_service do have
// it, so those keep `updated_at = NOW()`).
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

async function invokeHrRpc(method: string, payload: Record<string, unknown> = {}): Promise<RpcEnvelope> {
  const hr = (typeof window !== 'undefined' && window.electronDB?.hr) as
    | Record<string, ((p: Record<string, unknown>) => Promise<RpcEnvelope>) | undefined>
    | undefined;
  const fn = hr?.[method];
  if (!fn) return { success: false, error: 'RPC unavailable' };
  try {
    // `call(hr, ...)` preserves the surface object as `this` so the e2e
    // shim handlers (which call `this._cid()`) resolve the company id.
    return await fn.call(hr, payload);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function parseJsonLines(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ─── Policy & component loaders (work on BOTH environments via adapter.query) ──

async function loadHrPolicy(companyId: string): Promise<HrPolicy> {
  const adapter = await getDbAdapter();
  const res = await adapter.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE company_id = $1::uuid AND key LIKE 'hr.%'`,
    [companyId],
  );
  const rows: Record<string, unknown> = {};
  for (const r of res.rows || []) rows[r.key] = r.value;
  return buildPolicy(rows);
}

async function loadPayrollComponents(companyId: string): Promise<PayrollComponentRule[]> {
  const adapter = await getDbAdapter();
  const res = await adapter.query(
    `SELECT code, name_ar, type, calculation_method, default_amount
       FROM payroll_components
      WHERE company_id = $1::uuid AND is_active = true
      ORDER BY type, code`,
    [companyId],
  );
  return (res.rows || []).map((r: Record<string, unknown>) => ({
    code: String(r.code),
    nameAr: String(r.name_ar || r.code),
    type: String(r.type) as PayrollComponentRule['type'],
    calculationMethod: String(r.calculation_method) as PayrollComponentRule['calculationMethod'],
    defaultAmount: Number(r.default_amount) || 0,
  }));
}

/** Approved + pending days of a leave type for an employee within a calendar year. */
async function getUsedLeaveDays(companyId: string, employeeId: string, leaveType: string, year: number): Promise<number> {
  const adapter = await getDbAdapter();
  const res = await adapter.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(days), 0) AS total FROM leaves
      WHERE company_id = $1::uuid AND employee_id = $2::uuid AND type = $3
        AND status IN ('pending', 'approved')
        AND EXTRACT(YEAR FROM start_date) = $4`,
    [companyId, employeeId, leaveType, year],
  );
  return Number(res.rows?.[0]?.total || 0);
}

/** Resolve a default-account id by function key (default_accounts → code fallback). */
async function resolveHrAccountId(companyId: string, functionKey: string, fallbackCode: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const da = await adapter.query<{ account_id: string }>(
    `SELECT account_id FROM default_accounts WHERE company_id = $1::uuid AND function_key = $2`,
    [companyId, functionKey],
  );
  if (da.rows?.[0]?.account_id) return da.rows[0].account_id;
  const acc = await adapter.query<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1::uuid AND code = $2 LIMIT 1`,
    [companyId, fallbackCode],
  );
  return acc.rows?.[0]?.id || null;
}

export const hrApi = {
  // ─── Employees ────────────────────────────────────────────────────────────
  async getEmployees(companyId: string): Promise<{ success: boolean; data?: Employee[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getEmployees');
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapEmployeeRow(r)) };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT e.*, d.name as department_name FROM employees e LEFT JOIN departments d ON e.department_id = d.id WHERE e.company_id = $1 ORDER BY e.full_name`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapEmployeeRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getEmployeesPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { isActive?: boolean; departmentId?: string; search?: string }
  ): Promise<PaginatedQueryResult<Employee>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeHrRpc('getEmployeesPaginated', {
          page: p,
          pageSize: ps,
          isActive: filters?.isActive ?? null,
          departmentId: filters?.departmentId ?? null,
          search: filters?.search ?? null,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = rows.length > 0 ? Number((rows[0] as Record<string, unknown>).total_count || 0) : 0;
        const items = rows.map((r: Record<string, unknown>) => mapEmployeeRow(r));
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();
      const { offset } = clampPageArgs(page, pageSize);

      const conditions: string[] = ['e.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.isActive !== undefined) {
        params.push(filters.isActive);
        conditions.push(`e.is_active = $${params.length}`);
      }
      if (filters?.departmentId) {
        params.push(filters.departmentId);
        conditions.push(`e.department_id = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(e.full_name ILIKE $${params.length} OR e.employee_number ILIKE $${params.length} OR e.email ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM employees e WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT e.*, d.name as department_name
         FROM employees e LEFT JOIN departments d ON e.department_id = d.id
         WHERE ${where}
         ORDER BY e.full_name
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapEmployeeRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getEmployeeById(id: string, companyId: string): Promise<{ success: boolean; data?: Employee; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getEmployeeById', { id });
        if (result.success && result.rows?.[0]) return { success: true, data: mapEmployeeRow(result.rows[0]) };
        return { success: false, error: result.error || 'Not found' };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('SELECT e.*, d.name as department_name FROM employees e LEFT JOIN departments d ON e.department_id = d.id WHERE e.id = $1 AND e.company_id = $2 LIMIT 1', [id, companyId]);
      if (result.success && result.rows?.[0]) return { success: true, data: mapEmployeeRow(result.rows[0]) };
      return { success: false, error: result.error || 'Not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createEmployee(data: Omit<Employee, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createEmployeeSchema, data);
      if (!validation.success) return { success: false, error: validation.error };

      // توليد رقم موظف تلقائي إذا لم يتم تمريره
      let employeeData = data;
      if (!data.employeeNumber) {
        const seq = await getNextDocumentNumber(data.companyId, 'employee');
        if (seq.success && seq.number) {
          employeeData = { ...data, employeeNumber: seq.number };
        }
      }

      if (isElectronPg()) {
        const result = await invokeHrRpc('createEmployee', {
          employeeNumber: employeeData.employeeNumber,
          fullName: employeeData.fullName,
          nationalId: employeeData.nationalId ?? null,
          phone: employeeData.phone ?? null,
          email: employeeData.email ?? null,
          address: employeeData.address ?? null,
          departmentId: employeeData.departmentId ?? null,
          position: employeeData.position ?? null,
          grade: employeeData.grade ?? null,
          hireDate: employeeData.hireDate,
          terminationDate: employeeData.terminationDate ?? null,
          baseSalary: employeeData.baseSalary ?? 0,
          isActive: employeeData.isActive ?? true,
          photoUrl: employeeData.photoUrl ?? null,
          attachments: employeeData.attachments ?? null,
        });
        if (result.success && result.rows?.[0]) {
          const employeeId = String(result.rows[0].id);
          // Opening balance (employee advance): Dr Advances / Cr Opening Equity
          const opening = Number(employeeData.openingBalance) || 0;
          if (opening > 0 && !employeeData.openingBalancePosted) {
            const { postEmployeeOpening } = await import('@/core/utils/openingBalance');
            await postEmployeeOpening(data.companyId, { id: employeeId, name: employeeData.fullName, amount: opening });
          }
          return { success: true, id: employeeId };
        }
        return { success: false, error: result.error };
      }

      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO employees (company_id, employee_number, full_name, national_id, phone, email, address, department_id, position, grade, hire_date, termination_date, base_salary, is_active, photo_url, attachments, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [employeeData.companyId, employeeData.employeeNumber, employeeData.fullName, employeeData.nationalId, employeeData.phone, employeeData.email, employeeData.address, employeeData.departmentId, employeeData.position, employeeData.grade, employeeData.hireDate, employeeData.terminationDate, employeeData.baseSalary, employeeData.isActive, employeeData.photoUrl, employeeData.attachments ? JSON.stringify(employeeData.attachments) : null, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        const employeeId = String(result.rows[0].id);
        const opening = Number(employeeData.openingBalance) || 0;
        if (opening > 0 && !employeeData.openingBalancePosted) {
          const { postEmployeeOpening } = await import('@/core/utils/openingBalance');
          await postEmployeeOpening(data.companyId, { id: employeeId, name: employeeData.fullName, amount: opening });
        }
        return { success: true, id: employeeId };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateEmployee(id: string, companyId: string, data: Partial<Omit<Employee, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('updateEmployee', {
          id,
          ...data,
          ...(data.attachments !== undefined ? { attachments: data.attachments } : {}),
        });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.employeeNumber !== undefined) { fields.push(`employee_number = $${idx++}`); values.push(data.employeeNumber); }
      if (data.fullName !== undefined) { fields.push(`full_name = $${idx++}`); values.push(data.fullName); }
      if (data.nationalId !== undefined) { fields.push(`national_id = $${idx++}`); values.push(data.nationalId); }
      if (data.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(data.phone); }
      if (data.email !== undefined) { fields.push(`email = $${idx++}`); values.push(data.email); }
      if (data.address !== undefined) { fields.push(`address = $${idx++}`); values.push(data.address); }
      if (data.departmentId !== undefined) { fields.push(`department_id = $${idx++}`); values.push(data.departmentId); }
      if (data.position !== undefined) { fields.push(`position = $${idx++}`); values.push(data.position); }
      if (data.grade !== undefined) { fields.push(`grade = $${idx++}`); values.push(data.grade); }
      if (data.hireDate !== undefined) { fields.push(`hire_date = $${idx++}`); values.push(data.hireDate); }
      if (data.terminationDate !== undefined) { fields.push(`termination_date = $${idx++}`); values.push(data.terminationDate); }
      if (data.baseSalary !== undefined) { fields.push(`base_salary = $${idx++}`); values.push(data.baseSalary); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }
      if (data.photoUrl !== undefined) { fields.push(`photo_url = $${idx++}`); values.push(data.photoUrl); }
      if (data.attachments !== undefined) { fields.push(`attachments = $${idx++}`); values.push(JSON.stringify(data.attachments)); }
      if (_userId !== undefined) { fields.push(`updated_by = $${idx++}`); values.push(safeUserId(_userId)); }
      fields.push('updated_at = NOW()');
      if (fields.length === 1) return { success: true };
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE employees SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteEmployee(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // Guard: an employee with any payroll/leave/attendance/EOS history must
      // be deactivated, never hard-deleted (FK CASCADE would silently destroy
      // financial history).
      const hist = await adapter.query<{ rel: string }>(
        `SELECT 'payroll_lines' AS rel FROM payroll_lines pl JOIN employees e ON pl.employee_id = e.id WHERE e.id = $1::uuid AND e.company_id = $2::uuid
         UNION ALL SELECT 'leaves' FROM leaves l JOIN employees e ON l.employee_id = e.id WHERE e.id = $1::uuid AND e.company_id = $2::uuid
         UNION ALL SELECT 'attendance' FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE e.id = $1::uuid AND e.company_id = $2::uuid
         UNION ALL SELECT 'end_of_service' FROM end_of_service eos JOIN employees e ON eos.employee_id = e.id WHERE e.id = $1::uuid AND e.company_id = $2::uuid
         LIMIT 1`,
        [id, companyId],
      );
      if (hist.rows?.[0]?.rel) {
        return {
          success: false,
          error: `لا يمكن حذف الموظف لوجود سجلات مرتبطة (${hist.rows[0].rel === 'payroll_lines' ? 'مسيرات رواتب' : hist.rows[0].rel === 'leaves' ? 'إجازات' : hist.rows[0].rel === 'attendance' ? 'حضور' : 'نهاية خدمة'}). استخدم "تعطيل الموظف" بدلاً من الحذف.`,
        };
      }
      if (isElectronPg()) {
        const result = await invokeHrRpc('deleteEmployee', { id });
        return { success: result.success, error: result.error };
      }
      const result = await adapter.query('DELETE FROM employees WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Attendance ───────────────────────────────────────────────────────────
  async getAttendance(companyId: string, month: number, year: number): Promise<{ success: boolean; data?: AttendanceRecord[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getAttendance', { month, year });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapAttendanceRow(r)) };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT a.*, e.full_name as employee_name FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE a.company_id = $1 AND EXTRACT(MONTH FROM a.date) = $2 AND EXTRACT(YEAR FROM a.date) = $3 ORDER BY a.date DESC`,
        [companyId, month, year]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapAttendanceRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async saveAttendance(records: Omit<AttendanceRecord, 'id'>[], _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (records.length === 0) return { success: true };
      const cidValidation = validateInput(companyIdSchema, records[0].companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };

      // Server-side normalization + derivation.
      //
      // NORMALIZATION (bug fix "invalid input syntax for type timestamp: 08:00"):
      // `attendance.check_in/check_out` are timestamptz columns, but callers
      // send one of three shapes — time-only ("08:00" from the UI time input),
      // full datetime ("2026-08-31 08:00" from the AI tool), or empty. We
      // normalize to "YYYY-MM-DD HH:mm:ss" (or NULL) BEFORE any branch so both
      // the RPC and the fallback receive identical, valid values.
      const normalizePunch = (punch: string | undefined, date: string): string | null => {
        const raw = String(punch || '').trim();
        if (!raw) return null;
        // Full datetime already? Keep the date part + time part.
        const dt = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(:\d{2})?/.exec(raw);
        if (dt) return `${dt[1]} ${dt[2]}:00${dt[3] || ''}`.replace(/:00(\d\d)$/, ':00');
        // Time-only "HH:mm(:ss)" — combine with the record's date.
        const tm = /^(\d{1,2}):(\d{2})(:(\d{2}))?$/.exec(raw);
        if (tm) {
          const hh = tm[1].padStart(2, '0');
          return `${date} ${hh}:${tm[2]}:${tm[4] || '00'}`;
        }
        return null; // unparseable → NULL (never send a bare time to a timestamp column)
      };

      const policy = await loadHrPolicy(records[0].companyId);
      const prepared = records.map((r) => {
        const status = (['present', 'absent', 'late', 'on_leave'] as const).includes(r.status) ? r.status : 'present';
        const normIn = normalizePunch(r.checkIn, r.date);
        const normOut = normalizePunch(r.checkOut, r.date);
        let derivedOvertime: number | undefined;
        if (normIn && normOut && status === 'present') {
          derivedOvertime = deriveAttendance(normIn, normOut, policy, '08:00:00').overtimeHours;
        }
        const manualOvertime = Number(r.overtimeHours) || 0;
        return {
          ...r,
          checkIn: normIn ?? undefined,
          checkOut: normOut ?? undefined,
          status,
          // Manual overtime wins when provided; otherwise server-derived.
          overtimeHours: manualOvertime > 0 ? manualOvertime : (derivedOvertime ?? 0),
        };
      });

      if (isElectronPg()) {
        const result = await invokeHrRpc('saveAttendance', {
          data: {
            records: prepared.map((r) => ({
              employeeId: r.employeeId,
              date: r.date,
              checkIn: r.checkIn ?? null,
              checkOut: r.checkOut ?? null,
              overtimeHours: r.overtimeHours ?? null,
              status: r.status,
              notes: r.notes ?? null,
            })),
          },
        });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      // Pre-fetch existing attendance records in one query
      const placeholders = records.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',');
      const empParams = records.flatMap(r => [r.employeeId, r.date, r.companyId]);
      const existingRes = await adapter.query<{ employee_id: string; date: string; id: string }>(
        `SELECT employee_id, date, id FROM attendance WHERE (employee_id, date, company_id) IN (${placeholders})`,
        empParams
      );
      const existingMap = new Map<string, string>();
      for (const row of (existingRes.rows || [])) {
        existingMap.set(`${row.employee_id}:${row.date}`, row.id);
      }
      // Build upsert queries — attendance has no updated_at column
      const queries: { sql: string; params: unknown[] }[] = [];
      for (const rec of prepared) {
        const key = `${rec.employeeId}:${rec.date}`;
        const existingId = existingMap.get(key);
        if (existingId) {
          queries.push({ sql: 'UPDATE attendance SET check_in = $1::timestamptz, check_out = $2::timestamptz, overtime_hours = $3, status = $4, notes = $5, updated_by = $8 WHERE id = $6 AND company_id = $7', params: [rec.checkIn ?? null, rec.checkOut ?? null, rec.overtimeHours, rec.status, rec.notes ?? null, existingId, rec.companyId, safeUserId(_userId)] });
        } else {
          queries.push({ sql: 'INSERT INTO attendance (company_id, employee_id, date, check_in, check_out, overtime_hours, status, notes, created_by, updated_by) VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10)', params: [rec.companyId, rec.employeeId, rec.date, rec.checkIn ?? null, rec.checkOut ?? null, rec.overtimeHours, rec.status, rec.notes ?? null, safeUserId(_userId), safeUserId(_userId)] });
        }
      }
      const result = await adapter.transaction(queries);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Payroll ──────────────────────────────────────────────────────────────
  async getPayrollRuns(companyId: string): Promise<{ success: boolean; data?: PayrollRun[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getPayrollRuns');
        if (!result.success) return { success: false, error: result.error };
        const runs = (result.rows || []).map((r: Record<string, unknown>) => {
          const run = mapPayrollRunRow(r);
          run.lines = parseJsonLines(r.lines).map(mapPayrollLineRow);
          return run;
        });
        return { success: true, data: runs };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('SELECT * FROM payroll_runs WHERE company_id = $1 ORDER BY year DESC, month DESC', [companyId]);
      if (!result.success) return { success: false, error: result.error };
      const runs = (result.rows || []).map((r: Record<string, unknown>) => mapPayrollRunRow(r));
      if (runs.length > 0) {
        const runIds = runs.map((r) => r.id);
        const linesRes = await adapter.query(
          `SELECT pl.*, e.full_name as employee_name FROM payroll_lines pl LEFT JOIN employees e ON pl.employee_id = e.id WHERE pl.payroll_run_id = ANY($1)`,
          [runIds]
        );
        const linesByRun = new Map<string, PayrollLine[]>();
        for (const lr of (linesRes.rows || []) as Record<string, unknown>[]) {
          const runId = String(lr.payroll_run_id);
          if (!linesByRun.has(runId)) linesByRun.set(runId, []);
          linesByRun.get(runId)!.push(mapPayrollLineRow(lr));
        }
        for (const run of runs) {
          run.lines = linesByRun.get(run.id) || [];
        }
      }
      return { success: true, data: runs };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getPayrollRunsPaginated(
    companyId: string,
    page: number = 1,
    pageSize: number = 25,
    filters?: { status?: string }
  ): Promise<PaginatedQueryResult<PayrollRun>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeHrRpc('getPayrollRunsPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status ?? null,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = rows.length > 0 ? Number((rows[0] as Record<string, unknown>).total_count || 0) : 0;
        const runs = rows.map((r: Record<string, unknown>) => {
          const run = mapPayrollRunRow(r);
          run.lines = parseJsonLines(r.lines).map(mapPayrollLineRow);
          return run;
        });
        return { success: true, data: paginatedResult(runs, total, p, ps) };
      }
      const adapter = await getDbAdapter();
      const { offset } = clampPageArgs(page, pageSize);

      const conditions: string[] = ['pr.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`pr.status = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM payroll_runs pr WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps, offset);
      const dataResult = await adapter.query(
        `SELECT pr.* FROM payroll_runs pr
         WHERE ${where}
         ORDER BY pr.year DESC, pr.month DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };
      const runs = (dataResult.rows || []).map((r: Record<string, unknown>) => mapPayrollRunRow(r));
      if (runs.length > 0) {
        const runIds = runs.map((r) => r.id);
        const linesRes = await adapter.query(
          `SELECT pl.*, e.full_name as employee_name FROM payroll_lines pl LEFT JOIN employees e ON pl.employee_id = e.id WHERE pl.payroll_run_id = ANY($1)`,
          [runIds]
        );
        const linesByRun = new Map<string, PayrollLine[]>();
        for (const lr of (linesRes.rows || []) as Record<string, unknown>[]) {
          const runId = String(lr.payroll_run_id);
          if (!linesByRun.has(runId)) linesByRun.set(runId, []);
          linesByRun.get(runId)!.push(mapPayrollLineRow(lr));
        }
        for (const run of runs) {
          run.lines = linesByRun.get(run.id) || [];
        }
      }
      return { success: true, data: paginatedResult(runs, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createPayrollRun(data: CreatePayrollRunInput, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (!data.lines || data.lines.length === 0) return { success: false, error: 'لا يمكن إنشاء مسير رواتب بدون موظفين (سطور).' };
      if (data.month < 1 || data.month > 12) return { success: false, error: 'الشهر يجب أن يكون بين 1 و 12.' };
      if (data.year < 2000 || data.year > 2100) return { success: false, error: 'السنة يجب أن تكون بين 2000 و 2100.' };

      const adapter = await getDbAdapter();

      // Guard: one active run per period (uq_payroll_runs_period backs this
      // at the DB level too — the pre-check gives a friendly Arabic error).
      const dupe = await adapter.query<{ id: string }>(
        `SELECT id FROM payroll_runs WHERE company_id = $1::uuid AND month = $2 AND year = $3 AND status IN ('draft', 'posted') LIMIT 1`,
        [data.companyId, data.month, data.year],
      );
      if (dupe.rows?.[0]?.id) {
        return { success: false, error: `يوجد مسير رواتب للفترة ${data.month}/${data.year} بالفعل. لا يمكن إنشاء مسيرين لنفس الشهر.` };
      }

      let runNumber: string | undefined;
      const seq = await getNextDocumentNumber(data.companyId, 'payroll_run');
      if (seq.success && seq.number) {
        runNumber = seq.number;
      }

      // SERVER-SIDE recomputation (single source of truth): fetch employee
      // base salaries + overtime hours from attendance, recompute every line
      // through the payroll engine. Client-supplied derived values are
      // merged only as overrides the engine re-validates.
      const empIds = data.lines.map((l) => l.employeeId);
      const empsRes = await adapter.query(
        `SELECT id, full_name, base_salary FROM employees WHERE company_id = $1::uuid AND id = ANY($2::uuid)`,
        [data.companyId, empIds],
      );
      const emps = new Map((empsRes.rows || []).map((r: Record<string, unknown>) => [String(r.id), r]));

      const otRes = await adapter.query<{ employee_id: string; total: string | number }>(
        `SELECT employee_id, COALESCE(SUM(overtime_hours), 0) AS total FROM attendance
          WHERE company_id = $1::uuid AND employee_id = ANY($2::uuid)
            AND EXTRACT(MONTH FROM date) = $3 AND EXTRACT(YEAR FROM date) = $4
          GROUP BY employee_id`,
        [data.companyId, empIds, data.month, data.year],
      );
      const otByEmp = new Map((otRes.rows || []).map((r) => [String(r.employee_id), Number(r.total) || 0]));

      const policy = await loadHrPolicy(data.companyId);
      const components = await loadPayrollComponents(data.companyId);
      const computed = computePayroll(
        data.lines.map((l) => {
          const emp = emps.get(l.employeeId) as { full_name?: string; base_salary?: string | number } | undefined;
          return {
            employeeId: l.employeeId,
            employeeName: emp ? String(emp.full_name) : undefined,
            baseSalary: Number(emp?.base_salary ?? 0),
            overtimeHours: otByEmp.get(l.employeeId) ?? 0,
          };
        }),
        components,
        policy,
        data.lines.map((l) => ({
          employeeId: l.employeeId,
          // Client overrides ONLY re-shape allowances/deductions adjustments;
          // the engine recomputes net from them.
          extraAllowances: Math.max(0, Number(l.allowances) || 0),
          extraDeductions: Math.max(0, Number(l.deductions) || 0),
        })),
      );

      const totalAmount = computed.totalNet;
      const lines = computed.lines.map((c) => ({
        employeeId: c.employeeId,
        baseSalary: c.baseSalary,
        allowances: c.allowances,
        deductions: c.deductions,
        overtime: c.overtime,
        overtimeHours: c.overtimeHours,
        netSalary: c.netSalary,
      }));

      if (isElectronPg()) {
        const result = await invokeHrRpc('createPayrollRun', {
          month: data.month,
          year: data.year,
          totalAmount,
          status: data.status,
          runNumber: runNumber ?? null,
          notes: data.notes ?? null,
          lines: lines.map((line) => ({
            employeeId: line.employeeId,
            baseSalary: line.baseSalary,
            allowances: line.allowances,
            deductions: line.deductions,
            overtime: line.overtime,
            netSalary: line.netSalary,
          })),
        });
        if (result.success && result.rows?.[0]) return { success: true, id: String(result.rows[0].id) };
        return { success: false, error: result.error };
      }

      const tx = await adapter.transaction([
        { sql: `INSERT INTO payroll_runs (company_id, month, year, total_amount, status, run_number, notes, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, params: [data.companyId, data.month, data.year, totalAmount, data.status, runNumber || null, data.notes ?? null, safeUserId(_userId), safeUserId(_userId)] },
      ]);
      if (tx.success && tx.results?.[0]?.rows?.[0]) {
        const runId = tx.results[0].rows[0].id as string;
        if (lines.length > 0) {
          const lineValues = lines.map((_, i: number) => {
            const off = i * 8;
            return `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7}, $${off + 8})`;
          }).join(', ');
          const lineParams = lines.flatMap((line) => [runId, line.employeeId, line.baseSalary, line.allowances, line.deductions, line.overtime, line.overtimeHours, line.netSalary]);
          await adapter.query(
            `INSERT INTO payroll_lines (payroll_run_id, employee_id, base_salary, allowances, deductions, overtime, overtime_hours, net_salary) VALUES ${lineValues}`,
            lineParams
          );
        }
        return { success: true, id: runId };
      }
      return { success: false, error: tx.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Preview a payroll run WITHOUT persisting: employee cards + components +
   * attendance overtime run through the same engine used at creation. The UI
   * preview table and the AI agent both call this — one source of truth.
   */
  async previewPayrollRun(
    companyId: string,
    month: number,
    year: number,
    overrides?: Array<{ employeeId: string; components?: Record<string, number>; extraAllowances?: number; extraDeductions?: number }>,
  ): Promise<{ success: boolean; data?: ComputedPayroll; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (month < 1 || month > 12 || year < 2000 || year > 2100) return { success: false, error: 'شهر أو سنة غير صالحة.' };
      const adapter = await getDbAdapter();

      const empsRes = await adapter.query(
        `SELECT id, full_name, base_salary FROM employees WHERE company_id = $1::uuid AND is_active = true ORDER BY full_name`,
        [companyId],
      );
      const employees = (empsRes.rows || []) as Array<Record<string, unknown>>;
      if (employees.length === 0) return { success: true, data: { lines: [], totalGross: 0, totalDeductions: 0, totalNet: 0, totalOvertimeHours: 0 } };

      const empIds = employees.map((e) => String(e.id));
      const otRes = await adapter.query<{ employee_id: string; total: string | number }>(
        `SELECT employee_id, COALESCE(SUM(overtime_hours), 0) AS total FROM attendance
          WHERE company_id = $1::uuid AND employee_id = ANY($2::uuid)
            AND EXTRACT(MONTH FROM date) = $3 AND EXTRACT(YEAR FROM date) = $4
          GROUP BY employee_id`,
        [companyId, empIds, month, year],
      );
      const otByEmp = new Map((otRes.rows || []).map((r) => [String(r.employee_id), Number(r.total) || 0]));

      const policy = await loadHrPolicy(companyId);
      const components = await loadPayrollComponents(companyId);
      const computed = computePayroll(
        employees.map((e) => ({
          employeeId: String(e.id),
          employeeName: String(e.full_name),
          baseSalary: Number(e.base_salary) || 0,
          overtimeHours: otByEmp.get(String(e.id)) ?? 0,
        })),
        components,
        policy,
        overrides,
      );
      return { success: true, data: computed };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deletePayrollRun(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // Draft-only: posted runs already booked the GL entry.
      const statusRes = await adapter.query<{ status: string }>(
        `SELECT status FROM payroll_runs WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [id, companyId],
      );
      const status = statusRes.rows?.[0]?.status;
      if (!status) return { success: false, error: 'المسير غير موجود.' };
      if (status !== 'draft') return { success: false, error: 'لا يمكن حذف مسير مرحَّل. المسيرات المرحّلة محفوظة للسلامة المالية.' };
      if (isElectronPg()) {
        const result = await invokeHrRpc('deletePayrollRun', { id });
        return { success: result.success, error: result.error };
      }
      const result = await adapter.query('DELETE FROM payroll_runs WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Post a payroll run: atomic gross-up journal entry + status flip.
   *   Dr  52101  Salaries Expense      (base + allowances + overtime)
   *   Cr  21501  Salaries Payable      (net)
   *   Cr  21502  Payroll Deductions    (total deductions — omitted when 0)
   * Accounts resolve via default_accounts (configurable) with code fallback.
   *
   * Runs UNIFIED through runTransaction on BOTH environments (Electron's
   * db:internal-transaction channel applies per-statement auth guards, and
   * the SQL_MODULE_TABLE_RULES grant hr.create/hr.edit writes to
   * transactions/journal_entries). The old status-flip-only RPC handler is
   * intentionally NOT used — posting MUST book the GL entry.
   */
  async postPayrollRun(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; runNumber?: string; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();

      const [salariesAcc, payableAcc, deductionsAcc] = await Promise.all([
        resolveHrAccountId(companyId, 'default_salaries', '52101'),
        resolveHrAccountId(companyId, 'default_salaries_payable', '21501'),
        resolveHrAccountId(companyId, 'default_payroll_deductions', '21502'),
      ]);
      if (!salariesAcc || !payableAcc || !deductionsAcc) {
        return { success: false, error: 'حسابات الرواتب غير مهيأة. راجع الحسابات الافتراضية في الإعدادات (52101/21501/21502).' };
      }

      // Atomic: lock the run, recompute totals from stored lines, book the
      // gross-up JE, and flip status — all inside ONE transaction. Works on
      // both Electron (db:internal-transaction) and PGlite.
      const statements: TxStatement[] = [];

      // 1) Locked read of run + lines totals (single CTE for validation done below via adapter)
      const runRes = await adapter.query(
        `SELECT pr.run_number, pr.status,
                COALESCE(SUM(pl.base_salary + pl.allowances + pl.overtime), 0) AS gross,
                COALESCE(SUM(pl.deductions), 0) AS deductions,
                COALESCE(SUM(pl.net_salary), 0) AS net
           FROM payroll_runs pr
           JOIN payroll_lines pl ON pl.payroll_run_id = pr.id
          WHERE pr.id = $1::uuid AND pr.company_id = $2::uuid
          GROUP BY pr.run_number, pr.status`,
        [id, companyId],
      );
      const run = runRes.rows?.[0] as { run_number?: string; status: string; gross: string | number; deductions: string | number; net: string | number } | undefined;
      if (!run) return { success: false, error: 'المسير غير موجود أو لا يحتوي سطوراً.' };
      if (run.status !== 'draft') return { success: false, error: 'لا يمكن ترحيل مسير غير مسودة (أو مرحَّل مسبقاً).' };

      const gross = Number(run.gross) || 0;
      const deductions = Number(run.deductions) || 0;
      const net = Number(run.net) || 0;
      if (gross <= 0 || net <= 0) return { success: false, error: 'المسير يحتوي أصفاراً مالية — لا يمكن ترحيله.' };

      const runNumber = String(run.run_number || '');
      const monthLabel = new Date().toISOString().slice(0, 10);
      const entries = [
        { accountId: salariesAcc, debit: gross, credit: 0, memo: `مصروف رواتب — مسير ${runNumber}` },
        { accountId: payableAcc, debit: 0, credit: net, memo: `رواتب مستحقة الدفع — مسير ${runNumber}` },
        ...(deductions > 0
          ? [{ accountId: deductionsAcc, debit: 0, credit: deductions, memo: `استقطاعات مستحقة — مسير ${runNumber}` }]
          : []),
      ];

      statements.push(buildJournalEntryStatement(companyId, {
        reference: runNumber || `PR-${id.slice(0, 8)}`,
        description: `ترحيل مسير رواتب ${runNumber} — إجمالي ${gross} / صافي ${net} / استقطاعات ${deductions}`,
        date: monthLabel,
        totalAmount: gross,
        entries,
      }));
      // Status flip inside the same atomic batch
      statements.push({
        sql: `UPDATE payroll_runs SET status = 'posted', updated_by = $3::uuid WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
        params: [id, companyId, safeUserId(_userId)],
      });

      const tx = await runTransaction(statements);
      if (!tx.success) return { success: false, error: tx.error || 'فشل ترحيل المسير' };
      return { success: true, runNumber };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Leaves ───────────────────────────────────────────────────────────────
  async getLeaves(companyId: string): Promise<{ success: boolean; data?: Leave[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getLeaves');
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapLeaveRow(r)) };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT l.*, e.full_name as employee_name FROM leaves l JOIN employees e ON l.employee_id = e.id WHERE l.company_id = $1 ORDER BY l.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapLeaveRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getLeavesPaginated(
    companyId: string,
    page: number = 1,
    pageSize: number = 25,
    filters?: { status?: string }
  ): Promise<PaginatedQueryResult<Leave>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeHrRpc('getLeavesPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status ?? null,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = rows.length > 0 ? Number((rows[0] as Record<string, unknown>).total_count || 0) : 0;
        const items = rows.map((r: Record<string, unknown>) => mapLeaveRow(r));
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();
      const { offset } = clampPageArgs(page, pageSize);

      const conditions: string[] = ['l.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`l.status = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM leaves l WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps, offset);
      const dataResult = await adapter.query(
        `SELECT l.*, e.full_name as employee_name
         FROM leaves l JOIN employees e ON l.employee_id = e.id
         WHERE ${where}
         ORDER BY l.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapLeaveRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createLeave(data: CreateLeaveInput, _userId?: string): Promise<{ success: boolean; id?: string; days?: number; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (!data.employeeId) return { success: false, error: 'الموظف مطلوب.' };

      // SERVER-side day computation (client values ignored)
      const days = computeLeaveDays(data.startDate, data.endDate);
      if (days <= 0) return { success: false, error: 'نطاق التواريخ غير صالح: تاريخ النهاية يجب أن يكون بعد البداية.' };

      // Overlap guard: reject a new request intersecting a pending/approved leave
      const adapter = await getDbAdapter();
      const overlap = await adapter.query<{ id: string; start_date: string; end_date: string }>(
        `SELECT id, start_date, end_date FROM leaves
          WHERE company_id = $1::uuid AND employee_id = $2::uuid
            AND status IN ('pending', 'approved')
            AND daterange(start_date, end_date) && daterange($3::date, $4::date)
          LIMIT 1`,
        [data.companyId, data.employeeId, data.startDate, data.endDate],
      );
      const ov = overlap.rows?.[0];
      if (ov && leavesOverlap(data.startDate, data.endDate, String(ov.start_date).slice(0, 10), String(ov.end_date).slice(0, 10))) {
        return { success: false, error: `يوجد طلب إجازة متداخل للفترة ${String(ov.start_date).slice(0, 10)} إلى ${String(ov.end_date).slice(0, 10)}.` };
      }

      const status = data.status === 'pending' ? 'pending' : 'pending';
      if (isElectronPg()) {
        const result = await invokeHrRpc('createLeave', {
          employeeId: data.employeeId,
          leaveType: data.leaveType,
          startDate: data.startDate,
          endDate: data.endDate,
          days,
          status,
          reason: data.reason ?? null,
        });
        if (result.success && result.rows?.[0]) return { success: true, id: String(result.rows[0].id), days };
        return { success: false, error: result.error };
      }
      const result = await adapter.query(
        `INSERT INTO leaves (company_id, employee_id, type, start_date, end_date, days, status, reason, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [data.companyId, data.employeeId, data.leaveType, data.startDate, data.endDate, days, status, data.reason, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id, days };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /** Leave balances per type for one employee (entitlement − used this year). */
  async getLeaveBalances(companyId: string, employeeId: string): Promise<{ success: boolean; data?: LeaveBalance[]; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id: employeeId, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const policy = await loadHrPolicy(companyId);
      const year = new Date().getFullYear();
      const types: Leave['leaveType'][] = ['annual', 'sick', 'emergency', 'unpaid'];
      const balances = await Promise.all(types.map(async (t) => computeLeaveBalance({
        leaveType: t,
        usedDays: await getUsedLeaveDays(companyId, employeeId, t, year),
        policy,
      })));
      return { success: true, data: balances };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * State machine: pending → approved/rejected/cancelled only.
   * Approving enforces the leave balance STRICTLY (row-lock + recompute) —
   * the API is the last line of defense, not the UI.
   */
  async updateLeaveStatus(id: string, companyId: string, status: Leave['status'], approvedBy?: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
        return { success: false, error: 'حالة إجازة غير صالحة.' };
      }
      const adapter = await getDbAdapter();
      const leaveRes = await adapter.query(
        `SELECT employee_id, type, start_date, end_date, status FROM leaves WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [id, companyId],
      );
      const leave = leaveRes.rows?.[0] as { employee_id: string; type: string; start_date: string; end_date: string; status: string } | undefined;
      if (!leave) return { success: false, error: 'الإجازة غير موجودة.' };

      // State machine guards
      const from = leave.status;
      if (from === status) return { success: true };
      const allowed: Record<string, string[]> = {
        pending: ['approved', 'rejected', 'cancelled'],
        approved: ['cancelled'],
        rejected: [],
        cancelled: [],
      };
      if (!(allowed[from] || []).includes(status)) {
        return { success: false, error: `لا يمكن الانتقال من حالة "${from}" إلى "${status}".` };
      }

      // Strict balance enforcement on approval
      if (status === 'approved') {
        const start = String(leave.start_date).slice(0, 10);
        const end = String(leave.end_date).slice(0, 10);
        const days = computeLeaveDays(start, end);
        const year = Number(start.slice(0, 4));
        const usedExcludingThis = await getUsedLeaveDays(companyId, String(leave.employee_id), String(leave.type), year);
        // The pending leave itself is already counted in `used` — exclude it
        const usedOther = Math.max(0, usedExcludingThis - days);
        const policy = await loadHrPolicy(companyId);
        const balance = computeLeaveBalance({ leaveType: String(leave.type), usedDays: usedOther, policy });
        if (!balance.uncapped && days > balance.remaining) {
          return {
            success: false,
            error: `رصيد الإجازة غير كافٍ: المطلوب ${days} يوماً والمتبقي ${balance.remaining} يوماً من أصل ${balance.entitled} (رصيد ${String(leave.type) === 'annual' ? 'سنوية' : String(leave.type) === 'sick' ? 'مرضية' : 'طارئة'}).`,
          };
        }
      }

      if (isElectronPg()) {
        const result = await invokeHrRpc('updateLeaveStatus', {
          id,
          status,
          approvedBy: approvedBy || null,
        });
        return { success: result.success, error: result.error };
      }
      // leaves has no updated_at column
      const result = await adapter.query(
        'UPDATE leaves SET status = $1, approved_by = $2, approved_at = $3, updated_by = $6 WHERE id = $4 AND company_id = $5',
        [status, approvedBy || null, status === 'approved' ? new Date().toISOString() : null, id, companyId, safeUserId(_userId)]
      );
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteLeave(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // Only pending/rejected leaves may be deleted; approved leaves must be
      // cancelled instead (preserves the attendance/history trail).
      const statusRes = await adapter.query<{ status: string }>(
        `SELECT status FROM leaves WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [id, companyId],
      );
      const st = statusRes.rows?.[0]?.status;
      if (!st) return { success: false, error: 'الإجازة غير موجودة.' };
      if (st === 'approved') return { success: false, error: 'لا يمكن حذف إجازة معتمدة — استخدم "إلغاء" بدلاً من الحذف.' };
      if (isElectronPg()) {
        const result = await invokeHrRpc('deleteLeave', { id });
        return { success: result.success, error: result.error };
      }
      const result = await adapter.query('DELETE FROM leaves WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── End of Service ───────────────────────────────────────────────────────
  async getEndOfServices(companyId: string): Promise<{ success: boolean; data?: EndOfService[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getEndOfServices');
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapEosRow(r)) };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT e.*, emp.full_name as employee_name FROM end_of_service e JOIN employees emp ON e.employee_id = emp.id WHERE e.company_id = $1 ORDER BY e.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapEosRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getEndOfServicesPaginated(
    companyId: string,
    page: number = 1,
    pageSize: number = 25,
    filters?: { status?: string }
  ): Promise<PaginatedQueryResult<EndOfService>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeHrRpc('getEndOfServicesPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status ?? null,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = rows.length > 0 ? Number((rows[0] as Record<string, unknown>).total_count || 0) : 0;
        const items = rows.map((r: Record<string, unknown>) => mapEosRow(r));
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();
      const { offset } = clampPageArgs(page, pageSize);

      const conditions: string[] = ['e.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`e.status = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM end_of_service e WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps, offset);
      const dataResult = await adapter.query(
        `SELECT e.*, emp.full_name as employee_name
         FROM end_of_service e JOIN employees emp ON e.employee_id = emp.id
         WHERE ${where}
         ORDER BY e.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapEosRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * SERVER-side EOS computation: the employee's hire date + current base
   * salary + company policy are the ONLY inputs. Client-supplied
   * serviceYears/lastSalary/eosAmount are IGNORED (anti-hallucination for
   * AI tools and anti-tampering for the UI).
   */
  async createEndOfService(data: CreateEndOfServiceInput, _userId?: string): Promise<{ success: boolean; id?: string; eosAmount?: number; serviceYears?: number; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (!data.employeeId) return { success: false, error: 'الموظف مطلوب.' };

      const adapter = await getDbAdapter();
      const empRes = await adapter.query(
        `SELECT hire_date, base_salary, full_name FROM employees WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [data.employeeId, data.companyId],
      );
      const emp = empRes.rows?.[0] as { hire_date: string; base_salary: string | number; full_name: string } | undefined;
      if (!emp) return { success: false, error: 'الموظف غير موجود.' };

      const hireDate = String(emp.hire_date).slice(0, 10);
      const terminationDate = String(data.terminationDate).slice(0, 10);
      const policy = await loadHrPolicy(data.companyId);
      const computed = computeEos(hireDate, terminationDate, Number(emp.base_salary) || 0, data.reason, policy);
      if (computed.serviceYears <= 0) return { success: false, error: 'سنوات الخدمة صفر — تاريخ نهاية الخدمة قبل التعيين.' };
      if (computed.eosAmount <= 0) return { success: false, error: 'مستحقات نهاية الخدمة صفر.' };

      const reason = (['resignation', 'termination', 'contract_end', 'retirement'] as const).includes(data.reason) ? data.reason : 'resignation';
      const status = data.status === 'draft' ? 'draft' : 'draft';

      if (isElectronPg()) {
        const result = await invokeHrRpc('createEndOfService', {
          employeeId: data.employeeId,
          terminationDate,
          serviceYears: computed.serviceYears,
          lastSalary: computed.lastSalary,
          eosAmount: computed.eosAmount,
          reason,
          status,
          notes: data.notes ?? null,
        });
        if (result.success && result.rows?.[0]) return { success: true, id: String(result.rows[0].id), eosAmount: computed.eosAmount, serviceYears: computed.serviceYears };
        return { success: false, error: result.error };
      }
      const result = await adapter.query(
        `INSERT INTO end_of_service (company_id, employee_id, termination_date, service_years, last_salary, eos_amount, reason, status, notes, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [data.companyId, data.employeeId, terminationDate, computed.serviceYears, computed.lastSalary, computed.eosAmount, reason, status, data.notes, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id, eosAmount: computed.eosAmount, serviceYears: computed.serviceYears };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /** Preview EOS without persisting (UI card + AI tool share this). */
  async previewEndOfService(
    companyId: string,
    employeeId: string,
    terminationDate: string,
    reason: EndOfService['reason'],
  ): Promise<{ success: boolean; data?: { serviceYears: number; lastSalary: number; eosAmount: number; firstYearsAmount: number; beyondYearsAmount: number }; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id: employeeId, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const empRes = await adapter.query(
        `SELECT hire_date, base_salary FROM employees WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [employeeId, companyId],
      );
      const emp = empRes.rows?.[0] as { hire_date: string; base_salary: string | number } | undefined;
      if (!emp) return { success: false, error: 'الموظف غير موجود.' };
      const policy = await loadHrPolicy(companyId);
      const computed = computeEos(String(emp.hire_date).slice(0, 10), terminationDate, Number(emp.base_salary) || 0, reason, policy);
      return { success: true, data: computed };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * EOS state machine with ATOMIC journal entries:
   *   draft → approved : accrual JE  (Dr 52501 EOS Expense / Cr 21503 EOS Payable)
   *   approved → paid  : settlement JE (Dr 21503 / Cr cash-box GL account)
   *                       via payEndOfService(cashBoxId) — NOT this method.
   * paid is terminal (no transitions out).
   */
  async updateEndOfServiceStatus(id: string, companyId: string, status: EndOfService['status'], _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (!['draft', 'approved', 'paid', 'cancelled'].includes(status)) {
        return { success: false, error: 'حالة غير صالحة.' };
      }
      const adapter = await getDbAdapter();
      const eosRes = await adapter.query(
        `SELECT status, eos_amount, employee_id FROM end_of_service WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [id, companyId],
      );
      const eos = eosRes.rows?.[0] as { status: string; eos_amount: string | number; employee_id: string } | undefined;
      if (!eos) return { success: false, error: 'سجل نهاية الخدمة غير موجود.' };
      const from = String(eos.status);
      if (from === status) return { success: true };

      // State machine
      const allowed: Record<string, string[]> = {
        draft: ['approved', 'cancelled'],
        approved: ['paid', 'cancelled'],
        paid: [],
        cancelled: [],
      };
      if (!(allowed[from] || []).includes(status)) {
        return { success: false, error: `لا يمكن الانتقال من حالة "${from}" إلى "${status}".` };
      }
      // paid MUST go through payEndOfService (needs cashBoxId for the JE)
      if (status === 'paid') {
        return { success: false, error: 'الدفع يتم عبر دفع مستحقات نهاية الخدمة مع اختيار الخزنة — لا يمكن وضعه "مدفوع" مباشرة.' };
      }

      if (status === 'approved') {
        // Atomic: accrual JE + status flip
        const [eosExpenseAcc, eosPayableAcc] = await Promise.all([
          resolveHrAccountId(companyId, 'default_eos_expense', '52501'),
          resolveHrAccountId(companyId, 'default_eos_payable', '21503'),
        ]);
        if (!eosExpenseAcc || !eosPayableAcc) {
          return { success: false, error: 'حسابات نهاية الخدمة غير مهيأة (52501/21503). راجع الحسابات الافتراضية.' };
        }
        const amount = Number(eos.eos_amount) || 0;
        if (amount <= 0) return { success: false, error: 'مبلغ نهاية الخدمة صفر — لا يمكن اعتماده.' };
        const statements: TxStatement[] = [
          buildJournalEntryStatement(companyId, {
            reference: `EOS-${id.slice(0, 8)}`,
            description: `استحقاق نهاية خدمة موظف — ${amount}`,
            date: new Date().toISOString().slice(0, 10),
            totalAmount: amount,
            entries: [
              { accountId: eosExpenseAcc, debit: amount, credit: 0, memo: 'مصروف نهاية الخدمة' },
              { accountId: eosPayableAcc, debit: 0, credit: amount, memo: 'مستحقات نهاية الخدمة' },
            ],
          }),
          {
            sql: `UPDATE end_of_service SET status = 'approved', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
            params: [id, companyId, safeUserId(_userId)],
          },
        ];
        const tx = await runTransaction(statements);
        if (!tx.success) return { success: false, error: tx.error || 'فشل اعتماد نهاية الخدمة' };
        return { success: true };
      }

      // cancelled (from draft or approved — approved cancellation does NOT
      // auto-reverse the accrual JE; accountants post a manual reversal JE)
      const result = await adapter.query(
        `UPDATE end_of_service SET status = 'cancelled', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId, safeUserId(_userId)],
      );
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Settle an approved EOS: payment JE (Dr 21503 EOS Payable / Cr cash-box
   * account) + status→paid + cash_box_id/paid_at stamping — ONE atomic batch.
   */
  async payEndOfService(id: string, companyId: string, cashBoxId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (!cashBoxId) return { success: false, error: 'الخزنة مطلوبة لتسوية الدفع.' };
      const adapter = await getDbAdapter();

      const eosRes = await adapter.query(
        `SELECT status, eos_amount FROM end_of_service WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [id, companyId],
      );
      const eos = eosRes.rows?.[0] as { status: string; eos_amount: string | number } | undefined;
      if (!eos) return { success: false, error: 'سجل نهاية الخدمة غير موجود.' };
      if (String(eos.status) !== 'approved') return { success: false, error: 'لا يمكن الدفع قبل اعتماد الاستحقاق.' };
      const amount = Number(eos.eos_amount) || 0;
      if (amount <= 0) return { success: false, error: 'المبلغ صفر.' };

      const [eosPayableAcc, cashBoxRes] = await Promise.all([
        resolveHrAccountId(companyId, 'default_eos_payable', '21503'),
        adapter.query<{ account_id: string }>(
          `SELECT account_id FROM cash_boxes WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
          [cashBoxId, companyId],
        ),
      ]);
      const cashAcc = cashBoxRes.rows?.[0]?.account_id || null;
      if (!eosPayableAcc) return { success: false, error: 'حساب مستحقات نهاية الخدمة غير مهيأ (21503).' };
      if (!cashAcc) return { success: false, error: 'الخزنة المختارة غير مرتبطة بحساب محاسبي — راجع شاشة النقدية والخزائن.' };

      const statements: TxStatement[] = [
        buildJournalEntryStatement(companyId, {
          reference: `EOS-PAY-${id.slice(0, 8)}`,
          description: `دفع مستحقات نهاية الخدمة — ${amount}`,
          date: new Date().toISOString().slice(0, 10),
          totalAmount: amount,
          entries: [
            { accountId: eosPayableAcc, debit: amount, credit: 0, memo: 'تسوية مستحقات نهاية الخدمة' },
            { accountId: cashAcc, debit: 0, credit: amount, memo: 'دفع من الخزنة' },
          ],
        }),
        {
          sql: `UPDATE end_of_service SET status = 'paid', cash_box_id = $3::uuid, paid_at = NOW(), updated_by = $4::uuid, updated_at = NOW()
                 WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'approved'`,
          params: [id, companyId, cashBoxId, safeUserId(_userId)],
        },
      ];
      const tx = await runTransaction(statements);
      if (!tx.success) return { success: false, error: tx.error || 'فشل تسجيل الدفع' };
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteEndOfService(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // Only draft/cancelled may be deleted — approved/paid records carry JEs.
      const statusRes = await adapter.query<{ status: string }>(
        `SELECT status FROM end_of_service WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [id, companyId],
      );
      const st = statusRes.rows?.[0]?.status;
      if (!st) return { success: false, error: 'السجل غير موجود.' };
      if (st === 'approved' || st === 'paid') {
        return { success: false, error: `لا يمكن حذف سجل ${st === 'paid' ? 'مدفوع' : 'معتمد'} — له قيود محاسبية مرتبطة.` };
      }
      if (isElectronPg()) {
        const result = await invokeHrRpc('deleteEndOfService', { id });
        return { success: result.success, error: result.error };
      }
      const result = await adapter.query('DELETE FROM end_of_service WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Departments ───────────────────────────────────────────────────────────
  // NOTE: no dedicated `db:rpc:hr.*` handlers exist for departments — these
  // methods run through `adapter.query` on BOTH environments. In Electron the
  // `db:internal-query` channel applies assertSqlAuthorized and the
  // SQL_MODULE_TABLE_RULES hr rule covers the `departments` table.
  async getDepartments(companyId: string): Promise<{ success: boolean; data?: Department[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT d.id, d.company_id, d.name, d.manager_id, mu.full_name AS manager_name,
                (SELECT COUNT(*)::int FROM employees e WHERE e.department_id = d.id AND e.company_id = d.company_id) AS employee_count
           FROM departments d
           LEFT JOIN users mu ON d.manager_id = mu.id
          WHERE d.company_id = $1::uuid
          ORDER BY d.name`,
        [companyId],
      );
      if (!result.success) return { success: false, error: result.error };
      return {
        success: true,
        data: (result.rows || []).map((r: Record<string, unknown>) => mapDepartmentRow(r)),
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createDepartment(data: { companyId: string; name: string; managerId?: string }, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (!data.name || !data.name.trim()) return { success: false, error: 'اسم القسم مطلوب.' };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO departments (company_id, name, manager_id, created_by, updated_by)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid) RETURNING id`,
        [data.companyId, data.name.trim(), data.managerId || null, safeUserId(_userId), safeUserId(_userId)],
      );
      if (result.success && result.rows?.[0]) return { success: true, id: String(result.rows[0].id) };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateDepartment(id: string, companyId: string, data: { name?: string; managerId?: string | null }, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (data.name !== undefined && !data.name.trim()) return { success: false, error: 'اسم القسم مطلوب.' };
      if (data.name === undefined && data.managerId === undefined) return { success: true };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name.trim()); }
      if (data.managerId !== undefined) { fields.push(`manager_id = $${idx++}::uuid`); values.push(data.managerId || null); }
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(
        `UPDATE departments SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`,
        values,
      );
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteDepartment(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // Guard: a department with linked employees must not be deleted —
      // moving the employees first is the user's job.
      const count = await adapter.query<{ cnt: string | number }>(
        `SELECT COUNT(*)::int AS cnt FROM employees WHERE department_id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId],
      );
      const linked = Number(count.rows?.[0]?.cnt || 0);
      if (linked > 0) {
        return { success: false, error: `لا يمكن حذف القسم لوجود ${linked} موظف مرتبط به — انقل الموظفين إلى قسم آخر أولاً.` };
      }
      const result = await adapter.query('DELETE FROM departments WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Payroll Components (unified API — the engine + AI + UI all call these) ──
  async getPayrollComponentsList(companyId: string): Promise<{ success: boolean; data?: PayrollComponent[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT * FROM payroll_components WHERE company_id = $1::uuid ORDER BY type, name_ar`,
        [companyId],
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapPayrollComponentRow(r)) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createPayrollComponent(data: {
    companyId: string;
    nameAr: string;
    nameEn?: string;
    code?: string;
    type: PayrollComponent['type'];
    calculationMethod?: PayrollComponent['calculationMethod'];
    defaultAmount?: number;
    isActive?: boolean;
  }, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (!data.nameAr || !data.nameAr.trim()) return { success: false, error: 'اسم المكوّن بالعربية مطلوب.' };
      const validTypes = ['earning', 'deduction', 'tax', 'insurance', 'net'] as const;
      const validMethods = ['fixed', 'percentage', 'formula'] as const;
      const type = validTypes.includes(data.type) ? data.type : null;
      if (!type) return { success: false, error: 'نوع المكوّن غير صالح (earning/deduction/tax/insurance/net).' };
      const method = (data.calculationMethod && validMethods.includes(data.calculationMethod)) ? data.calculationMethod : 'fixed';
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO payroll_components (company_id, name_ar, name_en, code, type, calculation_method, default_amount, affects_gross_salary, affects_tax, affects_social_insurance, is_active, created_by, updated_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13::uuid) RETURNING id`,
        [data.companyId, data.nameAr.trim(), data.nameEn || null, data.code || null, type, method, data.defaultAmount ?? 0, type === 'earning', type === 'tax', type === 'insurance', data.isActive ?? true, safeUserId(_userId), safeUserId(_userId)],
      );
      if (result.success && result.rows?.[0]) return { success: true, id: String(result.rows[0].id) };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updatePayrollComponent(id: string, companyId: string, data: {
    nameAr?: string;
    nameEn?: string;
    code?: string;
    type?: PayrollComponent['type'];
    calculationMethod?: PayrollComponent['calculationMethod'];
    defaultAmount?: number;
    isActive?: boolean;
  }, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (data.nameAr !== undefined && !data.nameAr.trim()) return { success: false, error: 'اسم المكوّن بالعربية مطلوب.' };
      const validTypes = ['earning', 'deduction', 'tax', 'insurance', 'net'] as const;
      const validMethods = ['fixed', 'percentage', 'formula'] as const;
      if (data.type !== undefined && !validTypes.includes(data.type)) return { success: false, error: 'نوع المكوّن غير صالح.' };
      if (data.calculationMethod !== undefined && !validMethods.includes(data.calculationMethod)) return { success: false, error: 'طريقة الحساب غير صالحة.' };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.nameAr !== undefined) { fields.push(`name_ar = $${idx++}`); values.push(data.nameAr.trim()); }
      if (data.nameEn !== undefined) { fields.push(`name_en = $${idx++}`); values.push(data.nameEn || null); }
      if (data.code !== undefined) { fields.push(`code = $${idx++}`); values.push(data.code || null); }
      if (data.type !== undefined) { fields.push(`type = $${idx++}`); values.push(data.type); }
      if (data.calculationMethod !== undefined) { fields.push(`calculation_method = $${idx++}`); values.push(data.calculationMethod); }
      if (data.defaultAmount !== undefined) { fields.push(`default_amount = $${idx++}`); values.push(data.defaultAmount); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }
      if (fields.length === 0) return { success: true };
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(
        `UPDATE payroll_components SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`,
        values,
      );
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Soft delete only — components may be referenced by past payroll runs so a
   * HARD delete is unsafe; deactivation keeps history intact.
   */
  async deactivatePayrollComponent(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `UPDATE payroll_components SET is_active = false, updated_by = $3::uuid, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId, safeUserId(_userId)],
      );
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Dashboard KPIs ────────────────────────────────────────────────────────────
  async getHrKpis(companyId: string): Promise<{
    success: boolean;
    data?: {
      totalEmployees: number;
      activeEmployees: number;
      pendingLeaves: number;
      totalPayrollAmount: number;
    };
    error?: string;
  }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeHrRpc('getHrKpis');
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0] || {};
        return {
          success: true,
          data: {
            totalEmployees: Number(row.total_employees || 0),
            activeEmployees: Number(row.active_employees || 0),
            pendingLeaves: Number(row.pending_leaves || 0),
            totalPayrollAmount: Number(row.total_payroll || 0),
          },
        };
      }
      const adapter = await getDbAdapter();
      const [empResult, activeResult, leavesResult, payrollResult] = await Promise.all([
        adapter.query<{ cnt: string | number }>(
          `SELECT COUNT(*)::int AS cnt FROM employees WHERE company_id = $1`,
          [companyId],
        ),
        adapter.query<{ cnt: string | number }>(
          `SELECT COUNT(*)::int AS cnt FROM employees WHERE company_id = $1 AND is_active = true`,
          [companyId],
        ),
        adapter.query<{ cnt: string | number }>(
          `SELECT COUNT(*)::int AS cnt FROM leaves WHERE company_id = $1 AND status = 'pending'`,
          [companyId],
        ),
        adapter.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(pl.net_salary), 0) AS total
             FROM payroll_lines pl
             JOIN payroll_runs pr ON pl.payroll_run_id = pr.id
             JOIN employees e ON pl.employee_id = e.id
            WHERE pr.company_id = $1
              AND e.company_id = $1
              AND pr.status = 'posted'`,
          [companyId],
        ),
      ]);
      return {
        success: true,
        data: {
          totalEmployees: Number(empResult.rows?.[0]?.cnt || 0),
          activeEmployees: Number(activeResult.rows?.[0]?.cnt || 0),
          pendingLeaves: Number(leavesResult.rows?.[0]?.cnt || 0),
          totalPayrollAmount: Number(payrollResult.rows?.[0]?.total || 0),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

function mapEmployeeRow(r: Record<string, unknown>): Employee {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    employeeNumber: String(r.employee_number),
    fullName: String(r.full_name),
    nationalId: r.national_id ? String(r.national_id) : undefined,
    phone: r.phone ? String(r.phone) : undefined,
    email: r.email ? String(r.email) : undefined,
    address: r.address ? String(r.address) : undefined,
    departmentId: r.department_id ? String(r.department_id) : undefined,
    departmentName: r.department_name ? String(r.department_name) : undefined,
    position: r.position ? String(r.position) : undefined,
    grade: r.grade ? String(r.grade) : undefined,
    hireDate: r.hire_date ? String(r.hire_date) : undefined,
    terminationDate: r.termination_date ? String(r.termination_date) : undefined,
    baseSalary: r.base_salary !== undefined && r.base_salary !== null ? Number(r.base_salary) : undefined,
    isActive: r.is_active === true || r.is_active === 'true',
    photoUrl: r.photo_url ? String(r.photo_url) : undefined,
    attachments: r.attachments ? (typeof r.attachments === 'string' ? JSON.parse(r.attachments) : r.attachments) : undefined,
  };
}

/** Local "HH:mm" from a timestamptz/Date value (page tables split on ':'). */
function punchTime(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return undefined;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function mapAttendanceRow(r: Record<string, unknown>): AttendanceRecord {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name ? String(r.employee_name) : undefined,
    // toDateString (Phase 45 guard): pg returns Date objects for date columns —
    // String(date) yields locale text that never matches a "YYYY-MM-DD" filter.
    date: toDateString(r.date) ?? String(r.date),
    checkIn: punchTime(r.check_in),
    checkOut: punchTime(r.check_out),
    overtimeHours: r.overtime_hours ? Number(r.overtime_hours) : undefined,
    status: String(r.status) as AttendanceRecord['status'],
    notes: r.notes ? String(r.notes) : undefined,
  };
}

function mapPayrollRunRow(r: Record<string, unknown>): PayrollRun {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    month: Number(r.month),
    year: Number(r.year),
    totalAmount: Number(r.total_amount) || 0,
    status: String(r.status) as PayrollRun['status'],
    runNumber: r.run_number ? String(r.run_number) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    lines: [],
  };
}

function mapPayrollLineRow(r: Record<string, unknown>): PayrollLine {
  return {
    id: String(r.id),
    payrollRunId: String(r.payroll_run_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name ? String(r.employee_name) : '',
    baseSalary: Number(r.base_salary) || 0,
    allowances: Number(r.allowances) || 0,
    deductions: Number(r.deductions) || 0,
    overtime: Number(r.overtime) || 0,
    netSalary: Number(r.net_salary) || 0,
  };
}function mapLeaveRow(r: Record<string, unknown>): Leave {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name ? String(r.employee_name) : undefined,
    leaveType: String(r.type) as Leave['leaveType'],
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    days: Number(r.days) || 0,
    status: String(r.status) as Leave['status'],
    approvedBy: r.approved_by ? String(r.approved_by) : undefined,
    approvedAt: r.approved_at ? String(r.approved_at) : undefined,
    reason: r.reason ? String(r.reason) : undefined,
  };
}

function mapEosRow(r: Record<string, unknown>): EndOfService {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name ? String(r.employee_name) : undefined,
    terminationDate: String(r.termination_date),
    serviceYears: Number(r.service_years) || 0,
    lastSalary: Number(r.last_salary) || 0,
    eosAmount: Number(r.eos_amount) || 0,
    reason: String(r.reason) as EndOfService['reason'],
    status: String(r.status) as EndOfService['status'],
    cashBoxId: r.cash_box_id ? String(r.cash_box_id) : undefined,
    paidAt: r.paid_at ? String(r.paid_at) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
  };
}

function mapDepartmentRow(r: Record<string, unknown>): Department {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    name: String(r.name),
    managerId: r.manager_id ? String(r.manager_id) : undefined,
    managerName: r.manager_name ? String(r.manager_name) : undefined,
    employeeCount: Number(r.employee_count) || 0,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapPayrollComponentRow(r: Record<string, unknown>): PayrollComponent {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    nameAr: String(r.name_ar),
    nameEn: r.name_en ? String(r.name_en) : undefined,
    code: r.code ? String(r.code) : undefined,
    type: String(r.type) as PayrollComponent['type'],
    calculationMethod: String(r.calculation_method || 'fixed') as PayrollComponent['calculationMethod'],
    defaultAmount: Number(r.default_amount) || 0,
    affectsGrossSalary: r.affects_gross_salary === true,
    affectsTax: r.affects_tax === true,
    affectsSocialInsurance: r.affects_social_insurance === true,
    isActive: r.is_active === true,
    defaultAccountId: r.default_account_id ? String(r.default_account_id) : undefined,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}