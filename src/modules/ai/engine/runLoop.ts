// Room for: searches → write confirmation → resume → up to 2 anti-fabrication
// correction cycles, without starving legitimate multi-document requests.
export const MAX_ITERATIONS = 10;

/**
 * True for TEMPORARY provider failures that deserve one backoff retry:
 * 429 (quota) / 503 / 529 (overload) / lost stream. Anything else (auth,
 * model, validation) fails fast — retrying it would only burn quota.
 * Pure — moved verbatim from chatEngine.runLoop so the retry policy is
 * testable without driving the whole loop.
 */
export function isTransientProviderError(errText: string): boolean {
  return (
    /\b(429|503|529)\b/.test(errText) ||
    /انتهت مهلة البث|انتهت حصة|overloaded|timeout/i.test(errText)
  );
}
