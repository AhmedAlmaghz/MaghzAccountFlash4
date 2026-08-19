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

import { hrApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return { query: vi.fn(queryImpl) };
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
