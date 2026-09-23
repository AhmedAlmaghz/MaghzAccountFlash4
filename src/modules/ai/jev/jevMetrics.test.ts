import { describe, it, expect } from 'vitest';
import {
  recordJevError,
  getLastJevError,
  recordJevMetric,
  getJevMetricsSummary,
} from './jevMetrics';

describe('jevMetrics errors', () => {
  it('records the last JEV error for diagnostics', () => {
    recordJevError('jev-health', new Error('LLM provider error (401): invalid key'));
    const last = getLastJevError();
    expect(last?.label).toBe('jev-health');
    expect(last?.error).toContain('401');
  });

  it('keeps only the latest error', () => {
    recordJevError('a', 'first');
    recordJevError('b', 'second');
    expect(getLastJevError()?.error).toBe('second');
  });

  it('fallback metrics carry zero JEV cost', () => {
    const before = getJevMetricsSummary().totalCostUsd;
    recordJevMetric({ at: Date.now(), label: 'search-all', latencyMs: 5, inputTokens: 0, outputTokens: 0, costUsd: 0, jevUsed: false });
    expect(getJevMetricsSummary().totalCostUsd).toBe(before);
  });
});
