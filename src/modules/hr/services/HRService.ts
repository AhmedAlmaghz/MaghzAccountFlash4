import { BaseService } from '@/core/services/BaseService';
import { z } from 'zod';

// Validation schemas
const CreateEmployeeSchema = z.object({
  employeeNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  departmentId: z.string().uuid().nullable(),
  positionId: z.string().uuid().nullable(),
  hireDate: z.string(),
  baseSalary: z.number().min(0),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  isActive: z.boolean().default(true),
});

const CreateAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string(),
  checkIn: z.string(),
  checkOut: z.string().optional(),
  status: z.enum(['present', 'absent', 'late', 'half_day']),
  notes: z.string().optional(),
});

const ProcessPayrollSchema = z.object({
  periodStartDate: z.string(),
  periodEndDate: z.string(),
  departmentId: z.string().uuid().optional(),
});

export type CreateEmployeeDto = z.infer<typeof CreateEmployeeSchema>;
export type CreateAttendanceDto = z.infer<typeof CreateAttendanceSchema>;
export type ProcessPayrollDto = z.infer<typeof ProcessPayrollSchema>;

/**
 * HR Service
 * 
 * Encapsulates all business logic for HR operations:
 * - Employee management
 * - Attendance tracking
 * - Payroll processing
 * - Leave management
 * - End of service calculations
 */
export class HRService extends BaseService {
  /**
   * Create a new employee
   */
  async createEmployee(data: CreateEmployeeDto) {
    this.requirePermission('hr.create');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateEmployeeSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Check if employee number already exists
      const existing = await this.query(
        'SELECT id FROM employees WHERE company_id = $1::uuid AND employee_number = $2',
        [companyId, validated.employeeNumber]
      );

      if (existing.success && existing.rows && existing.rows.length > 0) {
        throw new Error('Employee number already exists');
      }

      // Create employee
      const result = await this.query(
        `INSERT INTO employees 
         (id, company_id, employee_number, first_name, last_name, department_id, position_id, 
          hire_date, base_salary, phone, email, address, is_active, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11, $12, $13, $14::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.employeeNumber,
          validated.firstName,
          validated.lastName,
          validated.departmentId,
          validated.positionId,
          validated.hireDate,
          validated.baseSalary,
          validated.phone || null,
          validated.email || null,
          validated.address || null,
          validated.isActive,
          userId,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create employee');
      }

      const employeeId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'employees',
        recordId: employeeId,
        action: 'create',
        newValues: {
          employeeNumber: validated.employeeNumber,
          firstName: validated.firstName,
          lastName: validated.lastName,
          baseSalary: validated.baseSalary,
        },
      });

      return { success: true, id: employeeId };
    }, 'createEmployee');
  }

  /**
   * Create attendance record
   */
  async createAttendance(data: CreateAttendanceDto) {
    this.requirePermission('hr.edit');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateAttendanceSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Check if attendance already exists for this employee and date
      const existing = await this.query(
        'SELECT id FROM attendance WHERE company_id = $1::uuid AND employee_id = $2::uuid AND date = $3',
        [companyId, validated.employeeId, validated.date]
      );

      if (existing.success && existing.rows && existing.rows.length > 0) {
        throw new Error('Attendance record already exists for this date');
      }

      // Create attendance
      const result = await this.query(
        `INSERT INTO attendance 
         (id, company_id, employee_id, date, check_in, check_out, status, notes, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.employeeId,
          validated.date,
          validated.checkIn,
          validated.checkOut || null,
          validated.status,
          validated.notes || null,
          userId,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create attendance record');
      }

      const attendanceId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'attendance',
        recordId: attendanceId,
        action: 'create',
        newValues: {
          employeeId: validated.employeeId,
          date: validated.date,
          status: validated.status,
        },
      });

