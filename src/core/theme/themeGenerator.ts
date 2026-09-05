import {
  BRAND_EMERALD,
  BRAND_GOLD,
  isValidHex,
  normalizeHex,
  withThemeDefaults,
  type ThemeDefinition,
  type ThemeFont,
  type ThemeMode,
} from './themes';

/**
 * Deterministic theme generator — turns a base color (or a named style
 * preset) into a complete, harmonious ThemeDefinition. Pure functions so
 * the AI agent, the settings page, and unit tests share one derivation.
 */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mixHex(a: string, b: string, weight: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  const w = Math.min(1, Math.max(0, weight));
  const mixed: Rgb = [
    Math.round(ra[0] + (rb[0] - ra[0]) * w),
    Math.round(ra[1] + (rb[1] - ra[1]) * w),
    Math.round(ra[2] + (rb[2] - ra[2]) * w),
  ];
  const to = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to(mixed[0])}${to(mixed[1])}${to(mixed[2])}`;
}

/** Named style presets: base hue pairs (primary + accent). */
export const THEME_STYLE_PRESETS: Record<string, { primary: string; accent: string; nameAr: string; nameEn: string }> = {
  ocean: { primary: '#0E7490', accent: '#F59E0B', nameAr: 'محيطي', nameEn: 'Ocean' },
  desert: { primary: '#B45309', accent: '#0E7490', nameAr: 'صحراوي', nameEn: 'Desert' },
  forest: { primary: '#15803D', accent: '#D4A017', nameAr: 'غابي', nameEn: 'Forest' },
  royal: { primary: '#6D28D9', accent: '#F59E0B', nameAr: 'ملكي', nameEn: 'Royal' },
  sunset: { primary: '#C2410C', accent: '#7C3AED', nameAr: 'غروب', nameEn: 'Sunset' },
  rose: { primary: '#BE123C', accent: '#0E7490', nameAr: 'وردي', nameEn: 'Rose' },
};

export interface GenerateThemeInput {
  nameAr?: string;
  nameEn?: string;
  mode?: ThemeMode;
  /** Base brand color (#rgb/#rrggbb). Falls back to style preset, then emerald. */
  primary?: string;
  /** Accent color. Defaults to a harmonious hue rotation of the primary. */
  accent?: string;
  /** Named style preset (ocean/desert/forest/royal/sunset/rose). */
  style?: string;
  font?: ThemeFont;
}

const VALID_FONTS: ThemeFont[] = ['cairo', 'inter', 'plex', 'system'];

/** Complementary-ish accent: rotate hue +35° with vivid saturation. */
export function deriveAccent(primaryHex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(primaryHex));
  return hslToHex(h + 35, Math.max(s, 0.65), Math.min(Math.max(l, 0.45), 0.6));
}

export function generateTheme(input: GenerateThemeInput = {}): ThemeDefinition {
  const preset = input.style ? THEME_STYLE_PRESETS[input.style.toLowerCase()] : undefined;
  const mode: ThemeMode = input.mode === 'dark' ? 'dark' : 'light';
  const primary = input.primary && isValidHex(input.primary)
    ? normalizeHex(input.primary, BRAND_EMERALD)
    : normalizeHex(preset?.primary ?? BRAND_EMERALD, BRAND_EMERALD);
  const accent = input.accent && isValidHex(input.accent)
    ? normalizeHex(input.accent, BRAND_GOLD)
    : preset?.accent ?? deriveAccent(primary);
  const font: ThemeFont = input.font && (VALID_FONTS as string[]).includes(input.font) ? input.font : 'cairo';
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `custom-${crypto.randomUUID().slice(0, 8)}`
    : `custom-${Date.now().toString(36)}`;

  const base: ThemeDefinition = {
    id,
    nameAr: input.nameAr?.trim() || preset?.nameAr || 'ثيم مخصص',
    nameEn: input.nameEn?.trim() || preset?.nameEn || 'Custom Theme',
    mode,
    primary,
    accent,
    background: '',
    surface: '',
    sidebarBg: '',
    headerBg: '',
    navText: '',
    navActive: '',
    navIcon: '',
    font,
  };

  if (mode === 'light') {
    base.background = mixHex(primary, '#ffffff', 0.96);
    base.surface = '#ffffff';
    base.sidebarBg = '#ffffff';
    base.headerBg = '#ffffff';
    base.navText = '#52525B';
    base.navActive = primary;
    base.navIcon = '#71717A';
  } else {
    const bg = mixHex(primary, '#101018', 0.86);
    base.background = bg;
    base.surface = mixHex(bg, '#ffffff', 0.05);
    base.sidebarBg = mixHex(bg, '#000000', 0.25);
    base.headerBg = base.surface;
    base.navText = '#D4D4D8';
    const [h, s, l] = rgbToHsl(hexToRgb(primary));
    base.navActive = hslToHex(h, s, Math.min(l + 0.12, 0.75));
    base.navIcon = '#A1A1AA';
  }

  return withThemeDefaults(base);
}
