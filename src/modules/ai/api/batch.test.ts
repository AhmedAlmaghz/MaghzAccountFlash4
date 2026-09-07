import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./index', () => ({
  aiApi: {
    batchCreate: vi.fn(),
    batchGet: vi.fn(),
    batchList: vi.fn(),
    batchSetStatus: vi.fn(),
    batchRetryFailed: vi.fn(),
  },
}));

import { aiApi } from './index';
import {
  cancelBatch,
  enqueueBatch,
  getBatch,
  listBatches,
  findResumableBatches,
  pauseBatch,
  retryFailedBatch,
  unpauseBatch,
} from './batch';
import { registerTool, clearToolRegistry } from '../tools/registry';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const mockedApi = vi.mocked(aiApi, true);

const adminUser: User = { id: 'u1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };

function writeTool(name: string, permission: 'sales.create' | 'sales.post' = 'sales.create') {
  registerTool({
    name,
    labelAr: 'أداة',
    descriptionAr: 'وصف',
    permission,
    dangerLevel: 'write',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({}),
  });
}

describe('enqueueBatch', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    writeTool('sales.create_invoice');
    writeTool('sales.post_invoice', 'sales.post');
  });

  it('rejects empty batches', async () => {
    const res = await enqueueBatch({ items: [] });
    expect(res.success).toBe(false);
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('rejects batches over the 500-item chunk cap', async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({ tool: 'sales.create_invoice', args: { i } }));
    const res = await enqueueBatch({ items });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/500/);
  });

  it('rejects unknown tools before writing anything', async () => {
    const res = await enqueueBatch({ items: [{ tool: 'nope.missing', args: {} }] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/غير معروفة/);
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('rejects read tools (batches are writes-only)', async () => {
    registerTool({
      name: 'sales.get_invoices',
      labelAr: 'أداة',
      descriptionAr: 'وصف',
      permission: 'sales.view',
      dangerLevel: 'read',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
    const res = await enqueueBatch({ items: [{ tool: 'sales.get_invoices', args: {} }] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/قراءة/);
  });

  it('rejects DAG violations (forward refs) before writing', async () => {
    const res = await enqueueBatch({
      items: [{ tool: 'sales.create_invoice', args: {}, after: 1 }, { tool: 'sales.create_invoice', args: {} }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/سابق فقط/);
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('creates the batch with resolved seq + idempotency keys', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 2, inserted: 2 } });
    const res = await enqueueBatch({
      title: 'دفعة اختبار',
      kind: 'sales_invoice',
      items: [
        { tool: 'sales.create_invoice', args: { x: 1 }, ref: 'first' },
        { tool: 'sales.post_invoice', args: { x: 2 }, after: 'first' },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.data?.batchId).toBe('b1');
    const payload = mockedApi.batchCreate.mock.calls[0][0];
    expect(payload.companyId).toBe('c1');
    expect(payload.userId).toBe('u1');
    expect(payload.title).toBe('دفعة اختبار');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[1].after_seq).toBe(0);
    expect(payload.items[0].idempotency_key).toBeTruthy();
    expect(payload.items[0].idempotency_key).not.toBe(payload.items[1].idempotency_key);
  });

  it('forwards display labels to the bridge', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    await enqueueBatch({
      items: [{ tool: 'sales.create_invoice', args: {}, label: 'مستندنا — كما هو' }],
    });
    expect(mockedApi.batchCreate.mock.calls[0][0].items[0].label).toBe('مستندنا — كما هو');
  });

  it('surfaces bridge errors honestly', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: false, error: 'DB down' });
    const res = await enqueueBatch({ items: [{ tool: 'sales.create_invoice', args: {} }] });
    expect(res.success).toBe(false);
    expect(res.error).toBe('DB down');
  });
});

describe('getBatch / listBatches / findResumableBatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
  });

  it('getBatch forwards context and returns the detail', async () => {
    mockedApi.batchGet.mockResolvedValue({ success: true, data: { id: 'b1' } as never });
    const res = await getBatch('b1');
    expect(res.success).toBe(true);
    expect(mockedApi.batchGet).toHaveBeenCalledWith('c1', 'u1', 'b1');
  });

  it('pause/unpause/cancel forward the transition with context', async () => {
    mockedApi.batchSetStatus.mockResolvedValue({ success: true, data: { status: 'paused', skipped: 0 } });
    expect((await pauseBatch('b1')).success).toBe(true);
    expect(mockedApi.batchSetStatus).toHaveBeenCalledWith('c1', 'u1', 'b1', 'paused');
    await unpauseBatch('b1');
    expect(mockedApi.batchSetStatus).toHaveBeenCalledWith('c1', 'u1', 'b1', 'running');
    await cancelBatch('b1');
    expect(mockedApi.batchSetStatus).toHaveBeenCalledWith('c1', 'u1', 'b1', 'cancelled');
  });

  it('retryFailedBatch forwards and returns the requeued count', async () => {
    mockedApi.batchRetryFailed.mockResolvedValue({ success: true, data: { requeued: 3 } });
    const res = await retryFailedBatch('b1');
    expect(res).toEqual({ success: true, data: { requeued: 3 } });
    expect(mockedApi.batchRetryFailed).toHaveBeenCalledWith('c1', 'u1', 'b1');
  });

  it('surfaces bridge errors from status transitions honestly', async () => {
    mockedApi.batchSetStatus.mockResolvedValue({ success: false, error: 'gone' });
    const res = await pauseBatch('b1');
    expect(res.success).toBe(false);
    expect(res.error).toBe('gone');
  });

  it('findResumableBatches merges running + paused without dupes', async () => {
    const running = { id: 'b1', status: 'running' };
    const paused = { id: 'b1', status: 'running' };
    const paused2 = { id: 'b2', status: 'paused' };
    mockedApi.batchList.mockImplementation(async (_c, _u, status) => ({
      success: true,
      data: (status === 'running' ? [running] : [paused, paused2]) as never,
    }));
    const res = await findResumableBatches();
    expect(res.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });
});
