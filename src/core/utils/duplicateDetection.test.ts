import { describe, it, expect } from 'vitest';
import { detectDuplicates, buildCompositeName } from './duplicateDetection';

interface Item { id: string; name: string; code?: string }

const mk = (id: string, name: string, code?: string): Item => ({ id, name, code });

describe('duplicateDetection', () => {
  it('detects exact duplicate after Arabic normalization (ة→ه, ي/ى, إأآ)', () => {
    const items = [mk('1', 'شركة الأمل للتجارة'), mk('2', 'مؤسسة النور')];
    const res = detectDuplicates('شركه الامل للتجاره', items, (x) => x.name, { getId: (x) => x.id });
    expect(res.exactMatch).not.toBeNull();
    expect(res.exactMatch?.matchedName).toBe('شركة الأمل للتجارة');
    expect(res.hasDuplicates).toBe(true);
  });

  it('detects exact duplicate with diacritics and kashida ignored', () => {
    const items = [mk('1', 'مُحمَّد ـ أحمد')];
    const res = detectDuplicates('محمد احمد', items, (x) => x.name, { getId: (x) => x.id });
    expect(res.exactMatch).not.toBeNull();
  });

  it('detects near duplicate with high similarity (>=0.85)', () => {
    const items = [mk('1', 'شركة الأمل للتجارة'), mk('2', 'مؤسسة النور الحديثة')];
    // حرف واحد فرق → Levenshtein 1/18 ≈ 0.94
    const res = detectDuplicates('شركة الأمال للتجارة', items, (x) => x.name, { getId: (x) => x.id, nearThreshold: 0.85 });
    expect(res.exactMatch).toBeNull();
    expect(res.nearMatches.length).toBeGreaterThan(0);
    expect(res.nearMatches[0].score).toBeGreaterThanOrEqual(0.85);
  });

  it('does not flag distant names as near', () => {
    const items = [mk('1', 'شركة الأمل'), mk('2', 'مؤسسة النور')];
    const res = detectDuplicates('مصنع الحديد', items, (x) => x.name, { getId: (x) => x.id, nearThreshold: 0.85 });
    expect(res.hasDuplicates).toBe(false);
  });

  it('excludes current id when editing', () => {
    const items = [mk('1', 'أحمد محمد'), mk('2', 'أحمد محمد')];
    const res = detectDuplicates('أحمد محمد', items, (x) => x.name, { getId: (x) => x.id, excludeId: '1' });
    // should still find exact for id 2, but not count self
    expect(res.exactMatch?.item.id).toBe('2');
  });

  it('ignores short input (<2 chars)', () => {
    const items = [mk('1', 'أحمد')];
    const res = detectDuplicates('ا', items, (x) => x.name, { getId: (x) => x.id });
    expect(res.hasDuplicates).toBe(false);
  });

  it('code exact match boosts to exact when name also normalized exact', () => {
    const items = [mk('1', 'منتج 1', 'PRD-001'), mk('2', 'منتج 2', 'PRD-002')];
    const res = detectDuplicates('PRD-001', items, (x) => x.code || '', { getId: (x) => x.id, getCode: (x) => x.code });
    expect(res.exactMatch).not.toBeNull();
  });

  it('limits near results', () => {
    const items = Array.from({ length: 10 }, (_, i) => mk(String(i), 'شركة الأمل للتجارة'));
    const res = detectDuplicates('شركة الأمل للتجارة الدولية', items, (x) => x.name, { getId: (x) => x.id, nearThreshold: 0.5, limit: 3 });
    expect(res.nearMatches.length).toBeLessThanOrEqual(3);
  });

  it('buildCompositeName joins non-empty parts', () => {
    expect(buildCompositeName('مرحبا', undefined, '  ', 'عالم')).toBe('مرحبا عالم');
    expect(buildCompositeName()).toBe('');
  });

  it('returns empty for empty items', () => {
    const res = detectDuplicates('أحمد', [], (x: Item) => x.name);
    expect(res.hasDuplicates).toBe(false);
    expect(res.exactMatch).toBeNull();
  });

  it('handles English case-insensitive exact', () => {
    const items = [mk('1', 'Ahmed Mohamed')];
    const res = detectDuplicates('ahmed mohamed', items, (x) => x.name, { getId: (x) => x.id });
    expect(res.exactMatch).not.toBeNull();
  });
});
