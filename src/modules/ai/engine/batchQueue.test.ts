import { describe, it, expect } from 'vitest';
import {
  resolveBatchItems,
  buildIdempotencyKey,
  stableStringify,
  nextRetryDelayMs,
  summarizeBatchProgress,
  isTerminalBatchStatus,
  MAX_ITEM_ATTEMPTS,
} from './batchQueue';

describe('resolveBatchItems', () => {
  it('carries display labels through untouched', () => {
    const res = resolveBatchItems([
      { tool: 'sales.create_invoice', args: {}, label: 'معكوس ← مشتريات' },
      { tool: 'sales.create_invoice', args: {} },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0].label).toBe('معكوس ← مشتريات');
    expect(res.items[1].label).toBeNull();
  });

  it('assigns seq numbers with null deps when no after given', () => {
    const res = resolveBatchItems([
      { tool: 'sales.create_invoice', args: { a: 1 } },
      { tool: 'sales.create_invoice', args: { a: 2 } },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.map((i) => i.seq)).toEqual([0, 1]);
    expect(res.items.every((i) => i.afterSeq === null)).toBe(true);
  });

  it('resolves numeric backward refs', () => {
    const res = resolveBatchItems([
      { tool: 'purchases.create_supplier', args: {} },
      { tool: 'purchases.create_invoice', args: {}, after: 0 },
      { tool: 'accounting.create_payment_voucher', args: {}, after: 1 },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.map((i) => i.afterSeq)).toEqual([null, 0, 1]);
  });

  it('resolves semantic string refs to earlier seq', () => {
    const res = resolveBatchItems([
      { tool: 'purchases.create_supplier', args: {}, ref: 'new-supplier' },
      { tool: 'purchases.create_invoice', args: {}, after: 'new-supplier' },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[1].afterSeq).toBe(0);
  });

  it('rejects forward references', () => {
    const res = resolveBatchItems([
      { tool: 'a.x', args: {}, after: 1 },
      { tool: 'a.y', args: {} },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/سابق فقط/);
  });

  it('rejects self references', () => {
    const res = resolveBatchItems([{ tool: 'a.x', args: {}, after: 0 }]);
    expect(res.ok).toBe(false);
  });

  it('rejects unknown string refs', () => {
    const res = resolveBatchItems([{ tool: 'a.x', args: {}, after: 'ghost' }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/ghost/);
  });

  it('rejects duplicate refs', () => {
    const res = resolveBatchItems([
      { tool: 'a.x', args: {}, ref: 'dup' },
      { tool: 'a.y', args: {}, ref: 'dup' },
    ]);
    expect(res.ok).toBe(false);
  });

  it('rejects out-of-range seq refs', () => {
    const res = resolveBatchItems([{ tool: 'a.x', args: {}, after: 9 }]);
    expect(res.ok).toBe(false);
  });

  it('rejects empty batches', () => {
    expect(resolveBatchItems([]).ok).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('is deterministic for the same tool + args', () => {
    const a = buildIdempotencyKey('sales.create_invoice', { x: 1, y: [1, 2] });
    const b = buildIdempotencyKey('sales.create_invoice', { x: 1, y: [1, 2] });
    expect(a).toBe(b);
  });

  it('ignores object key order (stable stringify)', () => {
    const a = buildIdempotencyKey('t', { x: 1, y: 2 });
    const b = buildIdempotencyKey('t', { y: 2, x: 1 });
    expect(a).toBe(b);
    expect(stableStringify({ b: 1, a: { z: 3, y: 2 } })).toBe('{"a":{"y":2,"z":3},"b":1}');
  });

  it('differs across tools and args', () => {
    expect(buildIdempotencyKey('a', { x: 1 })).not.toBe(buildIdempotencyKey('b', { x: 1 }));
    expect(buildIdempotencyKey('a', { x: 1 })).not.toBe(buildIdempotencyKey('a', { x: 2 }));
  });
});

describe('retry backoff', () => {
  it('retries immediate, then 30s, then 5min, then gives up', () => {
    expect(nextRetryDelayMs(1)).toBe(0);
    expect(nextRetryDelayMs(2)).toBe(30_000);
    expect(nextRetryDelayMs(3)).toBe(300_000);
    expect(nextRetryDelayMs(4)).toBeNull();
    expect(nextRetryDelayMs(99)).toBeNull();
  });

  it('max attempts is 1 initial + 3 retries', () => {
    expect(MAX_ITEM_ATTEMPTS).toBe(4);
  });
});

describe('progress helpers', () => {
  it('summarizes counts in Arabic', () => {
    expect(summarizeBatchProgress(45, 3, 2, 50)).toBe('أُنجز 45 — فشل 3 — تُخطّي 2 — متبقٍ 0 (من 50)');
    expect(summarizeBatchProgress(0, 0, 0, 20)).toMatch(/متبقٍ 20/);
  });

  it('detects terminal batch statuses', () => {
    expect(isTerminalBatchStatus('done')).toBe(true);
    expect(isTerminalBatchStatus('partial')).toBe(true);
    expect(isTerminalBatchStatus('cancelled')).toBe(true);
    expect(isTerminalBatchStatus('running')).toBe(false);
    expect(isTerminalBatchStatus('paused')).toBe(false);
    expect(isTerminalBatchStatus('pending')).toBe(false);
  });
});
