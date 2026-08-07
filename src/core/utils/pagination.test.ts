import { describe, it, expect } from 'vitest';
import { clampPageArgs, buildPaginationParams, appendLimitOffset, paginatedResult } from './pagination';

describe('pagination utility', () => {
  it('clampPageArgs coerces invalid values', () => {
    expect(clampPageArgs(0, 0)).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(clampPageArgs(-1, 100)).toEqual({ page: 1, pageSize: 100, offset: 0 });
    expect(clampPageArgs(2, 50)).toEqual({ page: 2, pageSize: 50, offset: 50 });
    expect(clampPageArgs(NaN, NaN)).toEqual({ page: 1, pageSize: 25, offset: 0 });
  });

  it('clampPageArgs caps at maxPageSize', () => {
    expect(clampPageArgs(1, 10000, 500)).toEqual({ page: 1, pageSize: 500, offset: 0 });
  });

  it('buildPaginationParams returns limit and offset', () => {
    const result = buildPaginationParams(3, 25);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(25);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(50);
  });

  it('appendLimitOffset adds placeholders and strips trailing semicolon', () => {
    const sql = appendLimitOffset('SELECT * FROM x WHERE y = 1;');
    expect(sql).toBe('SELECT * FROM x WHERE y = 1 LIMIT $__LIMIT OFFSET $__OFFSET');
  });

  it('paginatedResult computes totalPages', () => {
    const result = paginatedResult([1, 2, 3], 75, 1, 25);
    expect(result.totalPages).toBe(3);
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('paginatedResult handles empty results', () => {
    const result = paginatedResult([], 0, 1, 25);
    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([]);
  });
});
