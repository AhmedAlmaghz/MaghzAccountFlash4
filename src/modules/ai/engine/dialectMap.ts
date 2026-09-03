/**
 * Dialect & culture layer — normalizes REGIONAL BUSINESS VOCABULARY (Yemeni,
 * Gulf, Egyptian, Levantine, Maghrebi…) into the system's canonical terms
 * before dates/numbers/tools see them.
 *
 * `normalizeArabic` (core/utils) folds ORTHOGRAPHY (أ/ا، ة/ه، ى/ي) — it cannot
 * help when the user says a DIFFERENT WORD: "خصم/كسر/تنزيلات" (EG) all mean
 * discount, "حوالة عبر المنصة/محفظة جيب" (YE) mean a bank-style transfer,
 * "الصراف/البنك" (Gulf) is the treasury. Left raw, the LLM must guess; mapped,
 * the right tool argument is chosen deterministically.
 *
 * Design:
 *  - Pure maps, no DB — unit-testable, zero latency.
 *  - `expandDialectText` rewrites the user text into canonical Arabic BEFORE
 *    entity resolution + LLM history, so every downstream layer (search tools,
 *    tool args, the model itself) reads one vocabulary.
 *  - `canonicalPaymentMethod` maps dialect words onto the paymentMethod enum
 *    used by voucher/invoice tools (cash | bank | check).
 *  - Currency words per locale are already handled by parseFlexibleNumber;
 *    here we only map DIALECT words for money instruments.
 */

// NOTE: folding here is length-preserving (see foldKeepLength below) so
// matched indices in the folded text map 1:1 onto the original — the
// replacement reuses ORIGINAL slices and only swaps the dialect run.

interface DialectEntry {
  /** Folded dialect word/phrase (matched as a standalone token run). */
  words: string[];
  /** Canonical replacement used when expanding the text. */
  canonical: string;
}

/**
 * Business vocabulary map — dialect → canonical system term.
 * Ordered for replacement: LONGER phrases first so "حوالة بنكية" is replaced
 * before the shorter "بنك" could partially consume it.
 */
const VOCABULARY: DialectEntry[] = [
  // ── Payment methods & money instruments ──────────────────────────────────
  { words: ['حواله عبر المنصه', 'حواله الكترونيه', 'محفظه جيب', 'محفظه الكترونيه', 'تحويل رصيد', 'حواله موبايل'], canonical: 'حوالة إلكترونية (bank)' },
  { words: ['صراف', 'مكتب حوالات'], canonical: 'الخزنة النقدية' },
  { words: ['كاش'], canonical: 'نقداً' },
  // ── Discount (Egyptian/Gulf/Levantine) ──────────────────────────────────
  { words: ['كسر في السعر', 'كسر'], canonical: 'خصم' },
  { words: ['تنزيلات', 'تنزيل'], canonical: 'خصم' },
  // ── Documents (Gulf/Levantine) ───────────────────────────────────────────
  { words: ['فواتير ضريبيه', 'فاتوره ضريبيه', 'الفاتوره الضريبيه'], canonical: 'فاتورة ضريبية' },
  { words: ['ايصال', 'ايصالات'], canonical: 'سند قبض' },
  { words: ['صرفيه', 'مصروفه'], canonical: 'مصروف' },
  // ── Stock & quantities ───────────────────────────────────────────────────
  { words: ['دسته'], canonical: ' dozen (12 وحدة) ' },
  { words: ['كرتونه', 'كرتن'], canonical: 'كرتون' },
  // ── HR (Gulf/Egyptian) ───────────────────────────────────────────────────
  { words: ['مستحقاتي', 'مرتبي', 'راتبي الشهري'], canonical: 'راتبي' },
  { words: ['اجازه مرضيه'], canonical: 'إجازة مرضية' },
  { words: ['استئذان'], canonical: 'إجازة قصيرة' },
  // ── Parties (Gulf) ───────────────────────────────────────────────────────
  { words: ['العميل الجديد المحتمل'], canonical: 'عميل محتمل' },
];

/**
 * Dialect payment words → the paymentMethod enum used by tools.
 * Mirrors system-prompt rule 26 but as a DETERMINISTIC map the model (and
 * any future arg-normalizer) can rely on.
 */
