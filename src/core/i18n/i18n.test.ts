import { describe, it, expect } from 'vitest';
import ar from './ar.json';
import en from './en.json';

function getAllKeys(obj: unknown, prefix = ''): string[] {
  const keys: string[] = [];
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      const v = (obj as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && Object.keys(v).length > 0) {
        keys.push(...getAllKeys(v, key));
      } else {
        keys.push(key);
      }
    }
  }
  return keys;
}

describe('i18n balance', () => {
  const arKeys = new Set(getAllKeys(ar));
  const enKeys = new Set(getAllKeys(en));

  it('has the same number of keys in AR and EN', () => {
    expect(arKeys.size).toBe(enKeys.size);
  });

  it('has no missing keys in EN (compared to AR)', () => {
    const missing = [...arKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('has no missing keys in AR (compared to EN)', () => {
    const missing = [...enKeys].filter((k) => !arKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('sales.customer is an object in both languages (not string)', () => {
    expect(typeof (ar as Record<string, unknown>).sales).toBe('object');
    const arSales = (ar as Record<string, Record<string, unknown>>).sales;
    const enSales = (en as Record<string, Record<string, unknown>>).sales;
    expect(typeof arSales.customer).toBe('object');
    expect(typeof enSales.customer).toBe('object');
  });

  it('sales.customer.title exists in both languages', () => {
    const arSales = (ar as Record<string, Record<string, Record<string, string>>>).sales;
    const enSales = (en as Record<string, Record<string, Record<string, string>>>).sales;
    expect(typeof arSales.customer.title).toBe('string');
    expect(typeof enSales.customer.title).toBe('string');
    expect(arSales.customer.title.length).toBeGreaterThan(0);
    expect(enSales.customer.title.length).toBeGreaterThan(0);
  });

  it('accounting section has at least 60 keys in each language', () => {
    const arAcc = (ar as Record<string, Record<string, unknown>>).accounting;
    const enAcc = (en as Record<string, Record<string, unknown>>).accounting;
    expect(Object.keys(arAcc).length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(enAcc).length).toBeGreaterThanOrEqual(60);
  });
});
