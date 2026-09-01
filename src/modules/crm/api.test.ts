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

vi.mock('@/core/api', () => ({
  getNextDocumentNumber: vi.fn(async () => ({ success: true, number: 'CUST-0001' })),
}));

vi.mock('@/core/utils/auditLogger', () => ({
  logAudit: vi.fn(async () => {}),
}));

vi.mock('@/modules/auth/store', () => ({
  useAuthStore: { getState: () => ({ user: { id: '00000000-0000-0000-0000-000000000099', username: 'tester' } }) },
}));

vi.mock('@/core/utils/userIdValidator', () => ({
  safeUserId: vi.fn((v: unknown) => {
    if (!v || typeof v !== 'string') return null;
    const t = v.trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t.toLowerCase() : null;
  }),
}));

vi.mock('@/core/utils/normalizeArabic', () => ({
  normalizeArabic: vi.fn((s: string) => s.toLowerCase().trim()),
  fuzzyMatchScore: vi.fn(() => 0.5),
  findAllFuzzyMatches: vi.fn(() => []),
  bestFuzzyMatch: vi.fn(() => null),
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
    let capturedInsertParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (sql, params) => {
      // First query is duplicate guard — return no duplicate
      if (sql.includes('LOWER(name)')) {
        return { success: true, rows: [] };
      }
      capturedInsertParams = params;
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
    expect(capturedInsertParams).toEqual([
      COMPANY_ID, 'New Lead', null, null, null, null, 'new', 'warm', null, null, null, expect.any(String), null, null,
    ]);
  });

  it('createLead blocks exact duplicate (API guard)', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('LOWER(name)')) {
        return { success: true, rows: [{ id: 'dup-id', name: 'New Lead' }] };
      }
      return { success: true, rows: [{ id: 'new-lead' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.createLead({
      companyId: COMPANY_ID,
      name: 'New Lead',
      phone: '+967700000000',
      status: 'new',
      rating: 'warm',
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مكررة|مطابق/);
    expect(res.duplicate).toBeDefined();
  });

  it('updateLead with empty data returns success without DB call', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateLead(LEAD_ID, COMPANY_ID, {});
    expect(res.success).toBe(true);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it('updateLead with status change builds correct SET clause (with updated_by)', async () => {
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
    // updated_by is always stamped now (Phase A2)
    expect(capturedSql).toMatch(/updated_by/);
    expect(capturedSql).toMatch(/WHERE id = \$\d+::uuid AND company_id = \$\d+::uuid/);
    // params: status, rating, updated_by(null for undefined userId), id, companyId
    expect(capturedParams?.[0]).toBe('qualified');
    expect(capturedParams?.[1]).toBe('hot');
  });

  it('convertLeadToCustomer creates customer and updates lead status to converted (atomic CTE)', async () => {
    const adapter = makeMockAdapter(async (sql, _params) => {
      // Atomic CTE must be checked before the generic getLeadById pattern
      if (sql.includes('lead_check') && sql.includes('new_customer')) {
        return { success: true, rows: [{ id: 'new-customer', opportunity_id: null }] };
      }
      // getLeadById
      if (sql.includes('FROM leads') && sql.includes('WHERE id = $1::uuid AND company_id = $2::uuid')) {
        return { success: true, rows: [{ id: LEAD_ID, company_id: COMPANY_ID, name: 'L', email: 'e@test.com', phone: '700000', status: 'new', rating: 'warm', estimated_value: 50000, assigned_to: null }] };
      }
      // duplicate guard for leads (not in convert path) — but handle
      if (sql.includes('LOWER(name)')) return { success: true, rows: [] };
      // deleteLead guard check (not in convert)
      if (sql.includes('FROM opportunities WHERE lead_id')) return { success: true, rows: [{ opps: 0, tasks: 0, acts: 0 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.convertLeadToCustomer(LEAD_ID, COMPANY_ID, { address: 'Addr', taxNumber: 'TX', creditLimit: 5000 });
    expect(res.success).toBe(true);
    expect(res.id).toBe('new-customer');
    expect(res.code).toBe('CUST-0001');
  });

  it('convertLeadToCustomer rejects already-converted lead', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM leads') && sql.includes('WHERE id = $1::uuid')) {
        return { success: true, rows: [{ id: LEAD_ID, company_id: COMPANY_ID, name: 'L', status: 'converted', rating: 'warm' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.convertLeadToCustomer(LEAD_ID, COMPANY_ID, {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/محوَّل|converted/i);
  });

  it('convertLeadToCustomer with createOpportunity returns opportunityId', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('lead_check') && sql.includes('new_customer')) {
        return { success: true, rows: [{ id: 'new-customer', opportunity_id: 'new-opp-id' }] };
      }
      if (sql.includes('FROM leads') && sql.includes('WHERE id = $1::uuid')) {
        return { success: true, rows: [{ id: LEAD_ID, company_id: COMPANY_ID, name: 'Al-Amal', status: 'new', rating: 'warm', estimated_value: 100000, assigned_to: null }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.convertLeadToCustomer(LEAD_ID, COMPANY_ID, { createOpportunity: true });
    expect(res.success).toBe(true);
    expect(res.opportunityId).toBe('new-opp-id');
  });

  it('getLeadsPaginated builds search ILIKE filter correctly', async () => {
    let capturedSql: string | null = null;
    let capturedParams: unknown[] | null = null;
    const adapter = makeMockAdapter(async (sql, params) => {
      // COUNT query
      if (sql.includes('COUNT(*)')) return { success: true, rows: [{ total: 0 }] };
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

  it('deleteLead blocks when lead has referencing opportunities', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities WHERE lead_id')) {
        return { success: true, rows: [{ opps: 1, tasks: 0, acts: 0 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.deleteLead(LEAD_ID, COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/لا يمكن حذف/);
  });

  it('deleteLead succeeds when no references exist', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities WHERE lead_id')) {
        return { success: true, rows: [{ opps: 0, tasks: 0, acts: 0 }] };
      }
      if (sql.includes('DELETE FROM leads')) return { success: true, rows: [] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.deleteLead(LEAD_ID, COMPANY_ID);
    expect(res.success).toBe(true);
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
    const adapter = makeMockAdapter(async (sql) => {
      // getOpportunityById for stage-machine guard
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 50000, stage: 'new', probability: 50, expected_close_date: null, assigned_to: null, notes: 'old' }] };
      }
      if (sql.includes('UPDATE opportunities')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    let capturedSql = '';
    const spyAdapter = makeMockAdapter(async (sql, _params) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 50000, stage: 'new', probability: 50, expected_close_date: null, assigned_to: null, notes: 'old' }] };
      }
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(spyAdapter as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { notes: 'Updated notes' });
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/notes = \$1/);
  });

  it('updateOpportunity with stage won auto-stamps close_date and probability', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 50000, stage: 'negotiation', probability: 80, expected_close_date: null, assigned_to: null, notes: '' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    let capturedSql = '';
    const spy = makeMockAdapter(async (sql, _params) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 50000, stage: 'negotiation', probability: 80, expected_close_date: null, assigned_to: null, notes: '' }] };
      }
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(spy as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { stage: 'won' });
    expect(res.success).toBe(true);
    expect(capturedSql).toMatch(/close_date = CURRENT_DATE/);
    expect(capturedSql).toMatch(/probability/);
  });

  it('updateOpportunity blocks illegal backward transition', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 50000, stage: 'proposal', probability: 60, expected_close_date: null, assigned_to: null, notes: '' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { stage: 'qualified' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/غير قانوني|انتقال/);
  });

  it('updateOpportunity blocks modification of won opportunity', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 50000, stage: 'won', probability: 100, expected_close_date: null, assigned_to: null, notes: '' }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { stage: 'negotiation' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/مقفلة|won/i);
  });

  it('getOpportunityById returns mapped opportunity with closeDate', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp 1', value: 100000, stage: 'won', probability: 100, close_date: '2026-08-20', expected_close_date: '2026-08-15', assigned_to: null }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getOpportunityById(OPPORTUNITY_ID, COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.stage).toBe('won');
    expect(res.data?.closeDate).toBe('2026-08-20');
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
      if (sql.includes('COUNT(*)')) return { success: true, rows: [{ total: 0 }] };
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
      // CTE: INSERT + UPDATE in one statement — params: company, lead, opp, cust, type, subject, desc, date, duration, assigned, created_at, created_by, updated_by
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

  it('createActivity uses CTE to stamp lead last_contacted_at atomically', async () => {
    let capturedSql = '';
    const adapter = makeMockAdapter(async (sql) => {
      capturedSql = sql;
      return { success: true, rows: [{ id: 'new-act' }] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.createActivity({
      companyId: COMPANY_ID,
      type: 'call',
      subject: 'Follow-up',
      activityDate: '2026-06-15',
      leadId: LEAD_ID,
    });
    expect(capturedSql).toMatch(/new_activity/);
    expect(capturedSql).toMatch(/touched_lead/);
    expect(capturedSql).toMatch(/last_contacted_at/);
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
    expect(capturedParams?.[0]).toBe('New Subject');
    expect(capturedParams?.[1]).toBe('2026-07-01');
  });
});

describe('crmApi - Pagination edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLeadsPaginated returns total 0 when no results match', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('COUNT(*)')) return { success: true, rows: [{ total: 0 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getLeadsPaginated(COMPANY_ID, 1, 25, { status: 'lost' });
    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(0);
    expect(res.data?.items).toEqual([]);
  });

  it('getOpportunitiesPaginated clamps page args via clampPageArgs', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('COUNT(*)')) return { success: true, rows: [{ total: 0 }] };
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getOpportunitiesPaginated(COMPANY_ID, 1, 50, { stage: 'new' });
    expect(res.success).toBe(true);
    expect(res.data?.pageSize).toBe(50);
  });

  it('getActivitiesPaginated supports search filter', async () => {
    let capturedSql: string | null = null;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('COUNT(*)')) return { success: true, rows: [{ total: 0 }] };
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.getActivitiesPaginated(COMPANY_ID, 1, 25, { type: 'call', search: 'ahmed' });
    expect(capturedSql).toMatch(/a\.type = \$2/);
    expect(capturedSql).toMatch(/a\.subject ILIKE \$3/);
  });

  it('getActivitiesPaginated filters by type only', async () => {
    let capturedSql: string | null = null;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('COUNT(*)')) return { success: true, rows: [{ total: 0 }] };
      capturedSql = sql;
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await crmApi.getActivitiesPaginated(COMPANY_ID, 1, 25, { type: 'call' });
    expect(capturedSql).toMatch(/a\.type = \$2/);
    expect(capturedSql).not.toMatch(/a\.subject ILIKE/);
  });
});

describe('crmApi - Stage machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows forward transition new -> qualified', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp', value: 10000, stage: 'new', probability: 10 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { stage: 'qualified' });
    expect(res.success).toBe(true);
  });

  it('allows open -> won transition', async () => {
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('FROM opportunities o') && sql.includes('WHERE o.id = $1::uuid')) {
        return { success: true, rows: [{ id: OPPORTUNITY_ID, company_id: COMPANY_ID, name: 'Opp', value: 10000, stage: 'negotiation', probability: 80 }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.updateOpportunity(OPPORTUNITY_ID, COMPANY_ID, { stage: 'won' });
    expect(res.success).toBe(true);
  });
});

describe('crmApi - KPIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLeadKpis returns aggregated counts', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ total: 10, new_leads: 3, contacted: 2, qualified: 2, converted: 2, lost: 1, pipeline_value: 50000 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getLeadKpis(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(10);
    expect(res.data?.converted).toBe(2);
  });

  it('getOpportunityKpis returns pipeline and weighted values', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ total: 5, open_count: 3, won: 1, lost: 1, pipeline_value: 300000, weighted_value: 150000, won_value: 100000 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getOpportunityKpis(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.pipelineValue).toBe(300000);
    expect(res.data?.weightedValue).toBe(150000);
  });

  it('getTaskKpis returns overdue count', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ total: 8, pending: 4, completed: 3, cancelled: 1, overdue: 2 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getTaskKpis(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.overdue).toBe(2);
  });

  it('getActivityKpis returns type breakdown', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ total: 20, calls: 10, meetings: 5, total_minutes: 600 }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await crmApi.getActivityKpis(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data?.calls).toBe(10);
    expect(res.data?.totalMinutes).toBe(600);
  });
});
