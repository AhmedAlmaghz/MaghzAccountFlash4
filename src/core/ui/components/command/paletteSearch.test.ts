import { describe, it, expect } from 'vitest';
import { normalizeQuery, scoreText, filterItems, highlightParts, flattenRows } from './paletteSearch';

describe('normalizeQuery', () => {
  it('lowercases and normalizes Arabic variants', () => {
    expect(normalizeQuery('إبراهيم محمد')).toBe('ابراهيم محمد');
  });

  it('trims whitespace and collapses spaces', () => {
    expect(normalizeQuery('  فواتير   المبيعات ')).toBe('فواتير المبيعات');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeQuery('')).toBe('');
  });
});

describe('scoreText', () => {
  const label = 'فواتير المبيعات';

  it('returns score 1 for empty query', () => {
    expect(scoreText('', label).score).toBe(1);
  });

  it('returns score 0 when no match', () => {
    expect(scoreText('xyzzy', label).score).toBe(0);
    expect(scoreText('المحاسبة', label).score).toBe(0);
  });

  it('scores prefix matches higher than substring matches', () => {
    const prefix = scoreText('فواتير', label);
    const substring = scoreText('المبيعات', label);
    expect(prefix.score).toBeGreaterThan(substring.score);
  });

  it('matches via keywords with a lower boost', () => {
    const viaLabel = scoreText('فواتير', label, ['invoice', 'فاتورة']);
    const viaKeyword = scoreText('invoice', label, ['invoice', 'فاتورة']);
    expect(viaLabel.score).toBeGreaterThan(viaKeyword.score);
    expect(viaKeyword.score).toBeGreaterThan(0);
  });

  it('handles Arabic variant normalization (ة/ه, أ/ا)', () => {
    expect(scoreText('فاتورة', 'فاتورة المبيعات', []).score).toBeGreaterThan(0);
    expect(scoreText('فاطمه', 'فاطمة', []).score).toBeGreaterThan(0);
  });
});

describe('filterItems', () => {
  const items = [
    { label: 'فواتير المبيعات', keywords: ['invoice'] },
    { label: 'فواتير المشتريات', keywords: ['invoice'] },
    { label: 'القيود اليومية', keywords: ['journal'] },
    { label: 'لوحة التحكم', keywords: ['home'] },
  ];

  it('returns all items for empty query', () => {
    expect(filterItems(items, '')).toHaveLength(4);
  });

  it('filters by substring match', () => {
    const results = filterItems(items, 'فواتير');
    expect(results).toHaveLength(2);
    expect(results[0].label).toBe('فواتير المبيعات');
  });

  it('returns empty array when nothing matches', () => {
    expect(filterItems(items, 'المخازن')).toEqual([]);
  });

  it('ranks label matches before keyword matches', () => {
    const results = filterItems(items, 'invoice');
    expect(results[0].label).toBe('فواتير المبيعات');
  });

  it('matches Arabic variants in query', () => {
    const results = filterItems([{ label: 'فاطمة العلي' }, { label: 'سعيد' }], 'فاطمه');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('فاطمة العلي');
  });

  it('keeps original order for ties', () => {
    const results = filterItems(items, 'فواتير');
    expect(results.map((r) => r.label)).toEqual(['فواتير المبيعات', 'فواتير المشتريات']);
  });
});

describe('highlightParts', () => {
  it('splits into match and non-match segments for exact raw match', () => {
    const parts = highlightParts('فواتير المبيعات', 'فواتير');
    expect(parts).toEqual([
      { text: 'فواتير', match: true },
      { text: ' المبيعات', match: false },
    ]);
  });

  it('returns single non-match segment when query is empty', () => {
    expect(highlightParts('فواتير المبيعات', '')).toEqual([{ text: 'فواتير المبيعات', match: false }]);
  });

  it('returns single non-match segment when no match', () => {
    expect(highlightParts('فواتير المبيعات', 'المحاسبة')).toEqual([
      { text: 'فواتير المبيعات', match: false },
    ]);
  });

  it('handles middle matches', () => {
    const parts = highlightParts('فواتير المبيعات', 'المبيعات');
    expect(parts).toEqual([
      { text: 'فواتير ', match: false },
      { text: 'المبيعات', match: true },
    ]);
  });

  it('returns whole-text match for normalized-only matches', () => {
    const parts = highlightParts('فاطمة', 'فاطمه');
    expect(parts).toEqual([{ text: 'فاطمة', match: true }]);
  });

  it('is case-insensitive for latin text', () => {
    const parts = highlightParts('Dashboard', 'dashboard');
    expect(parts).toEqual([{ text: 'Dashboard', match: true }]);
  });
});

describe('flattenRows', () => {
  it('flattens groups preserving order', () => {
    const groups = [
      { key: 'a', rows: [{ key: 'a1' }, { key: 'a2' }] },
      { key: 'b', rows: [{ key: 'b1' }] },
    ];
    expect(flattenRows(groups).map((r) => r.key)).toEqual(['a1', 'a2', 'b1']);
  });
});
