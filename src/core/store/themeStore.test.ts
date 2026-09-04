import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './index';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from '@/core/theme/themes';

describe('useAppStore themes', () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: 'light',
      themeId: DEFAULT_LIGHT_THEME_ID,
      customThemes: [],
    });
  });

  it('defaults to the emerald light identity theme', () => {
    expect(useAppStore.getState().themeId).toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it('setThemeId activates a built-in theme and syncs mode', () => {
    useAppStore.getState().setThemeId(DEFAULT_DARK_THEME_ID);
    expect(useAppStore.getState().themeId).toBe(DEFAULT_DARK_THEME_ID);
    expect(useAppStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setTheme keeps themeId in sync for backward compat', () => {
    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().themeId).toBe(DEFAULT_DARK_THEME_ID);
    useAppStore.getState().setTheme('light');
    expect(useAppStore.getState().themeId).toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it('addCustomTheme persists and activates the custom theme', () => {
    useAppStore.getState().addCustomTheme({
      id: 'custom-1',
      nameAr: 'شركتي',
      nameEn: 'My Co',
      mode: 'light',
      primary: '#123456',
      accent: '#654321',
      background: '#ffffff',
      surface: '#f5f5f5',
      sidebarBg: '#ffffff',
      headerBg: '#ffffff',
      navText: '#52525b',
      navActive: '#123456',
      navIcon: '#71717a',
      font: 'cairo',
    });
    const state = useAppStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.themeId).toBe('custom-1');
  });

  it('updateCustomTheme patches fields and keeps id stable', () => {
    useAppStore.getState().addCustomTheme({
      id: 'custom-1',
      nameAr: 'شركتي',
      nameEn: 'My Co',
      mode: 'light',
      primary: '#123456',
      accent: '#654321',
      background: '#ffffff',
      surface: '#f5f5f5',
      sidebarBg: '#ffffff',
      headerBg: '#ffffff',
      navText: '#52525b',
      navActive: '#123456',
      navIcon: '#71717a',
      font: 'cairo',
    });
    useAppStore.getState().updateCustomTheme('custom-1', { primary: '#0b7a5e' });
    expect(useAppStore.getState().customThemes[0].primary).toBe('#0b7a5e');
    expect(useAppStore.getState().customThemes[0].id).toBe('custom-1');
  });

  it('deleteCustomTheme falls back to a built-in theme when active', () => {
    useAppStore.getState().addCustomTheme({
      id: 'custom-1',
      nameAr: 'شركتي',
      nameEn: 'My Co',
      mode: 'light',
      primary: '#123456',
      accent: '#654321',
      background: '#ffffff',
      surface: '#f5f5f5',
      sidebarBg: '#ffffff',
      headerBg: '#ffffff',
      navText: '#52525b',
      navActive: '#123456',
      navIcon: '#71717a',
      font: 'cairo',
    });
    useAppStore.getState().deleteCustomTheme('custom-1');
    const state = useAppStore.getState();
    expect(state.customThemes).toHaveLength(0);
    expect(state.themeId).toBe(DEFAULT_LIGHT_THEME_ID);
  });
});