const PAYMENT_METHOD_MAP: Array<{ words: string[]; method: 'cash' | 'bank' | 'check' }> = [
  { words: ['نقدي', 'نقدا', 'كاش', 'صراف', 'فلوس حاضره', 'دفعت حالا'], method: 'cash' },
  { words: ['حواله', 'حوالة', 'تحويل', 'بنك', 'بنكي', 'محفظه', 'محفظة', 'جيب', 'منصه', 'منصة', 'ايبك', 'كريم', 'محول'], method: 'bank' },
  { words: ['شيك', 'صك', 'صكوك'], method: 'check' },
];

/**
 * Word-boundary pattern for Arabic runs. Lookarounds exclude ARABIC LETTERS
 * (\u0621-\u064A + extended) — but NOT tanween marks (ً ٌ ٍ sit at
 * \u064B-\u0650, outside the letter range), so inflected endings like
 * "نقداً" still match as word-ends. At string start/end or next to a
 * space the lookarounds trivially pass (no Arabic letter present).
 */
const ARABIC_LETTERS = String.raw`[\u0621-\u064A\u0671-\u06D3]`;

/**
 * Prefixes tolerated (and preserved) before a dialect word: the definite
 * article "ال" and the single-letter conjunctions/prepositions (و ف ب ل ك)
 * that glue onto the next word ("بكسر", "وكاش", "فمحفظة"). Both groups are
 * captured so the replacement keeps them attached to the canonical term.
 */
const PREFIX_GROUP = '((?:ال)?[وفبلك]?)';

/**
 * Build a regex that matches the folded dialect word as a standalone run,
 * tolerating the definite article and clitic conjunctions before it.
 * foldKeepLength transforms each character 1:1, so index i in the folded
 * string corresponds exactly to index i in the original.
 */
function dialectRegex(foldedWord: string): RegExp {
  const escaped = foldedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<!${ARABIC_LETTERS})((?:ال)?${escaped})(?!${ARABIC_LETTERS})`,
    'g',
  );
}

/**
 * Match WITH the tolerated prefix — used by expandDialectText so clitic
 * prepositions survive the replacement ("بكسر" → "بخصم" not "خصم").
 */
function dialectRegexWithPrefix(foldedWord: string): RegExp {
  const escaped = foldedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<!${ARABIC_LETTERS})${PREFIX_GROUP}((?:ال)?${escaped})(?!${ARABIC_LETTERS})`,
    'g',
  );
}

/**
 * Replace standalone dialect phrases with canonical terms.
 *
 * Matching happens on the FOLDED string but replacement is mapped back to
 * the ORIGINAL text: `foldKeepLength` transforms each character 1:1 (never
 * removes anything), so index i in the folded string corresponds exactly to
 * index i in the original — we rebuild the output from original slices.
 */
function foldKeepLength(s: string): string {
  return s.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

export function expandDialectText(text: string): { text: string; changed: string[] } {
  if (!text) return { text, changed: [] };
  const folded = foldKeepLength(text);
  let out = text;
  const changed: string[] = [];

  for (const entry of VOCABULARY) {
    for (const w of entry.words) {
      const re = dialectRegexWithPrefix(foldKeepLength(w));
      // Collect matches on the FOLDED text (indices == original indices).
      const matches = [...folded.matchAll(re)];
      if (matches.length === 0) continue;
      if (!changed.includes(w)) changed.push(w);

      // Apply replacements back-to-front so earlier indices stay valid.
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        const start = m.index ?? 0;
        const end = start + m[0].length;
        // m[1] = tolerated prefix (optional clitic + optional article).
        // m[2] = the word run (with its own optional article).
        const prefix = m[1] ?? '';
        const wordRun = m[2] ?? '';
        const wordHadArticle = wordRun.startsWith('ال');
        let canonical = entry.canonical;
        if (wordHadArticle && !canonical.startsWith('ال')) canonical = 'ال' + canonical;
        out = out.slice(0, start) + prefix + canonical + out.slice(end);
      }
    }
  }

  return { text: out, changed };
}

/** Deterministic dialect word → paymentMethod (cash/bank/check). */
export function canonicalPaymentMethod(text: string): 'cash' | 'bank' | 'check' | null {
  const folded = foldKeepLength(text || '');
  for (const { words, method } of PAYMENT_METHOD_MAP) {
    const hit = words.some((w) => dialectRegex(foldKeepLength(w)).test(folded));
    if (hit) return method;
  }
  return null;
}

// Re-export for tests that need the prefix-aware matcher directly.
export { dialectRegexWithPrefix as __dialectRegexWithPrefix };
