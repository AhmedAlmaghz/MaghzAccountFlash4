/**
 * AI job-queue IPC contract — shared by the Electron main-process handlers
 * (electron/aiHandler.js), the PGlite browser fallback (browserBridge.ts)
 * and the renderer client (api/batch.ts).
 *
 * Zero imports: type-only, so no module cycles. Keep the three
 * implementations SQL-identical — the migrations test asserts the key
 * patterns exist in both.
 */

export type JobBatchStatus = 'pending' | 'running' | 'paused' | 'done' | 'partial' | 'cancelled';

export type JobItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export interface JobBatchItemInput {
  tool_name: string;
  args: Record<string, unknown>;
  after_seq: number | null;
  idempotency_key: string;
  /** Human display note (direction badge…) — never executed. */
  label?: string | null;
  /** Stable name later items address via {{ref}} / @ref. */
  ref?: string | null;
}

export interface JobBatchSummary {
  id: string;
  kind: string;
  title: string | null;
  totalCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  status: JobBatchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobBatchItem {
  id: string;
  seq: number;
  toolName: string;
  args: Record<string, unknown>;
  afterSeq: number | null;
  label: string | null;
  ref: string | null;
  resultData: Record<string, string | number | boolean> | null;
  status: JobItemStatus;
  attempts: number;
  lastError: string | null;
  errorCode: string | null;
  resultRef: string | null;
}

export interface JobBatchDetail extends JobBatchSummary {
  items: JobBatchItem[];
}

/** Max items accepted per batch-create call — huge uploads enqueue in chunks. */
export const BATCH_CREATE_CHUNK = 500;

/**
 * Max items claimed per worker round-trip.
 *
 * P1 fix (2026-09-11 audit): was 100. A 100-item chunk meant a user pressing
 * pause/cancel waited for up to ~99 more financial writes before the worker
 * noticed (the header is only re-checked at chunk boundaries), and a crash
 * mid-chunk left 100 items 'running' for recover to fail. At 10, cancel is
 * honored within ~9 items, recover windows stay small, and the extra claim
 * CTEs are cheap (one statement per 10 items). Batches of 500 still run —
 * just in 50 short rounds instead of 5 long ones.
 */
export const BATCH_CLAIM_LIMIT = 10;

/** Attempts per item before it is marked failed permanently (1 + 3 retries). */
export const BATCH_MAX_ATTEMPTS = 4;
