import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/index', () => ({
  aiApi: {
    batchClaim: vi.fn(),
    batchItemDone: vi.fn(),
    batchItemFail: vi.fn(),
    batchGet: vi.fn(),
    batchList: vi.fn(),
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

// File-wide hermeticity: the lifecycle/ref suites assert call counts, so
// accumulated calls from earlier tests would poison them (the pre-existing
// red state of this file). Every test starts with zeroed call history.
beforeEach(() => {
  vi.clearAllMocks();
});

describe('runBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Header miss by default → syncHeader falls back to a full refresh, i.e.
    // the pre-optimization behavior. Tests for the header path set their own.
    mockedApi.batchList.mockResolvedValue({ success: true, data: [] });
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
    // Start-of-run read (running) drives the loop; later reads see terminal.
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 2 }) });

    const progress: string[] = [];
    const final = await runBatch('c1', 'u1', 'b1', {
      onProgress: (d) => progress.push(`${d.doneCount}/${d.totalCount}`),
    });

    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedExec).toHaveBeenCalledWith('sales.create_invoice', { x: 1 }, { companyId: 'c1', userId: 'u1' });
    expect(mockedApi.batchItemDone).toHaveBeenCalledWith(
      'c1', 'u1', 'b1', 'i1', 'INV-1', { invoiceNumber: 'INV-1' },
    );
    expect(final?.status).toBe('done');
    expect(progress.length).toBeGreaterThan(0);
  });

  it('tracks progress locally with header-only sync (bounded full reads)', async () => {
    // Regression gate for the UI-thread freeze: the worker used to re-read
    // the FULL detail (every item + args JSON) after EVERY item — O(N²)
    // parsing on the main thread, where PGlite also executes. Now progress
    // is tracked locally and the DB is consulted header-only (no items).
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'i1', seq: 0, toolName: 'sales.create_invoice', args: { x: 1 }, afterSeq: null, attempts: 1 },
        { id: 'i2', seq: 1, toolName: 'sales.create_invoice', args: { x: 2 }, afterSeq: null, attempts: 1 },
      ] as never,
    });
    mockedExec.mockResolvedValue({ ok: true, result: { invoiceNumber: 'INV-1' } });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: null } });
    // Start-of-run full read (running) + terminal-close full read (done).
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 2 }) });
    // Header path: by end-of-round the DB already flipped to done (the fin
    // query fires when no queued/running items remain).
    const headerBase = {
      id: 'b1', kind: 'mixed', title: 'دفعة', totalCount: 2,
      doneCount: 0, failedCount: 0, skippedCount: 0,
      createdAt: '', updatedAt: '',
    };
    mockedApi.batchList.mockResolvedValue({
      success: true,
      data: [{ ...headerBase, status: 'done', doneCount: 2 }],
    });

    const progress: string[] = [];
    const final = await runBatch('c1', 'u1', 'b1', {
      onProgress: (d) => progress.push(`${d.doneCount}/${d.totalCount}`),
    });

    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(final?.status).toBe('done');
    expect(final?.doneCount).toBe(2);
    // Per-item progress came from local counters…
    expect(progress).toContain('1/2');
    expect(progress).toContain('2/2');
    // …the header path was used…
    expect(mockedApi.batchList).toHaveBeenCalledWith('c1', 'u1');
    // …and full detail was read only twice (start + terminal), not per item.
    expect(mockedApi.batchGet).toHaveBeenCalledTimes(2);
  });

  it('reports retryable failures with classification and keeps going', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      // attempts:1 = first failure → immediate retry (delay 0). Higher
      // attempt counts sleep per the backoff schedule (capped 10s) — a
      // separate concern covered by nextRetryDelayMs unit tests.
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
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 1 }) });

    await runBatch('c1', 'u1', 'b1');

    expect(mockedApi.batchItemFail).toHaveBeenCalledWith(
      'c1', 'u1', 'b1', 'i1', 'timeout', 'TIMEOUT', true,
    );
    // second item still executed after the first failed retryably
    expect(mockedExec).toHaveBeenCalledTimes(2);
  });

  it('P1: a TIMEOUT on a WRITE tool is never retried (abandoned promise may still commit)', async () => {
    // The timeout abandons — never aborts — the underlying promise. For a
    // write tool the abandoned call may commit at any moment, so re-running
    // the item would mint a duplicate financial document. It must fail
    // permanently with an honest code instead.
    const { registerTool, clearToolRegistry } = await import('../tools/registry');
    clearToolRegistry();
    registerTool({
      name: 't.write',
      labelAr: 'كتابة',
      descriptionAr: 'أداة كتابة اختبارية',
      permission: 'core.view',
      dangerLevel: 'write',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
    try {
      mockedApi.batchClaim.mockResolvedValueOnce({
        success: true,
        data: [
          { id: 'i1', seq: 0, toolName: 't.write', args: {}, afterSeq: null, attempts: 1 },
        ] as never,
      });
      mockedExec.mockResolvedValueOnce({ ok: false, error: 'timeout', errorClass: { code: 'TIMEOUT', retryable: true } as never });
      mockedApi.batchItemFail.mockResolvedValue({ success: true, data: { retried: false, finalStatus: 'partial' } });
      mockedApi.batchGet
        .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
        .mockResolvedValue({ success: true, data: detail({ status: 'partial', failedCount: 1 }) });

      const final = await runBatch('c1', 'u1', 'b1');

      // Code stays TIMEOUT (classifiable by errorTaxonomy); the duplicate
      // protection is retryable=false.
      expect(mockedApi.batchItemFail).toHaveBeenCalledWith(
        'c1', 'u1', 'b1', 'i1', 'timeout', 'TIMEOUT', false,
      );
      expect(final?.status).toBe('partial');
    } finally {
      clearToolRegistry();
    }
  });

  it('stops early when the batch finalizes mid-run', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'i1', seq: 0, toolName: 't.a', args: {}, afterSeq: null, attempts: 1 }] as never,
    });
    mockedExec.mockResolvedValue({ ok: true, result: {} });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: 'partial' } });
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({
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
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({ success: true, data: detail() });

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

describe('ref substitution', () => {
  it('substitutes {{ref.id}} from a completed dependency before executing', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'i1', seq: 0, toolName: 't.make', args: {}, afterSeq: null, ref: 'sup', attempts: 1 },
        { id: 'i2', seq: 1, toolName: 't.use', args: { supplierId: '{{sup.id}}' }, afterSeq: 0, ref: null, attempts: 1 },
      ] as never,
    });
    mockedExec
      .mockResolvedValueOnce({ ok: true, result: { id: 's-1', name: 'مورد' } })
      .mockResolvedValueOnce({ ok: true, result: {} });
    mockedApi.batchItemDone.mockResolvedValue({ success: true, data: { finalStatus: null } });
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 2 }) });

    await runBatch('c1', 'u1', 'b1');

    expect(mockedExec).toHaveBeenNthCalledWith(2, 't.use', { supplierId: 's-1' }, { companyId: 'c1', userId: 'u1' });
    // outputs persisted via resultData on done
    expect(mockedApi.batchItemDone).toHaveBeenCalledWith(
      'c1', 'u1', 'b1', 'i1', 's-1', expect.objectContaining({ id: 's-1' }),
    );
  });

  it('fails loudly with UNRESOLVED_REF when the ref is unknown', async () => {
    mockedApi.batchClaim.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'i9', seq: 0, toolName: 't.use', args: { supplierId: '{{ghost.id}}' }, afterSeq: null, ref: null, attempts: 1 },
      ] as never,
    });
    mockedApi.batchItemFail.mockResolvedValue({ success: true, data: { retried: false, skipped: 0, finalStatus: null } });
    mockedApi.batchGet
      .mockResolvedValueOnce({ success: true, data: detail({ status: 'running' }) })
      .mockResolvedValue({ success: true, data: detail({ status: 'done', doneCount: 0, failedCount: 1 }) });

    await runBatch('c1', 'u1', 'b1');

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedApi.batchItemFail).toHaveBeenCalledWith(
      'c1', 'u1', 'b1', 'i9', expect.stringMatching(/ghost/), 'UNRESOLVED_REF', false,
    );
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
