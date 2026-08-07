import { describe, it, expect } from 'vitest';
import { clampPageArgs, buildPaginationParams, paginatedResult } from './pagination';

describe('paginatedResult helper', () => {
  it('builds PaginatedData with correct totalPages', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const result = paginatedResult(items, 50, 1, 25);
    expect(result).toEqual({
      items,
      total: 50,
      page: 1,
      pageSize: 25,
      totalPages: 2,
    });
  });

  it('handles total=0 with totalPages=1 (min 1)', () => {
    const result = paginatedResult([], 0, 1, 25);
    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([]);
  });

  it('rounds up for partial last page', () => {
    const result = paginatedResult([{ id: 1 }], 26, 1, 25);
    expect(result.totalPages).toBe(2);
  });

  it('handles single page', () => {
    const result = paginatedResult([{ id: 1 }, { id: 2 }], 2, 1, 25);
    expect(result.totalPages).toBe(1);
  });
});

describe('clampPageArgs boundary cases', () => {
  it('clamps page to >= 1', () => {
    expect(clampPageArgs(-5, 25).page).toBe(1);
    expect(clampPageArgs(0, 25).page).toBe(1);
  });

  it('clamps NaN to 1', () => {
    expect(clampPageArgs(NaN, 25).page).toBe(1);
  });

  it('clamps negative pageSize to 1', () => {
    expect(clampPageArgs(1, -10).pageSize).toBe(1);
  });

  it('caps pageSize at maxPageSize', () => {
    const result = clampPageArgs(1, 1000, 500);
    expect(result.pageSize).toBe(500);
  });

  it('offset = (page-1) * pageSize', () => {
    expect(clampPageArgs(3, 25).offset).toBe(50);
    expect(clampPageArgs(1, 25).offset).toBe(0);
  });
});

describe('buildPaginationParams', () => {
  it('returns limit, offset, page, pageSize', () => {
    const result = buildPaginationParams(2, 10);
    expect(result).toEqual({ limit: 10, offset: 10, page: 2, pageSize: 10 });
  });

  it('uses clampPageArgs defaults for invalid input', () => {
    const result = buildPaginationParams(-1, 0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });
});
