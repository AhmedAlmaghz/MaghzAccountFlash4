import { normalizeArabic } from '@/core/utils/normalizeArabic';

/** Normalize a search query for matching (lowercase + Arabic variants). */
export function normalizeQuery(query: string): string {
  return normalizeArabic(query);
}

export interface ScoreResult {
  score: number;
  /** Index of the match inside the label (used for highlighting). */
  matchIndex: number;
  matchLength: number;
}

const EMPTY_RESULT: ScoreResult = { score: 0, matchIndex: -1, matchLength: 0 };

/**
 * Rank how well `query` matches `label` / `keywords`.
 * 0 = no match. Higher = better. Prefers label over keywords,
 * prefix over substring, and longer matches.
 */
export function scoreText(
  query: string,
  label: string,
  keywords: string[] = [],
): ScoreResult {
  const q = normalizeQuery(query);
  if (!q) return { score: 1, matchIndex: 0, matchLength: 0 };

  const candidates: Array<{ text: string; boost: number }> = [
    { text: label, boost: 100 },
    ...keywords.map((k) => ({ text: k, boost: 40 })),
  ];

  let best: ScoreResult = EMPTY_RESULT;
  for (const { text, boost } of candidates) {
    const normalized = normalizeQuery(text);
    if (!normalized) continue;

    const idx = normalized.indexOf(q);
    if (idx !== -1) {
      let score = boost + 50; // substring base
      if (idx === 0) score += 30; // prefix bonus
      const lengthRatio = q.length / normalized.length;
      score += lengthRatio * 10;
      if (score > best.score) {
        best = { score, matchIndex: idx, matchLength: q.length };
      }
    }
  }
  return best;
}

/** Filter and rank palette items by a query string. */
export function filterItems<T extends { label: string; keywords?: string[] }>(
  items: T[],
  query: string,
): T[] {
  const q = normalizeQuery(query);
  if (!q) return items;

  const scored = items
    .map((item) => ({ item, result: scoreText(q, item.label, item.keywords ?? []) }))
    .filter((entry) => entry.result.score > 0);

  scored.sort((a, b) => b.result.score - a.result.score);
  return scored.map((entry) => entry.item);
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into segments where the query match is highlighted.
 * Uses a raw case-insensitive match when possible (exact 1:1 offsets),
 * falls back to normalised matching without granular highlighting.
 */
export function highlightParts(text: string, query: string): HighlightSegment[] {
  const q = normalizeQuery(query);
  if (!q) return [{ text, match: false }];

  // Fast path: exact raw match (case-insensitive) — clean offsets.
  const lowered = text.toLowerCase();
  const rawIdx = lowered.indexOf(q);
  if (rawIdx !== -1) {
    return [
      { text: text.slice(0, rawIdx), match: false },
      { text: text.slice(rawIdx, rawIdx + q.length), match: true },
      { text: text.slice(rawIdx + q.length), match: false },
    ].filter((s) => s.text.length > 0);
  }

  // Normalised match (Arabic variants) — highlight whole text as a match
  // so the user still sees *why* the row was returned.
  const normalized = normalizeArabic(text);
  if (normalized.includes(q)) {
    return [{ text, match: true }];
  }

  return [{ text, match: false }];
}

/** Flatten grouped results into a single selectable list. */
export function flattenRows<T extends { key: string }>(groups: Array<{ key: string; rows: T[] }>): T[] {
  return groups.flatMap((group) => group.rows);
}
