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
    validateInput: vi.fn((_schema: unknown, data: unknown) => ({ success: true, data })),
    idCompanySchema: mockSchema,
    companyIdSchema: mockSchema,
    createLeadSchema: mockSchema,
    updateLeadSchema: mockSchema,
    createOpportunitySchema: mockSchema,
    updateOpportunitySchema: mockSchema,
    createTaskSchema: mockSchema,
    updateTaskSchema: mockSchema,
    createActivitySchema: mockSchema,
    updateActivitySchema: mockSchema,
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

import { crmApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return { query: vi.fn(queryImpl) };
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = '00000000-0000-0000-0000-000000000100';
const OPPORTUNITY_ID = '00000000-0000-0000-0000-000000000200';
const TASK_ID = '00000000-0000-0000-0000-000000000300';
const ACTIVITY_ID = '00000000-0000-0000-0000-000000000400';

describe('crmApi - Leads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLeads returns leads with assigned_name from users LEFT JOIN', async () => {
    const adapter = makeMockAdapter(async (_sql, _params) => ({
      success: true,
      rows: [
        { id: LEAD_ID, company_id: COMPANY_ID, name: 'Lead 1', phone: '+967111', email: 'l1@example.com', company: 'C1', source: 'web', status: 'new', rating: 'hot', estimated_value: 100000, assigned_to: null, notes: '', created_at: '2026-01-01' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getLeads(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].name).toBe('Lead 1');
    expect(res.data?.[0].rating).toBe('hot');
  });

  it('getLeadById returns mapped lead with defaults when fields missing', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: LEAD_ID, company_id: COMPANY_ID, name: 'Test' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getLeadById(LEAD_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.rating).toBe('warm');
    expect(res.data?.status).toBe('new');
  });

  it('createLead sends null for empty optional fields (PG-friendly)', async () => {
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true, rows: [{ id: 'new-lead' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.createLead({
      companyId: COMPANY_ID,
      name: 'New Lead',
      phone: undefined,
      email: undefined,
      company: undefined,
      source: undefined,
      status: 'new',
      rating: 'warm',
      estimatedValue: undefined,
      assignedTo: undefined,
      notes: undefined,
    });
    expect(res.success).toBe(true);
    expect(capturedParams).toEqual([
      COMPANY_ID, 'New Lead', null, null, null, null, 'new', 'warm', null, null, null, expect.any(String), null, null,
    ]);
  });

  it('updateLead with empty data returns success without DB call', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateLead(LEAD_ID, COMPANY_ID, {});
    expect(res.success).toBe(true);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('updateLead with status change builds correct SET clause', async () => {
    let capturedSql: string | null = null;
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateLead(LEAD_ID, COMPANY_ID, { status: 'qualified', rating: 'hot' });
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/status = \$1/);
    expect(capturedSql).toMatch(/rating = \$2/);
    expect(capturedSql).toMatch(/WHERE id = \$3 AND company_id = \$4/);
    expect(capturedParams).toEqual(['qualified', 'hot', LEAD_ID, COMPANY_ID]);
  });

  it('convertLeadToCustomer creates customer and updates lead status to converted', async () => {
    const callOrder: string[] = [];
    const adapter = makeMockAdapter(async (sql, _params) => {
      if (sql.startsWith('SELECT * FROM leads')) {
        callOrder.push('select_lead');
        return { success: true, rows: [{ id: LEAD_ID, company_id: COMPANY_ID, name: 'L', email: 'e', phone: 'p' }] };
      }
      if (sql.startsWith('INSERT INTO customers')) {
        callOrder.push('insert_customer');
        return { success: true, rows: [{ id: 'new-customer' }] };
      }
      if (sql.startsWith("UPDATE leads SET status = 'converted'")) {
        callOrder.push('update_lead');
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.convertLeadToCustomer(LEAD_ID, COMPANY_ID, { address: 'Addr', taxNumber: 'TX', creditLimit: 5000 });
    expect(res.success).toBe(true);
    expect(res.id).toBe('new-customer');
    expect(callOrder).toEqual(['select_lead', 'insert_customer', 'update_lead']);
  });

  it('getLeadsPaginated builds search ILIKE filter correctly', async () => {
    let capturedSql: string | null = null;
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getLeadsPaginated(COMPANY_ID, 1, 25, { search: 'ahmed' });
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/l\.name ILIKE \$2/);
    expect(capturedSql).toMatch(/l\.email ILIKE \$2/);
    expect(capturedSql).toMatch(/l\.phone ILIKE \$2/);
    expect(capturedParams?.[1]).toBe('%ahmed%');
  });
});

describe('crmApi - Opportunities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getOpportunities returns opportunities with stage and probability', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 100000, stage: 'qualified', probability: 60, expected_close_date: '2026-07-01', assigned_to: null, notes: 'note' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getOpportunities(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].stage).toBe('qualified');
    expect(res.data?.[0].probability).toBe(60);
  });

  it('createOpportunity includes notes in INSERT statement', async () => {
    let capturedSql: string | null = null;
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [{ id: 'new-opp' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.createOpportunity({
      companyId: COMPANY_ID,
      name: 'New Opportunity',
      value: 50000,
      stage: 'new',
      probability: 25,
      expectedCloseDate: '2026-12-31',
      assignedTo: undefined,
      notes: 'Important deal',
    });
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/notes/);
  });

  it('updateOpportunity includes notes in SET clause (fixes silent data loss)', async () => {
    let capturedSql: string | null = null;
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { notes: 'Updated notes' });
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/notes = \$1/);
    expect(capturedSql).toMatch(/WHERE id = \$2 AND company_id = \$3/);
  });

  it('updateOpportunity can update stage and probability together', async () => {
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { stage: 'won', probability: 100 });
    expect(capturedParams).toEqual(['won', 100, OPPORTUNITY_ID, COMPANY_ID]);
  });
});

