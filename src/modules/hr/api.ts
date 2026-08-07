import { getDbAdapter } from '@/core/database/adapters';
import { safeUserId } from '@/core/utils/userIdValidator';
import { validateInput, idCompanySchema, companyIdSchema, createEmployeeSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { getNextDocumentNumber } from '@/core/api';
import type { Employee, AttendanceRecord, PayrollRun, PayrollLine, Leave, EndOfService } from './types';

export const hrApi = {
  // ─── Employees ────────────────────────────────────────────────────────────
  async getEmployees(companyId: string): Promise<{ success: boolean; data?: Employee[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
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
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

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
      const adapter = await getDbAdapter();
      
      // توليد رقم موظف تلقائي إذا لم يتم تمريره
      let employeeData = data;
      if (!data.employeeNumber) {
        const seq = await getNextDocumentNumber(data.companyId, 'employee');
        if (seq.success && seq.number) {
          employeeData = { ...data, employeeNumber: seq.number };
        }
      }
      
      const result = await adapter.query(
        `INSERT INTO employees (company_id, employee_number, full_name, national_id, phone, email, address, department_id, position, grade, hire_date, termination_date, base_salary, is_active, photo_url, attachments, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [employeeData.companyId, employeeData.employeeNumber, employeeData.fullName, employeeData.nationalId, employeeData.phone, employeeData.email, employeeData.address, employeeData.departmentId, employeeData.position, employeeData.grade, employeeData.hireDate, employeeData.terminationDate, employeeData.baseSalary, employeeData.isActive, employeeData.photoUrl, employeeData.attachments ? JSON.stringify(employeeData.attachments) : null, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateEmployee(id: string, companyId: string, data: Partial<Omit<Employee, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
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
      const result = await adapter.query('DELETE FROM employees WHERE id = $1 AND company_id = $2', [id, companyId]);
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
      // Build upsert queries
      const queries: { sql: string; params: unknown[] }[] = [];
      for (const rec of records) {
        const key = `${rec.employeeId}:${rec.date}`;
        const existingId = existingMap.get(key);
        if (existingId) {
          queries.push({ sql: 'UPDATE attendance SET check_in = $1, check_out = $2, overtime_hours = $3, status = $4, notes = $5, updated_by = $8, updated_at = NOW() WHERE id = $6 AND company_id = $7', params: [rec.checkIn, rec.checkOut, rec.overtimeHours, rec.status, rec.notes, existingId, rec.companyId, safeUserId(_userId)] });
        } else {
          queries.push({ sql: 'INSERT INTO attendance (company_id, employee_id, date, check_in, check_out, overtime_hours, status, notes, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', params: [rec.companyId, rec.employeeId, rec.date, rec.checkIn, rec.checkOut, rec.overtimeHours, rec.status, rec.notes, safeUserId(_userId), safeUserId(_userId)] });
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
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

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

  async createPayrollRun(data: Omit<PayrollRun, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();

      let runData = data;
      if (!data.runNumber) {
        const seq = await getNextDocumentNumber(data.companyId, 'payroll_run');
        if (seq.success && seq.number) {
          runData = { ...data, runNumber: seq.number };
        }
      }

      const tx = await adapter.transaction([
        { sql: `INSERT INTO payroll_runs (company_id, month, year, total_amount, status, run_number, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, params: [runData.companyId, runData.month, runData.year, runData.totalAmount, runData.status, runData.runNumber || null, safeUserId(_userId), safeUserId(_userId)] },
      ]);
      if (tx.success && tx.results?.[0]?.[0]) {
        const runId = tx.results[0][0].id as string;
        if (data.lines.length > 0) {
          const lineValues = data.lines.map((_: typeof data.lines[0], i: number) => {
            const off = i * 7;
            return `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7})`;
          }).join(', ');
          const lineParams = data.lines.flatMap((line: typeof data.lines[0]) => [runId, line.employeeId, line.baseSalary, line.allowances, line.deductions, line.overtime, line.netSalary]);
          await adapter.query(
            `INSERT INTO payroll_lines (payroll_run_id, employee_id, base_salary, allowances, deductions, overtime, net_salary) VALUES ${lineValues}`,
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

  async postPayrollRun(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query("UPDATE payroll_runs SET status = 'posted', updated_by = $3, updated_at = NOW() WHERE id = $1 AND company_id = $2", [id, companyId, safeUserId(_userId)]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Leaves ───────────────────────────────────────────────────────────────
  async getLeaves(companyId: string): Promise<{ success: boolean; data?: Leave[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
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
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

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

  async createLeave(data: Omit<Leave, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO leaves (company_id, employee_id, type, start_date, end_date, days, status, reason, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [data.companyId, data.employeeId, data.leaveType, data.startDate, data.endDate, data.days, data.status, data.reason, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateLeaveStatus(id: string, companyId: string, status: Leave['status'], approvedBy?: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'UPDATE leaves SET status = $1, approved_by = $2, approved_at = $3, updated_by = $6, updated_at = NOW() WHERE id = $4 AND company_id = $5',
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
      const result = await adapter.query('DELETE FROM leaves WHERE id = $1 AND company_id = $2', [id, companyId]);
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
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

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

  async createEndOfService(data: Omit<EndOfService, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO end_of_service (company_id, employee_id, termination_date, service_years, last_salary, eos_amount, reason, status, notes, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [data.companyId, data.employeeId, data.terminationDate, data.serviceYears, data.lastSalary, data.eosAmount, data.reason, data.status, data.notes, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateEndOfServiceStatus(id: string, companyId: string, status: EndOfService['status'], _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query('UPDATE end_of_service SET status = $1, updated_by = $4, updated_at = NOW() WHERE id = $2 AND company_id = $3', [status, id, companyId, safeUserId(_userId)]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteEndOfService(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM end_of_service WHERE id = $1 AND company_id = $2', [id, companyId]);
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

function mapAttendanceRow(r: Record<string, unknown>): AttendanceRecord {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name ? String(r.employee_name) : undefined,
    date: String(r.date),
    checkIn: r.check_in ? String(r.check_in) : undefined,
    checkOut: r.check_out ? String(r.check_out) : undefined,
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
    lines: [],
  };
}

function mapPayrollLineRow(r: Record<string, unknown>): PayrollLine {
  return {
    id: String(r.id),
    payrollRunId: String(r.payroll_run_id),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    baseSalary: Number(r.base_salary) || 0,
    allowances: Number(r.allowances) || 0,
    deductions: Number(r.deductions) || 0,
    overtime: Number(r.overtime) || 0,
    netSalary: Number(r.net_salary) || 0,
  };
}

function mapLeaveRow(r: Record<string, unknown>): Leave {
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
    notes: r.notes ? String(r.notes) : undefined,
  };
}
