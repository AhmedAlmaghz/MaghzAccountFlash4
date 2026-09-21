/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_QUERY_TIMEOUT_MS, withQueryTimeout } from './pgliteTransport';
import type { DbTransport } from './pgliteTransport';

/**
 * WorkerTransport (Worker-migration step 2).
 *
 * Same DbTransport seam as MainThreadTransport, but the engine runs in a
 * dedicated Worker — heavy WASM queries no longer freeze the UI thread.
 * Every call carries an explicit timeout (today a hung query hangs forever).
 *
 * NOT wired into the adapter yet (step 3: flag + reads-first rollout with a
 * dual-transport test matrix). This slice is the transport + protocol only.
 *
 * Notes:
 * - The PGliteWorker import is dynamic so the main bundle stays lean until
 *   the flag enables this path.
 * - Boot is single-flight with null-on-failure (same contract as
 *   getInstance): a poisoned boot never sticks, the next call retries.
 * - Structured clone carries rows across the boundary: Date/BigInt survive,
 *   Errors do not — failures surface as Error(message) via the timeout race.
 */

/** Minimal structural surface needed from the worker-side database. */
export interface WorkerDb {
  query(pgSql: string, params?: any[]): Promise<{ rows: any[] }>;
  exec(sql: string): Promise<unknown>;
}

export type WorkerFactory = () => Promise<WorkerDb>;

/** Per-attempt ceiling for worker boot (IDB lock inside the worker stalls the same way). */
export const WORKER_BOOT_TIMEOUT_MS = 30_000;

export class WorkerTransport implements DbTransport {
  private boot: Promise<WorkerDb> | null = null;
  private factory: WorkerFactory;
  private queryTimeoutMs: number;

  constructor(factory: WorkerFactory, queryTimeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS) {
    this.factory = factory;
    this.queryTimeoutMs = queryTimeoutMs;
  }

  private ready(): Promise<WorkerDb> {
    if (!this.boot) {
      const booting = withQueryTimeout(this.factory(), WORKER_BOOT_TIMEOUT_MS, 'worker boot');
      this.boot = booting;
      // A poisoned boot must not stick — the next call retries fresh.
      booting.catch(() => {
        if (this.boot === booting) this.boot = null;
      });
    }
    return this.boot;
  }

  async queryRaw(pgSql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    const db = await this.ready();
    const result = await withQueryTimeout(db.query(pgSql, params || []), this.queryTimeoutMs, 'worker query');
    const rows = (result.rows || []) as any[];
    return { rows, rowCount: rows.length };
  }

  async execRaw(sql: string): Promise<void> {
    const db = await this.ready();
    await withQueryTimeout(db.exec(sql), this.queryTimeoutMs, 'worker exec');
  }
}

/** Production factory: real Worker + PGliteWorker, lazily imported. */
export function createWorkerTransport(queryTimeoutMs?: number): WorkerTransport {
  return new WorkerTransport(async () => {
    const { PGliteWorker } = await import('@electric-sql/pglite/worker');
    const w = new Worker(new URL('./pgliteWorkerHost.ts', import.meta.url), { type: 'module' });
    return (await PGliteWorker.create(w, { dataDir: 'idb://maghzaccount-pglite' })) as unknown as WorkerDb;
  }, queryTimeoutMs);
}

let shared: WorkerTransport | null = null;

/** Shared worker transport (one worker, one engine, one IndexedDB lock). */
export function getWorkerTransport(): WorkerTransport {
  if (!shared) shared = createWorkerTransport();
  return shared;
}
