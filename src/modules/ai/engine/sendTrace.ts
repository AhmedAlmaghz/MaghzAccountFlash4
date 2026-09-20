/**
 * Send-phase trace (pure-ish, no engine state) — extracted verbatim from
 * chatEngine.ts (D-phase decomposition, second block; see claims.ts for the
 * first). Every send records its progress through a tiny ring buffer
 * (press → context → entities → stream → first chunk → end), one console
 * line per phase. When a user reports "pressed send and everything froze",
 * the console shows EXACTLY which phase never completed — no more guessing
 * between a dead UI, a wedged DB read, and a stalled provider.
 */

const SEND_TRACE_CAP = 60;
const sendTrace: Array<{ at: number; phase: string }> = [];
export function traceSend(phase: string): void {
  sendTrace.push({ at: Date.now(), phase });
  if (sendTrace.length > SEND_TRACE_CAP) sendTrace.splice(0, sendTrace.length - SEND_TRACE_CAP);
  console.info(`[ai/send] ${phase}`);
}
/** Full phase history (oldest first) — also reachable live as window.__aiTrace. */
export function getSendTrace(): Array<{ at: number; phase: string }> {
  return sendTrace.slice();
}
if (typeof window !== 'undefined') {
  (window as unknown as { __aiTrace?: unknown }).__aiTrace = getSendTrace;
}
