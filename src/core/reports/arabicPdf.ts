import ArabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';

/**
 * Arabic PDF pipeline for jsPDF — fixes the "strange symbols" exports.
 *
 * Root cause: jsPDF's built-in helvetica has no Arabic glyphs AND jsPDF
 * performs no Arabic shaping, so Arabic text came out as tofu/disjointed
 * letters. This module:
 *  1. embeds the Amiri TTF (shipped in public/fonts) into the jsPDF VFS,
 *  2. reshapes logical Arabic into visual presentation forms
 *     (arabic-reshaper: contextual joining + lam-alef ligatures),
 *  3. reorders runs per the Unicode bidi algorithm (bidi-js), so text is
 *     rendered WITHOUT doc.setR2L (which would double-reverse it).
 *
 * Everything degrades gracefully: if the font cannot load (offline edge),
 * callers fall back to the legacy helvetica path — never worse than today.
 */

export const ARABIC_FONT_NAME = 'Amiri';
const REGULAR_URL = `${import.meta.env.BASE_URL}fonts/Amiri-Regular.ttf`;
const BOLD_URL = `${import.meta.env.BASE_URL}fonts/Amiri-Bold.ttf`;

const ARABIC_RANGE = /[؀-ۿ]/;

interface JsPdfWithFont {
  addFileToVFS(filename: string, data: string): void;
  addFont(filename: string, name: string, style: string): void;
  setFont(name: string, style?: string): void;
}

let cachedBase64: { regular: string; bold: string } | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function loadFontFiles(): Promise<{ regular: string; bold: string } | null> {
  if (cachedBase64) return cachedBase64;
  try {
    const [regularRes, boldRes] = await Promise.all([fetch(REGULAR_URL), fetch(BOLD_URL)]);
    if (!regularRes.ok || !boldRes.ok) return null;
    const [regularBuf, boldBuf] = await Promise.all([regularRes.arrayBuffer(), boldRes.arrayBuffer()]);
    if (regularBuf.byteLength < 10_000 || boldBuf.byteLength < 10_000) return null;
    cachedBase64 = {
      regular: arrayBufferToBase64(regularBuf),
      bold: arrayBufferToBase64(boldBuf),
    };
    return cachedBase64;
  } catch {
    return null;
  }
}

/** For tests: clear the in-memory font cache. */
export function clearArabicFontCache(): void {
  cachedBase64 = null;
}

/**
 * Registers Amiri (regular + bold) on a jsPDF instance.
 * @returns true when Arabic text can be rendered properly.
 */
export async function ensureArabicFont(doc: JsPdfWithFont): Promise<boolean> {
  const files = await loadFontFiles();
  if (!files) return false;
  try {
    doc.addFileToVFS('Amiri-Regular.ttf', files.regular);
    doc.addFileToVFS('Amiri-Bold.ttf', files.bold);
    doc.addFont('Amiri-Regular.ttf', ARABIC_FONT_NAME, 'normal');
    doc.addFont('Amiri-Bold.ttf', ARABIC_FONT_NAME, 'bold');
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
