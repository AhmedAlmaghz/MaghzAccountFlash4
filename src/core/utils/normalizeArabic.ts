/**
 * Arabic text normalization for fuzzy search.
 * Reduces spelling variants (alef, hamza, teh marbouta, yeh) to a common form
 * so the system tolerates common typos and dialectal differences.
 */

const ALEF_VARIANTS = /[إأآا]/g;
const YEH_VARIANTS = /[ىي]/g;
const TA_MARBOUTA = /[ةه]/g;
const WAW_HAMZA = /ؤ/g;
const YEH_HAMZA = /ئ/g;
const KASHIDA = /\u0640/g;
const DIACRITICS = /[\u064b-\u0652]/g;

const ALEF = 'ا';
const YEH = 'ي';
const HEH = 'ه';
const WAW = 'و';
const SPACE = ' ';

/**
 * Normalise an Arabic string so different Unicode representations of the same
 * letter are collapsed into one.  Also strips tatweel (kashida) and tashkeel
 * (short vowels) because they are almost always optional in user input.
 *
 * Hamza-on-waw (ؤ) → و  and  hamza-on-yeh (ئ) → ي  so that common
 * spelling variants (e.g. سؤال vs سوال, عائشة vs عايشة) converge.
 * Standalone hamza (ء) is left as-is.
 */
export function normalizeArabic(text: string): string {
  return text
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(KASHIDA, '')
    .replace(ALEF_VARIANTS, ALEF)
    .replace(YEH_VARIANTS, YEH)
    .replace(TA_MARBOUTA, HEH)
    .replace(WAW_HAMZA, WAW)
    .replace(YEH_HAMZA, YEH)
    .replace(/\s+/g, SPACE)
    .trim()
    .toLowerCase();
}

/**
 * Levenshtein edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

/**
 * Similarity score (0–1) between a query and a target string.
 * Both strings are normalised before comparison.
 */
export function fuzzyMatchScore(query: string, target: string): number {
  const a = normalizeArabic(query);
  const b = normalizeArabic(target);

  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;

  // Check substring after normalisation — high-score shortcut for compound names
  if (b.includes(a) || a.includes(b)) {
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.5 + 0.5 * lenRatio; // 0.75–1.0 for substrings
  }

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
  index: number;
}

/**
 * Return the single best fuzzy match above the given threshold, or `null`.
 */
export function bestFuzzyMatch<T>(
  query: string,
  items: T[],
  keyFn: (item: T) => string,
  threshold = 0.55,
): FuzzyMatchResult<T> | null {
  let best: FuzzyMatchResult<T> | null = null;

  for (let i = 0; i < items.length; i++) {
    const score = fuzzyMatchScore(query, keyFn(items[i]));
    if (score >= threshold && (!best || score > best.score)) {
      best = { item: items[i], score, index: i };
    }
  }

  return best;
}

/**
 * Return ALL fuzzy matches above the threshold, sorted by score descending.
 */
export function findAllFuzzyMatches<T>(
  query: string,
  items: T[],
  keyFn: (item: T) => string,
  threshold = 0.45,
): FuzzyMatchResult<T>[] {
  const results: FuzzyMatchResult<T>[] = [];

  for (let i = 0; i < items.length; i++) {
    const score = fuzzyMatchScore(query, keyFn(items[i]));
    if (score >= threshold) {
      results.push({ item: items[i], score, index: i });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
