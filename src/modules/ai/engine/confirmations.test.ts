import { describe, expect, it } from 'vitest';
import {
  WRITE_RETRY_LIMIT,
  findPendingCall,
  hasExhaustedRetries,
  prunePendingCall,
  writeAttemptKey,
} from './confirmations';
import type { PendingToolCall } from '../types';

const mk = (callId: string): PendingToolCall => ({
  callId,
  toolName: 'sales.create_invoice',
  args: { a: 1 },
} as unknown as PendingToolCall);

/**
 * Slice-2 equivalence lock: the confirmation queue primitives moved verbatim
 * from chatEngine.ts into ./confirmations. The double-click killer is the
 * prune-BEFORE-await ordering — these tests pin the pure pieces of it.
 */
describe('confirmations slice-2 equivalence', () => {
  it('stable key ignores arg order', () => {
    expect(writeAttemptKey('t', { a: 1, b: 2 })).toBe(writeAttemptKey('t', { b: 2, a: 1 }));
  });

  it('find + prune round-trip', () => {
    const calls = [mk('c1'), mk('c2')];
    expect(findPendingCall(calls, 'c2')?.callId).toBe('c2');
    expect(findPendingCall(calls, 'zz')).toBeUndefined();
    const pruned = prunePendingCall(calls, 'c1');
    expect(pruned.map((c) => c.callId)).toEqual(['c2']);
    // pure: input untouched
    expect(calls).toHaveLength(2);
  });

  it('pruning twice is a no-op (double-click safe)', () => {
    const once = prunePendingCall([mk('c1')], 'c1');
    expect(prunePendingCall(once, 'c1')).toHaveLength(0);
  });

  it('retry ceiling is 2 and enforced', () => {
    expect(WRITE_RETRY_LIMIT).toBe(2);
    const attempts = new Map([[writeAttemptKey('t', { a: 1 }), 2]]);
    expect(hasExhaustedRetries(attempts, 't', { a: 1 })).toBe(true);
    expect(hasExhaustedRetries(attempts, 't', { a: 2 })).toBe(false);
  });
});
