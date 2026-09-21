import { describe, expect, it } from 'vitest';
import { MAX_ITERATIONS, isTransientProviderError } from './runLoop';

/**
 * Slice-3 equivalence lock: the retry policy moved verbatim from
 * chatEngine.runLoop into ./runLoop. The loop itself stays in the engine
 * (it owns history/store/epoch/budget) — this pins its pure decision.
 */
describe('runLoop slice-3 equivalence', () => {
  it('keeps the iteration budget at 10', () => {
    expect(MAX_ITERATIONS).toBe(10);
  });

  it('retries quota/overload/lost-stream, fails fast otherwise', () => {
    expect(isTransientProviderError('429 quota exceeded')).toBe(true);
    expect(isTransientProviderError('provider overloaded')).toBe(true);
    expect(isTransientProviderError('انتهت مهلة البث')).toBe(true);
    expect(isTransientProviderError('timeout waiting')).toBe(true);
    expect(isTransientProviderError('invalid api key')).toBe(false);
    expect(isTransientProviderError('model not found')).toBe(false);
    expect(isTransientProviderError('')).toBe(false);
  });
});
