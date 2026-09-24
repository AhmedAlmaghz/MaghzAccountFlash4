import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn().mockResolvedValue({ success: true, rows: [] }),
}));

const fakeTools = [
  {
    name: 'search.customers', descriptionAr: '', labelAr: '', permission: 'sales.view', dangerLevel: 'read', parameters: {},
    execute: vi.fn(async () => ({ matches: [{ id: 'c1', name: 'شركة الأمل', score: 0.9 }] })),
  },
  {
    name: 'search.products', descriptionAr: '', labelAr: '', permission: 'inventory.view', dangerLevel: 'read', parameters: {},
    execute: vi.fn(async () => ({ matches: [{ id: 'p1', name: 'سكر', score: 0.8 }] })),
  },
  {
    name: 'search.suppliers', descriptionAr: '', labelAr: '', permission: 'purchases.view', dangerLevel: 'read', parameters: {},
    execute: vi.fn(async () => ({ matches: [] })),
  },
];

vi.mock('../tools/registry', () => ({
  getTool: vi.fn((name: string) => fakeTools.find((t) => t.name === name)),
  getVisibleTools: vi.fn(() => fakeTools),
}));

vi.mock('./jevClient', () => ({
  jevSystemOne: vi.fn(),
}));

vi.mock('./jevMetrics', () => ({
  recordJevMetric: vi.fn(),
  estimateJevCost: (n: number) => n * 0.000000042,
}));

import { jevSystemOne } from './jevClient';
import { getTool } from '../tools/registry';
import {
  keywordGuessTypes,
  jevRouteSearch,
  jevSearchAll,
  clearSearchRouteCache,
  SEARCH_TYPE_THRESHOLD,
  SEARCH_FAMILIES,
} from './jevSearch';

const ctx = { companyId: 'c1', userId: 'u1' };

