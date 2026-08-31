import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/validation', () => {
  const mockSchema = () => ({});
  mockSchema.optional = () => mockSchema;
  mockSchema.min = () => mockSchema;
  mockSchema.uuid = () => mockSchema;
  return {
    validateInput: vi.fn(() => ({ success: true })),
    idCompanySchema: mockSchema,
    companyIdSchema: mockSchema,
    createEmployeeSchema: mockSchema,
  };
});

vi.mock('@/core/utils/pagination', () => ({
  clampPageArgs: vi.fn((page: number, pageSize: number) => ({
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  })),
  paginatedResult: vi.fn((items: unknown[], total: number, page: number, pageSize: number) => ({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })),
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'PR-0001' })),
}));

// tx helpers run through the adapter under test — pass through to the mocked
// adapter's transaction so guard tests can capture statements.
vi.mock('@/core/database/tx', async () => {
  const actual = await vi.importActual<typeof import('@/core/database/tx')>('@/core/database/tx');
  return {
    ...actual,
    runTransaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
      const adapter = await (await vi.importMock('@/core/database/adapters')).getDbAdapter();
      return adapter.transaction(queries);
    }),
  };
});

import { hrApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return {
    query: vi.fn(queryImpl),
    transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
      const results = [];
      for (const q of queries) {
        results.push(await queryImpl(q.sql, q.params || []));
      }
      return { success: true, results };
    }),
  };
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const EMP_ID = '00000000-0000-0000-0000-000000000010';
const EMP_NUM = 'EMP-001';

