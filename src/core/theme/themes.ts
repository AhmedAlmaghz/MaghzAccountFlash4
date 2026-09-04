/**
 * Brand Theme Engine — maghzaccount-pro Visual Identity
 *
 * Palette (single source of truth):
 * - Deep emerald  #0B7A5E  (primary / trust)
 * - Warm gold     #D4A017  (accent / premium highlights)
 * - Clean white   #FFFFFF  (light surfaces)
 * - Charcoal      #1A1A2E  (dark surfaces)
 *
 * Best practices applied:
 * - Tokens, not hard-coded hex in components: every theme maps onto the same
 *   CSS variables (--color-primary-*, --color-gold-*, --chart-*, --brand-*),
 *   so Tailwind classes (bg-primary-600, text-gold-500, …) re-theme for free.
 * - `dark` class = mode switch only; colors come from the active definition.
 * - Custom themes persist as data (store), never as code changes.
 */

export type ThemeMode = 'light' | 'dark';

export type ThemeFont = 'cairo' | 'inter' | 'plex' | 'system';

export interface ThemeDefinition {
  id: string;
  nameAr: string;
  nameEn: string;
  mode: ThemeMode;
  /** Brand primary — deep emerald by default */
  primary: string;
  /** Warm gold accent */
  accent: string;
  /** App background (light: white-ish, dark: charcoal) */
  background: string;
  /** Card / surface background */
  surface: string;
  /** Main navigation (sidebar) background */
  sidebarBg: string;
  /** Top header background (rendered at 85% with blur) */
  headerBg: string;
  /** Navigation link text (default state) */
  navText: string;
  /** Navigation link + icon color (active state) */
  navActive: string;
  /** Navigation icon color (default state) */
  navIcon: string;
  /** UI typeface */
  font: ThemeFont;
}

export const BRAND_EMERALD = '#0B7A5E';
export const BRAND_GOLD = '#D4A017';
export const BRAND_WHITE = '#FFFFFF';
export const BRAND_CHARCOAL = '#1A1A2E';
export const BRAND_CHARCOAL_SURFACE = '#23233F';

export const DEFAULT_LIGHT_THEME_ID = 'emerald-light';
export const DEFAULT_DARK_THEME_ID = 'emerald-dark';

export const BUILT_IN_THEMES: ThemeDefinition[] = [
  {
    id: DEFAULT_LIGHT_THEME_ID,
    nameAr: 'زمردي فاتح',
    nameEn: 'Emerald Light',
    mode: 'light',
    primary: BRAND_EMERALD,
    accent: BRAND_GOLD,
    background: '#F7FAF8',
    surface: BRAND_WHITE,
    sidebarBg: BRAND_WHITE,
    headerBg: BRAND_WHITE,
    navText: '#52525B',
    navActive: BRAND_EMERALD,
    navIcon: '#71717A',
    font: 'cairo',
  },
  {
    id: DEFAULT_DARK_THEME_ID,
    nameAr: 'زمردي داكن',
    nameEn: 'Emerald Dark',
    mode: 'dark',
    primary: '#14B58A',
    accent: BRAND_GOLD,
    background: BRAND_CHARCOAL,
    surface: BRAND_CHARCOAL_SURFACE,
    sidebarBg: BRAND_CHARCOAL,
    headerBg: BRAND_CHARCOAL,
    navText: '#D4D4D8',
    navActive: '#14B58A',
    navIcon: '#A1A1AA',
    font: 'cairo',
  },
];

/**
 * Backward compatibility: themes created before the interface tokens
 * (sidebar/header/nav/font) existed get sensible mode-based defaults.
 */
export function withThemeDefaults(def: ThemeDefinition): ThemeDefinition {
  const dark = def.mode === 'dark';
  return {
    ...def,
    sidebarBg: def.sidebarBg ?? (dark ? BRAND_CHARCOAL : BRAND_WHITE),
    headerBg: def.headerBg ?? (dark ? BRAND_CHARCOAL : BRAND_WHITE),
    navText: def.navText ?? (dark ? '#D4D4D8' : '#52525B'),
    navActive: def.navActive ?? def.primary,
    navIcon: def.navIcon ?? (dark ? '#A1A1AA' : '#71717A'),
    font: def.font ?? 'cairo',
  };
}

export const FONT_STACKS: Record<ThemeFont, string> = {
  cairo: "'Cairo', 'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif",
  inter: "'Inter', 'Cairo', 'IBM Plex Sans Arabic', system-ui, sans-serif",
  plex: "'IBM Plex Sans Arabic', 'Cairo', 'Inter', system-ui, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif",
};

