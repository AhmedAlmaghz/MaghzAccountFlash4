import { describe, it, expect } from 'vitest';
import {
  normalizeArabic,
  levenshtein,
  fuzzyMatchScore,
  bestFuzzyMatch,
  findAllFuzzyMatches,
} from './normalizeArabic';

describe('normalizeArabic', () => {
  it('collapses alef variants to plain alef', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabic('آدم')).toBe('ادم');
    expect(normalizeArabic('أحمد إبراهيم')).toBe('احمد ابراهيم');
  });

  it('collapses yeh variants to yeh', () => {
    expect(normalizeArabic('على')).toBe('علي');
    expect(normalizeArabic('مصطفى')).toBe('مصطفي');
  });

  it('collapses teh marbouta to heh', () => {
    expect(normalizeArabic('فاطمة')).toBe('فاطمه');
    expect(normalizeArabic('عائشة')).toBe('عايشه');
  });

  it('collapses hamza variants to hamza', () => {
    expect(normalizeArabic('سؤال')).toBe('سوال');
    expect(normalizeArabic('فؤاد')).toBe('فواد');
    expect(normalizeArabic('مسؤول')).toBe('مسوول');
  });

  it('strips tashkeel (diacritics)', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabic('فَتْح')).toBe('فتح');
  });

  it('strips tatweel (kashida)', () => {
    expect(normalizeArabic('محمدــ')).toBe('محمد');
    expect(normalizeArabic('الــمـــملكة')).toBe('المملكه');
  });

  it('lowercases and trims', () => {
    expect(normalizeArabic('  محمد  ')).toBe('محمد');
  });

  it('normalizes NFKC compound characters', () => {
    expect(normalizeArabic('ﻡﺣﻣﺩ').normalize('NFKC')).toBe('محمد');
  });

  it('combined scenario: complex name', () => {
    const input = 'أحمدُ بنُ فاطِمَةَ الْعَلَوِيّ';
    const result = normalizeArabic(input);
    expect(result).toContain('احمد');
    expect(result).toContain('بن');
    expect(result).toContain('فاطمه');
    expect(result).toContain('العلوي');
    expect(result).not.toMatch(/[ٌٍَُِْ]/); // no diacritics
  });

  it('handles empty string', () => {
    expect(normalizeArabic('')).toBe('');
  });

  it('handles strings without Arabic characters', () => {
    expect(normalizeArabic('John Doe')).toBe('john doe');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('محمد', 'محمد')).toBe(0);
  });

  it('returns length for empty left string', () => {
    expect(levenshtein('', 'محمد')).toBe(4);
  });

  it('returns length for empty right string', () => {
    expect(levenshtein('محمد', '')).toBe(4);
  });

  it('counts single insertion (middle)', () => {
    expect(levenshtein('محمد', 'محمود')).toBe(1);
  });

  it('counts single insertion (end)', () => {
    expect(levenshtein('محمد', 'محممد')).toBe(1);
  });

  it('counts single deletion', () => {
    expect(levenshtein('محممد', 'محمد')).toBe(1);
  });
});

describe('fuzzyMatchScore', () => {
  it('returns 1 for exact match', () => {
    expect(fuzzyMatchScore('محمد', 'محمد')).toBe(1);
  });

  it('handles Arabic normalization variant', () => {
    const score = fuzzyMatchScore('أحمد', 'احمد');
    // After normalization both become 'احمد' for comparison
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns 0 for completely different strings', () => {
    const score = fuzzyMatchScore('محمد', 'أمريكا');
    expect(score).toBeLessThan(0.3);
  });

  it('high score for substring match', () => {
    const score = fuzzyMatchScore('محمد', 'محمد أحمد');
    expect(score).toBeGreaterThan(0.6);
  });

  it('handles empty query', () => {
    expect(fuzzyMatchScore('', 'محمد')).toBe(0);
  });

  it('handles both empty', () => {
    expect(fuzzyMatchScore('', '')).toBe(1);
  });

  it('handles partial typo', () => {
    // "محم" vs "محمد" — close match
    const score = fuzzyMatchScore('محم', 'محمد');
    expect(score).toBeGreaterThan(0.5);
  });
});

describe('bestFuzzyMatch', () => {
  const items = [
    { id: '1', name: 'محمد أحمد' },
    { id: '2', name: 'أحمد علي' },
    { id: '3', name: 'سعيد سالم' },
  ];

  it('finds exact match', () => {
    const result = bestFuzzyMatch('محمد أحمد', items, (i) => i.name);
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe('1');
  });

  it('finds fuzzy match with normalization', () => {
    const result = bestFuzzyMatch('أحمد', items, (i) => i.name);
    expect(result).not.toBeNull();
    expect(result!.item.name).toContain('أحمد');
  });

  it('returns null for no match above threshold', () => {
    const result = bestFuzzyMatch('xyz', items, (i) => i.name, 0.9);
    expect(result).toBeNull();
  });

  it('returns null for empty items', () => {
    const result = bestFuzzyMatch('محمد', [], (i) => i.name);
    expect(result).toBeNull();
  });
});

describe('findAllFuzzyMatches', () => {
  const items = [
    { id: '1', name: 'محمد أحمد' },
    { id: '2', name: 'أحمد علي' },
    { id: '3', name: 'سعيد سالم' },
  ];

  it('returns all matches above default threshold', () => {
    const results = findAllFuzzyMatches('أحمد', items, (i) => i.name);
    expect(results.length).toBeGreaterThanOrEqual(2); // items 1 and 2
  });

  it('returns empty for strict threshold', () => {
    const results = findAllFuzzyMatches('xyz', items, (i) => i.name, 0.99);
    expect(results).toHaveLength(0);
  });

  it('sorts by score descending', () => {
    const results = findAllFuzzyMatches('أحمد', items, (i) => i.name);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('returns empty for empty items', () => {
    const results = findAllFuzzyMatches('محمد', [], (i) => i.name);
    expect(results).toHaveLength(0);
  });
});
