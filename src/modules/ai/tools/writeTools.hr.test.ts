import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/hr/api', () => ({
  hrApi: {
    updateEmployee: vi.fn(),
    createEmployee: vi.fn(),
  },
}));

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'EMP-999' })),
}));

import { writeTools } from './writeTools';
import { hrApi } from '@/modules/hr/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool(name: string) {
  return writeTools.find((t) => t.name === name);
}

describe('hr.update_employee tool (department binding regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exists and carries hr.edit permission', () => {
    const tool = findTool('hr.update_employee');
    expect(tool).toBeDefined();
    expect(tool?.permission).toBe('hr.edit');
  });

  it('supports departmentId/position/baseSalary and forwards them to hrApi.updateEmployee', async () => {
    const tool = findTool('hr.update_employee');
    expect(tool).toBeDefined();
    const schema = tool!.parameters as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['departmentId', 'position', 'baseSalary']),
    );

    vi.mocked(hrApi.updateEmployee).mockResolvedValue({ success: true } as never);

    const res = (await tool!.execute(
      { employeeId: 'emp-1', departmentId: 'dep-1', baseSalary: 250000 },
      ctx,
    )) as Record<string, unknown>;

    expect(res.updated).toBe(true);
    expect(hrApi.updateEmployee).toHaveBeenCalledWith('emp-1', ctx.companyId, {
      departmentId: 'dep-1',
      baseSalary: 250000,
    });
  });

  it('rejects a non-positive base salary', async () => {
    const tool = findTool('hr.update_employee');
    expect(tool).toBeDefined();
    const res = (await tool!.execute({ employeeId: 'emp-1', baseSalary: -5 }, ctx)) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(String(res.error)).toContain('أكبر من صفر');
    expect(hrApi.updateEmployee).not.toHaveBeenCalled();
  });

  it('rejects an update with no fields', async () => {
    const tool = findTool('hr.update_employee');
    expect(tool).toBeDefined();
    const res = (await tool!.execute({ employeeId: 'emp-1' }, ctx)) as Record<string, unknown>;
    expect(String(res.error)).toContain('حقل واحد على الأقل');
  });

  it('surfaces hrApi failures verbatim', async () => {
    const tool = findTool('hr.update_employee');
    expect(tool).toBeDefined();
    vi.mocked(hrApi.updateEmployee).mockResolvedValue({ success: false, error: 'الموظف غير موجود' } as never);
    const res = (await tool!.execute({ employeeId: 'emp-x', fullName: 'سامي' }, ctx)) as Record<string, unknown>;
    expect(String(res.error)).toContain('الموظف غير موجود');
  });
});

describe('hr.create_employee — plain `name` alias (transcript regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Real session 2026-09-10: the model passed `name` (like suppliers and
  // customers accept) and all 12 employee creations failed with
  // "الاسم الكامل مطلوب" although the name was right there in args.
  it('accepts plain `name` as an alias for fullName', async () => {
    const tool = findTool('hr.create_employee');
    expect(tool).toBeDefined();
    vi.mocked(hrApi.createEmployee).mockResolvedValue({ success: true, id: 'emp-9' } as never);
    const res = (await tool!.execute(
      { name: 'أحمد صالح', hireDate: '2026-01-01', baseSalary: 350000, position: 'مدير عام' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(hrApi.createEmployee)).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'أحمد صالح' }),
      ctx.userId,
    );
  });

  it('shows the real name on the approval card (never undefined)', () => {
    const tool = findTool('hr.create_employee');
    expect(tool).toBeDefined();
    const s = tool!.summarizeArgs!({ name: 'أحمد صالح', baseSalary: 350000 });
    expect(s).toContain('أحمد صالح');
    expect(s).not.toContain('undefined');
  });

  it('maps `name` to fullName on update instead of silently dropping it', async () => {
    const tool = findTool('hr.update_employee');
    expect(tool).toBeDefined();
    vi.mocked(hrApi.updateEmployee).mockResolvedValue({ success: true } as never);
    const res = (await tool!.execute({ employeeId: 'emp-1', name: 'اسم جديد' }, ctx)) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(vi.mocked(hrApi.updateEmployee)).toHaveBeenCalledWith(
      'emp-1',
      ctx.companyId,
      expect.objectContaining({ fullName: 'اسم جديد' }),
    );
  });
});
