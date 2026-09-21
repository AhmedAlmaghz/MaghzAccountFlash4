/* eslint-disable @typescript-eslint/no-explicit-any */
import { PGlite } from '@electric-sql/pglite';

/**
 * PGlite transport abstraction (Worker-migration step 1).
 *
 * Today PGlite runs on the UI thread and every heavy WASM query freezes
 * the browser tab. The end state is a WorkerTransport behind this same
 * interface; this slice only extracts the seam with zero behaviour change:
 * MainThreadTransport owns the exact singleton/boot logic the adapter used.
 *
 * Design notes:
 * - The singleton lives HERE (moved, not copied) — two PGlite instances
 *   would fight over one IndexedDB lock, so there must be exactly one owner.
 * - SQL is already PostgreSQL-style ($N) at this level — placeholder
 *   conversion stays in the adapter.
 * - Timeouts are NOT applied to queries yet (helper only, tested standalone).
 *   Wiring them in is step 2, after the Worker path exists to compare against.
 */

export interface DbTransport {
  /** Raw query against the engine (pg-style $N params). */
  queryRaw(pgSql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
  /** Raw exec for statements without results (BEGIN/COMMIT/ROLLBACK/DDL). */
  execRaw(sql: string): Promise<void>;
}

/** Per-query ceiling for future transports (a hung query must not hang the app). */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

/**
 * Race a promise against an explicit ceiling. Pure helper — no PGlite needed.
 * The loser is abandoned, not cancelled (the engine owns its own cleanup).
 */
export function withQueryTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ─── Singleton ownership (moved verbatim from pgliteAdapter) ────────────────

let pglite: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

function isBrowserIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-attempt ceiling for PGlite boot. `waitReady` has no built-in timeout —
 * on an IDB lock or a thrashed disk it can stall forever, freezing the whole
 * app at the spinner with zero feedback. The retry loop in getInstance turns
 * this rejection into another attempt, then a named error.
 */
const PG_BOOT_TIMEOUT_MS = 30_000;

async function openInstance(): Promise<PGlite> {
  const dataDir = isBrowserIndexedDB() ? 'idb://maghzaccount-pglite' : undefined;
  const instance = new PGlite({ dataDir });
  await Promise.race([
    instance.waitReady,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`PGlite boot timed out after ${PG_BOOT_TIMEOUT_MS / 1000}s (IndexedDB lock?)`)), PG_BOOT_TIMEOUT_MS),
    ),
  ]);
  return instance;
}

export async function getInstance(): Promise<PGlite> {
  if (pglite) return pglite;
  if (initPromise) return initPromise;

  // IndexedDB locks are transient by nature (second tab, slow disk, AV
  // scan): retry a few times with backoff before declaring the database
  // dead. Each attempt gets a FRESH promise so a poisoned one never sticks.
  initPromise = (async () => {
    // NOTE: initPromise is nulled ONLY on final failure (see catch below).
    // Nulling it between attempts would let a concurrent caller spawn a
    // second instance mid-retry — two writers fighting over one IndexedDB.
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const instance = await openInstance();
        pglite = instance;
        return instance;
      } catch (err) {
        lastError = err;
        if (attempt < 3) await sleep(attempt * 1000);
      }
    }
    throw lastError instanceof Error
      ? new Error(`PGlite init failed after 3 attempts: ${lastError.message}`)
      : lastError;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/** Today's behaviour: the engine on the calling thread. */
export class MainThreadTransport implements DbTransport {
  async queryRaw(pgSql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    const db = await getInstance();
    const result = await db.query(pgSql, params || []);
    return { rows: result.rows as any[], rowCount: result.rows?.length || 0 };
  }

  async execRaw(sql: string): Promise<void> {
    const db = await getInstance();
    await db.exec(sql);
  }
}

/** Shared main-thread transport (one engine, one lock, one owner). */
export const mainThreadTransport = new MainThreadTransport();
