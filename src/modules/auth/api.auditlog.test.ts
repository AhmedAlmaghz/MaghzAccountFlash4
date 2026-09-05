import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

vi.mock('@/core/utils/validation', () => ({
  validateInput: vi.fn(() => ({ success: true })),
  companyIdSchema: {},
  idCompanySchema: {},
}));

import { authApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

function mockAdapter(
  impl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>,
) {
  const query = vi.fn(impl);
  vi.mocked(getDbAdapter).mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
  return query;
}

beforeEach(() => {
  vi.mocked(getDbAdapter).mockReset();
  delete (window as unknown as Record<string, unknown>).electronAuth;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronAuth;
  vi.restoreAllMocks();
});

describe('authApi.getAuditLogs row mapping (regression: audit page crash)', () => {
  it('maps snake_case columns to camelCase so recordId is never undefined', async () => {
    mockAdapter(async () => ({
      success: true,
      rows: [
        {
          id: 'log-1',
          user_id: 'user-1',
          action: 'create',
          table_name: 'sales_invoices',
          record_id: '3f2a1b9c-1111-2222-3333-444455556666',
          old_values: null,
          new_values: null,
          ip_address: '127.0.0.1',
          company_id: COMPANY_ID,
          created_at: '2026-09-05T10:00:00.000Z',
          username: 'admin',
        },
      ],
    }));

    const res = await authApi.getAuditLogs(COMPANY_ID, {});
    expect(res.success).toBe(true);
    const log = res.data![0];
    expect(log.tableName).toBe('sales_invoices');
    expect(log.recordId).toBe('3f2a1b9c-1111-2222-3333-444455556666');
    // The audit page renders recordId.slice(0, 8) — must not throw.
    expect(() => log.recordId.slice(0, 8)).not.toThrow();
  });

  it('defaults NULL record_id (login/logout rows) to empty string', async () => {
    mockAdapter(async () => ({
      success: true,
      rows: [
        {
          id: 'log-2',
          user_id: 'user-1',
          action: 'login',
          table_name: 'users',
          record_id: null,
          old_values: null,
          new_values: null,
          ip_address: null,
          company_id: COMPANY_ID,
          created_at: '2026-09-05T10:00:00.000Z',
          username: 'admin',
        },
      ],
    }));

    const res = await authApi.getAuditLogs(COMPANY_ID, {});
    expect(res.success).toBe(true);
    expect(res.data![0].recordId).toBe('');
  });
});
