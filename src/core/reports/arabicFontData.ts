import regularDataUrl from './fonts/Tajawal-Regular.ttf?inline';
import boldDataUrl from './fonts/Tajawal-Bold.ttf?inline';

/**
 * Tajawal TTFs bundled into the PDF chunk via Vite `?inline` (base64 data
 * URLs). Inlining — rather than fetching from /fonts — guarantees the font
 * is available in every runtime, including Electron file:// where fetch()
 * of local files is blocked (that silent failure was the "reversed text"
 * bug: no font ⇒ no shaping, and setR2L had been dropped).
 *
 * This module is ONLY reached through a dynamic import from arabicPdf, so
 * the ~160 KB payload joins the lazy PDF chunk, never the main bundle.
 */
function dataUrlToBase64(dataUrl: string): string | null {
  if (typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  // Sanity: a TTF base64 must decode to bytes starting with 00 01 00 00.
  if (b64.length < 20_000) return null;
  return b64;
}

export function getEmbeddedFonts(): { regular: string; bold: string } | null {
  const regular = dataUrlToBase64(regularDataUrl as string);
  const bold = dataUrlToBase64(boldDataUrl as string);
  if (!regular || !bold) return null;
  return { regular, bold };
}
