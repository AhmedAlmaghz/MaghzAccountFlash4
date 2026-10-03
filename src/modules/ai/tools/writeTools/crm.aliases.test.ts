import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/crm/api', () => ({
  crmApi: {
    createLead: vi.fn(),
    createOpportunity: vi.fn(),
    createTask: vi.fn(),
    createActivity: vi.fn(),
    updateLead: vi.fn(),
    updateOpportunity: vi.fn(),
    updateTask: vi.fn(),
  },
}));

import { crmWriteTools } from './crm';
import { crmApi } from '@/modules/crm/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool(name: string) {
  const t = crmWriteTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as {
    execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  };
}

describe('crm Arabic-first aliases (audit round)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create_lead accepts nameAr', async () => {
    vi.mocked(crmApi.createLead).mockResolvedValue({ success: true, id: 'l1' } as never);
    const res = (await findTool('crm.create_lead').execute({ nameAr: 'خالد' }, ctx)) as Record<
      string,
      unknown
    >;
    expect(res.created).toBe(true);
    expect(vi.mocked(crmApi.createLead)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'خالد' }),
      ctx.userId,
    );
  });

  it('create_opportunity accepts Arabic stage + amount alias, value optional', async () => {
    vi.mocked(crmApi.createOpportunity).mockResolvedValue({ success: true, id: 'o1' } as never);
    const res = (await findTool('crm.create_opportunity').execute(
      { opportunityName: 'صفقة', stage: 'تفاوض', amount: 5000 },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(crmApi.createOpportunity)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'صفقة', stage: 'negotiation', value: 5000 }),
      ctx.userId,
    );
  });

  it('create_task accepts Arabic title/priority and links', async () => {
    vi.mocked(crmApi.createTask).mockResolvedValue({ success: true, id: 't1' } as never);
    const res = (await findTool('crm.create_task').execute(
      { عنوان: 'تابع العميل', priority: 'عالية', leadId: '11111111-1111-4111-8111-111111111111' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(crmApi.createTask)).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'تابع العميل', priority: 'high' }),
      ctx.userId,
    );
  });

  it('create_activity maps Arabic types and normalizes dates', async () => {
    vi.mocked(crmApi.createActivity).mockResolvedValue({ success: true, id: 'a1' } as never);
    const res = (await findTool('crm.create_activity').execute(
      { subject: 'مكالمة', type: 'مكالمة', activityDate: '15 أغسطس 2026' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(vi.mocked(crmApi.createActivity)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'call' }),
      ctx.userId,
    );
  });

  it('update_task drops the invalid in_progress value (maps to pending)', async () => {
    vi.mocked(crmApi.updateTask).mockResolvedValue({ success: true } as never);
    const res = (await findTool('crm.update_task').execute(
      { taskId: '11111111-1111-4111-8111-111111111111', status: 'قيد التنفيذ' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(vi.mocked(crmApi.updateTask)).toHaveBeenCalledWith(
      expect.anything(),
      ctx.companyId,
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('update_opportunity_stage maps Arabic stages', async () => {
    vi.mocked(crmApi.updateOpportunity).mockResolvedValue({ success: true } as never);
    const res = (await findTool('crm.update_opportunity_stage').execute(
      { opportunityId: '11111111-1111-4111-8111-111111111111', stage: 'فوز' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.updated).toBe(true);
  });
});
