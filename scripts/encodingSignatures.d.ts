/**
 * Types for the shared encoding gate module.
 *
 * `scripts/encodingSignatures.mjs` is plain ESM so `node scripts/check-encoding.mjs`
 * runs it without a build step. The vitest gate imports the same file, and the
 * app tsconfig excludes `src/test` — so this declaration keeps the import
 * typed if the test tree is ever type-checked.
 */
export declare const ROOT: string;
export declare const MOJIBAKE: string[];
export declare const LATIN1_RUN: RegExp;
export declare const ROOTS: string[];
export declare const EXTENSIONS: string[];
export declare function walk(dir: string, out?: string[]): string[];
export declare function scannedFiles(): string[];
export declare function findMojibake(): string[];
