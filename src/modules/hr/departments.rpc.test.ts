import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The desktop half of the departments / payroll-components tranche.
 *
 * The PGlite fallback is covered by the existing suites, and it is the half that
 * a unit test can see. This file covers the other half: with the typed surface
 * present, the eight functions must go through `db:rpc:hr.*` and never reach the
 * adapter — because on the desktop the adapter forwards straight to
 * `db:internal-query`, which is raw SQL text crossing the process boundary.
 *
 * Behaviour, not pattern-matching. Whether the guard holds depends on control
 * flow, and there are several valid shapes of it; a regex written for one would
 * pass a method whose guard had been broken into another. Installing the surface
 * and asserting the adapter is untouched fails the moment any of the eight
 * regresses, whatever the shape of the guard.
 *
 * The payload assertions matter as much as the routing. A company id travelling
 * in the payload is a cross-tenant handle, and the three `affects_*` columns of
 * a payroll component are DERIVED from its type on the main side — a payload
 * that could set them would let a caller reclassify a deduction as part of gross
 * salary and move every payroll total downstream.
 */
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

import { hrApi } from './api';
import { getDbAdapter, isElectronPg } from '@/core/database/adapters';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const DEPT_ID = '00000000-0000-0000-0000-0000000000aa';
const COMP_ID = '00000000-0000-0000-0000-0000000000bb';
const USER_ID = '00000000-0000-0000-0000-0000000000cc';

let query: ReturnType<typeof vi.fn>;
let surface: Record<string, ReturnType<typeof vi.fn>>;

function envelope(rows: unknown[] = [], error?: string) {
  return error ? { success: false, error } : { success: true, rows };
}

