import { useState, useEffect, useCallback } from 'react';
import { purchasesApi } from '../api';
import { usePaginatedList } from '@/core/hooks/usePaginatedList';
import { useAuthStore } from '@/modules/auth/store';
import type {
  Supplier,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseReturn,
  SupplierStatementItem,
  ApAgingBucket,
} from '../types';

export function useSuppliers(companyId: string) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await purchasesApi.getSuppliers(companyId);
      if (result.success && result.data) {
        setSuppliers(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Supplier, 'id'>) => {
    const result = await purchasesApi.createSupplier(data);
    if (result.success && result.id) {
      setSuppliers(prev => [...prev, { ...data, id: result.id } as Supplier]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Supplier>) => {
    const result = await purchasesApi.updateSupplier(id, companyId, data);
    if (result.success) {
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteSupplier(id, companyId);
    if (result.success) {
      setSuppliers(prev => prev.filter(s => s.id !== id));
    }
    return result;
  }, [companyId]);

  return { suppliers, isLoading, create, update, remove };
}

export function useSupplierDetails(companyId: string, supplierId: string | null) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [statement, setStatement] = useState<SupplierStatementItem[]>([]);
  const [aging, setAging] = useState<ApAgingBucket[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!supplierId || !companyId) return;
    async function load() {
      setIsLoading(true);
      const [supRes, stmtRes, agingRes] = await Promise.all([
        purchasesApi.getSupplierById(supplierId as string, companyId),
        purchasesApi.getSupplierStatement(supplierId as string, companyId),
        purchasesApi.getApAging(supplierId as string, companyId),
      ]);
      if (supRes.success && supRes.data) setSupplier(supRes.data);
      if (stmtRes.success && stmtRes.data) setStatement(stmtRes.data);
      if (agingRes.success && agingRes.data) setAging(agingRes.data);
      setIsLoading(false);
    }
    load();
  }, [companyId, supplierId]);

  return { supplier, statement, aging, isLoading };
}

export function usePurchaseInvoices(companyId: string) {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await purchasesApi.getInvoices(companyId);
      if (result.success && result.data) {
        setInvoices(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<PurchaseInvoice, 'id'>) => {
    const result = await purchasesApi.createInvoice(data);
    if (result.success && result.id) {
      const newInv = { ...data, id: result.id } as PurchaseInvoice;
      setInvoices(prev => [newInv, ...prev]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<PurchaseInvoice>) => {
    const result = await purchasesApi.updateInvoice(id, companyId, data);
    if (result.success) {
      setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, ...data } as PurchaseInvoice : inv));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteInvoice(id, companyId);
    if (result.success) {
      setInvoices(prev => prev.filter(inv => inv.id !== id));
    }
    return result;
  }, [companyId]);

  const post = useCallback(async (id: string) => {
    const result = await purchasesApi.postInvoice(id, companyId);
    if (result.success) {
      setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status: 'posted' as const } : inv));
    }
    return result;
  }, [companyId]);

  return { invoices, isLoading, create, update, remove, post };
}

export interface PurchaseInvoiceFilters {
  status?: string;
  supplierId?: string;
}

