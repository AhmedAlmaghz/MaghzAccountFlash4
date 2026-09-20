import { traceSend } from './sendTrace';

/**
 * Race a promise against a wall clock — extracted verbatim from chatEngine.ts
 * (D-phase decomposition). On expiry the loser is detached (late rejection
 * swallowed) and `fallback` is returned — the caller proceeds degraded
 * instead of hanging. Real rejections propagate. The timeout is traced +
 * warned with its label so the console tells slow (deadline-hit logged)
 * apart from stuck (nothing logged at all).
 */
export function deadlineOr<T>(p: Promise<T>, ms: number, fallback: T, label = 'op'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('__deadline__')), ms);
  });
  return Promise.race([
    p.then(
      (v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; },
    ),
    timeout,
  ]).catch((e) => {
    if (e instanceof Error && e.message === '__deadline__') {
      p.catch(() => { /* detached loser stays unobserved */ });
      console.warn(`[ai] deadline hit: ${label} — proceeding degraded`);
      traceSend(`deadline-hit:${label}`);
      return fallback;
    }
    throw e;
  });
}
