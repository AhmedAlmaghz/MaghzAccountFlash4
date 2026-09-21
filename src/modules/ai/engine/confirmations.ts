import type { PendingToolCall } from '../types';

/**
 * Identical-retry ceiling: the same write (toolName + stable args) that
 * fails this many times stops spawning confirmation cards — the model gets
 * an honest error instead of an infinite approve→fail→retry loop.
 */
export const WRITE_RETRY_LIMIT = 2;

/** Stable key for a (toolName, args) pair — key order must not matter. */
export function writeAttemptKey(toolName: string, args: unknown): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return `${toolName}::${JSON.stringify(stable(args))}`;
}

/** Find a pending write by callId (pure — no store access). */
export function findPendingCall(calls: PendingToolCall[], callId: string): PendingToolCall | undefined {
  return calls.find((c) => c.callId === callId);
}

/**
 * Remove a pending write by callId (pure — returns a new array).
 * The engine prunes BEFORE any await: main-thread saturation can process
 * a second queued UI activation before React flushes, and the old
 * "prune after execute" window executed the same financial write twice.
 */
export function prunePendingCall(calls: PendingToolCall[], callId: string): PendingToolCall[] {
  return calls.filter((c) => c.callId !== callId);
}

/** True when this exact write already failed enough to stop re-asking. */
export function hasExhaustedRetries(attempts: Map<string, number>, toolName: string, args: unknown): boolean {
  return (attempts.get(writeAttemptKey(toolName, args)) ?? 0) >= WRITE_RETRY_LIMIT;
}
