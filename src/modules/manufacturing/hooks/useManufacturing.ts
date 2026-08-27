import { useState, useEffect, useCallback } from 'react';
import { manufacturingApi } from '../api';
import { usePaginatedList } from '@/core/hooks/usePaginatedList';
import type { BOM, WorkOrder, WorkOrderLine, WorkOrderVariance } from '../types';

// Global refresh signal for manufacturing — any write bumps the counter so
// ALL manufacturing hooks (paginated or not, on any page) reload.
let manufacturingVersion = 0;
const manufacturingListeners = new Set<() => void>();
function bumpManufacturingVersion() {
  manufacturingVersion++;
  manufacturingListeners.forEach((cb) => cb());
}
function useManufacturingVersion() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const cb = () => setTick((v) => v + 1);
    manufacturingListeners.add(cb);
    return () => { manufacturingListeners.delete(cb); };
  }, []);
  return manufacturingVersion;
}

export function useBoms(companyId: string) {
  const [boms, setBoms] = useState<BOM[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const version = useManufacturingVersion();

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const res = await manufacturingApi.getBoms(companyId);
      if (res.success && res.data) setBoms(res.data);
      setIsLoading(false);
    }
    load();
  }, [companyId, version]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const res = await manufacturingApi.getBoms(companyId);
    if (res.success && res.data) setBoms(res.data);
    setIsLoading(false);
  }, [companyId]);

  const create = useCallback(async (data: Omit<BOM, 'id'> & { lines: { materialId: string; quantity: number; unitCost?: number }[] }) => {
    const res = await manufacturingApi.createBom(data);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh]);

  const update = useCallback(async (id: string, data: Partial<Omit<BOM, 'id' | 'companyId'>> & { lines?: Partial<{ materialId: string; quantity: number; unitCost?: number }>[] }) => {
    const res = await manufacturingApi.updateBom(id, companyId, undefined, data);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh, companyId]);

  const remove = useCallback(async (id: string) => {
    const res = await manufacturingApi.deleteBom(id, companyId);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh, companyId]);

  return { boms, isLoading, refresh, create, update, remove };
}

export function useWorkOrders(companyId: string) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const version = useManufacturingVersion();

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const res = await manufacturingApi.getWorkOrders(companyId);
      if (res.success && res.data) setWorkOrders(res.data);
      setIsLoading(false);
    }
    load();
  }, [companyId, version]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const res = await manufacturingApi.getWorkOrders(companyId);
    if (res.success && res.data) setWorkOrders(res.data);
    setIsLoading(false);
  }, [companyId]);

  const create = useCallback(async (data: Omit<WorkOrder, 'id'> & { lines: { materialId: string; plannedQuantity: number; unitCost: number }[] }) => {
    const res = await manufacturingApi.createWorkOrder(data);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh]);

  const update = useCallback(async (id: string, data: Partial<Omit<WorkOrder, 'id' | 'companyId'>> & { lines?: Partial<WorkOrderLine>[] }) => {
    const res = await manufacturingApi.updateWorkOrder(id, companyId, undefined, data);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh, companyId]);

  const remove = useCallback(async (id: string) => {
    const res = await manufacturingApi.deleteWorkOrder(id, companyId);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh, companyId]);

  const changeStatus = useCallback(async (id: string, status: WorkOrder['status'], producedQuantity?: number, outputWarehouseId?: string, opts?: { returnMaterials?: boolean }) => {
    const res = await manufacturingApi.updateWorkOrderStatus(id, companyId, status, undefined, producedQuantity, outputWarehouseId, opts);
    if (res.success) { bumpManufacturingVersion(); await refresh(); }
    return res;
  }, [refresh, companyId]);

  return { workOrders, isLoading, refresh, create, update, remove, changeStatus };
}

export function useWorkOrderVariance(workOrderId: string, companyId: string) {
  const [variances, setVariances] = useState<WorkOrderVariance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!workOrderId || !companyId) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const res = await manufacturingApi.getWorkOrderById(workOrderId, companyId);
      if (cancelled) return;
      if (res.success && res.data) {
        const lines = res.data.lines;
        const mapped = lines.map((l) => {
          const plannedQty = l.plannedQuantity || 0;
          const actualQty = l.actualQuantity || 0;
          const plannedCost = plannedQty * (l.unitCost || 0);
          const actualCost = actualQty * (l.actualUnitCost || l.unitCost || 0);
          return {
            materialName: l.materialName || l.materialId,
            plannedQty,
            actualQty,
            varianceQty: actualQty - plannedQty,
            plannedCost,
            actualCost,
            varianceCost: actualCost - plannedCost,
          };
        });
        setVariances(mapped);
      }
      setIsLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [workOrderId, companyId]);

  return { variances, isLoading };
}

// ─── Paginated Hooks ──────────────────────────────────────────────────────────

export interface BomsFilters {
  search?: string;
  isActive?: boolean;
}

export function useBomsPaginated(companyId: string, filters?: BomsFilters) {
  const version = useManufacturingVersion();
  const { reload: reloadList, ...list } = usePaginatedList<BOM>(
    (page, pageSize) => manufacturingApi.getBomsPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.search, filters?.isActive, version]
  );

  const create = useCallback(async (data: Omit<BOM, 'id'> & { lines: { materialId: string; quantity: number; unitCost?: number }[] }) => {
    const res = await manufacturingApi.createBom(data);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<Omit<BOM, 'id' | 'companyId'>> & { lines?: Partial<{ materialId: string; quantity: number; unitCost?: number }>[] }) => {
    const res = await manufacturingApi.updateBom(id, companyId, undefined, data);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [companyId, reloadList]);

  const remove = useCallback(async (id: string) => {
    const res = await manufacturingApi.deleteBom(id, companyId);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [companyId, reloadList]);

  return { ...list, create, update, remove };
}

export interface WorkOrdersFilters {
  status?: string;
}

export function useWorkOrdersPaginated(companyId: string, filters?: WorkOrdersFilters) {
  const version = useManufacturingVersion();
  const { reload: reloadList, ...list } = usePaginatedList<WorkOrder>(
    (page, pageSize) => manufacturingApi.getWorkOrdersPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, version]
  );

  const create = useCallback(async (data: Omit<WorkOrder, 'id'> & { lines: { materialId: string; plannedQuantity: number; unitCost: number }[] }) => {
    const res = await manufacturingApi.createWorkOrder(data);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [reloadList]);

  const update = useCallback(async (id: string, data: Partial<Omit<WorkOrder, 'id' | 'companyId'>> & { lines?: Partial<WorkOrderLine>[] }) => {
    const res = await manufacturingApi.updateWorkOrder(id, companyId, undefined, data);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [companyId, reloadList]);

  const remove = useCallback(async (id: string) => {
    const res = await manufacturingApi.deleteWorkOrder(id, companyId);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [companyId, reloadList]);

  const changeStatus = useCallback(async (id: string, status: WorkOrder['status'], producedQuantity?: number, outputWarehouseId?: string, opts?: { returnMaterials?: boolean }) => {
    const res = await manufacturingApi.updateWorkOrderStatus(id, companyId, status, undefined, producedQuantity, outputWarehouseId, opts);
    if (res.success) { bumpManufacturingVersion(); await reloadList(); }
    return res;
  }, [companyId, reloadList]);

  return { ...list, create, update, remove, changeStatus };
}
