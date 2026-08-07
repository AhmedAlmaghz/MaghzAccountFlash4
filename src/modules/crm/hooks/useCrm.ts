import { useState, useEffect, useCallback } from 'react';
import { crmApi } from '../api';
import { usePaginatedList } from '@/core/hooks/usePaginatedList';
import { useAuthStore } from '@/modules/auth/store';
import type { Lead, Opportunity, Task, Activity } from '../types';

export function useLeads(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const res = await crmApi.getLeads(companyId);
      if (res.success && res.data) setLeads(res.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const res = await crmApi.getLeads(companyId);
    if (res.success && res.data) setLeads(res.data);
    setIsLoading(false);
  }, [companyId]);

  const create = useCallback(async (data: Omit<Lead, 'id' | 'createdAt'>) => {
    const res = await crmApi.createLead(data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Lead, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateLead(id, companyId, data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteLead(id, companyId);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId]);

  const convertToCustomer = useCallback(async (id: string, customerData: Record<string, unknown>) => {
    const res = await crmApi.convertLeadToCustomer(id, companyId, customerData, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId, user?.id]);

  return { leads, isLoading, refresh, create, update, remove, convertToCustomer };
}

export function useOpportunities(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const res = await crmApi.getOpportunities(companyId);
      if (res.success && res.data) setOpportunities(res.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const res = await crmApi.getOpportunities(companyId);
    if (res.success && res.data) setOpportunities(res.data);
    setIsLoading(false);
  }, [companyId]);

  const create = useCallback(async (data: Omit<Opportunity, 'id' | 'createdAt'>) => {
    const res = await crmApi.createOpportunity(data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Opportunity, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateOpportunity(id, companyId, data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteOpportunity(id, companyId);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId]);

  return { opportunities, isLoading, refresh, create, update, remove };
}

export function useTasks(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const res = await crmApi.getTasks(companyId);
      if (res.success && res.data) setTasks(res.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const res = await crmApi.getTasks(companyId);
    if (res.success && res.data) setTasks(res.data);
    setIsLoading(false);
  }, [companyId]);

  const create = useCallback(async (data: Omit<Task, 'id' | 'createdAt'>) => {
    const res = await crmApi.createTask(data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Task, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateTask(id, companyId, data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteTask(id, companyId);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId]);

  return { tasks, isLoading, refresh, create, update, remove };
}

export function useActivities(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const res = await crmApi.getActivities(companyId);
      if (res.success && res.data) setActivities(res.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    const res = await crmApi.getActivities(companyId);
    if (res.success && res.data) setActivities(res.data);
    setIsLoading(false);
  }, [companyId]);

  const create = useCallback(async (data: Omit<Activity, 'id' | 'createdAt'>) => {
    const res = await crmApi.createActivity(data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Activity, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateActivity(id, companyId, data, user?.id);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteActivity(id, companyId);
    if (res.success) await refresh();
    return res;
  }, [refresh, companyId]);

  return { activities, isLoading, refresh, create, update, remove };
}

export interface LeadFilters {
  status?: string;
  assignedTo?: string;
  search?: string;
}

export function useLeadsPaginated(companyId: string, filters?: LeadFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<Lead>(
    (page, pageSize) => crmApi.getLeadsPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, filters?.assignedTo, filters?.search]
  );

  const create = useCallback(async (data: Omit<Lead, 'id' | 'createdAt'>) => {
    const res = await crmApi.createLead(data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Lead, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateLead(id, companyId, data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteLead(id, companyId);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId]);

  const convertToCustomer = useCallback(async (id: string, customerData: Record<string, unknown>) => {
    const res = await crmApi.convertLeadToCustomer(id, companyId, customerData, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId, user?.id]);

  return {
    leads: list.items,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    isLoading: list.isLoading,
    goToPage: list.goToPage,
    changePageSize: list.changePageSize,
    create,
    update,
    remove,
    convertToCustomer,
    reload: reloadList,
  };
}

export interface OpportunityFilters {
  stage?: string;
  assignedTo?: string;
  search?: string;
}

export function useOpportunitiesPaginated(companyId: string, filters?: OpportunityFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<Opportunity>(
    (page, pageSize) => crmApi.getOpportunitiesPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.stage, filters?.assignedTo, filters?.search]
  );

  const create = useCallback(async (data: Omit<Opportunity, 'id' | 'createdAt'>) => {
    const res = await crmApi.createOpportunity(data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Opportunity, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateOpportunity(id, companyId, data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteOpportunity(id, companyId);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId]);

  return {
    opportunities: list.items,
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

export interface TaskFilters {
  status?: string;
  priority?: string;
  search?: string;
}

export function useTasksPaginated(companyId: string, filters?: TaskFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<Task>(
    (page, pageSize) => crmApi.getTasksPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.status, filters?.priority, filters?.search]
  );

  const create = useCallback(async (data: Omit<Task, 'id' | 'createdAt'>) => {
    const res = await crmApi.createTask(data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Task, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateTask(id, companyId, data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteTask(id, companyId);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId]);

  return {
    tasks: list.items,
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

export interface ActivityFilters {
  type?: string;
  assignedTo?: string;
}

export function useActivitiesPaginated(companyId: string, filters?: ActivityFilters) {
  const user = useAuthStore((s) => s.user);
  const { reload: reloadList, ...list } = usePaginatedList<Activity>(
    (page, pageSize) => crmApi.getActivitiesPaginated(companyId, page, pageSize, filters),
    [companyId, filters?.type, filters?.assignedTo]
  );

  const create = useCallback(async (data: Omit<Activity, 'id' | 'createdAt'>) => {
    const res = await crmApi.createActivity(data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, user?.id]);

  const update = useCallback(async (id: string, data: Partial<Omit<Activity, 'id' | 'companyId'>>) => {
    const res = await crmApi.updateActivity(id, companyId, data, user?.id);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId, user?.id]);

  const remove = useCallback(async (id: string) => {
    const res = await crmApi.deleteActivity(id, companyId);
    if (res.success) await reloadList();
    return res;
  }, [reloadList, companyId]);

  return {
    activities: list.items,
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
