import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate } from '.';

describe('cn utility', () => {
  it('merges class names correctly', () => {
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    expect(cn('btn', isActive && 'btn-active')).toBe('btn btn-active');
  });
});

describe('formatCurrency', () => {
  it('formats YER currency in Arabic', () => {
    const result = formatCurrency(1234567.89);
    expect(result).toContain('١٬٢٣٤٬٥٦٧');
    expect(result).toContain('ر.ي.');
  });

  it('handles string input', () => {
    const result = formatCurrency('5000');
    expect(result).toContain('٥٬٠٠٠');
  });

  it('returns dash for invalid input', () => {
    expect(formatCurrency('invalid')).toBe('-');
    expect(formatCurrency(NaN)).toBe('-');
  });

  it('formats with different currency', () => {
    const result = formatCurrency(100, 'USD');
    expect(result).toContain('US$');
  });
});

describe('formatDate', () => {
  it('formats date string', () => {
    const result = formatDate('2024-06-15');
    expect(result).toContain('٢٠٢٤');
    expect(result).toContain('٠٦');
  });

  it('formats Date object', () => {
    const result = formatDate(new Date(2024, 5, 15));
    expect(result).toContain('٢٠٢٤');
  });
});
