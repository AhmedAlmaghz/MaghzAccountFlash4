import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DbConfig {
  type: 'pg';
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}

export interface CompanyConfig {
  name: string;
  nameEn: string;
  currency: string;
  taxNumber: string;
  address: string;
  phone: string;
  email: string;
  calendar?: 'gregorian' | 'hijri';
  decimalPlaces?: number;
  dateFormat?: string;
  fiscalYearStart?: string;
}

export type SeedOption = 'none' | 'default' | 'demo';

interface OnboardingState {
  completed: boolean;
  currentStep: number;
  dbConfig: DbConfig;
  companyConfig: CompanyConfig;
  seedOption: SeedOption;
  adminPassword: string;
  isProcessing: boolean;
  processingMessage: string;
  error: string | null;

  // Actions
  setCompleted: (completed: boolean) => void;
  setCurrentStep: (step: number) => void;
  setDbConfig: (config: Partial<DbConfig>) => void;
  setCompanyConfig: (config: Partial<CompanyConfig>) => void;
  setSeedOption: (option: SeedOption) => void;
  setAdminPassword: (password: string) => void;
  setProcessing: (processing: boolean, message?: string) => void;
  setError: (error: string | null) => void;
  clearPassword: () => void;
  reset: () => void;
}

const defaultDbConfig: DbConfig = {
  type: 'pg',
  host: 'localhost',
  port: '5432',
  database: 'MaghzAccountFlash35',
  user: 'maghz',
  password: '',
};

const defaultCompanyConfig: CompanyConfig = {
  name: 'شركة المغزى للتجارة والصناعة',
  nameEn: 'Maghz Trading & Industry Co.',
  currency: 'YER',
  taxNumber: '3100123456',
  address: 'صنعاء - شارع الستين - عمارة التجارة الدولية',
  phone: '+96714444888',
  email: 'info@maghzaccount.com',
  calendar: 'gregorian',
  decimalPlaces: 2,
  dateFormat: 'yyyy-MM-dd',
  fiscalYearStart: new Date().getFullYear() + '-01-01',
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      currentStep: 0,
      dbConfig: { ...defaultDbConfig },
      companyConfig: { ...defaultCompanyConfig },
      seedOption: 'default',
      adminPassword: '',
      isProcessing: false,
      processingMessage: '',
      error: null,

      setCompleted: (completed) => set({ completed }),
      setCurrentStep: (currentStep) => set({ currentStep }),
      setDbConfig: (config) => set((state) => ({ dbConfig: { ...state.dbConfig, ...config } })),
      setCompanyConfig: (config) => set((state) => ({ companyConfig: { ...state.companyConfig, ...config } })),
      setSeedOption: (seedOption) => set({ seedOption }),
      setAdminPassword: (adminPassword) => set({ adminPassword }),
      setProcessing: (isProcessing, processingMessage = '') => set({ isProcessing, processingMessage }),
    setError: (error) => set({ error }),
    clearPassword: () => set((state) => ({ dbConfig: { ...state.dbConfig, password: '' } })),
    reset: () => set({
        completed: false,
        currentStep: 0,
        dbConfig: { ...defaultDbConfig },
        companyConfig: { ...defaultCompanyConfig },
        seedOption: 'default',
        adminPassword: '',
        isProcessing: false,
        processingMessage: '',
        error: null,
      }),
    }),
    {
      name: 'maghzaccount-onboarding',
      partialize: (state) => {
        const { dbConfig, adminPassword: _ap, ...rest } = state;
        const { password: _pw, ...safeDbConfig } = dbConfig;
        return { ...rest, dbConfig: safeDbConfig };
      },
    }
  )
);
