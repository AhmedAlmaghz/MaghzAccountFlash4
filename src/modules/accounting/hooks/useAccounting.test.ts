import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAccounts } from './useAccounting';
import { accountingApi } from '../api';
import type { Account } from '../types';

vi.mock('../api', () => ({
  accountingApi: {
    getAccounts: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

vi.mock('@/modules/auth/store', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      user: { id: 'user-1' },
      shouldFilterByOwner: () => false,
    })),
  },
}));

function buildAccountTree(accounts: Account[]): Account[] {
  const accountMap = new Map<string, Account>();
  const rootAccounts: Account[] = [];

  accounts.forEach(acc => {
    accountMap.set(acc.id, { ...acc, children: [] });
  });

  accounts.forEach(acc => {
    const node = accountMap.get(acc.id)!;
    if (acc.parentId && accountMap.has(acc.parentId)) {
      const parent = accountMap.get(acc.parentId)!;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      rootAccounts.push(node);
    }
  });

  return rootAccounts;
}

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: 'a1',
    companyId: 'c1',
    code: '1000',
    nameAr: 'حساب',
    type: 'asset',
    nature: 'debit',
    isGroup: false,
    balance: 0,
    isActive: true,
    ...overrides,
  };
}

describe('buildAccountTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildAccountTree([])).toEqual([]);
  });

  it('returns single root when no parent is specified', () => {
    const accounts = [makeAccount({ id: 'a1', code: '1000', nameAr: 'الأصول' })];
    const tree = buildAccountTree(accounts);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a1');
    expect(tree[0].children).toEqual([]);
  });

  it('nests child account under its parent', () => {
    const accounts = [
      makeAccount({ id: 'parent', code: '1000', nameAr: 'الأصول' }),
      makeAccount({ id: 'child', code: '1100', nameAr: 'الأصول المتداولة', parentId: 'parent' }),
    ];
    const tree = buildAccountTree(accounts);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('parent');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].id).toBe('child');
  });

  it('treats orphan parentId as root when parent does not exist', () => {
    const accounts = [
      makeAccount({ id: 'orphan', code: '1000', nameAr: 'يتيم', parentId: 'nonexistent' }),
    ];
    const tree = buildAccountTree(accounts);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('orphan');
  });

  it('handles multi-level nesting (grandchildren)', () => {
    const accounts = [
      makeAccount({ id: 'root', code: '1000', nameAr: 'الأصول' }),
      makeAccount({ id: 'child', code: '1100', nameAr: 'الأصول المتداولة', parentId: 'root' }),
      makeAccount({ id: 'grandchild', code: '1110', nameAr: 'النقدية', parentId: 'child' }),
    ];
    const tree = buildAccountTree(accounts);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('root');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].id).toBe('child');
    expect(tree[0].children![0].children).toHaveLength(1);
    expect(tree[0].children![0].children![0].id).toBe('grandchild');
  });

  it('handles multiple roots with children', () => {
    const accounts = [
      makeAccount({ id: 'r1', code: '1000', nameAr: 'الأصول' }),
      makeAccount({ id: 'r1c1', code: '1100', nameAr: 'النقدية', parentId: 'r1' }),
      makeAccount({ id: 'r2', code: '2000', nameAr: 'الالتزامات' }),
      makeAccount({ id: 'r2c1', code: '2100', nameAr: 'الدائنون', parentId: 'r2' }),
    ];
    const tree = buildAccountTree(accounts);
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('r1');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[1].id).toBe('r2');
    expect(tree[1].children).toHaveLength(1);
  });

  it('preserves original data and only adds children property', () => {
    const accounts = [
      makeAccount({ id: 'a1', code: '1000', nameAr: 'حساب 1', balance: 1000, isActive: true }),
    ];
    const tree = buildAccountTree(accounts);
    expect(tree[0].balance).toBe(1000);
    expect(tree[0].isActive).toBe(true);
    expect(tree[0].code).toBe('1000');
    expect(tree[0].nameAr).toBe('حساب 1');
  });
});

describe('useAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads accounts and builds tree on mount', async () => {
    vi.mocked(accountingApi.getAccounts).mockResolvedValue({
      success: true,
      data: [
        makeAccount({ id: 'root', code: '1000', nameAr: 'الأصول' }),
        makeAccount({ id: 'child', code: '1100', nameAr: 'النقدية', parentId: 'root' }),
      ],
    });

    const { result } = renderHook(() => useAccounts('company-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.accounts[0].id).toBe('root');
    expect(result.current.accounts[0].children).toHaveLength(1);
  });

  it('create adds new account to the tree', async () => {
    vi.mocked(accountingApi.getAccounts).mockResolvedValue({
      success: true,
      data: [makeAccount({ id: 'root', code: '1000', nameAr: 'الأصول' })],
    });
    vi.mocked(accountingApi.createAccount).mockResolvedValue({
      success: true,
      id: 'new-child',
    });

    const { result } = renderHook(() => useAccounts('company-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      const createResult = await result.current.create({
        companyId: 'company-1',
        code: '1100',
        nameAr: 'النقدية',
        type: 'asset',
        nature: 'debit',
        isGroup: false,
        balance: 0,
        isActive: true,
        parentId: 'root',
      });
      expect(createResult.success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.accounts[0].children).toHaveLength(1);
    });
    expect(result.current.accounts[0].children![0].id).toBe('new-child');
  });

  it('remove filters account from the tree', async () => {
    vi.mocked(accountingApi.getAccounts).mockResolvedValue({
      success: true,
      data: [
        makeAccount({ id: 'root', code: '1000', nameAr: 'الأصول' }),
        makeAccount({ id: 'child', code: '1100', nameAr: 'النقدية', parentId: 'root' }),
      ],
    });
    vi.mocked(accountingApi.deleteAccount).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAccounts('company-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.accounts[0].children).toHaveLength(1);

    await act(async () => {
      const removeResult = await result.current.remove('child');
      expect(removeResult.success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.accounts[0].children).toHaveLength(0);
    });
  });

  it('does not load when companyId is empty', async () => {
    const { result } = renderHook(() => useAccounts(''));
    expect(accountingApi.getAccounts).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
