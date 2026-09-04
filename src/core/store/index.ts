import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  BUILT_IN_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  applyThemeDefinition,
  findTheme,
  type ThemeDefinition,
} from '@/core/theme/themes';

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

export type { ThemeDefinition };

interface AppState {
  // UI State
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  /** Active theme definition id (built-in or custom). */
  themeId: string;
  /** User-created themes (persisted). */
  customThemes: ThemeDefinition[];
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
  setThemeId: (id: string) => void;
  addCustomTheme: (def: ThemeDefinition) => void;
  updateCustomTheme: (id: string, patch: Partial<ThemeDefinition>) => void;
  deleteCustomTheme: (id: string) => void;
  setLanguage: (language: 'ar' | 'en') => void;
  setActiveCompany: (name: string, id: string, currency: string, extra?: Partial<Company>) => void;
  setSelectedBranchId: (id: string | null) => void;
  setDbStatus: (status: 'connecting' | 'postgresql' | 'error', connected: boolean) => void;
}

function applyTheme(theme: 'light' | 'dark') {
  const id = theme === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  const def = BUILT_IN_THEMES.find((t) => t.id === id) ?? BUILT_IN_THEMES[0];
  applyThemeDefinition(def);
}

function applyStoredTheme(
  themeId: string | undefined,
  theme: 'light' | 'dark' | undefined,
  customThemes: ThemeDefinition[] | undefined,
) {
  const customs = Array.isArray(customThemes) ? customThemes : [];
  if (themeId) {
    applyThemeDefinition(findTheme(themeId, customs));
    return;
  }
  applyTheme(theme === 'dark' ? 'dark' : 'light');
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
  if (saved.themeId || saved.theme)
    applyStoredTheme(saved.themeId, saved.theme, saved.customThemes);
  if (saved.language) applyLanguage(saved.language);
} else {
  applyTheme('light');
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      theme: 'light',
      themeId: DEFAULT_LIGHT_THEME_ID,
      customThemes: [],
      language: 'ar',
      activeCompany: null,
      selectedBranchId: null,
      dbStatus: 'connecting',
      dbConnected: false,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setTheme: (theme) => {
        applyTheme(theme);
        set({
          theme,
          themeId: theme === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID,
        });
      },

      toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
        return {
          theme: newTheme,
          themeId: newTheme === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID,
        };
      }),

      setThemeId: (id) => {
        const def = findTheme(id, get().customThemes);
        applyThemeDefinition(def);
        set({ themeId: def.id, theme: def.mode });
      },

      addCustomTheme: (def) => {
        applyThemeDefinition(def);
        set((state) => ({
          customThemes: [...state.customThemes, def],
          themeId: def.id,
          theme: def.mode,
        }));
      },

      updateCustomTheme: (id, patch) => {
        const state = get();
        const customThemes = state.customThemes.map((t) =>
          t.id === id ? { ...t, ...patch, id } : t,
        );
        const active = customThemes.find((t) => t.id === id);
        if (active && state.themeId === id) applyThemeDefinition(active);
        set({ customThemes });
      },

      deleteCustomTheme: (id) => {
        const state = get();
        const customThemes = state.customThemes.filter((t) => t.id !== id);
        if (state.themeId === id) {
          const fallback =
            BUILT_IN_THEMES.find((t) => t.mode === state.theme) ?? BUILT_IN_THEMES[0];
          applyThemeDefinition(fallback);
          set({ customThemes, themeId: fallback.id, theme: fallback.mode });
        } else {
          set({ customThemes });
        }
      },
      
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
        themeId: state.themeId,
        customThemes: state.customThemes,
        language: state.language,
        sidebarOpen: state.sidebarOpen,
      } as AppState),
    }
  )
);
