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

function stubFontFetch(bytes = 20_000): void {
  const buf = new ArrayBuffer(bytes);
  new Uint8Array(buf).fill(65);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => buf })),
  );
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

  it('registers Amiri regular+bold in the jsPDF VFS', async () => {
    stubFontFetch();
    const doc = makeDoc();
    const ok = await ensureArabicFont(doc);
    expect(ok).toBe(true);
    expect(doc.addFileToVFS).toHaveBeenCalledTimes(2);
    expect(doc.addFileToVFS).toHaveBeenCalledWith('Amiri-Regular.ttf', expect.any(String));
    expect(doc.addFont).toHaveBeenCalledWith('Amiri-Regular.ttf', ARABIC_FONT_NAME, 'normal');
    expect(doc.addFont).toHaveBeenCalledWith('Amiri-Bold.ttf', ARABIC_FONT_NAME, 'bold');
  });

  it('caches the font files across documents', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => {
        const buf = new ArrayBuffer(20_000);
        new Uint8Array(buf).fill(66);
        return buf;
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await ensureArabicFont(makeDoc());
    await ensureArabicFont(makeDoc());
    // One fetch round (regular + bold), not two.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails honestly when the font cannot load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const doc = makeDoc();
    expect(await ensureArabicFont(doc)).toBe(false);
    expect(doc.addFileToVFS).not.toHaveBeenCalled();
  });
});
