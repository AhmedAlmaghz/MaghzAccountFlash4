import { useState, useEffect, useCallback } from 'react';
import { coreApi } from '../api';
import { useAuthStore } from '@/modules/auth/store';
import type { Company, Currency, VatSetting, Branch } from '../types';

export function useCompany() {
  const user = useAuthStore((s) => s.user);
  const [company, setCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const result = await coreApi.getCompany();
      if (result.success && result.data) {
        setCompany(result.data);
      } else {
        setError(result.error || 'Failed to load company');
      }
      setIsLoading(false);
    }
    load();
  }, []);

  const update = useCallback(async (data: Partial<Company>) => {
    if (!company) return { success: false };
    const result = await coreApi.updateCompany({ ...company, ...data }, user?.id);
    if (result.success) {
      setCompany({ ...company, ...data });
    }
    return result;
  }, [company, user?.id]);

  return { company, isLoading, error, update };
}

export function useCurrencies(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await coreApi.getCurrencies(companyId);
      if (result.success && result.data) {
        setCurrencies(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Currency, 'id'>) => {
    const result = await coreApi.createCurrency(data, user?.id);
    if (result.success && result.id) {
      setCurrencies(prev => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, [user?.id]);

  const update = useCallback(async (id: string, data: Partial<Currency>) => {
    const result = await coreApi.updateCurrency(companyId, id, data, user?.id);
    if (result.success) {
      setCurrencies(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    }
    return result;
  }, [companyId, user?.id]);

  return { currencies, isLoading, create, update };
}

export function useVatSettings(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [settings, setSettings] = useState<VatSetting | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await coreApi.getVatSettings(companyId);
      if (result.success && result.data) {
        setSettings(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const update = useCallback(async (data: Partial<VatSetting>) => {
    if (!settings || !settings.id || !settings.companyId) return { success: false };
    const result = await coreApi.updateVatSettings(settings.companyId, settings.id, data, user?.id);
    if (result.success) {
      setSettings({ ...settings, ...data });
    }
    return result;
  }, [settings, user?.id]);

  return { settings, isLoading, update };
}

export function useBranches(companyId: string) {
  const user = useAuthStore((s) => s.user);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await coreApi.getBranches(companyId);
      if (result.success && result.data) {
        setBranches(result.data);
      }
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Branch, 'id'>) => {
    const result = await coreApi.createBranch(data, user?.id);
    if (result.success && result.id) {
      setBranches(prev => [...prev, { ...data, id: result.id! }]);
    }
    return result;
  }, [user?.id]);

  const update = useCallback(async (id: string, data: Partial<Branch>) => {
    const result = await coreApi.updateBranch(companyId, id, data, user?.id);
    if (result.success) {
      setBranches(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
    }
    return result;
  }, [companyId, user?.id]);

  return { branches, isLoading, create, update };
}
