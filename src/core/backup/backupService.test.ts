import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

import { applyRestore, getBackupSetting, readBackupRows, setBackupSetting } from './backupService';
import { getDbAdapter } from '@/core/database/adapters';

function mockAdapter(
  queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>,
  transactionImpl?: (queries: { sql: string; params?: unknown[] }[]) => Promise<{ success: boolean; error?: string }>,
) {
  const query = vi.fn(queryImpl);
  const transaction = vi.fn(
    transactionImpl ?? (async () => ({ success: true, results: [] as unknown[] })),
  );
  vi.mocked(getDbAdapter).mockResolvedValue({ query, transaction } as unknown as Awaited<
    ReturnType<typeof getDbAdapter>
  >);
  return { query, transaction };
}

beforeEach(() => {
  vi.mocked(getDbAdapter).mockReset();
  delete (window as unknown as Record<string, unknown>).electronDB;
});

describe('readBackupRows (adapter fallback)', () => {
  it('reads planned tables and warns on failures instead of aborting', async () => {
    const { query } = mockAdapter(async (sql) => {
      if (sql.includes('FROM customers')) return { success: true, rows: [{ id: 'c1' }] };
      return { success: false, error: 'no such table' };
    });
    const { tables, warnings } = await readBackupRows('co1');
    expect(tables.customers).toEqual([{ id: 'c1' }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE company_id = $1'), ['co1']);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('applyRestore (adapter fallback)', () => {
  it('runs the composed batch as one transaction (wipe-all, users preserved)', async () => {
    const { transaction } = mockAdapter(
      async () => ({ success: true, rows: [] }),
      async () => ({ success: true }),
    );
    const res = await applyRestore('co1', {
      customers: [{ id: 'c1', company_id: 'co1', name: 'x' }],
      mystery_table: [{ id: 'm1' }],
    });
    // honest count: only planned tables (customers=1) — mystery_table is skipped
    expect(res.restored).toBe(1);
    expect(res.warnings).toEqual(['mystery_table: unknown table, skipped']);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [batch] = transaction.mock.calls[0] as { sql: string; params?: unknown[] }[][];
    // the wipe phase covers EVERY planned table (old-backup safety), in
    // FK-safe DELETE_ORDER — and never touches users/companies
    const deletes = batch.filter((s) => s.sql.startsWith('DELETE')).map((s) => s.sql);
    expect(deletes.some((sql) => sql.startsWith('DELETE FROM customers'))).toBe(true);
    expect(deletes.some((sql) => sql.startsWith('DELETE FROM pos_payments'))).toBe(true);
    expect(deletes.some((sql) => sql.startsWith('DELETE FROM users'))).toBe(false);
    expect(deletes.some((sql) => sql.startsWith('DELETE FROM companies'))).toBe(false);
    const insIdx = batch.findIndex((s) => s.sql.startsWith('INSERT INTO customers'));
    const delIdx = batch.findIndex((s) => s.sql.startsWith('DELETE FROM customers'));
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeLessThan(insIdx);
  });

  it('resolves user references against the target users (users lookup precedes the transaction)', async () => {
    const { query, transaction } = mockAdapter(
      async (sql) => (sql.includes('FROM users') ? { success: true, rows: [{ id: 'admin-1' }] } : { success: true, rows: [] }),
      async () => ({ success: true }),
    );
    await applyRestore('co1', {
      currencies: [{ id: 'cur1', company_id: 'co1', code: 'YER', created_by: 'gone-user' }],
    });
    expect(query).toHaveBeenCalledWith('SELECT id FROM users WHERE company_id = $1', ['co1']);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(transaction.mock.invocationCallOrder[0]);
    const [batch] = transaction.mock.calls[0] as { sql: string; params: unknown[] }[][];
    const insert = batch.find((s) => s.sql.startsWith('INSERT INTO currencies'));
    expect(insert).toBeDefined();
    // dangling created_by re-attributed… no auth user in tests → null
    expect(insert!.params).not.toContain('gone-user');
  });

  it('surfaces transaction failures as errors', async () => {
    mockAdapter(
      async () => ({ success: true, rows: [] }),
      async () => ({ success: false, error: 'FK violation' }),
    );
    await expect(applyRestore('co1', { customers: [{ id: 'c1' }] })).rejects.toThrow(/FK violation/);
  });
});

describe('backup settings', () => {
  it('reads null when missing and upserts on save', async () => {
    const { query } = mockAdapter(async () => ({ success: true, rows: [] }));
    await expect(getBackupSetting('co1', 'backup.autoEnabled')).resolves.toBeNull();
    await setBackupSetting('co1', 'backup.autoEnabled', 'true');
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ON CONFLICT (company_id, key)'), [
      expect.any(String),
      'co1',
      'backup.autoEnabled',
      'true',
    ]);
  });
});
