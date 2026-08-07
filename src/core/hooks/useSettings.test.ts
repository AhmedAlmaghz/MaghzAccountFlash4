import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../api', () => ({
  getDocumentSequences: vi.fn(),
  updateDocumentSequence: vi.fn(),
  getNextDocumentNumber: vi.fn(),
  peekNextDocumentNumber: vi.fn(),
  getProductTypes: vi.fn(),
  createProductType: vi.fn(),
  updateProductType: vi.fn(),
  deleteProductType: vi.fn(),
  getUnits: vi.fn(),
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
  deleteUnit: vi.fn(),
  getCashBoxes: vi.fn(),
  createCashBox: vi.fn(),
  updateCashBox: vi.fn(),
  deleteCashBox: vi.fn(),
  getBanks: vi.fn(),
  createBank: vi.fn(),
  updateBank: vi.fn(),
  deleteBank: vi.fn(),
  getCostCenters: vi.fn(),
  createCostCenter: vi.fn(),
  updateCostCenter: vi.fn(),
  deleteCostCenter: vi.fn(),
  getPayrollComponents: vi.fn(),
  createPayrollComponent: vi.fn(),
  updatePayrollComponent: vi.fn(),
  getDefaultAccounts: vi.fn(),
  updateDefaultAccount: vi.fn(),
  applyDefaultTemplate: vi.fn(),
}));

import * as settingsApi from '../api';
import {
  useDocumentSequences,
  useProductTypes,
  useUnits,
  useCashBoxes,
  useBanks,
  useCostCenters,
  useDefaultAccounts,
} from '../hooks/useSettings';

const COMPANY_ID = 'comp-1';
const RECORD_ID = 'rec-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDocumentSequences', () => {
  it('loads sequences on mount with companyId', async () => {
    vi.mocked(settingsApi.getDocumentSequences).mockResolvedValue({
      success: true,
      data: [{ id: RECORD_ID, documentType: 'sales_invoice', prefix: 'INV-' } as never],
    });

    const { result } = renderHook(() => useDocumentSequences(COMPANY_ID));

    expect(result.current.isLoading).toBe(true);
    await act(async () => { await Promise.resolve(); });

    expect(settingsApi.getDocumentSequences).toHaveBeenCalledWith(COMPANY_ID);
    expect(result.current.sequences).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not load when companyId is empty', async () => {
    renderHook(() => useDocumentSequences(''));
    expect(settingsApi.getDocumentSequences).not.toHaveBeenCalled();
  });

  it('update calls API and updates state on success', async () => {
    vi.mocked(settingsApi.getDocumentSequences).mockResolvedValue({
      success: true,
      data: [{ id: RECORD_ID, documentType: 'sales_invoice', prefix: 'INV-' } as never],
    });
    vi.mocked(settingsApi.updateDocumentSequence).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDocumentSequences(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      const res = await result.current.update(RECORD_ID, { prefix: 'X-' });
      expect(res.success).toBe(true);
    });

    expect(settingsApi.updateDocumentSequence).toHaveBeenCalledWith(RECORD_ID, { prefix: 'X-' }, COMPANY_ID);
    expect(result.current.sequences[0].prefix).toBe('X-');
  });

  it('does not update state on failed update', async () => {
    vi.mocked(settingsApi.getDocumentSequences).mockResolvedValue({
      success: true,
      data: [{ id: RECORD_ID, documentType: 'sales_invoice', prefix: 'INV-' } as never],
    });
    vi.mocked(settingsApi.updateDocumentSequence).mockResolvedValue({ success: false, error: 'fail' });

    const { result } = renderHook(() => useDocumentSequences(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      const res = await result.current.update(RECORD_ID, { prefix: 'X-' });
      expect(res.success).toBe(false);
    });

    expect(result.current.sequences[0].prefix).toBe('INV-');
  });
});

describe('useProductTypes', () => {
  it('loads and creates types', async () => {
    vi.mocked(settingsApi.getProductTypes).mockResolvedValue({ success: true, data: [] });
    vi.mocked(settingsApi.createProductType).mockResolvedValue({ success: true, id: 'new-id' });

    const { result } = renderHook(() => useProductTypes(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.types).toHaveLength(0);

    await act(async () => {
      await result.current.create({
        companyId: COMPANY_ID, nameAr: 'منتج', isActive: true,
        appearsInSales: true, appearsInPurchases: true, appearsInInventory: true,
        appearsInManufacturing: false, hasStockTracking: true, hasBOM: false,
      } as never);
    });

    expect(result.current.types).toHaveLength(1);
    expect(result.current.types[0].id).toBe('new-id');
  });

  it('removes type on successful delete', async () => {
    vi.mocked(settingsApi.getProductTypes).mockResolvedValue({
      success: true,
      data: [{ id: RECORD_ID, nameAr: 'منتج' } as never],
    });
    vi.mocked(settingsApi.deleteProductType).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useProductTypes(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.remove(RECORD_ID);
    });

    expect(result.current.types).toHaveLength(0);
  });
});

