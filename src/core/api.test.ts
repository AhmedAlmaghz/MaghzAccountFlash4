import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

vi.mock('@/core/utils/mapPgRow', () => ({
  mapRows: vi.fn(<T,>(rows: unknown[]): T[] => (rows as T[]) ?? []),
}));

import * as settingsApi from './api';
import { getDbAdapter } from '@/core/database/adapters';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const DOC_ID = '00000000-0000-0000-0000-000000000010';
const TYPE_ID = '00000000-0000-0000-0000-000000000020';
const UNIT_ID = '00000000-0000-0000-0000-000000000030';
const CASHBOX_ID = '00000000-0000-0000-0000-000000000040';
const BANK_ID = '00000000-0000-0000-0000-000000000050';
const CC_ID = '00000000-0000-0000-0000-000000000060';
const PA_ID = '00000000-0000-0000-0000-000000000070';
const DA_ID = '00000000-0000-0000-0000-000000000080';

function makeMockAdapter(impl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return { query: vi.fn(impl) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settingsApi.getDocumentSequences', () => {
  it('returns list of document sequences for company', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [
        { id: DOC_ID, company_id: COMPANY_ID, document_type: 'sales_invoice', prefix: 'INV-', suffix: '', starting_number: 1, current_number: 5, increment_step: 1, padding_length: 4, year_reset: false, is_active: true },
      ],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getDocumentSequences(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM document_sequences'),
      [COMPANY_ID]
    );
  });

  it('returns empty array when no sequences exist', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getDocumentSequences(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('propagates adapter errors', async () => {
    const adapter = makeMockAdapter(async () => ({ success: false, error: 'db down' }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getDocumentSequences(COMPANY_ID);
    expect(res.success).toBe(false);
    expect(res.error).toBe('db down');
  });
});

describe('settingsApi.updateDocumentSequence', () => {
  it('updates sequence with all 9 fields + WHERE company_id filter', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await settingsApi.updateDocumentSequence(DOC_ID, {
      prefix: 'INV-', suffix: '', startingNumber: 1, currentNumber: 5,
      incrementStep: 1, paddingLength: 4, yearReset: false, isActive: true,
    }, COMPANY_ID);

    expect(adapter.query).toHaveBeenCalledTimes(1);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE document_sequences/);
    expect(sql).toMatch(/AND company_id = \$11/);
    expect(params).toHaveLength(11);
    expect(params[8]).toBeNull();
    expect(params[9]).toBe(DOC_ID);
    expect(params[10]).toBe(COMPANY_ID);
  });
});

describe('settingsApi.getProductTypes', () => {
  it('returns product types ordered by name_ar', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: TYPE_ID, name_ar: 'منتج', appears_in_sales: true, is_active: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getProductTypes(COMPANY_ID);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringMatching(/ORDER BY name_ar/),
      [COMPANY_ID]
    );
  });

  it('createProductType includes all 14 columns + RETURNING id', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ id: TYPE_ID }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const result = await settingsApi.createProductType({
      companyId: COMPANY_ID, nameAr: 'منتج', appearsInSales: true, appearsInPurchases: true,
      appearsInInventory: true, appearsInManufacturing: false, hasStockTracking: true,
      hasBOM: false, isActive: true,
    });
    expect(result.success).toBe(true);
    expect(result.id).toBe(TYPE_ID);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO product_types/);
    expect(sql).toMatch(/RETURNING id/);
    expect(params).toHaveLength(16);
  });

  it('deleteProductType uses company_id filter', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await settingsApi.deleteProductType(TYPE_ID, COMPANY_ID);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM product_types/);
    expect(sql).toMatch(/AND company_id = \$2/);
    expect(params).toEqual([TYPE_ID, COMPANY_ID]);
  });
});

describe('settingsApi.getUnits', () => {
  it('returns active units ordered by name_ar', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: UNIT_ID, name_ar: 'قطعة', is_active: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getUnits(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM units/);
    expect(sql).toMatch(/is_active = true/);
    expect(sql).toMatch(/ORDER BY name_ar/);
  });
});

