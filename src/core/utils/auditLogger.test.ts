import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { logAudit, getAuditLogs } from './auditLogger';
import { getDbAdapter } from '@/core/database/adapters';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000010';
const RECORD_ID = '00000000-0000-0000-0000-000000000020';

function makeMockAdapter(impl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return { query: vi.fn(impl) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logAudit', () => {
  it('inserts audit log with basic fields', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await logAudit({
      userId: USER_ID,
      action: 'create',
      tableName: 'currencies',
      recordId: RECORD_ID,
      companyId: COMPANY_ID,
    });

    expect(adapter.query).toHaveBeenCalledTimes(1);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_logs/);
    expect(sql).toMatch(/NOW\(\)/);
    expect(params).toHaveLength(9);
    expect(typeof params[0]).toBe('string');
    expect((params[0] as string).length).toBeGreaterThanOrEqual(20);
    expect(params[1]).toBe(USER_ID);
    expect(params[2]).toBe('create');
    expect(params[3]).toBe('currencies');
    expect(params[4]).toBe(RECORD_ID);
    expect(params[8]).toBe(COMPANY_ID);
  });

  it('embeds recordLabel and username in new_values JSON', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await logAudit({
      userId: USER_ID,
      username: 'admin',
      action: 'create',
      tableName: 'currencies',
      recordId: RECORD_ID,
      recordLabel: 'YER - الريال اليمني',
      newValues: { code: 'YER' },
      companyId: COMPANY_ID,
    });

    const [, params] = adapter.query.mock.calls[0];
    const newValues = JSON.parse(params[6] as string);
    expect(newValues._label).toBe('YER - الريال اليمني');
    expect(newValues._username).toBe('admin');
    expect(newValues.code).toBe('YER');
  });

  it('supports reset_password action', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await logAudit({
      userId: USER_ID,
      action: 'reset_password',
      tableName: 'users',
      recordId: RECORD_ID,
      companyId: COMPANY_ID,
    });

    const [, params] = adapter.query.mock.calls[0];
    expect(params[2]).toBe('reset_password');
  });

  it('supports toggle_active action', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await logAudit({
      userId: USER_ID,
      action: 'toggle_active',
      tableName: 'users',
      recordId: RECORD_ID,
      companyId: COMPANY_ID,
    });

    const [, params] = adapter.query.mock.calls[0];
    expect(params[2]).toBe('toggle_active');
  });

  it('serializes oldValues and newValues as JSON strings', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await logAudit({
      userId: USER_ID,
      action: 'update',
      tableName: 'currencies',
      recordId: RECORD_ID,
      oldValues: { rate: 1 },
      newValues: { rate: 1.5 },
      companyId: COMPANY_ID,
    });

    const [, params] = adapter.query.mock.calls[0];
    expect(typeof params[5]).toBe('string');
    expect(JSON.parse(params[5] as string)).toEqual({ rate: 1 });
    expect(JSON.parse(params[6] as string)).toEqual({ rate: 1.5 });
  });

  it('handles null oldValues and newValues', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await logAudit({
      userId: USER_ID,
      action: 'delete',
      tableName: 'currencies',
      recordId: RECORD_ID,
      companyId: COMPANY_ID,
    });

    const [, params] = adapter.query.mock.calls[0];
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it('silently fails on adapter errors', async () => {
    const adapter = makeMockAdapter(async () => ({ success: false, error: 'db down' }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await expect(
      logAudit({
        userId: USER_ID,
        action: 'create',
        tableName: 'currencies',
        recordId: RECORD_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBeUndefined();
  });

  it('handles circular JSON gracefully', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await logAudit({
      userId: USER_ID,
      action: 'update',
      tableName: 'currencies',
      recordId: RECORD_ID,
      newValues: circular,
      companyId: COMPANY_ID,
    });

    const [, params] = adapter.query.mock.calls[0];
    expect(params[6]).toBeNull();
  });
});

describe('getAuditLogs', () => {
  it('queries with company_id filter and ORDER BY created_at DESC LIMIT 1000', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await getAuditLogs(COMPANY_ID);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM audit_logs/);
    expect(sql).toMatch(/WHERE company_id = \$1/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(sql).toMatch(/LIMIT 1000/);
    expect(params).toEqual([COMPANY_ID]);
  });

  it('adds all filter conditions when provided', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await getAuditLogs(COMPANY_ID, {
      userId: USER_ID,
      tableName: 'currencies',
      action: 'create',
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    });
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/AND user_id = \$2/);
    expect(sql).toMatch(/AND table_name = \$3/);
    expect(sql).toMatch(/AND action = \$4/);
    expect(sql).toMatch(/AND created_at >= \$5/);
    expect(sql).toMatch(/AND created_at <= \$6/);
    expect(params).toHaveLength(6);
  });

  it('returns empty array on success with no rows', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await getAuditLogs(COMPANY_ID);
    expect(res).toEqual({ success: true, rows: [] });
  });

  it('returns error structure on adapter failure', async () => {
    const adapter = makeMockAdapter(async () => ({ success: false, error: 'timeout' }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await getAuditLogs(COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toBe('timeout');
  });

  it('catches exceptions and returns error result', async () => {
    vi.mocked(getDbAdapter).mockRejectedValue(new Error('connection lost'));

    const res = await getAuditLogs(COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toContain('connection lost');
  });
});
