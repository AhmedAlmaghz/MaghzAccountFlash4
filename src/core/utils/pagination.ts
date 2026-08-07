export interface PaginatedQueryOptions {
  page: number;
  pageSize: number;
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedQueryResult<T> {
  success: boolean;
  data?: PaginatedData<T>;
  error?: string;
}

export function clampPageArgs(page: number, pageSize: number, maxPageSize = 500): { page: number; pageSize: number; offset: number } {
  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize) || 25), maxPageSize);
  const safePage = Math.max(1, Math.floor(page) || 1);
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

export function buildPaginationParams(page: number, pageSize: number): { limit: number; offset: number; page: number; pageSize: number } {
  const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
  return { page: p, pageSize: ps, limit: ps, offset };
}

export function appendLimitOffset(sql: string): string {
  const trimmed = sql.trim().replace(/;$/, '');
  return `${trimmed} LIMIT $__LIMIT OFFSET $__OFFSET`;
}

export function paginatedResult<T>(items: T[], total: number, page: number, pageSize: number): PaginatedData<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
