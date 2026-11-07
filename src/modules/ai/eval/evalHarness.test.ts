import { describe, it, expect } from 'vitest';
import { runEvalHarness } from './evalHarness';

describe('eval harness — deterministic arabic agent contracts', () => {
  it('all deterministic cases pass', async () => {
    const report = await runEvalHarness();
    expect(report.total).toBeGreaterThanOrEqual(6);
    const failed = report.cases.filter((c) => !c.pass);
    expect(failed, `failed: ${failed.map((f) => `${f.id} — ${f.detail}`).join('; ')}`).toEqual([]);
  });

  it('report shape is stable', async () => {
    const report = await runEvalHarness();
    expect(typeof report.at).toBe('string');
    expect(report.passed + report.failed).toBe(report.total);
  });
});
