import { describe, it, expect } from 'vitest';
import {
  PERMANENT_ITEM_ERROR_CODES,
  describePermanentFailures,
  partitionFailedItems,
  planBatchResume,
  type FailedItemInfo,
} from './batchQueue';

function item(over: Partial<FailedItemInfo> & { seq: number; toolName: string }): FailedItemInfo {
  return { label: null, lastError: null, errorCode: null, ...over };
}

describe('partitionFailedItems', () => {
  it('marks worker permanent codes as permanent', () => {
    const { retryable, permanent } = partitionFailedItems([
      item({ seq: 0, toolName: 'sales.create_invoice', errorCode: 'UNRESOLVED_REF', lastError: 'مرجع غير متوفر (sup)' }),
      item({ seq: 1, toolName: 'sales.create_invoice', errorCode: 'TIMEOUT_WRITE', lastError: 'انتهت المهلة' }),
    ]);
    expect(retryable).toHaveLength(0);
    expect(permanent.map((i) => i.seq)).toEqual([0, 1]);
  });

  it('marks taxonomy non-retryable families as permanent', () => {
    const { permanent } = partitionFailedItems([
      item({ seq: 0, toolName: 'crm.update_opportunity', errorCode: 'INVALID_STATUS_TRANSITION', lastError: 'انتقال غير مسموح' }),
      item({ seq: 1, toolName: 'accounting.delete_receipt_voucher', errorCode: 'DOCUMENT_NOT_DRAFT', lastError: 'سند مرحل' }),
      item({ seq: 2, toolName: 'hr.create_employee', errorCode: 'PERMISSION_DENIED', lastError: 'ليس لديك صلاحية' }),
    ]);
    expect(permanent).toHaveLength(3);
  });

  it('keeps transient and unknown codes retryable', () => {
    const { retryable, permanent } = partitionFailedItems([
      item({ seq: 0, toolName: 'sales.create_invoice', errorCode: 'RATE_LIMIT', lastError: 'تجاوز حد الاستدعاءات' }),
      item({ seq: 1, toolName: 'sales.create_invoice', errorCode: 'DB_ERROR', lastError: 'connection reset' }),
      item({ seq: 2, toolName: 'sales.create_invoice', errorCode: null, lastError: 'خطأ غامض قديم بلا كود' }),
    ]);
    expect(permanent).toHaveLength(0);
    expect(retryable.map((i) => i.seq)).toEqual([0, 1, 2]);
  });

  it('splits mixed failures into both buckets', () => {
    const { retryable, permanent } = partitionFailedItems([
      item({ seq: 0, toolName: 'a', errorCode: 'UNRESOLVED_REF' }),
      item({ seq: 1, toolName: 'b', errorCode: 'TIMEOUT' }),
    ]);
    expect(retryable.map((i) => i.seq)).toEqual([1]);
    expect(permanent.map((i) => i.seq)).toEqual([0]);
  });
});

describe('planBatchResume', () => {
  it('retries when there are no failures (paused/running resume)', () => {
    expect(planBatchResume([])).toEqual({ action: 'retry-and-run' });
  });

  it('refuses when EVERY failure is permanent', () => {
    const plan = planBatchResume([
      item({ seq: 0, toolName: 'sales.create_invoice', errorCode: 'UNRESOLVED_REF', lastError: 'مرجع غير متوفر (sup)' }),
    ]);
    expect(plan.action).toBe('refuse-permanent');
    if (plan.action !== 'refuse-permanent') return;
    expect(plan.message).toContain('تعذّر الاستئناف التلقائي');
    expect(plan.message).toContain('sales.create_invoice');
  });

  it('retries when at least one failure is transient', () => {
    expect(
      planBatchResume([
        item({ seq: 0, toolName: 'a', errorCode: 'UNRESOLVED_REF', lastError: 'x' }),
        item({ seq: 1, toolName: 'b', errorCode: 'RATE_LIMIT', lastError: 'y' }),
      ]),
    ).toEqual({ action: 'retry-and-run' });
  });
});

describe('describePermanentFailures', () => {
  it('explains UNRESOLVED_REF with a concrete fix', () => {
    const msg = describePermanentFailures([
      item({ seq: 2, toolName: 'sales.create_invoice', label: 'فاتورة المورد', errorCode: 'UNRESOLVED_REF', lastError: 'مرجع غير متوفر (sup)' }),
    ]);
    expect(msg).toContain('#3 sales.create_invoice');
    expect(msg).toContain('فاتورة المورد');
    expect(msg).toContain('مرجع غير متوفر (sup)');
    expect(msg).toContain('after');
  });

  it('warns against re-running TIMEOUT_WRITE (possible duplicate)', () => {
    const msg = describePermanentFailures([
      item({ seq: 0, toolName: 'sales.create_invoice', errorCode: 'TIMEOUT_WRITE', lastError: 'انتهت المهلة أثناء الكتابة' }),
    ]);
    expect(msg).toContain('مكرر');
  });

  it('reuses taxonomy guidance for taxonomy codes', () => {
    const msg = describePermanentFailures([
      item({ seq: 0, toolName: 'crm.update_opportunity', errorCode: 'INVALID_STATUS_TRANSITION', lastError: 'انتقال غير مسموح بهذه المرحلة' }),
    ]);
    // Taxonomy fixHint for the state-machine family mentions the legal flow.
    expect(msg).toContain('draft');
  });

  it('caps the listing with an overflow note', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      item({ seq: i, toolName: 't', errorCode: 'UNRESOLVED_REF', lastError: 'e' }),
    );
    expect(describePermanentFailures(many)).toContain('و 2 عناصر أخرى');
  });
});

describe('PERMANENT_ITEM_ERROR_CODES', () => {
  it('covers the worker-generated permanent codes', () => {
    expect(PERMANENT_ITEM_ERROR_CODES.has('UNRESOLVED_REF')).toBe(true);
    expect(PERMANENT_ITEM_ERROR_CODES.has('TIMEOUT_WRITE')).toBe(true);
  });
});
