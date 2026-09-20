/**
 * Token usage metering (B2) — pure accumulator, no I/O.
 *
 * Providers report `usage` per round-trip (prompt/completion/total tokens);
 * some omit it (null) or report partial fields. This module normalizes every
 * shape into one additive counter the engine accumulates per send and per
 * session, backing the session token budget (`ai.token_budget_per_session`):
 * warn at 80%, stop honestly at 100%. No silent truncation, ever.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Provider round-trips counted (including ones that reported no usage). */
  calls: number;
}

export interface RawUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
}

function toCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Add one round-trip's reported usage (null-safe) — returns a new object. */
export function addUsage(acc: TokenUsage, raw: RawUsage | null | undefined): TokenUsage {
  const prompt = toCount(raw?.prompt_tokens);
  const completion = toCount(raw?.completion_tokens);
  const total = toCount(raw?.total_tokens) || prompt + completion;
  return {
    promptTokens: acc.promptTokens + prompt,
    completionTokens: acc.completionTokens + completion,
    totalTokens: acc.totalTokens + total,
    calls: acc.calls + 1,
  };
}

/** Compact human line for honest notices ("12.4k tokens · 3 calls"). */
export function formatUsage(u: TokenUsage): string {
  const fmt = (n: number): string =>
    n >= 1000 ? `${Math.round((n / 1000) * 10) / 10}k` : String(n);
  return `${fmt(u.totalTokens)} tokens · ${u.calls} calls`;
}

/**
 * Budget state for one check: 'ok' | 'warn' (≥80%, warn once per session) |
 * 'exceeded' (≥100%, stop). Budget ≤ 0 (or missing) = unlimited.
 */
export type BudgetState = 'ok' | 'warn' | 'exceeded';

export function checkBudget(totalTokens: number, budget: number | null | undefined): BudgetState {
  const limit = typeof budget === 'number' && Number.isFinite(budget) ? Math.floor(budget) : 0;
  if (limit <= 0) return 'ok';
  if (totalTokens >= limit) return 'exceeded';
  if (totalTokens >= limit * 0.8) return 'warn';
  return 'ok';
}
