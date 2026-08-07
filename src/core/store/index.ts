import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Company {
  id: string;
  name: string;
  currency: string;
  nameEn?: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  stampUrl?: string;
  fiscalYearStart?: string;
  dateFormat?: string;
  decimalPlaces?: number;
  calendar?: 'gregorian' | 'hijri';
}

interface AppState {
  // UI State
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  language: 'ar' | 'en';
  
  // Company State
  activeCompany: Company | null;
  selectedBranchId: string | null;
  
  // Database State
  dbStatus: 'connecting' | 'postgresql' | 'error';
  dbConnected: boolean;

  // Actions
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setLanguage: (language: 'ar' | 'en') => void;
  setActiveCompany: (name: string, id: string, currency: string, extra?: Partial<Company>) => void;
  setSelectedBranchId: (id: string | null) => void;
  setDbStatus: (status: 'connecting' | 'postgresql' | 'error', connected: boolean) => void;
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
}

function applyLanguage(language: 'ar' | 'en') {
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = language === 'ar' ? 'ar' : 'en';
}

// Apply saved theme/language on module load
const saved = (() => {
  try {
    const raw = localStorage.getItem('maghzaccount-app');
    if (raw) return JSON.parse(raw).state;
  } catch {}
  return null;
})();
if (saved) {
  if (saved.theme) applyTheme(saved.theme);
  if (saved.language) applyLanguage(saved.language);
} else {
  applyTheme('light');
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: 'light',
      language: 'ar',
      activeCompany: null,
      selectedBranchId: null,
      dbStatus: 'connecting',
      dbConnected: false,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      
      toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
        return { theme: newTheme };
      }),
      
      setLanguage: (language) => {
        applyLanguage(language);
        set({ language });
      },
      
      setActiveCompany: (name, id, currency, extra) => set({
        activeCompany: { name, id, currency, ...extra },
      }),
      
      setSelectedBranchId: (id) => set({ selectedBranchId: id }),
      
      setDbStatus: (status, connected) => set({ dbStatus: status, dbConnected: connected }),
    }),
    {
      name: 'maghzaccount-app',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
