import { useState, useEffect, useCallback } from 'react';
import * as settingsApi from '../api';
import type { DocumentSequence, ProductType, Unit, CashBox, Bank, CostCenter, PayrollComponent, DefaultAccount } from '../types';

// ─── Document Sequences ───────────────────────────────────────────────────────
export function useDocumentSequences(companyId: string) {
  const [sequences, setSequences] = useState<DocumentSequence[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getDocumentSequences(companyId);
      if (result.success && result.data) setSequences(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const update = useCallback(async (id: string, data: Partial<DocumentSequence>) => {
    const result = await settingsApi.updateDocumentSequence(id, data, companyId);
    if (result.success) {
      setSequences(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
    }
    return result;
  }, [companyId]);

  const getNextNumber = useCallback(async (documentType: string) => {
    return settingsApi.getNextDocumentNumber(companyId, documentType);
  }, [companyId]);

  const peekNextNumber = useCallback(async (documentType: string) => {
    return settingsApi.peekNextDocumentNumber(companyId, documentType);
  }, [companyId]);

  return { sequences, isLoading, update, getNextNumber, peekNextNumber };
}

// ─── Product Types ────────────────────────────────────────────────────────────
export function useProductTypes(companyId: string): {
  types: ProductType[];
  isLoading: boolean;
  create: (data: Omit<ProductType, 'id'>) => Promise<{ success: boolean; id?: string; error?: string }>;
  update: (id: string, data: Partial<ProductType>) => Promise<{ success: boolean; error?: string }>;
  remove: (id: string) => Promise<{ success: boolean; error?: string }>;
} {
  const [types, setTypes] = useState<ProductType[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getProductTypes(companyId);
      if (result.success && result.data) setTypes(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<ProductType, 'id'>) => {
    const result = await settingsApi.createProductType(data);
    if (result.success && result.id) setTypes(prev => [...prev, { ...data, id: result.id! }]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<ProductType>) => {
    const result = await settingsApi.updateProductType(id, data, companyId);
    if (result.success) setTypes(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await settingsApi.deleteProductType(id, companyId);
    if (result.success) setTypes(prev => prev.filter(t => t.id !== id));
    return result;
  }, [companyId]);

  return { types, isLoading, create, update, remove };
}

// ─── Units
export function useUnits(companyId: string) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getUnits(companyId);
      if (result.success && result.data) setUnits(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Unit, 'id'>) => {
    const result = await settingsApi.createUnit(data);
    if (result.success && result.id) setUnits(prev => [...prev, { ...data, id: result.id! }]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Unit>) => {
    const result = await settingsApi.updateUnit(id, data, companyId);
    if (result.success) setUnits(prev => prev.map(u => u.id === id ? { ...u, ...data } : u));
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await settingsApi.deleteUnit(id, companyId);
    if (result.success) setUnits(prev => prev.filter(u => u.id !== id));
    return result;
  }, [companyId]);

  return { units, isLoading, create, update, remove };
}

// ─── Cash Boxes ───────────────────────────────────────────────────────────────
export function useCashBoxes(companyId: string) {
  const [boxes, setBoxes] = useState<CashBox[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getCashBoxes(companyId);
      if (result.success && result.data) setBoxes(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<CashBox, 'id'>) => {
    const result = await settingsApi.createCashBox(data);
    if (result.success && result.id) setBoxes(prev => [...prev, { ...data, id: result.id! }]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<CashBox>) => {
    const result = await settingsApi.updateCashBox(id, data, companyId);
    if (result.success) setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await settingsApi.deleteCashBox(id, companyId);
    if (result.success) setBoxes(prev => prev.filter(b => b.id !== id));
    return result;
  }, [companyId]);

  return { boxes, isLoading, create, update, remove };
}

// ─── Banks ────────────────────────────────────────────────────────────────────
export function useBanks(companyId: string) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getBanks(companyId);
      if (result.success && result.data) setBanks(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<Bank, 'id'>) => {
    const result = await settingsApi.createBank(data);
    if (result.success && result.id) setBanks(prev => [...prev, { ...data, id: result.id! }]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<Bank>) => {
    const result = await settingsApi.updateBank(id, data, companyId);
    if (result.success) setBanks(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await settingsApi.deleteBank(id, companyId);
    if (result.success) setBanks(prev => prev.filter(b => b.id !== id));
    return result;
  }, [companyId]);

  return { banks, isLoading, create, update, remove };
}

// ─── Cost Centers ─────────────────────────────────────────────────────────────
export function useCostCenters(companyId: string) {
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getCostCenters(companyId);
      if (result.success && result.data) setCenters(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<CostCenter, 'id'>) => {
    const result = await settingsApi.createCostCenter(data);
    if (result.success && result.id) setCenters(prev => [...prev, { ...data, id: result.id! }]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<CostCenter>) => {
    const result = await settingsApi.updateCostCenter(id, data, companyId);
    if (result.success) setCenters(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    return result;
  }, [companyId]);

  const remove = useCallback(async (id: string) => {
    const result = await settingsApi.deleteCostCenter(id, companyId);
    if (result.success) setCenters(prev => prev.filter(c => c.id !== id));
    return result;
  }, [companyId]);

  return { centers, isLoading, create, update, remove };
}

// ─── Payroll Components ───────────────────────────────────────────────────────
export function usePayrollComponents(companyId: string) {
  const [components, setComponents] = useState<PayrollComponent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getPayrollComponents(companyId);
      if (result.success && result.data) setComponents(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const create = useCallback(async (data: Omit<PayrollComponent, 'id'>) => {
    const result = await settingsApi.createPayrollComponent(data);
    if (result.success && result.id) setComponents(prev => [...prev, { ...data, id: result.id! }]);
    return result;
  }, []);

  const update = useCallback(async (id: string, data: Partial<PayrollComponent>) => {
    const result = await settingsApi.updatePayrollComponent(id, data, companyId);
    if (result.success) setComponents(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    return result;
  }, [companyId]);

  return { components, isLoading, create, update };
}

// ─── Default Accounts ─────────────────────────────────────────────────────────
export function useDefaultAccounts(companyId: string) {
  const [accounts, setAccounts] = useState<DefaultAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    async function load() {
      setIsLoading(true);
      const result = await settingsApi.getDefaultAccounts(companyId);
      if (result.success && result.data) setAccounts(result.data);
      setIsLoading(false);
    }
    load();
  }, [companyId]);

  const update = useCallback(async (id: string, accountId: string | null) => {
    const result = await settingsApi.updateDefaultAccount(id, accountId, companyId);
    if (result.success) setAccounts(prev => prev.map(a => a.id === id ? { ...a, accountId } : a));
    return result;
  }, [companyId]);

  const applyTemplate = useCallback(async (template: 'trading' | 'manufacturing' | 'services') => {
    const result = await settingsApi.applyDefaultTemplate(companyId, template);
    if (result.success) {
      // Reload
      const reload = await settingsApi.getDefaultAccounts(companyId);
      if (reload.success && reload.data) setAccounts(reload.data);
    }
    return result;
  }, [companyId]);

  return { accounts, isLoading, update, applyTemplate };
}