describe('hrApi.getEmployeesPaginated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches by employee_number (not legacy code column)', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      if (sql.includes('SELECT COUNT(*)')) {
        return { success: true, rows: [{ total: 1 }] };
      }
      return {
        success: true,
        rows: [{
          id: EMP_ID,
          company_id: COMPANY_ID,
          employee_number: EMP_NUM,
          full_name: 'Ahmed Ali',
          is_active: true,
          photo_url: 'data:image/png;base64,...',
          attachments: '["doc1.pdf"]',
        }],
      };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.getEmployeesPaginated(COMPANY_ID, 1, 25, { search: 'Ahmed' });
    expect(res.success).toBe(true);
    expect(capturedSql).toContain('e.employee_number');
    expect(capturedSql).not.toContain('e.code');
    expect(capturedParams).toContain('%Ahmed%');
    const data = res.data;
    expect(data).toBeDefined();
    expect(data?.items[0]).toMatchObject({
      id: EMP_ID,
      fullName: 'Ahmed Ali',
      employeeNumber: EMP_NUM,
      isActive: true,
    });
    expect((data?.items[0] as { photoUrl?: string }).photoUrl).toBe('data:image/png;base64,...');
    expect((data?.items[0] as { attachments?: string[] }).attachments).toEqual(['doc1.pdf']);
  });

  it('handles isActive boolean filter', async () => {
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedParams = params;
      if (sql.includes('SELECT COUNT(*)')) {
        return { success: true, rows: [{ total: 5 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await hrApi.getEmployeesPaginated(COMPANY_ID, 1, 25, { isActive: true });
    expect(capturedParams).toContain(true);
  });

  it('omits optional filters when undefined', async () => {
    let capturedSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [{ total: 0 }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await hrApi.getEmployeesPaginated(COMPANY_ID, 1, 25);
    expect(capturedSql).not.toContain('ILIKE');
    expect(capturedSql).not.toContain('e.is_active');
  });
});

describe('hrApi.createEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts with photo_url and attachments as JSON', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true, rows: [{ id: EMP_ID }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.createEmployee({
      companyId: COMPANY_ID,
      employeeNumber: EMP_NUM,
      fullName: 'Sara Ali',
      isActive: true,
      photoUrl: 'data:image/jpeg;base64,...',
      attachments: ['a.pdf', 'b.pdf'],
    } as never);
    expect(res.success).toBe(true);
    expect(capturedSql).toContain('photo_url');
    expect(capturedSql).toContain('attachments');
    expect(capturedParams).toContain('data:image/jpeg;base64,...');
    expect(capturedParams).toContain('["a.pdf","b.pdf"]');
  });
});

describe('hrApi.updateEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always updates updated_at via NOW()', async () => {
    let capturedSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.updateEmployee(EMP_ID, COMPANY_ID, { fullName: 'Updated Name' });
    expect(res.success).toBe(true);
    expect(capturedSql).toContain('updated_at = NOW()');
    expect(capturedSql).toContain('full_name = $1');
    expect(capturedSql).toContain('WHERE id = $2 AND company_id = $3');
  });

  it('stringifies attachments to JSON', async () => {
    let capturedParams: unknown[] = [];
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await hrApi.updateEmployee(EMP_ID, COMPANY_ID, { attachments: ['x.pdf', 'y.pdf'] });
    expect(capturedParams).toContain('["x.pdf","y.pdf"]');
  });

  it('returns success when no fields changed (only updated_at applied)', async () => {
    let queryCalled = false;
    const adapter = makeMockAdapter(async () => {
      queryCalled = true;
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.updateEmployee(EMP_ID, COMPANY_ID, {});
    expect(res.success).toBe(true);
    // No business fields → only updated_at → no query needed
    expect(queryCalled).toBe(false);
  });
});

describe('hrApi.getPayrollRunsPaginated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries with company_id filter and joins payroll_lines + employees', async () => {
    let countSql = '';
    let dataSql = '';
    const adapter = makeMockAdapter(async (sql, _params) => {
      if (sql.includes('SELECT COUNT(*)')) {
        countSql = sql;
        return { success: true, rows: [{ total: 1 }] };
      }
      if (sql.startsWith('SELECT pr.* FROM payroll_runs pr')) {
        dataSql = sql;
        return {
          success: true,
          rows: [{
            id: 'r1',
            company_id: COMPANY_ID,
            month: 6,
            year: 2026,
            total_amount: 1100,
            status: 'draft',
          }],
        };
      }
      if (sql.includes('payroll_lines pl')) {
        return { success: true, rows: [{ payroll_run_id: 'r1', employee_id: 'e1', employee_name: 'Sara', base_salary: 1000, allowances: 100, deductions: 0, overtime: 0, net_salary: 1100 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.getPayrollRunsPaginated(COMPANY_ID, 1, 25, { status: 'draft' });
    expect(res.success).toBe(true);
    expect(countSql).toContain('pr.company_id = $1');
    expect(countSql).toContain('pr.status = $2');
    expect(dataSql).toContain('LIMIT $3 OFFSET $4');
    expect(dataSql).not.toContain('notes');
    const data = res.data;
    expect(data?.items[0]).toMatchObject({ id: 'r1', month: 6, year: 2026, totalAmount: 1100, status: 'draft' });
    expect((data?.items[0] as { lines: unknown[] }).lines).toHaveLength(1);
  });
});

describe('hrApi.getLeavesPaginated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns leaves with status filter and joined employee name', async () => {
    let countSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('SELECT COUNT(*)')) {
        countSql = sql;
        return { success: true, rows: [{ total: 0 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await hrApi.getLeavesPaginated(COMPANY_ID, 1, 25, { status: 'pending' });
    expect(countSql).toContain('l.company_id = $1');
    expect(countSql).toContain('l.status = $2');
  });
});

describe('hrApi.getEndOfServicesPaginated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns end-of-service records with company_id filter', async () => {
    let countSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('SELECT COUNT(*)')) {
        countSql = sql;
        return { success: true, rows: [{ total: 0 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await hrApi.getEndOfServicesPaginated(COMPANY_ID, 1, 25, { status: 'draft' });
    expect(countSql).toContain('e.company_id = $1');
    expect(countSql).toContain('e.status = $2');
  });
});

describe('hrApi.getHrKpis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies company_id filter to payroll_lines JOIN for multi-tenancy', async () => {
    let payrollSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('payroll_lines pl')) {
        payrollSql = sql;
        return { success: true, rows: [{ total: 50000 }] };
      }
      return { success: true, rows: [{ cnt: 0 }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.getHrKpis(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(payrollSql).toContain('pr.company_id = $1');
    expect(payrollSql).toContain('e.company_id = $1');
    expect(payrollSql).toContain("pr.status = 'posted'");
    expect(res.data).toMatchObject({
      totalEmployees: 0,
      activeEmployees: 0,
      pendingLeaves: 0,
      totalPayrollAmount: 50000,
    });
  });
});

describe('hrApi.getEmployees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps photoUrl and attachments from snake_case response', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        id: EMP_ID,
        company_id: COMPANY_ID,
        employee_number: EMP_NUM,
        full_name: 'Khalid',
        is_active: true,
        photo_url: 'data:image/png;base64,abc',
        attachments: ['a.pdf', 'b.pdf'],
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.getEmployees(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0]).toMatchObject({
      id: EMP_ID,
      fullName: 'Khalid',
      isActive: true,
      photoUrl: 'data:image/png;base64,abc',
      attachments: ['a.pdf', 'b.pdf'],
    });
  });

  it('handles null photoUrl and attachments gracefully', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        id: EMP_ID,
        company_id: COMPANY_ID,
        employee_number: EMP_NUM,
        full_name: 'Mona',
        is_active: true,
        photo_url: null,
        attachments: null,
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.getEmployees(COMPANY_ID);
    expect(res.success).toBe(true);
    const first = res.data?.[0];
    expect(first?.photoUrl).toBeUndefined();
    expect(first?.attachments).toBeUndefined();
  });
});

// ─── Phase B guards (server-side single source of truth) ─────────────────────

describe('hrApi.deleteEmployee — history guard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('refuses to delete an employee with payroll/leave/attendance/EOS history', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes("FROM payroll_lines pl JOIN employees")) {
        return { success: true, rows: [{ rel: 'payroll_lines' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.deleteEmployee(EMP_ID, COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('لا يمكن حذف الموظف');
    expect(res.error).toContain('مسيرات رواتب');
  });

  it('allows deletion when no history exists (falls through to DELETE)', async () => {
    let deleted = false;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.startsWith('DELETE FROM employees')) deleted = true;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.deleteEmployee(EMP_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(deleted).toBe(true);
  });
});

describe('hrApi.createLeave — server-side computation + overlap guard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects reversed date ranges', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.createLeave({
      companyId: COMPANY_ID, employeeId: EMP_ID, leaveType: 'annual',
      startDate: '2026-08-10', endDate: '2026-08-01', days: 99, status: 'pending', reason: '',
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toContain('نطاق التواريخ غير صالح');
  });

  it('computes days server-side and rejects overlapping leaves', async () => {
    let insertSql = '';
    let insertParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      if (sql.includes('daterange')) {
        // Overlapping pending leave found
        return { success: true, rows: [{ id: 'l0', start_date: '2026-08-05', end_date: '2026-08-08' }] };
      }
      if (sql.startsWith('INSERT INTO leaves')) {
        insertSql = sql; insertParams = params;
        return { success: true, rows: [{ id: 'l1' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    // Overlapping request (2026-08-05..08-08 exists; request 08-07..08-12)
    const res = await hrApi.createLeave({
      companyId: COMPANY_ID, employeeId: EMP_ID, leaveType: 'annual',
      startDate: '2026-08-07', endDate: '2026-08-12', days: 999, status: 'pending', reason: 'x',
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toContain('متداخل');

    // Non-overlapping passes with SERVER-computed days (2026-08-01..08-03 → 3, not 999)
    const res2 = await hrApi.createLeave({
      companyId: COMPANY_ID, employeeId: EMP_ID, leaveType: 'annual',
      startDate: '2026-08-01', endDate: '2026-08-03', days: 999, status: 'pending', reason: 'x',
    } as never);
    expect(res2.success).toBe(true);
    expect(res2.days).toBe(3);
    expect(insertParams).toContain(3);
    expect(insertSql).toContain('INSERT INTO leaves');
  });
});

describe('hrApi.updateLeaveStatus — state machine + strict balance', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function leaveAdapter(leaveStatus: string, usedDays: number) {
    return makeMockAdapter(async (sql) => {
      if (sql.includes('FROM leaves') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ employee_id: EMP_ID, type: 'annual', start_date: '2026-08-01', end_date: '2026-08-10', status: leaveStatus }] };
      }
      if (sql.includes("status IN ('pending', 'approved')")) {
        return { success: true, rows: [{ total: String(usedDays) }] };
      }
      if (sql.startsWith('UPDATE leaves')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
  }

  it('rejects invalid transitions (approved → rejected)', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(leaveAdapter('approved', 0) as never);
    const res = await hrApi.updateLeaveStatus('l1', COMPANY_ID, 'rejected');
    expect(res.success).toBe(false);
    expect(res.error).toContain('لا يمكن الانتقال');
  });

  it('enforces the balance strictly when approving (10 days > 5 remaining)', async () => {
    // 10-day annual leave; entitlement 21; already used 16 others → remaining 5
    vi.mocked(getDbAdapter).mockResolvedValue(leaveAdapter('pending', 10 + 16) as never);
    const res = await hrApi.updateLeaveStatus('l1', COMPANY_ID, 'approved');
    expect(res.success).toBe(false);
    expect(res.error).toContain('رصيد الإجازة غير كافٍ');
    expect(res.error).toContain('المتبقي 5');
  });

  it('approves when the balance covers the request', async () => {
    let updateCalled = false;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM leaves') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ employee_id: EMP_ID, type: 'annual', start_date: '2026-08-01', end_date: '2026-08-05', status: 'pending' }] };
      }
      if (sql.includes("status IN ('pending', 'approved')")) {
        return { success: true, rows: [{ total: '5' }] };
      }
      if (sql.startsWith('UPDATE leaves')) { updateCalled = true; return { success: true, rows: [] }; }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.updateLeaveStatus('l1', COMPANY_ID, 'approved');
    expect(res.success).toBe(true);
    expect(updateCalled).toBe(true);
  });

  it('uncapped unpaid leaves bypass the balance check', async () => {
    let updateCalled = false;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM leaves') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ employee_id: EMP_ID, type: 'unpaid', start_date: '2026-08-01', end_date: '2026-12-31', status: 'pending' }] };
      }
      if (sql.startsWith('UPDATE leaves')) { updateCalled = true; return { success: true, rows: [] }; }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.updateLeaveStatus('l1', COMPANY_ID, 'approved');
    expect(res.success).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('hrApi.deleteLeave — approved-leave protection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('refuses to delete an approved leave (must cancel)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ status: 'approved' }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.deleteLeave('l1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('إجازة معتمدة');
  });

  it('allows deleting a pending leave', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ status: 'pending' }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.deleteLeave('l1', COMPANY_ID);
    expect(res.success).toBe(true);
  });
});

describe('hrApi.createPayrollRun — server-side recomputation + period guard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function payrollAdapter(opts: { dupe?: boolean; employee?: Record<string, unknown> } = {}) {
    const employees = opts.employee
      ? [opts.employee]
      : [
          { id: 'e1', full_name: 'Ahmed', base_salary: 300000 },
          { id: 'e2', full_name: 'Sara', base_salary: 200000 },
        ];
    return makeMockAdapter(async (sql) => {
      if (sql.includes('FROM payroll_runs') && sql.includes("IN ('draft', 'posted')") && sql.includes('LIMIT 1')) {
        return { success: true, rows: opts.dupe ? [{ id: 'dupe' }] : [] };
      }
      if (sql.includes('FROM employees') && sql.includes('ANY($2')) {
        return { success: true, rows: employees as unknown[] };
      }
      if (sql.includes('FROM attendance') && sql.includes('GROUP BY employee_id')) {
        return { success: true, rows: [{ employee_id: 'e1', total: '4' }] };
      }
      if (sql.includes('FROM settings') && sql.includes("LIKE 'hr.%'")) {
        return { success: true, rows: [] };
      }
      if (sql.includes('FROM payroll_components')) {
        return { success: true, rows: [] };
      }
      if (sql.startsWith('INSERT INTO payroll_runs')) {
        return { success: true, rows: [{ id: 'run1' }] };
      }
      if (sql.startsWith('INSERT INTO payroll_lines')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
  }

  it('rejects duplicate active runs for the same month/year', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue(payrollAdapter({ dupe: true }) as never);
    const res = await hrApi.createPayrollRun({
      companyId: COMPANY_ID, month: 8, year: 2026, totalAmount: 999, status: 'draft',
      lines: [{ employeeId: 'e1', employeeName: 'A', baseSalary: 300000, allowances: 0, deductions: 0, overtime: 0, netSalary: 1 }],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toContain('بالفعل');
  });

  it('recomputes every line server-side (client netSalary ignored)', async () => {
    let lineParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      if (sql.startsWith('INSERT INTO payroll_lines')) lineParams = params;
      if (sql.includes('FROM payroll_runs') && sql.includes("IN ('draft', 'posted')") && sql.includes('LIMIT 1')) {
        return { success: true, rows: [] };
      }
      if (sql.includes('FROM employees') && sql.includes('ANY($2')) {
        return { success: true, rows: [{ id: 'e1', full_name: 'Ahmed', base_salary: 300000 }, { id: 'e2', full_name: 'Sara', base_salary: 200000 }] };
      }
      if (sql.includes('FROM attendance') && sql.includes('GROUP BY employee_id')) {
        return { success: true, rows: [{ employee_id: 'e1', total: '4' }] };
      }
      if (sql.includes("LIKE 'hr.%'") || sql.includes('FROM payroll_components')) {
        return { success: true, rows: [] };
      }
      if (sql.startsWith('INSERT INTO payroll_runs')) return { success: true, rows: [{ id: 'run1' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.createPayrollRun({
      companyId: COMPANY_ID, month: 8, year: 2026, totalAmount: 999, status: 'draft',
      lines: [
        { employeeId: 'e1', employeeName: 'Ahmed', baseSalary: 1, allowances: 0, deductions: 0, overtime: 0, netSalary: 999 },
        { employeeId: 'e2', employeeName: 'Sara', baseSalary: 1, allowances: 0, deductions: 0, overtime: 0, netSalary: 999 },
      ],
    } as never);
    expect(res.success).toBe(true);
    // Server recomputed from employee cards: e1 = 300000 base (+ overtime from
    // attendance) and e2 = 200000 — NOT the client's 999/1.
    expect(lineParams).toContain(300000);
    expect(lineParams).toContain(200000);
    expect(lineParams).not.toContain(999);
  });

  it('rejects empty lines', async () => {
    const adapter = payrollAdapter();
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.createPayrollRun({
      companyId: COMPANY_ID, month: 8, year: 2026, totalAmount: 0, status: 'draft', lines: [],
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toContain('بدون موظفين');
  });
});

describe('hrApi.postPayrollRun — atomic gross-up journal entry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function postAdapter(run: { run_number?: string; status: string; gross: number; deductions: number; net: number } | null) {
    const txStatements: Array<{ sql: string; params?: unknown[] }> = [];
    return {
      adapter: {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
          // default_accounts lookups pass the function key as the 2nd param
          if (sql.includes('FROM default_accounts')) {
            const key = String(params[1] || '');
            const id = key.includes('payable') ? 'acc-payable' : key.includes('deductions') ? 'acc-ded' : 'acc-salaries';
            return { success: true, rows: [{ account_id: id }] };
          }
          if (sql.includes('FROM accounts') && sql.includes('LIMIT 1')) {
            return { success: true, rows: [{ id: 'acc-fallback' }] };
          }
          if (sql.includes('FROM payroll_runs pr') && sql.includes('JOIN payroll_lines pl')) {
            return run
              ? { success: true, rows: [{ run_number: run.run_number, status: run.status, gross: String(run.gross), deductions: String(run.deductions), net: String(run.net) }] }
              : { success: true, rows: [] };
          }
          return { success: true, rows: [] };
        }),
        transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
          txStatements.push(...queries);
          return { success: true, results: queries.map(() => ({ rows: [] })) };
        }),
      },
      txStatements,
    };
  }

  it('books the gross-up JE and flips status in ONE transaction', async () => {
    const { adapter, txStatements } = postAdapter({ run_number: 'PR-0001', status: 'draft', gross: 507500, deductions: 27000, net: 480500 });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.postPayrollRun('run1', COMPANY_ID, 'user1');
    expect(res.success).toBe(true);
    expect(res.runNumber).toBe('PR-0001');

    // ONE atomic batch: JE statement + status flip
    expect(txStatements).toHaveLength(2);
    const jeSql = txStatements[0].sql;
    expect(jeSql).toMatch(/WITH new_tx AS \(\s*INSERT INTO transactions/);
    expect(jeSql).toContain("VALUES ($1::uuid, $2::timestamptz, $3, $4, $5::numeric, 'posted')");
    // Gross-up entries: Dr salaries (gross) / Cr payable (net) / Cr deductions
    const jeParams = txStatements[0].params as unknown[];
    expect(jeParams).toContain(507500);   // totalAmount = gross
    expect(jeParams).toContain(480500);   // credit net
    expect(jeParams).toContain(27000);    // credit deductions
    const flipSql = txStatements[1].sql;
    expect(flipSql).toContain("SET status = 'posted'");
    expect(flipSql).toContain("AND status = 'draft'");
  });

  it('omits the deductions credit line when deductions are zero', async () => {
    const { adapter, txStatements } = postAdapter({ run_number: 'PR-0002', status: 'draft', gross: 100, deductions: 0, net: 100 });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.postPayrollRun('run2', COMPANY_ID);
    expect(res.success).toBe(true);
    // 2 entries only (Dr gross / Cr net) — the zero-deductions line is omitted
    const jeSql = txStatements[0].sql;
    expect((jeSql.match(/\(\(SELECT id FROM new_tx\)/g) || []).length).toBe(2);
  });

  it('refuses to re-post a posted run', async () => {
    const { adapter } = postAdapter({ run_number: 'PR-0003', status: 'posted', gross: 1, deductions: 0, net: 1 });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.postPayrollRun('run3', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('غير مسودة');
  });

  it('refuses when accounts are not configured', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM default_accounts') || (sql.includes('FROM accounts') && sql.includes('LIMIT 1'))) {
        return { success: true, rows: [] };
      }
      if (sql.includes('JOIN payroll_lines pl')) {
        return { success: true, rows: [{ run_number: 'PR-9', status: 'draft', gross: '10', deductions: '0', net: '10' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.postPayrollRun('runX', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('غير مهيأة');
  });
});

describe('hrApi.deletePayrollRun — draft-only', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('refuses to delete a posted run', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('SELECT status FROM payroll_runs')) return { success: true, rows: [{ status: 'posted' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.deletePayrollRun('r1', COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('مرحَّل');
  });

  it('deletes a draft run', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('SELECT status FROM payroll_runs')) return { success: true, rows: [{ status: 'draft' }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.deletePayrollRun('r1', COMPANY_ID);
    expect(res.success).toBe(true);
  });
});

describe('hrApi.createEndOfService — server-side computation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('computes serviceYears/lastSalary/eosAmount from the employee card (client zeros ignored)', async () => {
    let insertParams: unknown[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      if (sql.includes('FROM employees') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ hire_date: '2021-08-01', base_salary: 100000, full_name: 'Ahmed' }] };
      }
      if (sql.includes("LIKE 'hr.%'")) return { success: true, rows: [] };
      if (sql.startsWith('INSERT INTO end_of_service')) {
        insertParams = params;
        return { success: true, rows: [{ id: 'eos1' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    // Client passes garbage zeros (the AI-tool bug this fixes)
    const res = await hrApi.createEndOfService({
      companyId: COMPANY_ID, employeeId: EMP_ID, terminationDate: '2026-08-01',
      serviceYears: 0, lastSalary: 0, eosAmount: 0, reason: 'resignation', status: 'draft',
    } as never);
    expect(res.success).toBe(true);
    // 5 years × 0.5 × 100000 = 250000
    expect(res.eosAmount).toBe(250000);
    expect(res.serviceYears).toBe(5);
    expect(insertParams).toContain(250000);
    expect(insertParams).toContain(5);
  });

  it('rejects termination before hire date', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM employees') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ hire_date: '2026-08-01', base_salary: 100000, full_name: 'X' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.createEndOfService({
      companyId: COMPANY_ID, employeeId: EMP_ID, terminationDate: '2020-01-01',
      serviceYears: 9, lastSalary: 9, eosAmount: 9, reason: 'resignation', status: 'draft',
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toContain('قبل التعيين');
  });
});

describe('hrApi.updateEndOfServiceStatus — state machine + accrual JE', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('books the accrual JE atomically on draft → approved', async () => {
    const txStatements: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM end_of_service') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'draft', eos_amount: '250000', employee_id: EMP_ID }] };
        }
        if (sql.includes('FROM default_accounts')) {
          const key = String(params[1] || '');
          return { success: true, rows: [{ account_id: key.includes('eos_payable') ? 'acc-payable' : 'acc-expense' }] };
        }
        if (sql.includes('FROM accounts') && sql.includes('LIMIT 1')) return { success: true, rows: [{ id: 'acc-fb' }] };
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        txStatements.push(...queries);
        return { success: true, results: queries.map(() => ({ rows: [] })) };
      }),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.updateEndOfServiceStatus('eos1', COMPANY_ID, 'approved', 'u1');
    expect(res.success).toBe(true);
    expect(txStatements).toHaveLength(2);
    expect(txStatements[0].sql).toMatch(/WITH new_tx AS \(\s*INSERT INTO transactions/);
    expect(txStatements[0].params).toContain(250000);
    expect(txStatements[1].sql).toContain("SET status = 'approved'");
  });

  it('refuses direct approved → paid (must use payEndOfService with a cash box)', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM end_of_service') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ status: 'approved', eos_amount: '1000', employee_id: EMP_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.updateEndOfServiceStatus('eos1', COMPANY_ID, 'paid');
    expect(res.success).toBe(false);
    expect(res.error).toContain('الخزنة');
  });
});

describe('hrApi.payEndOfService — settlement JE against the cash box', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('books Dr payable / Cr cash-box account atomically', async () => {
    const txStatements: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM end_of_service') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'approved', eos_amount: '250000' }] };
        }
        if (sql.includes('FROM default_accounts')) {
          const key = String(params[1] || '');
          return { success: true, rows: [{ account_id: key.includes('eos_payable') ? 'acc-payable' : 'acc-other' }] };
        }
        if (sql.includes('FROM cash_boxes')) return { success: true, rows: [{ account_id: 'acc-cash' }] };
        return { success: true, rows: [] };
      }),
      transaction: vi.fn(async (queries: Array<{ sql: string; params?: unknown[] }>) => {
        txStatements.push(...queries);
        return { success: true, results: queries.map(() => ({ rows: [] })) };
      }),
    };
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await hrApi.payEndOfService('eos1', COMPANY_ID, 'box1', 'u1');
    expect(res.success).toBe(true);
    expect(txStatements).toHaveLength(2);
    const jeParams = txStatements[0].params as unknown[];
    expect(jeParams).toContain(250000);
    expect(jeParams).toContain('acc-payable');
    expect(jeParams).toContain('acc-cash');
    expect(txStatements[1].sql).toContain("SET status = 'paid'");
    expect(txStatements[1].sql).toContain('cash_box_id = $3::uuid');
    expect(txStatements[1].sql).toContain('paid_at = NOW()');
  });

  it('refuses payment before approval', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM end_of_service') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ status: 'draft', eos_amount: '100' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const res = await hrApi.payEndOfService('eos1', COMPANY_ID, 'box1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('قبل اعتماد');
  });
});