describe('settingsApi.getCashBoxes', () => {
  it('returns active cash boxes ordered by name', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: CASHBOX_ID, name: 'الصندوق الرئيسي', is_active: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getCashBoxes(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM cash_boxes/);
  });

  it('createCashBox INSERTs with all 8 columns', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [{ id: CASHBOX_ID }] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const result = await settingsApi.createCashBox({
      companyId: COMPANY_ID, name: 'صندوق', code: 'CB1', currentBalance: 1000, isActive: true,
    });
    expect(result.success).toBe(true);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO cash_boxes/);
    expect(params).toHaveLength(10);
  });
});

describe('settingsApi.getBanks', () => {
  it('returns active banks', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: BANK_ID, name: 'البنك الأهلي', is_active: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getBanks(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM banks/);
  });
});

describe('settingsApi.getCostCenters', () => {
  it('returns active cost centers ordered by name_ar', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: CC_ID, name_ar: 'المبيعات', is_active: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getCostCenters(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM cost_centers/);
  });
});

describe('settingsApi.getPayrollComponents', () => {
  it('returns active payroll components ordered by type, name_ar', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: PA_ID, name_ar: 'البدل', type: 'earning', is_active: true }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getPayrollComponents(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM payroll_components/);
    expect(sql).toMatch(/ORDER BY type, name_ar/);
  });
});

describe('settingsApi.getDefaultAccounts', () => {
  it('returns default accounts ordered by function_key', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{ id: DA_ID, function_key: 'default_cash', account_id: 'acc-1' }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.getDefaultAccounts(COMPANY_ID);
    expect(res.success).toBe(true);
    const [sql] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/FROM default_accounts/);
    expect(sql).toMatch(/ORDER BY function_key/);
  });

  it('updateDefaultAccount uses company_id filter', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await settingsApi.updateDefaultAccount(DA_ID, 'acc-2', COMPANY_ID);
    const [sql, params] = adapter.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE default_accounts/);
    expect(sql).toMatch(/AND company_id = \$3/);
    expect(params).toEqual(['acc-2', DA_ID, COMPANY_ID, null]);
  });

  it('updateDefaultAccount supports null account_id (unlink)', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await settingsApi.updateDefaultAccount(DA_ID, null, COMPANY_ID);
    const [, params] = adapter.query.mock.calls[0];
    expect(params[0]).toBeNull();
  });
});

describe('settingsApi.applyDefaultTemplate', () => {
  it('applies trading template by updating 12 default accounts', async () => {
    let queryCount = 0;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('SELECT id FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-found' }] };
      }
      if (sql.includes('UPDATE default_accounts')) {
        queryCount++;
        return { success: true };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.applyDefaultTemplate(COMPANY_ID, 'trading');
    expect(res.success).toBe(true);
    expect(queryCount).toBeGreaterThanOrEqual(12);
  });

  it('applies manufacturing and services templates with same 12 accounts', async () => {
    let totalQueries = 0;
    const adapter = makeMockAdapter(async (sql) => {
      if (sql.includes('SELECT id FROM accounts')) {
        return { success: true, rows: [{ id: 'acc-found' }] };
      }
      if (sql.includes('UPDATE default_accounts')) {
        totalQueries++;
      }
      return { success: true };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    await settingsApi.applyDefaultTemplate(COMPANY_ID, 'manufacturing');
    await settingsApi.applyDefaultTemplate(COMPANY_ID, 'services');
    expect(totalQueries).toBeGreaterThanOrEqual(24);
  });
});

describe('settingsApi.peekNextDocumentNumber', () => {
  it('returns the preview number without incrementing', async () => {
    const adapter = makeMockAdapter(async () => ({
      success: true,
      rows: [{
        id: DOC_ID, company_id: COMPANY_ID, document_type: 'sales_invoice',
        prefix: 'INV-', suffix: '', startingNumber: 1, currentNumber: 5,
        incrementStep: 1, paddingLength: 4, yearReset: false, isActive: true,
      }],
    }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.peekNextDocumentNumber(COMPANY_ID, 'sales_invoice');
    expect(res.success).toBe(true);
    expect(res.number).toMatch(/^INV-\d{4}$/);
  });

  it('returns error when sequence not found', async () => {
    const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

    const res = await settingsApi.peekNextDocumentNumber(COMPANY_ID, 'sales_invoice');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Sequence not found');
  });
});
