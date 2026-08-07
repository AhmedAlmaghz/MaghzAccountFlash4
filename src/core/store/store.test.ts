import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './index';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarOpen: true,
      theme: 'light',
      language: 'ar',
      activeCompany: null,
      selectedBranchId: null,
      dbStatus: 'connecting',
      dbConnected: false,
    });
  });

  it('has correct initial state', () => {
    const state = useAppStore.getState();
    expect(state.sidebarOpen).toBe(true);
    expect(state.theme).toBe('light');
    expect(state.language).toBe('ar');
    expect(state.activeCompany).toBeNull();
    expect(state.selectedBranchId).toBeNull();
    expect(state.dbStatus).toBe('connecting');
    expect(state.dbConnected).toBe(false);
  });

  it('toggleSidebar toggles sidebarOpen', () => {
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(true);
  });

  it('setTheme sets theme and applies to DOM', () => {
    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('toggleTheme toggles between light and dark', () => {
    expect(useAppStore.getState().theme).toBe('light');
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('dark');
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('light');
  });

  it('setLanguage sets language and applies dir/lang to DOM', () => {
    useAppStore.getState().setLanguage('en');
    expect(useAppStore.getState().language).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('setLanguage applies RTL for Arabic', () => {
    useAppStore.getState().setLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('setActiveCompany sets company with basic fields', () => {
    useAppStore.getState().setActiveCompany('Test Co', 'c1', 'YER');
    const company = useAppStore.getState().activeCompany;
    expect(company).toEqual({ name: 'Test Co', id: 'c1', currency: 'YER' });
  });

  it('setActiveCompany sets company with extra fields', () => {
    useAppStore.getState().setActiveCompany('Test Co', 'c1', 'YER', {
      taxNumber: '123',
      address: 'Sanaa',
      calendar: 'hijri',
    });
    const company = useAppStore.getState().activeCompany;
    expect(company?.taxNumber).toBe('123');
    expect(company?.address).toBe('Sanaa');
    expect(company?.calendar).toBe('hijri');
  });

  it('setSelectedBranchId sets branch id', () => {
    useAppStore.getState().setSelectedBranchId('b1');
    expect(useAppStore.getState().selectedBranchId).toBe('b1');
  });

  it('setSelectedBranchId can set null', () => {
    useAppStore.getState().setSelectedBranchId('b1');
    useAppStore.getState().setSelectedBranchId(null);
    expect(useAppStore.getState().selectedBranchId).toBeNull();
  });

  it('setDbStatus sets status and connected flag', () => {
    useAppStore.getState().setDbStatus('postgresql', true);
    expect(useAppStore.getState().dbStatus).toBe('postgresql');
    expect(useAppStore.getState().dbConnected).toBe(true);
  });

  it('setDbStatus sets error state', () => {
    useAppStore.getState().setDbStatus('error', false);
    expect(useAppStore.getState().dbStatus).toBe('error');
    expect(useAppStore.getState().dbConnected).toBe(false);
  });
});
