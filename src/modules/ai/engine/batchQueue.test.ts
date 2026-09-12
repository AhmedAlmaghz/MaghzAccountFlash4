import { describe, it, expect } from 'vitest';
import {
  resolveBatchItems,
  buildIdempotencyKey,
  extractOutputScalars,
  resolveOutputId,
  stableStringify,
  nextRetryDelayMs,
  substituteRefs,
  summarizeBatchProgress,
  isTerminalBatchStatus,
  MAX_ITEM_ATTEMPTS,
  truncateScalarsForPersist,
  RESULT_DATA_JSON_BUDGET,
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

describe('substituteRefs', () => {
  const outputs = new Map([
    ['sup_abo_elaz', { id: 's-uuid-1', name: 'أبو العز' }],
    ['emp1', { id: 'e-uuid-9' }],
  ]);

  it('resolves whole-value @ref to the output id', () => {
    const r = substituteRefs({ supplierId: '@sup_abo_elaz' }, outputs);
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ supplierId: 's-uuid-1' });
  });

  it('resolves embedded {{ref.field}} templates', () => {
    const r = substituteRefs(
      { supplierId: '{{sup_abo_elaz.id}}', notes: 'مورد {{sup_abo_elaz.name}} معتمد' },
      outputs,
    );
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ supplierId: 's-uuid-1', notes: 'مورد أبو العز معتمد' });
  });

  it('resolves inside nested arrays (invoice lines)', () => {
    const r = substituteRefs(
      { lines: [{ productId: '{{prod_1.id}}', quantity: 2 }] },
      new Map([['prod_1', { id: 'p-1' }]]),
    );
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ lines: [{ productId: 'p-1', quantity: 2 }] });
  });

  it('fails loudly on unknown refs (never silently null)', () => {
    const r = substituteRefs({ supplierId: '{{ghost.id}}' }, outputs);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ghost/);
    expect(r.error).toMatch(/after/);
  });

  it('fails on unknown bare @ref', () => {
    const r = substituteRefs({ employeeId: '@emp9' }, outputs);
    expect(r.ok).toBe(false);
  });

  it('leaves non-placeholder strings untouched (emails safe)', () => {
    const r = substituteRefs({ email: 'a@b.com', note: 'قابل @admin غداً' }, outputs);
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ email: 'a@b.com', note: 'قابل @admin غداً' });
  });
});

describe('resolveOutputId', () => {
  it('prefers exact id, else first Id-suffixed key (creator convention)', () => {
    expect(resolveOutputId({ id: 'x', supplierId: 's' })).toBe('x');
    expect(resolveOutputId({ created: true, supplierId: 's-1', name: 'مورد' })).toBe('s-1');
    expect(resolveOutputId({ created: true, invoiceId: 'i-1', invoiceNumber: 'INV-1' })).toBe('i-1');
    // foreign ids follow the primary — first wins, not the FK
    expect(resolveOutputId({ created: true, adjustmentId: 'a-1', productId: 'p-9' })).toBe('a-1');
    expect(resolveOutputId({ created: true, name: 'x' })).toBeNull();
    expect(resolveOutputId({})).toBeNull();
  });

  it('P0-7: honors the explicit PRIMARY_ID_FIELD annotation over key order', () => {
    // A result echoing an input id BEFORE the primary must NOT rebind @ref
    // to the echo (this silently wrote dependents against the wrong FK).
    const echoedFirst = { customerId: 'echoed-c1', voucherId: 'real-v9', created: true };
    expect(resolveOutputId(echoedFirst, 'accounting.create_receipt_voucher')).toBe('real-v9');
    const reversed = { invoiceId: 'real-i7', customerId: 'echoed-c1', created: true };
    expect(resolveOutputId(reversed, 'sales.create_invoice')).toBe('real-i7');
  });

  it('P0-7: falls back to convention for unannotated tools (backward compatible)', () => {
    expect(resolveOutputId({ created: true, invoiceId: 'i-1' }, 'some.unknown_tool')).toBe('i-1');
    expect(resolveOutputId({ created: true, invoiceId: 'i-1' })).toBe('i-1');
  });
});

describe('substituteRefs with entity-style outputs', () => {
  const outputs = new Map([
    ['sup_abo_elaz', { created: true, supplierId: 's-uuid-1', name: 'أبو العز' }],
    ['emp1', { created: true, employeeId: 'e-uuid-9' }],
  ]);

  it('resolves {{ref.id}} via the entity-id alias', () => {
    const r = substituteRefs({ supplierId: '{{sup_abo_elaz.id}}' }, outputs);
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ supplierId: 's-uuid-1' });
  });

  it('resolves bare @ref via the entity-id alias', () => {
    const r = substituteRefs({ employeeId: '@emp1' }, outputs);
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ employeeId: 'e-uuid-9' });
  });
});

describe('extractOutputScalars', () => {  it('keeps scalar fields, drops nested objects, caps size', () => {
    const out = extractOutputScalars({
      id: 'x1', invoiceNumber: 'INV-1', total: 100, ok: true,
      lines: [{ a: 1 }], nested: { b: 2 }, big: 'y'.repeat(500),
    });
    expect(out).toEqual({ id: 'x1', invoiceNumber: 'INV-1', total: 100, ok: true, big: 'y'.repeat(200) });
  });

  it('returns empty for non-objects', () => {
    expect(extractOutputScalars(null)).toEqual({});
    expect(extractOutputScalars('text')).toEqual({});
    expect(extractOutputScalars([1])).toEqual({});
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

describe('truncateScalarsForPersist (P3 — no more NULL-on-overflow)', () => {
  it('passes small payloads through untouched', () => {
    const data = { created: true, invoiceId: 'i-1', total: 500 };
    expect(truncateScalarsForPersist(data)).toEqual(data);
  });

  it('returns null for empty/null input (same as the old NULL path)', () => {
    expect(truncateScalarsForPersist(null)).toBeNull();
    expect(truncateScalarsForPersist({})).toBeNull();
  });

  it('keeps id-ish keys and drops long non-id values when over budget', () => {
    const data: Record<string, string | number | boolean> = {
      invoiceId: 'inv-uuid-1234',
      customerId: 'cust-uuid-5678',
      notes: 'x'.repeat(3000),
      extra: 'y'.repeat(500),
    };
    const out = truncateScalarsForPersist(data)!;
    expect(out).not.toBeNull();
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(RESULT_DATA_JSON_BUDGET);
    // Ids survive (refs resolve after restart); the novels do not.
    expect(out.invoiceId).toBe('inv-uuid-1234');
    expect(out.customerId).toBe('cust-uuid-5678');
    expect(out.notes).toBeUndefined();
  });

  it('truncates (not drops) an oversized id value', () => {
    const data = { invoiceId: 'i'.repeat(3000) };
    const out = truncateScalarsForPersist(data)!;
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(RESULT_DATA_JSON_BUDGET);
    expect(typeof out.invoiceId).toBe('string');
    expect((out.invoiceId as string).length).toBeGreaterThan(12);
  });
});
