import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveEntities,
  normalizeEntityKey,
  renderEntityBlock,
  ENTITY_SAME_THRESHOLD,
  ENTITY_MISSING_THRESHOLD,
} from './entityService';

vi.mock('../entityResolver', () => ({
  searchEntities: vi.fn(),
}));

import { searchEntities } from '../entityResolver';

const mockedSearch = vi.mocked(searchEntities);

function match(id: string, name: string, confidence: number) {
  return { type: 'customer', id, name, labelAr: 'عميل', confidence } as never;
}

describe('entityService — unified resolution (local first, JEV fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves high-confidence matches silently (≥0.85)', async () => {
    mockedSearch.mockResolvedValue([match('c1', 'شركة الأمل', 0.97)]);
    const [r] = await resolveEntities([{ text: 'شركة الامل', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('same');
    expect(r.id).toBe('c1');
    expect(r.score).toBeGreaterThanOrEqual(ENTITY_SAME_THRESHOLD);
  });

  it('returns missing for zero hits (never retries silently)', async () => {
    mockedSearch.mockResolvedValue([]);
    const [r] = await resolveEntities([{ text: 'كيان غير موجود أصلا', kind: 'supplier' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('missing');
    expect(r.id).toBeNull();
  });

  it('returns missing for weak scores (<0.55) with candidates', async () => {
    mockedSearch.mockResolvedValue([match('s1', 'مورد بعيد جدا', 0.31)]);
    const [r] = await resolveEntities([{ text: 'xyz', kind: 'supplier' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('missing');
    expect(r.score).toBeLessThan(ENTITY_MISSING_THRESHOLD);
  });

  it('returns confirm for the ambiguous band without JEV (single question, no execution)', async () => {
    mockedSearch.mockResolvedValue([match('p1', 'كرتون كبير', 0.7)]);
    const [r] = await resolveEntities([{ text: 'كرتون', kind: 'product' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('confirm');
    expect(r.id).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('forces confirm on near-tie rivals even at high score (never guesses)', async () => {
    mockedSearch.mockResolvedValue([match('c1', 'الحمادي', 0.95), match('c2', 'الحمادي للتجارة', 0.93)]);
    const [r] = await resolveEntities([{ text: 'الحمادي', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    expect(r.status).toBe('confirm');
  });

  it('isolates per-entity failures (one failing type never collapses the batch)', async () => {
    mockedSearch.mockImplementation(async (q) => {
      if (String(q).includes('يفشل')) throw new Error('db down');
      return [match('c9', 'عميل سليم', 0.99)];
    });
    const out = await resolveEntities(
      [
        { text: 'يفشل', kind: 'customer' },
        { text: 'عميل سليم', kind: 'customer' },
      ],
      'co1',
      { jevFallback: false },
    );
    expect(out[0].status).toBe('missing');
    expect(out[1].status).toBe('same');
  });

  it('dedup key folds Arabic variants (شركة == شركه)', () => {
    expect(normalizeEntityKey('customer', 'شركة الأمل')).toBe(
      normalizeEntityKey('customer', 'شركه الامل'),
    );
  });

  it('renders an authoritative block the model must obey', async () => {
    mockedSearch.mockResolvedValue([match('c1', 'شركة الأمل', 0.97)]);
    const out = await resolveEntities([{ text: 'شركة الامل', kind: 'customer' }], 'co1', {
      jevFallback: false,
    });
    const block = renderEntityBlock(out);
    expect(block).toContain('شركة الأمل');
    expect(block).toContain('c1');
  });
});
