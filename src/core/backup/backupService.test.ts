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
  it('runs the composed batch as one transaction', async () => {
    const { transaction } = mockAdapter(
      async () => ({ success: true, rows: [] }),
      async () => ({ success: true }),
    );
    const res = await applyRestore('co1', {
      customers: [{ id: 'c1', company_id: 'co1', name: 'x' }],
      mystery_table: [{ id: 'm1' }],
    });
    expect(res.restored).toBe(2);
    expect(res.warnings).toEqual(['mystery_table: unknown table, skipped']);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [batch] = transaction.mock.calls[0] as { sql: string; params?: unknown[] }[][];
    expect(batch[0].sql).toMatch(/^DELETE FROM customers/);
    expect(batch[1].sql).toMatch(/^INSERT INTO customers/);
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
