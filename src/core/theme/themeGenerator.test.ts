import { describe, it, expect } from 'vitest';
import {
  THEME_STYLE_PRESETS,
  deriveAccent,
  generateTheme,
} from './themeGenerator';
import { isValidHex, withThemeDefaults } from './themes';

describe('themeGenerator', () => {
  it('derives a valid hex accent from any primary', () => {
    expect(isValidHex(deriveAccent('#0B7A5E'))).toBe(true);
    expect(isValidHex(deriveAccent('#fff'))).toBe(true);
    expect(deriveAccent('#0B7A5E')).not.toBe('#0b7a5e');
  });

  it('generates a complete light theme from a primary', () => {
    const def = generateTheme({ nameAr: 'اختبار', primary: '#0E7490', mode: 'light' });
    expect(def.id).toMatch(/^custom-/);
    expect(def.mode).toBe('light');
    expect(def.primary).toBe('#0e7490');
    expect(isValidHex(def.accent)).toBe(true);
    expect(def.surface).toBe('#ffffff');
    expect(def.navActive).toBe('#0e7490');
    expect(def.font).toBe('cairo');
    // withThemeDefaults contract: every token present
    expect(withThemeDefaults(def)).toEqual(def);
  });

  it('generates a dark theme with deep background and lightened active', () => {
    const def = generateTheme({ primary: '#6D28D9', mode: 'dark' });
    expect(def.mode).toBe('dark');
    expect(def.background).not.toBe('#ffffff');
    expect(def.navText).toBe('#D4D4D8');
    expect(isValidHex(def.background)).toBe(true);
    expect(isValidHex(def.surface)).toBe(true);
    expect(isValidHex(def.navActive)).toBe(true);
  });

  it('falls back to emerald on invalid primary and honors style presets', () => {
    const bad = generateTheme({ primary: 'not-a-color' });
    expect(bad.primary).toBe('#0b7a5e');
    const ocean = generateTheme({ style: 'ocean', mode: 'dark' });
    expect(ocean.primary).toBe(THEME_STYLE_PRESETS.ocean.primary.toLowerCase());
    expect(ocean.nameAr).toBe('محيطي');
  });

  it('is deterministic for the same input (except id)', () => {
    const a = generateTheme({ primary: '#BE123C', mode: 'light', nameAr: 'X' });
    const b = generateTheme({ primary: '#BE123C', mode: 'light', nameAr: 'X' });
    const { id: _a, ...ra } = a;
    const { id: _b, ...rb } = b;
    void _a; void _b;
    expect(ra).toEqual(rb);
  });
});
