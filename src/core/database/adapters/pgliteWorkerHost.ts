/**
 * PGlite worker entry — bundled by Vite as a separate chunk via
 * `new Worker(new URL('./pgliteWorkerHost.ts', import.meta.url))`.
 *
 * NEVER statically imported by app code: the whole point is that the WASM
 * engine lives off the UI thread. The host owns the single IndexedDB lock
 * (same dataDir as the main-thread transport — only one of them boots per
 * session; the step-3 flag decides which).
 */
import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';

// No top-level await: worker chunks build as `iife`, which forbids it.
// A failed init rejects here; the main thread sees missing ready messages
// and fails via WORKER_BOOT_TIMEOUT_MS with a named error instead.
void worker({
  init: (options) => Promise.resolve(new PGlite({ ...options, dataDir: 'idb://maghzaccount-pglite' })),
});
