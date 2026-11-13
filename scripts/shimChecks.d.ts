/**
 * Types for the shared e2e-shim analysis module.
 *
 * `scripts/shimChecks.mjs` is plain ESM so the CLI scripts can run it
 * without a build step. The vitest gate imports the same file, and the app
 * tsconfig excludes `src/test` — this declaration keeps the import typed if
 * the test tree is ever type-checked.
 */
export interface ParamProblem {
  method: string;
  placeholders: number;
  params: number;
  sql: string;
}

export type ParseResult =
  | { ok: true }
  | { ok: false; error: string; line?: number; context?: string[] };

export declare function extractShimCode(source: string): string;
export declare function parseShimCode(code: string): ParseResult;
export declare function countArrayElements(expr: string): number | null;
export declare function checkStaticParamCounts(body: string): {
  checked: number;
  skipped: number;
  problems: ParamProblem[];
};
