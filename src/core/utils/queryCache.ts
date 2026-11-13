/**
 * A tiny shared cache for read queries that several components ask for.
 *
 * The problem it solves: the dashboard mounts a dozen widgets, each of which
 * asks the database for something on mount. On top of that React's
 * StrictMode mounts the tree TWICE in development, so every read was issued
 * twice — the dashboard fired 56 requests where 28 would do, and the screen
 * took ~12s to become usable.
 *
 * Two layers, exactly like the settings cache:
 *  - an IN-FLIGHT promise per key, so N concurrent callers share ONE round
 *    trip instead of N;
 *  - a short-lived RESULT cache, so a component mounted later (or a route
 *    revisited) reuses the answer.
 *
 * The TTL keeps it honest: a write calls `invalidateQueryCache()` and the
 * next read goes back to the database.
 */

interface CacheEntry {
  data: unknown;
  at: number;
}

const results = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Run `factory` at most once per key within `ttlMs`; concurrent callers
 * share the same promise.
 *
 * A rejected promise is never cached — the next caller retries.
 */
export function cachedPromise<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
  const cached = results.get(key);
  if (cached && Date.now() - cached.at < ttlMs) {
    return Promise.resolve(cached.data as T);
  }

  let pending = inFlight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = factory().then((data) => {
      results.set(key, { data, at: Date.now() });
      return data;
    });
    inFlight.set(key, pending);
    // `then(onOk, onErr)` (not `finally`) — a rejected promise would
    // otherwise surface as an unhandled rejection on this derived chain.
    const cleanup = () => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    };
    void pending.then(cleanup, cleanup);
  }

  return pending;
}

/**
 * Drop the cached results. Without a prefix, everything goes; with one,
 * only the keys that start with it.
 */
export function invalidateQueryCache(prefix?: string): void {
  if (!prefix) {
    results.clear();
    inFlight.clear();
    return;
  }
  for (const key of [...results.keys()]) {
    if (key.startsWith(prefix)) results.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** Test helper: how many entries are cached right now. */
export function queryCacheSize(): number {
  return results.size;
}