describe('useUnits', () => {
  it('loads and creates units', async () => {
    vi.mocked(settingsApi.getUnits).mockResolvedValue({ success: true, data: [] });
    vi.mocked(settingsApi.createUnit).mockResolvedValue({ success: true, id: 'u-1' });

    const { result } = renderHook(() => useUnits(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.units).toEqual([]);

    await act(async () => {
      await result.current.create({
        companyId: COMPANY_ID, nameAr: 'قطعة', conversionFactor: 1, isActive: true,
      } as never);
    });

    expect(result.current.units).toHaveLength(1);
  });
});

describe('useCashBoxes', () => {
  it('updates state on successful update', async () => {
    vi.mocked(settingsApi.getCashBoxes).mockResolvedValue({
      success: true,
      data: [{ id: RECORD_ID, name: 'صندوق', currentBalance: 0 } as never],
    });
    vi.mocked(settingsApi.updateCashBox).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useCashBoxes(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.update(RECORD_ID, { name: 'صندوق جديد' });
    });

    expect(result.current.boxes[0].name).toBe('صندوق جديد');
  });
});

describe('useBanks', () => {
  it('loads banks and removes one', async () => {
    vi.mocked(settingsApi.getBanks).mockResolvedValue({
      success: true,
      data: [{ id: 'b1' }, { id: 'b2' }] as never,
    });
    vi.mocked(settingsApi.deleteBank).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useBanks(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.banks).toHaveLength(2);

    await act(async () => {
      await result.current.remove('b1');
    });

    expect(result.current.banks).toHaveLength(1);
    expect(result.current.banks[0].id).toBe('b2');
  });
});

describe('useCostCenters', () => {
  it('loads and creates cost centers', async () => {
    vi.mocked(settingsApi.getCostCenters).mockResolvedValue({ success: true, data: [] });
    vi.mocked(settingsApi.createCostCenter).mockResolvedValue({ success: true, id: 'cc-1' });

    const { result } = renderHook(() => useCostCenters(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.centers).toEqual([]);

    await act(async () => {
      await result.current.create({
        companyId: COMPANY_ID, nameAr: 'مبيعات', type: 'department', budgetAmount: 0, isActive: true,
      } as never);
    });

    expect(result.current.centers).toHaveLength(1);
  });

  it('removes on successful delete', async () => {
    vi.mocked(settingsApi.getCostCenters).mockResolvedValue({
      success: true,
      data: [{ id: RECORD_ID, nameAr: 'مبيعات' }] as never,
    });
    vi.mocked(settingsApi.deleteCostCenter).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useCostCenters(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.remove(RECORD_ID);
    });

    expect(result.current.centers).toHaveLength(0);
  });
});

describe('useDefaultAccounts', () => {
  it('loads default accounts', async () => {
    vi.mocked(settingsApi.getDefaultAccounts).mockResolvedValue({
      success: true,
      data: [{ id: 'da-1', functionKey: 'default_cash', accountId: 'acc-1' }] as never,
    });

    const { result } = renderHook(() => useDefaultAccounts(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.accounts).toHaveLength(1);
  });

  it('updates accountId on successful update', async () => {
    vi.mocked(settingsApi.getDefaultAccounts).mockResolvedValue({
      success: true,
      data: [{ id: 'da-1', functionKey: 'default_cash', accountId: 'acc-1' }] as never,
    });
    vi.mocked(settingsApi.updateDefaultAccount).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDefaultAccounts(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.update('da-1', 'acc-2');
    });

    expect(result.current.accounts[0].accountId).toBe('acc-2');
  });

  it('supports null accountId (unlink)', async () => {
    vi.mocked(settingsApi.getDefaultAccounts).mockResolvedValue({
      success: true,
      data: [{ id: 'da-1', functionKey: 'default_cash', accountId: 'acc-1' }] as never,
    });
    vi.mocked(settingsApi.updateDefaultAccount).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDefaultAccounts(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.update('da-1', null);
    });

    expect(result.current.accounts[0].accountId).toBeNull();
  });

  it('applies trading template and reloads accounts', async () => {
    vi.mocked(settingsApi.getDefaultAccounts).mockResolvedValue({ success: true, data: [] });
    vi.mocked(settingsApi.applyDefaultTemplate).mockResolvedValue({ success: true });
    vi.mocked(settingsApi.getDefaultAccounts).mockResolvedValueOnce({ success: true, data: [] }).mockResolvedValueOnce({
      success: true,
      data: [{ id: 'da-1', functionKey: 'default_cash', accountId: 'acc-1' }] as never,
    });

    const { result } = renderHook(() => useDefaultAccounts(COMPANY_ID));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.accounts).toHaveLength(0);

    await act(async () => {
      await result.current.applyTemplate('trading');
    });

    expect(settingsApi.applyDefaultTemplate).toHaveBeenCalledWith(COMPANY_ID, 'trading');
    expect(settingsApi.getDefaultAccounts).toHaveBeenCalledTimes(2);
    expect(result.current.accounts).toHaveLength(1);
  });
});
