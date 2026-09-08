import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/index', () => ({
  aiApi: {
    batchClaim: vi.fn(),
    batchItemDone: vi.fn(),
    batchItemFail: vi.fn(),
    batchGet: vi.fn(),
    batchRecover: vi.fn(async () => ({ success: true, data: { recoveredFailed: 0, recoveredSkipped: 0, finalStatus: null } })),
  },
}));

vi.mock('./toolExecutor', () => ({
  executeToolCall: vi.fn(),
}));

import { aiApi } from '../api/index';
import { executeToolCall } from './toolExecutor';
import { runBatch, extractResultRef, batchProgressLine } from './batchRunner';

const mockedApi = vi.mocked(aiApi, true);
const mockedExec = vi.mocked(executeToolCall);

function detail(overrides = {}) {
  return {
    id: 'b1',
    kind: 'mixed',
    title: 'دفعة',
    totalCount: 2,
    doneCount: 0,
    failedCount: 0,
    skippedCount: 0,
    status: 'running',
    createdAt: '',
    updatedAt: '',
    items: [],
    ...overrides,
  } as never;
}

describe('runBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims, executes and completes every item', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'i1', seq: 0, toolName: 'sales.create_invoice', args: { x: 1 }, afterSeq: null, attempts: 1 },
        { id: 'i2', seq: 1, toolName: 'sales.create_invoice', args: { x: 2 }, afterSeq: null, attempts: 1 },
      ] as never,
    });
    mockedExec.mockResolvedValue({ ok: true, result: { invoiceNumber: 'INV-1' } });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: null } });
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 2 }) });

    const progress: string[] = [];
    const final = await runBatch('c1', 'u1', 'b1', {
      onProgress: (d) => progress.push(`${d.doneCount}/${d.totalCount}`),
    });

    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedExec).toHaveBeenCalledWith('sales.create_invoice', { x: 1 }, { companyId: 'c1', userId: 'u1' });
    expect(mockedApi.batchItemDone).toHaveBeenCalledWith('c1', 'u1', 'b1', 'i1', 'INV-1');
    expect(final?.status).toBe('done');
    expect(progress.length).toBeGreaterThan(0);
  });

  it('reports retryable failures with classification and keeps going', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'i1', seq: 0, toolName: 't.a', args: {}, afterSeq: null, attempts: 1 },
        { id: 'i2', seq: 1, toolName: 't.b', args: {}, afterSeq: null, attempts: 1 },
      ] as never,
    });
    mockedExec
      .mockResolvedValueOnce({ ok: false, error: 'timeout', errorClass: { code: 'TIMEOUT', retryable: true } as never })
      .mockResolvedValueOnce({ ok: true, result: {} });
    mockedApi.batchItemFail.mockResolvedValue({ success: true, data: { retried: true, attempts: 1 } });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: null } });
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 1 }) });

    await runBatch('c1', 'u1', 'b1');

    expect(mockedApi.batchItemFail).toHaveBeenCalledWith(
      'c1', 'u1', 'b1', 'i1', 'timeout', 'TIMEOUT', true,
    );
    // second item still executed after the first failed retryably
    expect(mockedExec).toHaveBeenCalledTimes(2);
  });

  it('stops early when the batch finalizes mid-run', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'i1', seq: 0, toolName: 't.a', args: {}, afterSeq: null, attempts: 1 }] as never,
    });
    mockedExec.mockResolvedValue({ ok: true, result: {} });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: 'partial' } });
    mockedApi.batchGet.mockResolvedValue({
      success: true,
      data: detail({ status: 'partial', doneCount: 1, failedCount: 1 }),
    });

    const final = await runBatch('c1', 'u1', 'b1');
    expect(final?.status).toBe('partial');
    expect(mockedApi.batchClaim).toHaveBeenCalledTimes(1);
  });

  it('returns null when the batch cannot be read', async () => {
    mockedApi.batchGet.mockResolvedValue({ success: false, error: 'gone' });
    expect(await runBatch('c1', 'u1', 'missing')).toBeNull();
  });

  it('honors shouldStop between items', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'i1', seq: 0, toolName: 't.a', args: {}, afterSeq: null, attempts: 1 },
        { id: 'i2', seq: 1, toolName: 't.b', args: {}, afterSeq: null, attempts: 1 },
      ] as never,
    });
    mockedExec.mockResolvedValue({ ok: true, result: {} });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: null } });
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail() });

    let calls = 0;
    await runBatch('c1', 'u1', 'b1', { shouldStop: () => ++calls > 1 });
    // first item executed, then stop checked before the second
    expect(mockedExec).toHaveBeenCalledTimes(1);
  });
});

describe('runBatch lifecycle guards', () => {
  it('recovers stale running items before starting', async () => {
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 2 }) });
    await runBatch('c1', 'u1', 'b1');
    expect(mockedApi.batchRecover).toHaveBeenCalledWith('c1', 'u1', 'b1');
  });

  it('exits (no infinite loop) when the batch is paused', async () => {
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail({ status: 'paused' }) });
    const final = await runBatch('c1', 'u1', 'b1');
    expect(final?.status).toBe('paused');
    expect(mockedApi.batchClaim).not.toHaveBeenCalled();
  });

  it('exits when the batch is cancelled', async () => {
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail({ status: 'cancelled' }) });
    const final = await runBatch('c1', 'u1', 'b1');
    expect(final?.status).toBe('cancelled');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('never stacks two workers on the same batch', async () => {
    mockedApi.batchClaim.mockResolvedValue({ success: true, data: [] });
    mockedApi.batchGet.mockResolvedValue({ success: true, data: detail({ status: 'paused' }) });
    const [a, b] = await Promise.all([runBatch('c1', 'u1', 'b1'), runBatch('c1', 'u1', 'b1')]);
    expect(a?.status).toBe('paused');
    expect(b?.status).toBe('paused');
    // second call short-circuits to a refresh instead of a second loop
    expect(mockedApi.batchRecover).toHaveBeenCalledTimes(1);
  });
});

describe('extractResultRef / batchProgressLine', () => {
  it('picks the first human document reference', () => {
    expect(extractResultRef({ invoiceNumber: 'INV-1', id: 'x' })).toBe('INV-1');
    expect(extractResultRef({ id: 'abc' })).toBe('abc');
    expect(extractResultRef(null)).toBeNull();
    expect(extractResultRef('text')).toBeNull();
  });

  it('renders the shared Arabic progress line', () => {
    expect(batchProgressLine(detail({ doneCount: 3, failedCount: 1, skippedCount: 0, totalCount: 10 }) as never))
      .toBe('أُنجز 3 — فشل 1 — تُخطّي 0 — متبقٍ 6 (من 10)');
  });
});
