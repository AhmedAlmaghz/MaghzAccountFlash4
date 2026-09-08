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

/** Max items claimed per worker round-trip. */
export const BATCH_CLAIM_LIMIT = 100;

/** Attempts per item before it is marked failed permanently (1 + 3 retries). */
export const BATCH_MAX_ATTEMPTS = 4;
