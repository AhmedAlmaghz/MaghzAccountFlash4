import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/hr/api', () => ({
  hrApi: {
    getDepartments: vi.fn(),
    createDepartment: vi.fn(),
    getEmployeesPaginated: vi.fn(),
    getPayrollRuns: vi.fn(),
    previewPayrollRun: vi.fn(),
    createPayrollRun: vi.fn(),
    saveAttendance: vi.fn(async () => ({ success: true })),
  },
}));

import { hrTools } from './hrTools';
import { hrApi } from '@/modules/hr/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool(name: string) {
  const t = hrTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as {
    execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  };
}

describe('HR live-session guards (2026-10-02 session 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('search.departments browses the head on empty query instead of erroring', async () => {
    vi.mocked(hrApi.getDepartments).mockResolvedValue({
      success: true,
      data: [{ id: 'd1', name: 'الإدارة', employeeCount: 0 }],
    } as never);
    const res = (await findTool('search.departments').execute({}, ctx)) as Record<string, unknown>;
    expect(Array.isArray(res.departments)).toBe(true);
    expect((res.departments as unknown[]).length).toBe(1);
  });

  it('hr.create_department accepts nameAr (Arabic-first model habit)', async () => {
    vi.mocked(hrApi.createDepartment).mockResolvedValue({ success: true, id: 'd9' } as never);
    const res = (await findTool('hr.create_department').execute({ nameAr: 'الإدارة' }, ctx)) as Record<
      string,
      unknown
    >;
    expect(res.created).toBe(true);
  });

  it('hr.generate_payroll_run hands back the existing run on duplicate period', async () => {
    vi.mocked(hrApi.previewPayrollRun).mockResolvedValue({
      success: true,
      data: { lines: [{ employeeId: 'e1' }], totalGross: 100, totalNet: 100 },
    } as never);
    vi.mocked(hrApi.createPayrollRun).mockResolvedValue({ success: false, error: 'يوجد مسير رواتب للفترة بالفعل' } as never);
    vi.mocked(hrApi.getPayrollRuns).mockResolvedValue({
      success: true,
      data: [{ id: 'run-9', month: 9, year: 2026, status: 'draft' }],
    } as never);
    const res = (await findTool('hr.generate_payroll_run').execute({ month: 9, year: 2026 }, ctx)) as Record<
      string,
      unknown
    >;
    expect(res.exists).toBe(true);
    expect(res.payrollId).toBe('run-9');
  });

  it('hr.save_attendance wraps a singular record and resolves employee names', async () => {
    vi.mocked(hrApi.getEmployeesPaginated).mockResolvedValue({
      success: true,
      data: { items: [{ id: 'emp-1', fullName: 'عماد المعز' }] },
    } as never);
    const res = (await findTool('hr.save_attendance').execute(
      { date: '21 سبتمبر 2026', employeeName: 'عماد المعز', status: 'absent' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.error).toBeUndefined();
    expect(vi.mocked(hrApi.saveAttendance)).toHaveBeenCalled();
  });
});