export function usePurchaseInvoicesPaginated(companyId: string, filters?: PurchaseInvoiceFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<PurchaseInvoice>(
    (page, pageSize) => purchasesApi.getInvoicesPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, filters?.supplierId]
  );

  const create = useCallback(async (data: Omit<PurchaseInvoice, 'id'>) => {
    const result = await purchasesApi.createInvoice(data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<PurchaseInvoice>) => {
    const result = await purchasesApi.updateInvoice(id, companyId, data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteInvoice(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const post = useCallback(async (id: string) => {
    const result = await purchasesApi.postInvoice(id, companyId, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  return {
    invoices: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    remove,
    post,
    reload: reloadList,
  };
}

export interface SupplierFilters {
  isActive?: boolean;
  search?: string;
}

export function useOutstandingInvoicesForSupplier(companyId: string, supplierId: string) {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !supplierId) {
      setInvoices([]);
      return;
    }
    setIsLoading(true);
    const result = await purchasesApi.getOutstandingInvoicesForSupplier(companyId, supplierId);
    if (result.success && result.data) setInvoices(result.data);
    else setInvoices([]);
    setIsLoading(false);
  }, [companyId, supplierId]);

  useEffect(() => { load(); }, [load]);

  return { invoices, isLoading, reload: load };
}

export function useSuppliersPaginated(companyId: string, filters?: SupplierFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<Supplier>(
    (page, pageSize) => purchasesApi.getSuppliersPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.isActive, filters?.search]
  );

  const create = useCallback(async (data: Omit<Supplier, 'id'>) => {
    const result = await purchasesApi.createSupplier(data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Supplier>) => {
    const result = await purchasesApi.updateSupplier(id, companyId, data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteSupplier(id, companyId, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  return {
    suppliers: list.items,
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

export function usePurchaseOrders(companyId: string) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await purchasesApi.getOrders(companyId);
      if (result.success && result.data) {
        setOrders(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<PurchaseOrder, 'id'>) => {
    const result = await purchasesApi.createOrder(data);
    if (result.success && result.id) {
      setOrders(prev => [{ ...data, id: result.id } as PurchaseOrder, ...prev]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<PurchaseOrder>) => {
    const result = await purchasesApi.updateOrder(id, companyId, data);
    if (result.success) {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, ...data } as PurchaseOrder : o));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteOrder(id, companyId);
    if (result.success) {
      setOrders(prev => prev.filter(o => o.id !== id));
    }
    return result;
  }, [companyId]);

  const convertToInvoice = useCallback(async (orderId: string) => {
    const result = await purchasesApi.convertOrderToInvoice(orderId, companyId);
    if (result.success) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'invoiced' as const } : o));
    }
    return result;
  }, [companyId]);

  return { orders, isLoading, create, update, remove, convertToInvoice };
}

export function usePurchaseReturns(companyId: string) {
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await purchasesApi.getReturns(companyId);
      if (result.success && result.data) {
        setReturns(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<PurchaseReturn, 'id'>) => {
    const result = await purchasesApi.createReturn(data);
    if (result.success && result.id) {
      setReturns(prev => [{ ...data, id: result.id } as PurchaseReturn, ...prev]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<PurchaseReturn>) => {
    const result = await purchasesApi.updateReturn(id, companyId, data);
    if (result.success) {
      setReturns(prev => prev.map(r => r.id === id ? { ...r, ...data } as PurchaseReturn : r));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteReturn(id, companyId);
    if (result.success) {
      setReturns(prev => prev.filter(r => r.id !== id));
    }
    return result;
  }, [companyId]);

  const post = useCallback(async (id: string) => {
    const result = await purchasesApi.postReturn(id, companyId);
    if (result.success) {
      setReturns(prev => prev.map(r => r.id === id ? { ...r, status: 'posted' as const } : r));
    }
    return result;
  }, [companyId]);

  return { returns, isLoading, create, update, remove, post };
}

export interface OrderFilters {
  status?: string;
  supplierId?: string;
}

export function usePurchaseOrdersPaginated(companyId: string, filters?: OrderFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<PurchaseOrder>(
    (page, pageSize) => purchasesApi.getOrdersPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, filters?.supplierId]
  );

  const create = useCallback(async (data: Omit<PurchaseOrder, 'id'>) => {
    const result = await purchasesApi.createOrder(data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<PurchaseOrder>) => {
    const result = await purchasesApi.updateOrder(id, companyId, data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteOrder(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const convertToInvoice = useCallback(async (orderId: string) => {
    const result = await purchasesApi.convertOrderToInvoice(orderId, companyId, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  return {
    orders: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    remove,
    convertToInvoice,
    reload: reloadList,
  };
}

export interface PurchaseReturnFilters {
  status?: string;
  supplierId?: string;
}

export function usePurchaseReturnsPaginated(companyId: string, filters?: PurchaseReturnFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<PurchaseReturn>(
    (page, pageSize) => purchasesApi.getReturnsPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, filters?.supplierId]
  );

  const create = useCallback(async (data: Omit<PurchaseReturn, 'id'>) => {
    const result = await purchasesApi.createReturn(data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<PurchaseReturn>) => {
    const result = await purchasesApi.updateReturn(id, companyId, data, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const result = await purchasesApi.deleteReturn(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const post = useCallback(async (id: string) => {
    const result = await purchasesApi.postReturn(id, companyId, user?.id);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId, user?.id]);

  return {
    returns: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    remove,
    post,
    reload: reloadList,
  };
}
