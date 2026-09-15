import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/manufacturing/api', () => ({
  manufacturingApi: {
    updateWorkOrderStatus: vi.fn(),
  },
}));

import { manufacturingWriteTools } from './manufacturing';
import { manufacturingApi } from '@/modules/manufacturing/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool() {
  const t = manufacturingWriteTools.find((x) => x.name === 'manufacturing.update_work_order_status');
  if (!t || !t.execute) throw new Error('tool not found');
  return t as unknown as { execute: (a: Record<string, unknown>, c: ToolContext) => Promise<unknown> };
}

const mockedApi = vi.mocked(manufacturingApi, true);

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.updateWorkOrderStatus.mockResolvedValue({ success: true } as never);
});

/**
 * Transcript regression: the model omits producedQuantity, num(undefined)
 * became 0, and completeWorkOrder froze produced_quantity at zero with no
 * stock receipt. The tool must pass undefined through (the API falls back
 * to the plan) — never a fabricated 0.
 */
describe('manufacturing.update_work_order_status — producedQuantity default', () => {
  it('omits producedQuantity (undefined) when the model does not pass it', async () => {
    const res = (await findTool().execute({ workOrderId: 'wo-1', status: 'completed' }, ctx)) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(mockedApi.updateWorkOrderStatus).toHaveBeenCalledWith(
      'wo-1', ctx.companyId, 'completed', ctx.userId, undefined, undefined, undefined,
    );
    expect(res.producedFromPlan).toBe(true);
  });

  it('passes an explicit positive quantity through', async () => {
    const res = (await findTool().execute({ workOrderId: 'wo-1', status: 'completed', producedQuantity: 12 }, ctx)) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(mockedApi.updateWorkOrderStatus).toHaveBeenCalledWith(
      'wo-1', ctx.companyId, 'completed', ctx.userId, 12, undefined, undefined,
    );
    expect(res.producedQuantity).toBe(12);
  });

  it('rejects an explicit zero instead of freezing the order at zero', async () => {
    const res = (await findTool().execute({ workOrderId: 'wo-1', status: 'completed', producedQuantity: 0 }, ctx)) as Record<string, unknown>;
    expect(res.error).toMatch(/أكبر من صفر/);
    expect(mockedApi.updateWorkOrderStatus).not.toHaveBeenCalled();
  });
});
