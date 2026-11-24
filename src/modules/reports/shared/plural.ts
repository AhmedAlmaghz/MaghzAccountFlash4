/**
 * Pluralization helper — replaces the old hardcoded `t('key.v1..v9')` chains.
 * Language-aware: works for AR (numeric strings, 1/2/3+ buckets) and EN (1/2/many).
 */
export type PluralKind = 'arabic' | 'english';

const PLURAL_ZONES: Record<PluralKind, { v1: string; v2: string; v3: string; v4: string }> = {
  arabic: { v1: '', v2: '.v2', v3: '.v3', v4: '.v4' },
  english: { v1: '', v2: '.v2', v3: '.v3', v4: '.v3' },
};

export function pluralKey(base: string, kind: PluralKind, n: number | string | null | undefined): string {
  const count = Number(n ?? 0);
  const zone = PLURAL_ZONES[kind];
  if (count <= 0) return `${base}${zone.v1}`;
  if (count === 1) return `${base}${zone.v1}`;
  if (count === 2) return `${base}${zone.v2}`;
  if (count >= 3 && count <= 10) return `${base}${zone.v3}`;
  return `${base}${zone.v3}`;
}

/**
 * Given a base i18n key and count, picks the correct plural variant using the
 * company language from the user's app settings. Mirrors the Arabic plural
 * conventions used across the product.
 */
export function pickPluralKey(base: string, n: number, language: string): string {
  const kind: PluralKind = language === 'ar' || language === 'ar-SA' || language === 'ar-YE' ? 'arabic' : 'english';
  return pluralKey(base, kind, n);
}

/** Split "key word word" — preserves original spaces. */
export function pluralize(base: string, n: number): string {
  const words = base.split(' ');
  if (words.length < 2) return words[0];
  const head = words.slice(0, -1).join(' ');
  return `${head} ${pickPluralKey(words[words.length - 1], n, 'ar')}`;
}

export function pluralizeDollarValue(
  base: string,
  total: number,
  formatter: (n: number) => string
): string {
  const n = Math.round(total);
  if (n === 0) return `${base}${PLURAL_ZONES.arabic.v1}`;
  if (n === 1) return `${base}${PLURAL_ZONES.arabic.v1}${formatter(n)}`;
  if (n === 2) return `${base}${PLURAL_ZONES.arabic.v2}${formatter(n)}`;
  return `${base}${PLURAL_ZONES.arabic.v3}${formatter(n)}`;
}

export function strongValue(formatted: string): string {
  return `<span class="font-bold tabular-nums">${formatted}</span>`;
}

/** Stable display of plural amounts: groups >20 join others ("…و 34"). */
export function joinOthersSuffix(count: number): string {
  if (count > 20) return `${count}`;
  return '';
}
