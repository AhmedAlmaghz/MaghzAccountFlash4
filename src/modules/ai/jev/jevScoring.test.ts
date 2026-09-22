import { describe, it, expect, vi } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn().mockResolvedValue({ success: true, rows: [] }),
}));

vi.mock('./jevClient', () => ({
  jevSystemOne: vi.fn().mockResolvedValue(null),
}));

vi.mock('./jevMetrics', () => ({
  recordJevMetric: vi.fn(),
  estimateJevCost: (n: number) => n * 0.000000042,
}));

import { jevScoreLead, LEAD_WEIGHTS } from './jevScoring';

describe('jevScoring', () => {
  it('falls back to 0.5 when JEV disabled', async () => {
    const res = await jevScoreLead('c1', { message: 'مرحبا' });
    expect(res.jevUsed).toBe(false);
    expect(res.composite).toBe(0.5);
    expect(res.dimensions.length).toBe(Object.keys(LEAD_WEIGHTS).length);
  });

  it('computes composite from JEV scores', async () => {
    const { jevSystemOne } = await import('./jevClient');
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        need: { type: 'score', score: 3, confidence: 0.9, probabilities: { '0': 0, '1': 0, '2': 0.1, '3': 0.9 }, legend: {} },
        budget: { type: 'score', score: 2, confidence: 0.8, probabilities: {}, legend: {} },
        authority: { type: 'score', score: 2, confidence: 0.85, probabilities: {}, legend: {} },
        timing: { type: 'score', score: 1, confidence: 0.7, probabilities: {}, legend: {} },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const res = await jevScoreLead('c1', { message: 'نبحث عن نظام ERP بميزانية 50000 والقرار بيدي خلال شهر' });
    expect(res.jevUsed).toBe(true);
    expect(res.composite).toBeGreaterThan(0.5);
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.dimensions[0].normalized).toBeGreaterThan(0.5);
  });
});
