import { useState, useEffect, useCallback } from 'react';
import { inventoryApi } from '../api';
import { usePaginatedList } from '@/core/hooks/usePaginatedList';
import type { Product, Warehouse, Stock, StockItem, StockTransfer, InventoryTransaction, StockAdjustment, ProductCategory } from '../types';

export function useProducts(companyId: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await inventoryApi.getProducts(companyId);
      if (result.success && result.data) {
        setProducts(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Product, 'id'>) => {
    const result = await inventoryApi.createProduct(data);
    if (result.success && result.id) {
      setProducts(prev => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Product>) => {
    const result = await inventoryApi.updateProduct(id, companyId, undefined, data);
    if (result.success) {
      setProducts(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteProduct(id, companyId);
    if (result.success) {
      setProducts(prev => prev.filter(p => p.id !== id));
    }
    return result;
  }, [companyId]);

  return { products, isLoading, create, update, remove };
}

export function useWarehouses(companyId: string) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await inventoryApi.getWarehouses(companyId);
      if (result.success && result.data) {
        setWarehouses(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Warehouse, 'id'>) => {
    const result = await inventoryApi.createWarehouse(data);
    if (result.success && result.id) {
      setWarehouses(prev => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Warehouse>) => {
    const result = await inventoryApi.updateWarehouse(id, companyId, data);
    if (result.success) {
      setWarehouses(prev => prev.map(w => w.id === id ? { ...w, ...data } : w));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteWarehouse(id, companyId);
    if (result.success) {
      setWarehouses(prev => prev.filter(w => w.id !== id));
    }
    return result;
  }, [companyId]);

  return { warehouses, isLoading, create, update, remove };
}

export function useStock(companyId: string) {
  const [stock, setStock] = useState<Stock[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await inventoryApi.getStock(companyId);
      if (result.success && result.data) {
        setStock(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  return { stock, isLoading };
}

export function useStockDetailed(companyId: string) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await inventoryApi.getStockDetailed(companyId);
      if (result.success && result.data) {
        setStock(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  return { stock, isLoading };
}

export function useStockTransfers(companyId: string) {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const result = await inventoryApi.getStockTransfers(companyId);
    if (result.success && result.data) {
      setTransfers(result.data);
    }
    setIsLoading(false);
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(async (data: Omit<StockTransfer, 'id'> & { lines?: Array<{ productId: string; quantity: number }> }) => {
    const result = await inventoryApi.createStockTransfer(data);
    if (result.success) {
      await reload();
    }
    return result;
  }, [reload]);

  const complete = useCallback(async (id: string) => {
    const result = await inventoryApi.completeStockTransfer(id, companyId);
    if (result.success) {
      setTransfers(prev => prev.map(t => t.id === id ? { ...t, status: 'completed' } : t));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteStockTransfer(id, companyId);
    if (result.success) {
      setTransfers(prev => prev.filter(t => t.id !== id));
    }
    return result;
  }, [companyId]);

  return { transfers, isLoading, create, complete, remove, reload };
}

export function useInventoryTransactions(companyId: string) {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const result = await inventoryApi.getInventoryTransactions(companyId);
    if (result.success && result.data) {
      setTransactions(result.data);
    }
    setIsLoading(false);
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(async (data: Omit<InventoryTransaction, 'id'>) => {
    const result = await inventoryApi.createInventoryTransaction(data);
    if (result.success) {
      await reload();
    }
    return result;
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteInventoryTransaction(id, companyId);
    if (result.success) {
      setTransactions(prev => prev.filter(t => t.id !== id));
    }
    return result;
  }, [companyId]);

  return { transactions, isLoading, create, remove, reload };
}

export interface InventoryTransactionFilters {
  type?: string;
  productId?: string;
}

export function useInventoryTransactionsPaginated(companyId: string, filters?: InventoryTransactionFilters) {
  const { reload: reloadList, ...list } = usePaginatedList<InventoryTransaction>(
    (page, pageSize) => inventoryApi.getInventoryTransactionsPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.type, filters?.productId]
  );

  const create = useCallback(async (data: Omit<InventoryTransaction, 'id'>) => {
    const result = await inventoryApi.createInventoryTransaction(data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteInventoryTransaction(id, companyId);
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
    remove,
    reload: reloadList,
  };
}

export function useStockAdjustments(companyId: string) {
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const result = await inventoryApi.getStockAdjustments(companyId);
    if (result.success && result.data) {
      setAdjustments(result.data);
    }
    setIsLoading(false);
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(async (data: Omit<StockAdjustment, 'id'>) => {
    const result = await inventoryApi.createStockAdjustment(data);
    if (result.success) {
      await reload();
    }
    return result;
  }, [reload]);

  const update = useCallback(async (id: string, data: Partial<StockAdjustment>) => {
    const result = await inventoryApi.updateStockAdjustment(id, companyId, data);
    if (result.success) {
      await reload();
    }
    return result;
  }, [reload, companyId]);

  const approve = useCallback(async (id: string, approvedBy: string) => {
    const result = await inventoryApi.approveStockAdjustment(id, companyId, approvedBy);
    if (result.success) {
      setAdjustments(prev => prev.map(a => a.id === id ? { ...a, status: 'approved', approvedBy, approvedAt: new Date().toISOString() } : a));
    }
    return result;
  }, [companyId]);

  const post = useCallback(async (id: string) => {
    const result = await inventoryApi.postStockAdjustment(id, companyId);
    if (result.success) {
      setAdjustments(prev => prev.map(a => a.id === id ? { ...a, status: 'posted', postedAt: new Date().toISOString() } : a));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteStockAdjustment(id, companyId);
    if (result.success) {
      setAdjustments(prev => prev.filter(a => a.id !== id));
    }
    return result;
  }, [companyId]);

  return { adjustments, isLoading, create, update, approve, post, remove, reload };
}

export function useProductCategories(companyId: string) {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await inventoryApi.getCategories(companyId);
      if (result.success && result.data) {
        setCategories(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<ProductCategory, 'id'>) => {
    const result = await inventoryApi.createProductCategory(data);
    if (result.success && result.id) {
      setCategories(prev => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<ProductCategory>) => {
    const result = await inventoryApi.updateProductCategory(id, companyId, data);
    if (result.success) {
      setCategories(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    }
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteProductCategory(id, companyId);
    if (result.success) {
      setCategories(prev => prev.filter(c => c.id !== id));
    }
    return result;
  }, [companyId]);

  return { categories, isLoading, create, update, remove };
}

export interface ProductFilters {
  search?: string;
  isActive?: boolean;
  productTypeId?: string;
}

export function useProductsPaginated(companyId: string, filters?: ProductFilters) {
  const { reload: reloadList, ...list } = usePaginatedList<Product>(
    (page, pageSize) => inventoryApi.getProductsPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.search, filters?.isActive, filters?.productTypeId]
  );

  const create = useCallback(async (data: Omit<Product, 'id'>) => {
    const result = await inventoryApi.createProduct(data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<Product>) => {
    const result = await inventoryApi.updateProduct(id, companyId, undefined, data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteProduct(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  return {
    products: list.items,
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

export function useStockAdjustmentsPaginated(companyId: string, filters?: { status?: string }) {
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(false);

  const reloadList = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const result = await inventoryApi.getStockAdjustments(companyId);
    if (result.success && result.data) {
      const filtered = filters?.status
        ? result.data.filter(a => a.status === filters.status)
        : result.data;
      setAdjustments(filtered);
      setTotal(filtered.length);
    }
    setIsLoading(false);
  }, [companyId, filters?.status]);

  useEffect(() => {
    reloadList();
  }, [reloadList]);

  const create = useCallback(async (data: Omit<StockAdjustment, 'id'>) => {
    const result = await inventoryApi.createStockAdjustment(data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<StockAdjustment>) => {
    const result = await inventoryApi.updateStockAdjustment(id, companyId, data);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const approve = useCallback(async (id: string, approvedBy: string) => {
    const result = await inventoryApi.approveStockAdjustment(id, companyId, approvedBy);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const post = useCallback(async (id: string) => {
    const result = await inventoryApi.postStockAdjustment(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await inventoryApi.deleteStockAdjustment(id, companyId);
    if (result.success) await reloadList();
    return result;
  }, [reloadList, companyId]);

  return {
    adjustments,
    total,
    page,
    pageSize,
    isLoading,
    goToPage: setPage,
    changePageSize: setPageSize,
    create,
    update,
    approve,
    post,
    remove,
    reload: reloadList,
  };
}
