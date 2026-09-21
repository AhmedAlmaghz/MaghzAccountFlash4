/**
 * PGlite transport selector (Worker-migration step 3).
 *
 * One engine per session — main-thread and worker transports share a single
 * IndexedDB lock, so per-query read/write splitting is UNSOUND (two engines
 * would fight over one dataDir). The safe gradualism is whole-engine:
 * this flag decides which transport owns the engine. Default is today's
 * behaviour; opt-in flips everything (reads, writes, transactions,
 * migrations) to the worker at once.
 *
 * Stored in localStorage like `maghzaccount-db-mode` (synchronous, no DB
 * round-trip on the hot path). E2E always forces main (no worker in the
 * e2e bridge).
 */
export type PgliteTransportMode = 'main' | 'worker';

const TRANSPORT_MODE_KEY = 'maghzaccount-pglite-transport';

function isE2E(): boolean {
  try {
    return (import.meta as { env?: { VITE_E2E?: string } }).env?.VITE_E2E === '1';
  } catch {
    return false;
  }
}

export function getTransportMode(): PgliteTransportMode {
  if (isE2E()) return 'main';
  try {
    if (localStorage.getItem(TRANSPORT_MODE_KEY) === 'worker') return 'worker';
  } catch {
    /* localStorage unavailable */
  }
  return 'main';
}

export function setTransportMode(mode: PgliteTransportMode): void {
  try {
    localStorage.setItem(TRANSPORT_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}