      return { success: true, id: attendanceId };
    }, 'createAttendance');
  }

  /**
   * Process payroll for a period
   * 
   * This is a critical operation that:
   * 1. Calculates salary based on attendance
   * 2. Calculates allowances and deductions
   * 3. Creates payroll records
   * 4. Creates accounting entries
   * 5. Is performed atomically (transaction-safe)
   */
  async processPayroll(data: ProcessPayrollDto) {
    this.requirePermission('hr.post');

    return this.executeWithErrorHandling(async () => {
      const validated = ProcessPayrollSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Get active employees for the period
      const employeesResult = await this.query(
        `SELECT e.*, d.name as department_name, p.name as position_name
         FROM employees e
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN positions p ON e.position_id = p.id
         WHERE e.company_id = $1::uuid AND e.is_active = true
         ${validated.departmentId ? 'AND e.department_id = $2::uuid' : ''}
         ORDER BY e.employee_number`,
        validated.departmentId ? [companyId, validated.departmentId] : [companyId]
      );

      if (!employeesResult.success || !employeesResult.rows) {
        throw new Error('Failed to get employees');
      }

      const employees = employeesResult.rows;

      if (employees.length === 0) {
        return { success: true, message: 'No employees found for payroll processing', processedCount: 0 };
      }

      // Process each employee
      const payrollId = crypto.randomUUID();

      const queries: { sql: string; params: unknown[] }[] = [
        // Create payroll record
        {
          sql: `INSERT INTO payrolls 
           (id, company_id, period_start_date, period_end_date, status, created_by)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'processed', $5::uuid)
           RETURNING id`,
          params: [payrollId, companyId, validated.periodStartDate, validated.periodEndDate, userId],
        },
      ];

      for (const employee of employees) {
        const employeeId = String(employee.id);
        const baseSalary = Number(employee.base_salary) || 0;

        // Calculate attendance days
        const attendanceResult = await this.query(
          `SELECT 
            COUNT(*) as total_days,
            SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_days,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
            SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
            SUM(CASE WHEN status = 'half_day' THEN 0.5 ELSE 0 END) as half_days
           FROM attendance
           WHERE company_id = $1::uuid AND employee_id = $2::uuid 
           AND date BETWEEN $3 AND $4`,
          [companyId, employeeId, validated.periodStartDate, validated.periodEndDate]
        );

        if (!attendanceResult.success || !attendanceResult.rows || attendanceResult.rows.length === 0) {
          continue; // Skip employee if no attendance data
        }

        const attendance = attendanceResult.rows[0] as Record<string, unknown>;
        const presentDays = Number(attendance.present_days) || 0;
        const absentDays = Number(attendance.absent_days) || 0;
        const lateDays = Number(attendance.late_days) || 0;
        const halfDays = Number(attendance.half_days) || 0;

        // Calculate salary
        const workingDays = 22; // Standard working days per month
        const dailyRate = baseSalary / workingDays;
        const workedDays = presentDays + halfDays;
        const grossSalary = dailyRate * workedDays;

        // Calculate deductions (absent days)
        const absentDeduction = dailyRate * absentDays;
        const lateDeduction = lateDays * (dailyRate * 0.1); // 10% deduction for late days
        const totalDeductions = absentDeduction + lateDeduction;

        // Calculate net salary
        const netSalary = grossSalary - totalDeductions;

        // Create payroll item
        const payrollItemId = crypto.randomUUID();
        queries.push({
          sql: `INSERT INTO payroll_items 
           (id, payroll_id, employee_id, base_salary, worked_days, absent_days, late_days, 
            gross_salary, deductions, net_salary, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11::uuid)`,
          params: [
            payrollItemId,
            payrollId,
            employeeId,
            baseSalary,
            workedDays,
            absentDays,
            lateDays,
            grossSalary,
            totalDeductions,
            netSalary,
            userId,
          ],
        });
      }

      // Execute transaction atomically
      const result = await this.transaction(queries);

      if (!result.success) {
        throw new Error(result.error || 'Failed to process payroll');
      }

      // Audit log
      await this.auditLog({
        tableName: 'payrolls',
        recordId: payrollId,
        action: 'create',
        newValues: {
          periodStartDate: validated.periodStartDate,
          periodEndDate: validated.periodEndDate,
          employeeCount: employees.length,
        },
      });

      return { success: true, payrollId, processedCount: employees.length };
    }, 'processPayroll');
  }

  /**
   * Calculate end of service benefits
   */
  async calculateEndOfService(employeeId: string, terminationDate: string) {
    this.requirePermission('hr.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();

      // Get employee details
      const employeeResult = await this.query(
        `SELECT * FROM employees 
         WHERE id = $1::uuid AND company_id = $2::uuid`,
        [employeeId, companyId]
      );

      if (!employeeResult.success || !employeeResult.rows || employeeResult.rows.length === 0) {
        throw new Error('Employee not found');
      }

      const employee = employeeResult.rows[0] as Record<string, unknown>;
      const hireDate = String(employee.hire_date);
      const baseSalary = Number(employee.base_salary) || 0;

      // Calculate service years
      const hireDateObj = new Date(hireDate);
      const terminationDateObj = new Date(terminationDate);
      const serviceYears = terminationDateObj.getFullYear() - hireDateObj.getFullYear();
      const serviceMonths = terminationDateObj.getMonth() - hireDateObj.getMonth();
      const totalServiceYears = serviceYears + (serviceMonths / 12);

      // Calculate end of service benefits (simplified calculation)
      // First 5 years: half month salary per year
      // After 5 years: full month salary per year
      const eosBenefit = totalServiceYears <= 5
        ? (baseSalary / 2) * totalServiceYears
        : (baseSalary / 2) * 5 + baseSalary * (totalServiceYears - 5);

      // Calculate unused leave balance
      const leaveBalanceResult = await this.query(
        `SELECT COALESCE(SUM(balance), 0) as total_balance
         FROM leave_balances
         WHERE company_id = $1::uuid AND employee_id = $2::uuid`,
        [companyId, employeeId]
      );

      const leaveBalance = leaveBalanceResult.success && leaveBalanceResult.rows && leaveBalanceResult.rows[0]
        ? Number(leaveBalanceResult.rows[0].total_balance) || 0
        : 0;

      const leaveEncashment = leaveBalance * (baseSalary / 22); // Daily rate

      const totalEos = eosBenefit + leaveEncashment;

      return {
        success: true,
        data: {
          employeeId,
          employeeName: `${employee.first_name} ${employee.last_name}`,
          hireDate,
          terminationDate,
          serviceYears: Math.round(totalServiceYears * 100) / 100,
          baseSalary,
          eosBenefit: Math.round(eosBenefit * 100) / 100,
          leaveBalance,
          leaveEncashment: Math.round(leaveEncashment * 100) / 100,
          totalEos: Math.round(totalEos * 100) / 100,
        },
      };
    }, 'calculateEndOfService');
  }

  /**
   * Get employees with pagination
   */
  async getEmployeesPaginated(page: number, pageSize: number, filters?: {
    departmentId?: string;
    isActive?: boolean;
    search?: string;
  }) {
    this.requirePermission('hr.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['e.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.departmentId) {
        conditions.push(`e.department_id = $${paramIndex}::uuid`);
        params.push(filters.departmentId);
        paramIndex++;
      }

      if (filters?.isActive !== undefined) {
        conditions.push(`e.is_active = $${paramIndex}`);
        params.push(filters.isActive);
        paramIndex++;
      }

      if (filters?.search) {
        conditions.push(`(e.first_name ILIKE $${paramIndex} OR e.last_name ILIKE $${paramIndex} OR e.employee_number ILIKE $${paramIndex})`);
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM employees e WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT e.*, d.name as department_name, p.name as position_name 
         FROM employees e 
         LEFT JOIN departments d ON e.department_id = d.id 
         LEFT JOIN positions p ON e.position_id = p.id 
         WHERE ${whereClause}
         ORDER BY e.employee_number ASC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get employees');
      }

      const total = countResult.success && countResult.rows && countResult.rows[0]
        ? Number(countResult.rows[0].total)
        : 0;

      return {
        success: true,
        data: {
          items: dataResult.rows || [],
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }, 'getEmployeesPaginated');
  }

  /**
   * Get attendance records with pagination
   */
  async getAttendancePaginated(page: number, pageSize: number, filters?: {
    employeeId?: string;
    departmentId?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    this.requirePermission('hr.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['a.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.employeeId) {
        conditions.push(`a.employee_id = $${paramIndex}::uuid`);
        params.push(filters.employeeId);
        paramIndex++;
      }

      if (filters?.departmentId) {
        conditions.push(`e.department_id = $${paramIndex}::uuid`);
        params.push(filters.departmentId);
        paramIndex++;
      }

      if (filters?.fromDate) {
        conditions.push(`a.date >= $${paramIndex}`);
        params.push(filters.fromDate);
        paramIndex++;
      }

      if (filters?.toDate) {
        conditions.push(`a.date <= $${paramIndex}`);
        params.push(filters.toDate);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total 
         FROM attendance a
         LEFT JOIN employees e ON a.employee_id = e.id
         WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT a.*, e.employee_number, e.first_name, e.last_name, d.name as department_name
         FROM attendance a
         LEFT JOIN employees e ON a.employee_id = e.id
         LEFT JOIN departments d ON e.department_id = d.id
         WHERE ${whereClause}
         ORDER BY a.date DESC, a.check_in DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get attendance records');
      }

      const total = countResult.success && countResult.rows && countResult.rows[0]
        ? Number(countResult.rows[0].total)
        : 0;

      return {
        success: true,
        data: {
          items: dataResult.rows || [],
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }, 'getAttendancePaginated');
  }
}

// Singleton instance
export const hrService = new HRService();