function installSurface(overrides: Record<string, unknown> = {}) {
  surface = {
    getDepartments: vi.fn(async () => envelope([{
      id: DEPT_ID, company_id: COMPANY_ID, name: 'Sales', manager_id: null,
      manager_name: null, employee_count: 2,
    }])),
    createDepartment: vi.fn(async () => envelope([{ id: DEPT_ID }])),
    updateDepartment: vi.fn(async () => envelope([])),
    deleteDepartment: vi.fn(async () => envelope([{ linked: 0, deleted: 1 }])),
    getPayrollComponentsList: vi.fn(async () => envelope([{
      id: COMP_ID, company_id: COMPANY_ID, name_ar: 'Bonus', name_en: 'Bonus',
      code: 'BON', type: 'earning', calculation_method: 'fixed', default_amount: 100,
      affects_gross_salary: true, affects_tax: false, affects_social_insurance: false,
      is_active: true, default_account_id: null,
    }])),
    createPayrollComponent: vi.fn(async () => envelope([{ id: COMP_ID }])),
    updatePayrollComponent: vi.fn(async () => envelope([])),
    deactivatePayrollComponent: vi.fn(async () => envelope([])),
    ...overrides,
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
  (window as unknown as Record<string, unknown>).electronDB = { hr: surface };
  return surface;
}

beforeEach(() => {
  query = vi.fn(async () => ({ success: true, rows: [] }));
  vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  vi.mocked(isElectronPg).mockReturnValue(true);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronDB;
  vi.restoreAllMocks();
});

const ID = DEPT_ID;

describe('departments and payroll components speak typed RPC on the desktop', () => {
  it('none of the eight reaches the adapter when the surface is installed', async () => {
    installSurface();

    await hrApi.getDepartments(COMPANY_ID);
    await hrApi.createDepartment({ companyId: COMPANY_ID, name: 'Sales' });
    await hrApi.updateDepartment(ID, COMPANY_ID, { name: 'Sales' });
    await hrApi.deleteDepartment(ID, COMPANY_ID);
    await hrApi.getPayrollComponentsList(COMPANY_ID);
    await hrApi.createPayrollComponent({ companyId: COMPANY_ID, nameAr: 'Bonus', type: 'earning' });
    await hrApi.updatePayrollComponent(ID, COMPANY_ID, { nameAr: 'Bonus' });
    await hrApi.deactivatePayrollComponent(ID, COMPANY_ID);

    expect(query, 'a migrated method reached adapter.query on the desktop path')
      .not.toHaveBeenCalled();
  });

  it('the reads map the rows the channel returns', async () => {
    installSurface();

    const depts = await hrApi.getDepartments(COMPANY_ID);
    expect(depts.success).toBe(true);
    expect(depts.data).toHaveLength(1);
    expect(depts.data?.[0].name).toBe('Sales');
    expect(depts.data?.[0].employeeCount).toBe(2);

    const comps = await hrApi.getPayrollComponentsList(COMPANY_ID);
    expect(comps.success).toBe(true);
    expect(comps.data?.[0].type).toBe('earning');
    expect(comps.data?.[0].defaultAmount).toBe(100);
    expect(comps.data?.[0].affectsGrossSalary).toBe(true);
  });

  it('no payload carries a company id — the main process owns the tenant', async () => {
    const s = installSurface();

    await hrApi.getDepartments(COMPANY_ID);
    await hrApi.getPayrollComponentsList(COMPANY_ID);
    await hrApi.createDepartment({ companyId: COMPANY_ID, name: 'Sales' });
    await hrApi.createPayrollComponent({ companyId: COMPANY_ID, nameAr: 'Bonus', type: 'earning' });
    await hrApi.updateDepartment(ID, COMPANY_ID, { name: 'Ops' });
    await hrApi.updatePayrollComponent(ID, COMPANY_ID, { nameAr: 'Bonus' });
    await hrApi.deleteDepartment(ID, COMPANY_ID);
    await hrApi.deactivatePayrollComponent(ID, COMPANY_ID);

    for (const [name, fn] of Object.entries(s)) {
      for (const call of fn.mock.calls) {
        expect(call[0], name + ' sent a companyId in the payload')
          .not.toHaveProperty('companyId');
      }
    }
  });

  it('no payload carries an audit user — the channel stamps the session', async () => {
    const s = installSurface();

    await hrApi.createDepartment({ companyId: COMPANY_ID, name: 'Sales' }, USER_ID);
    await hrApi.updateDepartment(ID, COMPANY_ID, { name: 'Ops' }, USER_ID);
    await hrApi.createPayrollComponent({ companyId: COMPANY_ID, nameAr: 'Bonus', type: 'earning' }, USER_ID);
    await hrApi.updatePayrollComponent(ID, COMPANY_ID, { nameAr: 'Bonus' }, USER_ID);
    await hrApi.deactivatePayrollComponent(ID, COMPANY_ID, USER_ID);

    for (const [name, fn] of Object.entries(s)) {
      for (const call of fn.mock.calls) {
        expect(call[0], name + ' sent an audit user in the payload')
          .not.toHaveProperty('userId');
        expect(call[0], name + ' sent an audit user in the payload')
          .not.toHaveProperty('createdBy');
        expect(call[0], name + ' sent an audit user in the payload')
          .not.toHaveProperty('updatedBy');
      }
    }
  });

  it('a payroll component creation does not send the derived affect_* columns', async () => {
    const s = installSurface();

    await hrApi.createPayrollComponent({
      companyId: COMPANY_ID, nameAr: 'Bonus', type: 'earning',
    } as never);

    const payload = s.createPayrollComponent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('affectsGrossSalary');
    expect(payload).not.toHaveProperty('affectsTax');
    expect(payload).not.toHaveProperty('affectsSocialInsurance');
    expect(payload).toMatchObject({ nameAr: 'Bonus', type: 'earning' });
  });

  it('a partial update sends only the keys the form changed', async () => {
    const s = installSurface();

    await hrApi.updateDepartment(ID, COMPANY_ID, { managerId: null });
    await hrApi.updatePayrollComponent(ID, COMPANY_ID, { isActive: false });

    expect(s.updateDepartment.mock.calls[0][0]).toEqual({ id: ID, name: undefined, managerId: null });
    expect(s.updatePayrollComponent.mock.calls[0][0]).toMatchObject({ id: ID, isActive: false });
  });

  it('the delete guard reaches the caller instead of reporting success', async () => {
    const s = installSurface({
      deleteDepartment: vi.fn(async () => envelope([], 'لا يمكن حذف القسم لوجود 2 موظف مرتبط به — انقل الموظفين إلى قسم آخر أولاً.')),
    });

    const res = await hrApi.deleteDepartment(ID, COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('موظف مرتبط');
    expect(s.deleteDepartment).toHaveBeenCalledWith({ id: ID });
  });

  it('a rejected channel result is reported, not swallowed', async () => {
    installSurface({
      createDepartment: vi.fn(async () => envelope([], 'اسم القسم مطلوب.')),
      deactivatePayrollComponent: vi.fn(async () => envelope([], 'Permission denied')),
    });

    const created = await hrApi.createDepartment({ companyId: COMPANY_ID, name: '  ' });
    expect(created.success).toBe(false);
    expect(created.error).toBe('اسم القسم مطلوب.');

    const off = await hrApi.deactivatePayrollComponent(ID, COMPANY_ID);
    expect(off.success).toBe(false);
    expect(off.error).toBe('Permission denied');
  });

  it('falls back to the adapter when the surface is absent (browser/PGlite)', async () => {
    vi.mocked(isElectronPg).mockReturnValue(false);
    delete (window as unknown as Record<string, unknown>).electronDB;
    query = vi.fn(async () => ({ success: true, rows: [{ id: DEPT_ID, company_id: COMPANY_ID, name: 'Sales', employee_count: 0 }] }));
    vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);

    const res = await hrApi.getDepartments(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].name).toBe('Sales');
    expect(query, 'the PGlite path is in-process, so the adapter is correct there')
      .toHaveBeenCalled();
  });
});
