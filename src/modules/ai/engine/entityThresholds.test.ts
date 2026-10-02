import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEntities, ENTITY_SAME_THRESHOLD, ENTITY_MISSING_THRESHOLD } from './entityService';
import { fuzzyMatchScore } from '@/core/utils/normalizeArabic';

vi.mock('../entityResolver', () => ({
  searchEntities: vi.fn(),
}));

import { searchEntities } from '../entityResolver';

const mockedSearch = vi.mocked(searchEntities);

/**
 * C4 threshold calibration harness (live 2026-10-02 follow-up).
 *
 * The 0.85/0.55 cutoffs were set from system behavior, not from YOUR data.
 * To calibrate: extend SAMPLES with ~50 real pairs from the company
 * database — (user wording → catalog name → expected verdict) — then run
 * this file. Any red row means a threshold or guard needs moving; when all
 * rows are green the thresholds are proven on real data, not guessed.
 *
 * Deliberate strictness (do NOT "fix" by lowering 0.85): a query that is a
 * mere PREFIX of a canonical name ('الحمادي' vs 'الحمادي للتجارة', 0.71)
 * MUST ask — it may be a different entity. Auto-execute is reserved for
 * full-name hits: exact (1.0), codes (0.9), full-name typos (levenshtein).
 * Lowering the bar would auto-execute generic suffixes ('للتجارة' scores
 * 0.77 by substring!) — the exact corruption the guards exist to prevent.
 */
function match(id: string, name: string, confidence: number) {
  return { type: 'customer', id, name, labelAr: 'عميل', confidence } as never;
}

describe('entity thresholds calibration (C4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the cutoff constants (change deliberately, never by drift)', () => {
    expect(ENTITY_SAME_THRESHOLD).toBe(0.85);
    expect(ENTITY_MISSING_THRESHOLD).toBe(0.55);
  });

  it('auto-executes full-name hits: exact, normalized-equal, codes, full-name typos', async () => {
    const pairs: Array<[string, string]> = [
      ['الشجاع للتجارة', 'الشجاع للتجارة'], // exact → 1.0
      ['شركه الامل للتجاره', 'شركة الأمل للتجارة'], // normalized-equal → 1.0
      ['الشوجاع للتجاره', 'الشجاع للتجاره'], // one-letter typo → ~0.94
    ];
    for (const [query, catalog] of pairs) {
      const score = fuzzyMatchScore(query, catalog);
      expect(score).toBeGreaterThanOrEqual(ENTITY_SAME_THRESHOLD);
      mockedSearch.mockResolvedValueOnce([match('c1', catalog, score)]);
      const [r] = await resolveEntities([{ text: query, kind: 'customer' }], 'co1', {
        jevFallback: false,
      });
      expect(r.status).toBe('same');
      expect(r.id).toBe('c1');
    }
  });

  it('asks on prefix queries even with high substring scores (never guesses)', async () => {
    // 'شركة الأمل' vs 'شركة الأمل للتجارة' scores ~0.78 — below the bar.
    const score = fuzzyMatchScore('شركة الأمل', 'شركة الأمل للتجارة');
    expect(score).toBeGreaterThanOrEqual(ENTITY_MISSING_THRESHOLD);
    expect(score).toBeLessThan(ENTITY_SAME_THRESHOLD);
    mockedSearch.mockResolvedValue([match('c1', 'شركة الأمل للتجارة', score)]);
    const [r] = await resolveEntities([{ text: 'شركة الأمل', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('confirm');
  });

  it('never auto-executes a generic suffix alone (substring trap)', async () => {
    // 'للتجارة' ⊂ 'الشجاع للتجارة' scores ~0.77 by substring — must ask.
    const score = fuzzyMatchScore('للتجارة', 'الشجاع للتجارة');
    expect(score).toBeLessThan(ENTITY_SAME_THRESHOLD);
    mockedSearch.mockResolvedValue([match('c1', 'الشجاع للتجارة', score)]);
    const [r] = await resolveEntities([{ text: 'للتجارة', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).not.toBe('same');
  });

  it('asks on near-tie twins even at high scores', async () => {
    mockedSearch.mockResolvedValue([
      match('c1', 'الحمادي للتجارة', 0.95),
      match('c2', 'الحمادي للتجارة فرع', 0.93),
    ]);
    const [r] = await resolveEntities([{ text: 'الحمادي', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('confirm');
  });

  it('reports missing for unrelated text', async () => {
    mockedSearch.mockResolvedValue([match('c9', 'اسم بعيد تماما', 0.2)]);
    const [r] = await resolveEntities([{ text: 'كيان غير موجود أصلا', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('missing');
  });
});
