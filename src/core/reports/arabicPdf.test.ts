import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ARABIC_FONT_NAME,
  clearArabicFontCache,
  ensureArabicFont,
  needsShaping,
  shapeForPdf,
} from './arabicPdf';

function makeDoc() {
  return {
    addFileToVFS: vi.fn(),
    addFont: vi.fn(),
    setFont: vi.fn(),
  };
}

describe('arabicPdf pipeline', () => {
  beforeEach(() => {
    clearArabicFontCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearArabicFontCache();
  });

  it('shapes Arabic into visual presentation forms (deterministic)', () => {
    // السلام عليكم → visual order, joined forms, lam-alef ligature (FEFC)
    expect(shapeForPdf('السلام عليكم')).toBe(
      'ﻢﻜﻴﻠﻋ ﻡﻼﺴﻟﺍ',
    );
    expect(shapeForPdf('السلام عليكم')).toContain('ﻼ'); // lam-alef ligature U+FEFC
  });

  it('keeps Latin and digits LTR inside Arabic runs', () => {
    const out = shapeForPdf('فاتورة INV-001 بمبلغ 1,250');
    expect(out).toContain('INV-001');
    expect(out).toContain('1,250');
    expect(out).not.toBe('فاتورة INV-001 بمبلغ 1,250');
  });

  it('passes non-Arabic input through untouched', () => {
    expect(shapeForPdf('hello')).toBe('hello');
    expect(shapeForPdf('')).toBe('');
    expect(shapeForPdf(null)).toBe('');
    expect(shapeForPdf(123)).toBe('123');
  });

  it('needsShaping detects Arabic script', () => {
    expect(needsShaping('مرحبا')).toBe(true);
    expect(needsShaping('hello')).toBe(false);
    expect(needsShaping(42)).toBe(false);
  });

  it('registers bundled Tajawal regular+bold in the jsPDF VFS', async () => {
    const doc = makeDoc();
    const ok = await ensureArabicFont(doc);
    expect(ok).toBe(true);
    expect(ARABIC_FONT_NAME).toBe('Tajawal');
    expect(doc.addFileToVFS).toHaveBeenCalledTimes(2);
    expect(doc.addFileToVFS).toHaveBeenCalledWith('Tajawal-Regular.ttf', expect.any(String));
    expect(doc.addFont).toHaveBeenCalledWith('Tajawal-Regular.ttf', ARABIC_FONT_NAME, 'normal');
    expect(doc.addFont).toHaveBeenCalledWith('Tajawal-Bold.ttf', ARABIC_FONT_NAME, 'bold');
  });

  it('fails honestly when the bundled font cannot load', async () => {
    vi.resetModules();
    vi.doMock('./arabicFontData', () => ({ getEmbeddedFonts: () => null }));
    const fresh = await import('./arabicPdf');
    fresh.clearArabicFontCache();
    const doc = makeDoc();
    expect(await fresh.ensureArabicFont(doc)).toBe(false);
    expect(doc.addFileToVFS).not.toHaveBeenCalled();
    vi.doUnmock('./arabicFontData');
    vi.resetModules();
  });
});
