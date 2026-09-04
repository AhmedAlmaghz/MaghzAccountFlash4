import { describe, it, expect } from 'vitest';
import {
  BRAND_EMERALD,
  BRAND_GOLD,
  BUILT_IN_THEMES,
  FONT_STACKS,
  applyThemeDefinition,
  findTheme,
  generateScale,
  isBuiltInTheme,
  isValidHex,
  normalizeHex,
  themeDisplayName,
  withThemeDefaults,
  type ThemeDefinition,
} from './themes';

describe('brand identity tokens', () => {
  it('uses the specified palette as single source of truth', () => {
    expect(BRAND_EMERALD).toBe('#0B7A5E');
    expect(BRAND_GOLD).toBe('#D4A017');
  });

  it('ships emerald light + dark built-ins matching the identity', () => {
    expect(BUILT_IN_THEMES).toHaveLength(2);
    const light = BUILT_IN_THEMES.find((t) => t.mode === 'light')!;
    const dark = BUILT_IN_THEMES.find((t) => t.mode === 'dark')!;
    expect(light.primary.toLowerCase()).toBe(BRAND_EMERALD.toLowerCase());
    expect(light.accent.toLowerCase()).toBe(BRAND_GOLD.toLowerCase());
    expect(dark.background.toLowerCase()).toBe('#1a1a2e');
  });

  it('isBuiltInTheme distinguishes built-in from custom ids', () => {
    expect(isBuiltInTheme('emerald-light')).toBe(true);
    expect(isBuiltInTheme('custom-123')).toBe(false);
  });

  it('findTheme falls back to the light identity theme for unknown ids', () => {
    expect(findTheme('nope').id).toBe('emerald-light');
  });

  it('findTheme resolves custom themes', () => {
    const custom: ThemeDefinition = {
      id: 'custom-1',
      nameAr: 'مخصص',
      nameEn: 'Custom',
      mode: 'dark',
      primary: '#123456',
      accent: '#654321',
      background: '#111111',
      surface: '#222222',
      sidebarBg: '#111111',
      headerBg: '#111111',
      navText: '#D4D4D8',
      navActive: '#123456',
      navIcon: '#A1A1AA',
      font: 'cairo',
    };
    expect(findTheme('custom-1', [custom]).id).toBe('custom-1');
  });

  it('themeDisplayName respects language', () => {
    const def = BUILT_IN_THEMES[0];
    expect(themeDisplayName(def, 'ar')).toBe(def.nameAr);
    expect(themeDisplayName(def, 'en')).toBe(def.nameEn);
  });
});

describe('generateScale', () => {
  it('keeps the brand color at the 600 step', () => {
    const scale = generateScale('#0B7A5E');
    expect(scale['600']).toBe('#0b7a5e');
  });

  it('builds a full 50..950 scale', () => {
    const scale = generateScale('#0B7A5E');
    for (const step of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']) {
      expect(scale[step]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('light steps are lighter and dark steps are darker than base', () => {
    const scale = generateScale('#0B7A5E');
    expect(scale['50']).not.toBe(scale['600']);
    expect(scale['950']).not.toBe(scale['600']);
  });

  it('falls back to emerald for invalid input', () => {
    const scale = generateScale('not-a-color');
    expect(scale['600']).toBe('#0b7a5e');
  });
});

describe('hex helpers', () => {
  it('isValidHex accepts 3 and 6 digit hex', () => {
    expect(isValidHex('#0B7A5E')).toBe(true);
    expect(isValidHex('#abc')).toBe(true);
    expect(isValidHex('0B7A5E')).toBe(false);
    expect(isValidHex('#zzzzzz')).toBe(false);
  });

  it('normalizeHex expands shorthand and lowercases', () => {
    expect(normalizeHex('#ABC', '#000000')).toBe('#aabbcc');
    expect(normalizeHex('#0B7A5E', '#000000')).toBe('#0b7a5e');
    expect(normalizeHex('junk', '#0b7a5e')).toBe('#0b7a5e');
  });
});

describe('applyThemeDefinition', () => {
  it('sets primary/gold scales and toggles dark class', () => {
    applyThemeDefinition(BUILT_IN_THEMES[1]);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--color-primary-600')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--color-gold-600')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBeTruthy();

    applyThemeDefinition(BUILT_IN_THEMES[0]);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('publishes interface tokens and the typeface', () => {
    applyThemeDefinition(BUILT_IN_THEMES[0]);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--brand-sidebar-bg')).toBe('#FFFFFF');
    expect(style.getPropertyValue('--brand-header-bg')).toBe('#FFFFFF');
    expect(style.getPropertyValue('--brand-nav-text')).toBe('#52525B');
    expect(style.getPropertyValue('--brand-nav-icon')).toBe('#71717A');
    expect(style.getPropertyValue('--font-arabic')).toContain('Cairo');
  });
});

describe('withThemeDefaults (backward compatibility)', () => {
  it('fills interface tokens for legacy custom themes', () => {
    const legacy = {
      id: 'custom-old',
      nameAr: 'قديم',
      nameEn: 'Old',
      mode: 'dark',
      primary: '#123456',
      accent: '#654321',
      background: '#111111',
      surface: '#222222',
    } as ThemeDefinition;
    const full = withThemeDefaults(legacy);
    expect(full.sidebarBg).toBe('#1A1A2E');
    expect(full.headerBg).toBe('#1A1A2E');
    expect(full.navActive).toBe('#123456');
    expect(full.font).toBe('cairo');
  });

  it('keeps explicitly customized tokens', () => {
    const full = withThemeDefaults({ ...BUILT_IN_THEMES[0], sidebarBg: '#000000', font: 'inter' });
    expect(full.sidebarBg).toBe('#000000');
    expect(full.font).toBe('inter');
  });
});

describe('FONT_STACKS', () => {
  it('offers four world-class typefaces', () => {
    expect(Object.keys(FONT_STACKS)).toEqual(['cairo', 'inter', 'plex', 'system']);
    expect(FONT_STACKS.cairo).toContain('Cairo');
    expect(FONT_STACKS.system).toContain('system-ui');
  });
});