describe('crmApi - Tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getTasks returns tasks with status and priority', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { id: TASK_ID, company_id: COMPANY_ID, title: 'T1', due_date: '2026-07-01', priority: 'high', status: 'pending' },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getTasks(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].title).toBe('T1');
    expect(res.data?.[0].priority).toBe('high');
  });

  it('createTask sends null for empty optional fields', async () => {
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true, rows: [{ id: 'new-task' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.createTask({
      companyId: COMPANY_ID,
      title: 'New Task',
      description: undefined,
      dueDate: undefined,
      priority: 'medium',
      status: 'pending',
      leadId: undefined,
      opportunityId: undefined,
      customerId: undefined,
      assignedTo: undefined,
    });
    expect(res.success).toBe(true);
    expect(capturedParams).toEqual([
      COMPANY_ID, null, null, null, 'New Task', null, null, 'medium', 'pending', null, expect.any(String), null, null,
    ]);
  });

  it('updateTask toggles status from pending to completed', async () => {
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.updateTask(TASK_ID, COMPANY_ID, { status: 'completed' });
    expect(capturedParams?.[0]).toBe('completed');
  });

  it('getTasksPaginated supports search filter on title and description', async () => {
    let capturedSql: string | null = null;
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.getTasksPaginated(COMPANY_ID, 1, 25, { search: 'meeting', priority: 'high' });
    expect(capturedSql).toMatch(/t\.title ILIKE \$3/);
    expect(capturedSql).toMatch(/t\.description ILIKE \$3/);
    expect(capturedSql).toMatch(/t\.priority = \$2/);
  });
});

describe('crmApi - Activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getActivities returns activities with activity_date and duration', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { id: ACTIVITY_ID, company_id: COMPANY_ID, type: 'call', subject: 'S1', description: 'D1', activity_date: '2026-06-01T10:00:00Z', duration_minutes: 30, assigned_to: null },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getActivities(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].type).toBe('call');
    expect(res.data?.[0].durationMinutes).toBe(30);
  });

  it('createActivity sends null for empty durationMinutes', async () => {
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true, rows: [{ id: 'new-act' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.createActivity({
      companyId: COMPANY_ID,
      type: 'note',
      subject: 'Test',
      description: undefined,
      activityDate: '2026-06-01',
      durationMinutes: undefined,
    });
    expect(res.success).toBe(true);
    expect(capturedParams?.[8]).toBeNull();
  });

  it('mapActivityRow falls back to NOW when activity_date is null (defensive)', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: ACTIVITY_ID, company_id: COMPANY_ID, type: 'email', subject: 'S2' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getActivities(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.[0].activityDate).toBeTruthy();
    expect(new Date(res.data?.[0].activityDate || '').getTime()).toBeGreaterThan(0);
  });

  it('updateActivity can update subject and activityDate together', async () => {
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (_sql, params) => {
      capturedParams = params;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.updateActivity(ACTIVITY_ID, COMPANY_ID, { subject: 'New Subject', activityDate: '2026-07-01' });
    expect(capturedParams).toEqual(['New Subject', '2026-07-01', ACTIVITY_ID, COMPANY_ID]);
  });
});

describe('crmApi - Pagination edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLeadsPaginated returns total 0 when no results match', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getLeadsPaginated(COMPANY_ID, 1, 25, { status: 'lost' });
    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(0);
    expect(res.data?.items).toEqual([]);
  });

  it('getOpportunitiesPaginated clamps page args via clampPageArgs', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getOpportunitiesPaginated(COMPANY_ID, 1, 50, { stage: 'new' });
    expect(res.success).toBe(true);
    expect(res.data?.pageSize).toBe(50);
  });

  it('getActivitiesPaginated filters by type only (no search param)', async () => {
    let capturedSql: string | null = null;
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.getActivitiesPaginated(COMPANY_ID, 1, 25, { type: 'call' });
    expect(capturedSql).toMatch(/a\.type = \$2/);
    expect(capturedSql).not.toMatch(/search/);
  });
});