describe('jevSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSearchRouteCache();
  });

  it('keyword fallback guesses families offline', () => {
    // Full table (not RBAC-filtered): generic "فاتورة" routes BOTH invoice
    // families + customer (max 3); unknown vocabulary routes nothing.
    expect(keywordGuessTypes('فاتورة العميل الشجاع', [...SEARCH_FAMILIES])).toContain('customer');
    expect(keywordGuessTypes('فاتورة العميل الشجاع', [...SEARCH_FAMILIES])).toContain('sales_invoice');
    expect(keywordGuessTypes('فاتورة العميل الشجاع', [...SEARCH_FAMILIES])).toContain('purchase_invoice');
    expect(keywordGuessTypes('فاتورة بيع', [...SEARCH_FAMILIES])).toContain('sales_invoice');
    expect(keywordGuessTypes('راتب الموظف', [...SEARCH_FAMILIES])).toEqual(['employee']);
    expect(keywordGuessTypes('مرحبا كيف حالك', [...SEARCH_FAMILIES])).toEqual([]);
  });

  it('normalizes Arabic variants on both sides (ة/ه، أ/ا، تشكيل)', () => {
    // Query with teh-marbuta spelled with هـ still hits normalized keywords
    expect(keywordGuessTypes('شركه الامل', [...SEARCH_FAMILIES])).toContain('customer');
    expect(keywordGuessTypes('حساب المصروف', [...SEARCH_FAMILIES])).toContain('account');
  });

  it('rank stage orders ambiguous hits via Choice (entity linker wired)', async () => {
    // customers tool returns 7 hits → extractHits caps at 5 → triggers rank
    const customersExecute = vi.mocked(getTool)('search.customers')?.execute as unknown as ReturnType<typeof vi.fn>;
    vi.mocked(customersExecute).mockResolvedValueOnce({
      matches: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `عميل ${i}`, score: 0.5 })),
    });
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        is_customer: { type: 'noul', noul: 0.9 },
        is_product: { type: 'noul', noul: 0.1 },
        is_supplier: { type: 'noul', noul: 0.1 },
        __dominant__: { type: 'choice', choice: 'customer', confidence: 0.9, probabilities: {} },
        link_0: {
          type: 'choice', choice: 'عميل 3 (عميل)', confidence: 0.88,
          probabilities: { 'عميل 3 (عميل)': 0.88, 'عميل 0 (عميل)': 0.05, 'عميل 1 (عميل)': 0.07 },
        },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const res = await jevSearchAll(ctx, 'عميل');
    expect(res.ranked).toBe(true);
    expect(res.hits[0].id).toBe('c3');
    expect(res.hits[0].score).toBeGreaterThanOrEqual(0.88);
    expect(res.ambiguous).toBe(false);
    // Gated winner is injectable (family 0.9 ≥ 0.6, link 0.88 ≥ 0.7)
    expect(res.linked).toEqual([
      { type: 'customer', id: 'c3', name: 'عميل 3', confidence: 0.88, familyProb: 0.9, injectable: true },
    ]);
    expect(res.familyProbs.customer).toBe(0.9);
    // Route + link = exactly 2 JEV calls (not one per family)
    expect(vi.mocked(jevSystemOne)).toHaveBeenCalledTimes(2);
  });

  it('weak link winners are candidates, never injections', async () => {
    // Route prob 0.55 clears the 0.5 bar but misses the 0.6 injection floor
    const customersExecute = vi.mocked(getTool)('search.customers')?.execute as unknown as ReturnType<typeof vi.fn>;
    vi.mocked(customersExecute).mockResolvedValueOnce({
      matches: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `عميل ${i}`, score: 0.5 })),
    });
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        is_customer: { type: 'noul', noul: 0.55 },
        is_product: { type: 'noul', noul: 0.1 },
        is_supplier: { type: 'noul', noul: 0.1 },
        __dominant__: { type: 'choice', choice: 'customer', confidence: 0.6, probabilities: {} },
        link_0: {
          type: 'choice', choice: 'عميل 1 (عميل)', confidence: 0.9,
          probabilities: { 'عميل 1 (عميل)': 0.9, 'عميل 0 (عميل)': 0.05 },
        },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const res = await jevSearchAll(ctx, 'عميل');
    expect(res.ranked).toBe(true);
    // High link confidence CANNOT rescue a weakly-routed family (the bank
    // bug): the winner is recorded but flagged non-injectable...
    expect(res.linked).toEqual([
      { type: 'customer', id: 'c1', name: 'عميل 1', confidence: 0.9, familyProb: 0.55, injectable: false },
    ]);
    // ...but the winner still moves to front as a verifiable candidate
    expect(res.hits[0].id).toBe('c1');
  });

  it('rank stage flags photo-finish ambiguity instead of guessing', async () => {
    const customersExecute = vi.mocked(getTool)('search.customers')?.execute as unknown as ReturnType<typeof vi.fn>;
    vi.mocked(customersExecute).mockResolvedValueOnce({
      matches: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `عميل ${i}`, score: 0.5 })),
    });
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        is_customer: { type: 'noul', noul: 0.9 },
        is_product: { type: 'noul', noul: 0.1 },
        is_supplier: { type: 'noul', noul: 0.1 },
        __dominant__: { type: 'choice', choice: 'customer', confidence: 0.9, probabilities: {} },
        link_0: {
          type: 'choice', choice: 'عميل 2 (عميل)', confidence: 0.45,
          probabilities: { 'عميل 2 (عميل)': 0.45, 'عميل 3 (عميل)': 0.40, 'عميل 0 (عميل)': 0.15 },
        },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const res = await jevSearchAll(ctx, 'عميل');
    expect(res.ranked).toBe(true);
    expect(res.ambiguous).toBe(true);
  });

  it('route returns empty (not error) when JEV unavailable', async () => {
    vi.mocked(jevSystemOne).mockResolvedValue(null);
    const r = await jevRouteSearch('c1', 'شركة الأمل');
    expect(r.jevUsed).toBe(false);
    expect(r.families).toEqual([]);
  });

  it('route respects the 0.5 threshold and sorts by prob', async () => {
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        is_customer: { type: 'noul', noul: 0.93 },
        is_product: { type: 'noul', noul: 0.61 },
        is_supplier: { type: 'noul', noul: 0.08 },
        __dominant__: { type: 'choice', choice: 'customer', confidence: 0.9, probabilities: {} },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const r = await jevRouteSearch('c1', 'عميل شركة الأمل');
    expect(r.jevUsed).toBe(true);
    expect(r.families.map((f) => f.key)).toEqual(['customer', 'product']);
    expect(r.families[0].prob).toBeGreaterThanOrEqual(SEARCH_TYPE_THRESHOLD);
    expect(r.dominant).toBe('customer');
  });

  it('searchAll executes ONLY matched families (one JEV call, bounded DB)', async () => {
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        is_customer: { type: 'noul', noul: 0.95 },
        is_product: { type: 'noul', noul: 0.10 },
        is_supplier: { type: 'noul', noul: 0.05 },
        __dominant__: { type: 'choice', choice: 'customer', confidence: 0.9, probabilities: {} },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    const res = await jevSearchAll(ctx, 'شركة الأمل');
    expect(res.jevUsed).toBe(true);
    expect(res.routedTypes).toEqual(['customer']);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]).toMatchObject({ type: 'customer', id: 'c1', name: 'شركة الأمل' });
    // Only the matched tool executed — suppliers/products untouched
    expect(vi.mocked(getTool)('search.customers')?.execute).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getTool)('search.products')?.execute).not.toHaveBeenCalled();
    expect(vi.mocked(getTool)('search.suppliers')?.execute).not.toHaveBeenCalled();
    // Exactly ONE JEV decision call for the whole multi-family question
    expect(vi.mocked(jevSystemOne)).toHaveBeenCalledTimes(1);
  });

  it('searchAll falls back to keywords when JEV is down', async () => {
    vi.mocked(jevSystemOne).mockResolvedValue(null);
    const res = await jevSearchAll(ctx, 'منتج سكر');
    expect(res.jevUsed).toBe(false);
    expect(res.fallback).toBe(true);
    expect(res.routedTypes).toContain('product');
    expect(res.hits[0]?.name).toBe('سكر');
  });

  it('caches the route for 60s (تابع/استمر costs zero)', async () => {
    vi.mocked(jevSystemOne).mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        is_customer: { type: 'noul', noul: 0.9 },
        is_product: { type: 'noul', noul: 0.1 },
        is_supplier: { type: 'noul', noul: 0.1 },
        __dominant__: { type: 'choice', choice: 'customer', confidence: 0.9, probabilities: {} },
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Awaited<ReturnType<typeof jevSystemOne>>);

    await jevRouteSearch('c1', 'شركة الأمل');
    await jevRouteSearch('c1', 'شركة الأمل');
    expect(vi.mocked(jevSystemOne)).toHaveBeenCalledTimes(1);
  });
});