export function isBuiltInTheme(id: string): boolean {
  return BUILT_IN_THEMES.some((t) => t.id === id);
}

export function findTheme(
  id: string,
  customThemes: ThemeDefinition[] = [],
): ThemeDefinition {
  const found =
    BUILT_IN_THEMES.find((t) => t.id === id) ??
    customThemes.find((t) => t.id === id);
  if (found) return found;
  return BUILT_IN_THEMES[0];
}

// ---------------------------------------------------------------------------
// Color scale generation — derive a Tailwind-like 50..950 scale from one hex
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  const w = Math.min(1, Math.max(0, weight));
  return [
    Math.round(a[0] + (b[0] - a[0]) * w),
    Math.round(a[1] + (b[1] - a[1]) * w),
    Math.round(a[2] + (b[2] - a[2]) * w),
  ];
}

function toHex([r, g, b]: Rgb): string {
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Build a 50→950 scale by mixing the base color toward white (light steps)
 * and toward black (dark steps). The 600 step stays close to the base so
 * `bg-primary-600` always reads as "the brand color".
 */
export function generateScale(baseHex: string): Record<string, string> {
  const base = hexToRgb(baseHex) ?? hexToRgb(BRAND_EMERALD)!;
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  return {
    '50': toHex(mix(base, white, 0.94)),
    '100': toHex(mix(base, white, 0.86)),
    '200': toHex(mix(base, white, 0.72)),
    '300': toHex(mix(base, white, 0.55)),
    '400': toHex(mix(base, white, 0.32)),
    '500': toHex(mix(base, white, 0.12)),
    '600': toHex(base),
    '700': toHex(mix(base, black, 0.18)),
    '800': toHex(mix(base, black, 0.36)),
    '900': toHex(mix(base, black, 0.55)),
    '950': toHex(mix(base, black, 0.75)),
  };
}

export function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

export function normalizeHex(value: string, fallback: string): string {
  const v = value.trim();
  if (!isValidHex(v)) return fallback;
  if (v.length === 4) {
    const [, a, b, c] = v;
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
  }
  return v.toLowerCase();
}

// ---------------------------------------------------------------------------
// DOM application — the only place that touches documentElement styles
// ---------------------------------------------------------------------------

export function applyThemeDefinition(input: ThemeDefinition): void {
  if (typeof document === 'undefined') return;
  const def = withThemeDefaults(input);
  const root = document.documentElement;
  const primary = generateScale(def.primary);
  const gold = generateScale(def.accent);

  for (const [step, color] of Object.entries(primary)) {
    root.style.setProperty(`--color-primary-${step}`, color);
  }
  for (const [step, color] of Object.entries(gold)) {
    root.style.setProperty(`--color-gold-${step}`, color);
  }

  // Semantic brand tokens — for custom CSS / gradients / charts
  root.style.setProperty('--brand-primary', def.primary);
  root.style.setProperty('--brand-accent', def.accent);
  root.style.setProperty('--brand-background', def.background);
  root.style.setProperty('--brand-surface', def.surface);
  root.style.setProperty('--brand-sidebar-bg', def.sidebarBg);
  root.style.setProperty('--brand-header-bg', def.headerBg);
  root.style.setProperty('--brand-nav-text', def.navText);
  root.style.setProperty('--brand-nav-active', def.navActive);
  root.style.setProperty('--brand-nav-icon', def.navIcon);
  root.style.setProperty('--chart-1', primary['600'] ?? def.primary);
  root.style.setProperty('--chart-2', gold['500'] ?? def.accent);

  // Typeface — overrides the design-system default per theme.
  const stack = FONT_STACKS[def.font] ?? FONT_STACKS.cairo;
  root.style.setProperty('--font-arabic', stack);
  root.style.setProperty('--font-sans', stack);

  // Dark surfaces follow the theme: charcoal family in dark mode.
  if (def.mode === 'dark') {
    root.style.setProperty('--color-zinc-950', def.background);
    root.style.setProperty('--color-zinc-900', def.surface);
  } else {
    root.style.removeProperty('--color-zinc-950');
    root.style.removeProperty('--color-zinc-900');
  }

  root.classList.remove('light', 'dark');
  root.classList.add(def.mode);
  root.dataset.theme = def.id;
  root.style.colorScheme = def.mode;
}

export function themeDisplayName(
  def: ThemeDefinition,
  language: 'ar' | 'en',
): string {
  return language === 'ar' ? def.nameAr : def.nameEn;
}
