declare module 'arabic-reshaper' {
  const ArabicReshaper: {
    convertArabic(text: string): string;
  };
  export default ArabicReshaper;
}

declare module 'bidi-js' {
  export interface BidiEmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export interface Bidi {
    getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl'): BidiEmbeddingLevels;
    getReorderedString(text: string, levels: BidiEmbeddingLevels, start?: number, end?: number): string;
  }
  const bidiFactory: () => Bidi;
  export default bidiFactory;
}
