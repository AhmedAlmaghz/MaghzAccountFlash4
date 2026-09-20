import { describe, it, expect } from 'vitest';
import { addUsage, checkBudget, emptyUsage, formatUsage } from './usageMeter';

/** B2: token metering — pure accumulator behind the session budget. */
describe('usageMeter (B2)', () => {
  it('starts at zero', () => {
    expect(emptyUsage()).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 });
  });

  it('accumulates a full usage report', () => {
    const u = addUsage(emptyUsage(), { prompt_tokens: 800, completion_tokens: 50, total_tokens: 850 });
    expect(u).toEqual({ promptTokens: 800, completionTokens: 50, totalTokens: 850, calls: 1 });
  });

  it('derives the total when the provider omits it', () => {
    const u = addUsage(emptyUsage(), { prompt_tokens: 100, completion_tokens: 20 });
    expect(u.totalTokens).toBe(120);
  });

  it('counts calls even when usage is null (provider silent)', () => {
    const u = addUsage(addUsage(emptyUsage(), null), undefined);
    expect(u).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 2 });
  });

  it('ignores negative/NaN fields instead of corrupting the meter', () => {
    const u = addUsage(emptyUsage(), { prompt_tokens: -5, completion_tokens: NaN, total_tokens: 100 });
    expect(u.promptTokens).toBe(0);
    expect(u.completionTokens).toBe(0);
    expect(u.totalTokens).toBe(100);
  });

  it('does not mutate the accumulator', () => {
    const base = emptyUsage();
    addUsage(base, { total_tokens: 10 });
    expect(base.totalTokens).toBe(0);
  });

  it('formats compactly for honest notices', () => {
    expect(formatUsage({ promptTokens: 12000, completionTokens: 400, totalTokens: 12400, calls: 3 }))
      .toBe('12.4k tokens · 3 calls');
    expect(formatUsage(emptyUsage())).toBe('0 tokens · 0 calls');
  });

  it('checkBudget: 0/missing = unlimited, warn at 80%, exceeded at 100%', () => {
    expect(checkBudget(999999, 0)).toBe('ok');
    expect(checkBudget(999999, null)).toBe('ok');
    expect(checkBudget(999999, undefined)).toBe('ok');
    expect(checkBudget(799, 1000)).toBe('ok');
    expect(checkBudget(800, 1000)).toBe('warn');
    expect(checkBudget(999, 1000)).toBe('warn');
    expect(checkBudget(1000, 1000)).toBe('exceeded');
    expect(checkBudget(5000, 1000)).toBe('exceeded');
  });
});
