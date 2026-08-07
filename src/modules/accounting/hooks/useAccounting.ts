import { useState, useEffect, useCallback, useMemo } from 'react';
import { accountingApi } from '../api';
import { useAuthStore } from '@/modules/auth/store';
import { usePaginatedList } from '@/core/hooks/usePaginatedList';
import type { Account, Transaction, TrialBalanceRow, LedgerRow, ReceiptVoucher, PaymentVoucher } from '../types';

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

export function useAccounts(companyId: string) {
  const [flatAccounts, setFlatAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const auth = useAuthStore.getState();
      const ownedByUserId = auth.shouldFilterByOwner('accounting') ? auth.user?.id : undefined;
      const result = await accountingApi.getAccounts(companyId, ownedByUserId);
      if (cancelled) return;
      if (result.success && result.data) {
        // API returns a tree; flatten it (DFS) to get a flat list of all accounts
        const flatten = (items: Account[]): Account[] =>
          items.flatMap(item => [item, ...flatten(item.children || [])]);
        setFlatAccounts(flatten(result.data));
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const accounts = useMemo(() => buildAccountTree(flatAccounts), [flatAccounts]);

  const create = useCallback(async (data: Omit<Account, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createAccount(data, userId);
    if (result.success && result.id) {
      const newAccount: Account = { ...data, id: result.id!, children: [] };
      setFlatAccounts(prev => [...prev, newAccount]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Account>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updateAccount(id, companyId, userId, data);
    if (result.success) {
      setFlatAccounts(prev => prev.map(a => a.id === id ? { ...a, ...data } : a));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deleteAccount(id, companyId);
    if (result.success) {
      setFlatAccounts(prev => prev.filter(a => a.id !== id));
    }
    return result;
  }, [companyId]);

  return { accounts, isLoading, create, update, remove };
}

export function useTransactions(companyId: string) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const auth = useAuthStore.getState();
      const ownedByUserId = auth.shouldFilterByOwner('accounting') ? auth.user?.id : undefined;
      const result = await accountingApi.getTransactions(companyId, ownedByUserId);
      if (cancelled) return;
      if (result.success && result.data) {
        setTransactions(result.data);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const create = useCallback(async (data: Omit<Transaction, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createTransaction(data, userId);
    if (result.success && result.id) {
      setTransactions(prev => [{ ...data, id: result.id! }, ...prev]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Transaction>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updateTransaction(id, companyId, userId, data);
    if (result.success) {
      setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
    }
    return result;
  }, [companyId]);

  const post = useCallback(async (id: string) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.postTransaction(id, companyId, userId);
    if (result.success) {
      setTransactions(prev => prev.map(t => t.id === id ? { ...t, status: 'posted' } : t));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deleteTransaction(id, companyId);
    if (result.success) {
      setTransactions(prev => prev.filter(t => t.id !== id));
    }
    return result;
  }, [companyId]);

  return { transactions, isLoading, create, update, post, remove };
}

export interface TransactionFilters {
  status?: string;
  createdBy?: string;
}

export function useTransactionsPaginated(companyId: string, filters?: TransactionFilters) {
  const { reload: reloadList, ...list } = usePaginatedList<Transaction>(
    (page, pageSize) => accountingApi.getTransactionsPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, filters?.createdBy]
  );

  const create = useCallback(async (data: Omit<Transaction, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createTransaction(data, userId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<Transaction>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updateTransaction(id, companyId, userId, data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const post = useCallback(async (id: string) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.postTransaction(id, companyId, userId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deleteTransaction(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  return {
    transactions: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    post,
    remove,
    reload: reloadList,
  };
}

export function useTrialBalance(companyId: string, asOfDate?: string) {
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const result = await accountingApi.getTrialBalance(companyId, asOfDate);
      if (cancelled) return;
      if (result.success && result.data) {
        setRows(result.data);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId, asOfDate]);

  return { rows, isLoading };
}

export function useAccountLedger(accountId: string, companyId: string, startDate?: string, endDate?: string) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!accountId || !companyId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const result = await accountingApi.getAccountLedger(accountId, companyId, startDate, endDate);
      if (cancelled) return;
      if (result.success && result.data) {
        setRows(result.data);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [accountId, companyId, startDate, endDate]);

  return { rows, isLoading };
}

export function useReceiptVouchers(companyId: string) {
  const [vouchers, setVouchers] = useState<ReceiptVoucher[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const auth = useAuthStore.getState();
      const ownedByUserId = auth.shouldFilterByOwner('accounting') ? auth.user?.id : undefined;
      const result = await accountingApi.getReceiptVouchers(companyId, ownedByUserId);
      if (cancelled) return;
      if (result.success && result.data) {
        setVouchers(result.data);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const create = useCallback(async (data: Omit<ReceiptVoucher, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createReceiptVoucher(data, userId);
    if (result.success && result.id) {
      setVouchers(prev => [{ ...data, id: result.id! }, ...prev]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<ReceiptVoucher>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updateReceiptVoucher(id, companyId, userId, data);
    if (result.success) {
      setVouchers(prev => prev.map(v => v.id === id ? { ...v, ...data } : v));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deleteReceiptVoucher(id, companyId);
    if (result.success) {
      setVouchers(prev => prev.filter(v => v.id !== id));
    }
    return result;
  }, [companyId]);

  return { vouchers, isLoading, create, update, remove };
}

export interface ReceiptVoucherFilters {
  status?: string;
}

export function useReceiptVouchersPaginated(companyId: string, filters?: ReceiptVoucherFilters) {
  const { reload: reloadList, ...list } = usePaginatedList<ReceiptVoucher>(
    (page, pageSize) => accountingApi.getReceiptVouchersPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status]
  );

  const create = useCallback(async (data: Omit<ReceiptVoucher, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createReceiptVoucher(data, userId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<ReceiptVoucher>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updateReceiptVoucher(id, companyId, userId, data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deleteReceiptVoucher(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  return {
    vouchers: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    remove,
    reload: reloadList,
  };
}

export function usePaymentVouchers(companyId: string) {
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const auth = useAuthStore.getState();
      const ownedByUserId = auth.shouldFilterByOwner('accounting') ? auth.user?.id : undefined;
      const result = await accountingApi.getPaymentVouchers(companyId, ownedByUserId);
      if (cancelled) return;
      if (result.success && result.data) {
        setVouchers(result.data);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const create = useCallback(async (data: Omit<PaymentVoucher, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createPaymentVoucher(data, userId);
    if (result.success && result.id) {
      setVouchers(prev => [{ ...data, id: result.id! }, ...prev]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<PaymentVoucher>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updatePaymentVoucher(id, companyId, userId, data);
    if (result.success) {
      setVouchers(prev => prev.map(v => v.id === id ? { ...v, ...data } : v));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deletePaymentVoucher(id, companyId);
    if (result.success) {
      setVouchers(prev => prev.filter(v => v.id !== id));
    }
    return result;
  }, [companyId]);

  return { vouchers, isLoading, create, update, remove };
}

export interface PaymentVoucherFilters {
  status?: string;
}

export function usePaymentVouchersPaginated(companyId: string, filters?: PaymentVoucherFilters) {
  const { reload: reloadList, ...list } = usePaginatedList<PaymentVoucher>(
    (page, pageSize) => accountingApi.getPaymentVouchersPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status]
  );

  const create = useCallback(async (data: Omit<PaymentVoucher, 'id'>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.createPaymentVoucher(data, userId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<PaymentVoucher>) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { success: false, error: 'User not authenticated' };
    const result = await accountingApi.updatePaymentVoucher(id, companyId, userId, data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await accountingApi.deletePaymentVoucher(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  return {
    vouchers: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    remove,
    reload: reloadList,
  };
}
