import ArabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';

/**
 * Arabic PDF pipeline for jsPDF — fixes the "strange symbols" exports.
 *
 * Root cause: jsPDF's built-in helvetica has no Arabic glyphs AND jsPDF
 * performs no Arabic shaping, so Arabic text came out as tofu/disjointed
 * letters. This module:
 *  1. embeds the bundled IBM Plex Sans Arabic TTF (regular + bold) into the jsPDF VFS (full presentation-forms coverage — Tajawal lacks isolated forms),
 *  2. reshapes logical Arabic into visual presentation forms
 *     (arabic-reshaper: contextual joining + lam-alef ligatures),
 *  3. reorders runs per the Unicode bidi algorithm (bidi-js), so text is
 *     rendered WITHOUT doc.setR2L (which would double-reverse it).
 *
 * The font travels INSIDE the lazy PDF chunk (Vite `?inline`), never over
 * the network: fetching local files is blocked under Electron file:// and
 * that silent failure was the "reversed text" bug (no font ⇒ no shaping,
 * while setR2L had already been dropped).
 */

export const ARABIC_FONT_NAME = 'IBMPlexSansArabic';

const ARABIC_RANGE = /[؀-ۿ]/;

interface JsPdfWithFont {
  addFileToVFS(filename: string, data: string): void;
  addFont(filename: string, name: string, style: string): void;
  setFont(name: string, style?: string): void;
}

let embeddedFonts: { regular: string; bold: string } | null = null;

/** For tests: clear the in-memory font cache. */
export function clearArabicFontCache(): void {
  embeddedFonts = null;
}

/**
 * Registers Tajawal (regular + bold) on a jsPDF instance.
 * @returns true when Arabic text can be rendered properly.
 */
export async function ensureArabicFont(doc: JsPdfWithFont): Promise<boolean> {
  try {
    if (!embeddedFonts) {
      const { getEmbeddedFonts } = await import('./arabicFontData');
      embeddedFonts = getEmbeddedFonts();
    }
    if (!embeddedFonts) return false;
    doc.addFileToVFS('IBMPlexSansArabic-Regular.ttf', embeddedFonts.regular);
    doc.addFileToVFS('IBMPlexSansArabic-Bold.ttf', embeddedFonts.bold);
    doc.addFont('IBMPlexSansArabic-Regular.ttf', ARABIC_FONT_NAME, 'normal');
    doc.addFont('IBMPlexSansArabic-Bold.ttf', ARABIC_FONT_NAME, 'bold');
    return true;
  } catch {
    return false;
  }
}

const bidi = bidiFactory();

/**
 * Converts logical-order text into jsPDF-ready visual-order text with
 * Arabic presentation forms. Non-Arabic strings pass through untouched.
 */
export function shapeForPdf(input: unknown): string {
  const text = input === null || input === undefined ? '' : String(input);
  if (!text || !ARABIC_RANGE.test(text)) return text;
  const reshaped = ArabicReshaper.convertArabic(text);
  const levels = bidi.getEmbeddingLevels(reshaped);
  return bidi.getReorderedString(reshaped, levels);
}

/** True when the string needs shaping (contains any Arabic character). */
export function needsShaping(input: unknown): boolean {
  return typeof input === 'string' && ARABIC_RANGE.test(input);
}
