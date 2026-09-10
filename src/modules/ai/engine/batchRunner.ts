import { aiApi } from '../api/index';
import { executeToolCall } from './toolExecutor';
import {
  extractOutputScalars,
  isTerminalBatchStatus,
  nextRetryDelayMs,
  substituteRefs,
  summarizeBatchProgress,
  type RefOutputs,
} from './batchQueue';
import type { JobBatchDetail, JobBatchSummary } from '../api/batchTypes';
import { BATCH_CLAIM_LIMIT } from '../api/batchTypes';

/**
 * Batch worker — runs in the renderer, state lives in Postgres.
 *
 * The loop claims ready items (deps satisfied, SKIP LOCKED) and executes
 * each through the normal tool executor, so batch execution carries exactly
 * the same RBAC + hygiene + audit guards as single calls. Progress is
 * reported after every chunk; pausing/cancelling is honored between chunks
 * (the claim channel refuses paused/cancelled batches, and the loop
 * re-checks the header too — defense in depth).
 *
 * Surviving restarts: the batch row persists. After a reload the worker is
 * gone, but `findResumableBatches` (api/batch.ts) lists running/paused
 * batches and the user resumes conversationally via `ai.resume_batch`.
 */

export interface BatchRunCallbacks {
  /** Fired after every executed chunk with the fresh header state. */
  onProgress?: (detail: JobBatchDetail) => void;
  /** Cooperative stop — checked between items (e.g. user pressed stop). */
  shouldStop?: () => boolean;
}

/**
 * Locally active workers (batchIds with a live runBatch loop in THIS
 * renderer). Prevents double-driving the same batch (banner resume while
 * the approval worker still runs) — the DB claim gate is the backstop,
 * this is the cheap front-stop. Cleared when the loop exits for any reason.
 */
const activeBatches = new Set<string>();

/** True while this renderer drives the batch — the resume banner hides these. */
export function isBatchActive(batchId: string): boolean {
  return activeBatches.has(batchId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort document reference for progress display (id/number/voucher). */
export function extractResultRef(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  for (const key of ['invoiceNumber', 'voucherNumber', 'orderNumber', 'returnNumber', 'number', 'code', 'id']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v.slice(0, 200);
  }
  return null;
}

async function refresh(
  companyId: string, userId: string, batchId: string,
): Promise<JobBatchDetail | null> {
  const res = await aiApi.batchGet(companyId, userId, batchId);
  return res.success && res.data ? res.data : null;
}

/**
 * Header-only sync — the UI-thread-saturation fix.
 *
 * The old loop re-read the FULL batch detail (every item WITH its args JSON)
 * after EVERY finished item: O(N²) parsing on the renderer's main thread,
 * where PGlite itself also executes. A 500-item invoice batch parsed its own
 * half-megabyte payload 500 times while the user typed — the tab froze.
 *
 * Progress needs only counts + status, so steady-state tracking is LOCAL
 * (done/failed/skipped are incremented from the item outcomes, mirroring the
 * SQL counters exactly) and the DB is consulted header-only via batchList
 * (LIMIT 20, no items) purely to notice EXTERNAL transitions the worker did
 * not cause itself: user pause/cancel, or terminal flip. Counts merge with
 * max() — mid-run they are monotonic, and max() also absorbs any
 * read-your-write lag from the just-committed item statements.
 */
async function syncHeader(
  companyId: string, userId: string, batchId: string, detail: JobBatchDetail,
): Promise<JobBatchDetail> {
  try {
    const list = await aiApi.batchList(companyId, userId);
    const found: JobBatchSummary | undefined =
      list.success && list.data ? list.data.find((b) => b.id === batchId) : undefined;
    if (!found) return (await refresh(companyId, userId, batchId)) ?? detail;
    return {
      ...detail,
      status: found.status,
      totalCount: Math.max(detail.totalCount, found.totalCount),
      doneCount: Math.max(detail.doneCount, found.doneCount),
      failedCount: Math.max(detail.failedCount, found.failedCount),
      skippedCount: Math.max(detail.skippedCount, found.skippedCount),
      updatedAt: found.updatedAt,
    };
  } catch {
    return detail;
  }
}

/** Macrotask gap so input/paint interleave with back-to-back heavy items. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runBatch(
  companyId: string,
  userId: string,
  batchId: string,
  callbacks: BatchRunCallbacks = {},
): Promise<JobBatchDetail | null> {
  if (activeBatches.has(batchId)) {
    // A loop already drives this batch here — never stack a second one.
    const existing = await refresh(companyId, userId, batchId);
    return existing;
  }
  activeBatches.add(batchId);
  try {
    return await runBatchInner(companyId, userId, batchId, callbacks);
  } finally {
    activeBatches.delete(batchId);
  }
}

async function runBatchInner(
  companyId: string,
  userId: string,
  batchId: string,
  callbacks: BatchRunCallbacks,
): Promise<JobBatchDetail | null> {
  // Crash recovery FIRST: items left 'running' by a dead worker would block
  // their dependents forever (claim only takes queued). They are failed —
  // never silently requeued, so a half-executed financial write can never
  // run twice. Downstream dependents skip via the standard cascade.
  try {
    await aiApi.batchRecover(companyId, userId, batchId);
  } catch {
    // Recovery is best-effort (a hiccup here must not block the run —
    // the claim gate still refuses unready items).
  }

  let detail = await refresh(companyId, userId, batchId);
  if (!detail) return null;

  // Completed outputs (persisted result_data) seed the substitution map, so
  // resumed runs resolve refs exactly like fresh ones. Keyed by ref name
  // AND by seq string ({{0.id}} also works).
  const outputs: RefOutputs = new Map();
  const seedOutputs = (d: JobBatchDetail | null) => {
    if (!d) return;
    for (const it of d.items ?? []) {
      if (it.status === 'done' && it.resultData && Object.keys(it.resultData).length > 0) {
        if (it.ref) outputs.set(it.ref, it.resultData);
        outputs.set(String(it.seq), it.resultData);
      }
    }
  };
  const rememberOutput = (
    item: { seq: number; ref?: string | null },
    scalars: Record<string, string | number | boolean>,
  ) => {
    if (Object.keys(scalars).length === 0) return;
    if (item.ref) outputs.set(item.ref, scalars);
    outputs.set(String(item.seq), scalars);
  };
  seedOutputs(detail);

  while (!isTerminalBatchStatus(detail.status)) {
    if (callbacks.shouldStop?.()) {
      detail = (await refresh(companyId, userId, batchId)) ?? detail;
      return detail;
    }
    if (detail.status === 'paused' || detail.status === 'cancelled') {
      // Not runnable and never terminal-flipped by us — EXIT instead of
      // spinning on empty claims forever (the pre-fix infinite loop).
      return detail;
    }

    const claim = await aiApi.batchClaim(companyId, userId, batchId, BATCH_CLAIM_LIMIT);
    if (!claim.success || !claim.data) {
      // Claim failed (DB hiccup) — back off one round and re-check the
      // header (cheap). No full re-read: nothing could have progressed
      // without a successful claim.
      await sleep(2000);
      detail = await syncHeader(companyId, userId, batchId, detail);
      if (isTerminalBatchStatus(detail.status)) {
        detail = (await refresh(companyId, userId, batchId)) ?? detail;
        callbacks.onProgress?.(detail);
        return detail;
      }
      continue;
    }
    if (claim.data.length === 0) {
      // Nothing claimable right now (deps still executing elsewhere).
      // Recover already failed the orphans above, so this is transient —
      // wait one round, then re-check the header; a paused/cancelled
      // header exits at the loop top.
      await sleep(1500);
      detail = await syncHeader(companyId, userId, batchId, detail);
      if (isTerminalBatchStatus(detail.status)) {
        detail = (await refresh(companyId, userId, batchId)) ?? detail;
        callbacks.onProgress?.(detail);
        return detail;
      }
      continue;
    }

    for (const item of claim.data) {
      // Cooperative gap: back-to-back heavy writes (invoice + journal +
      // stock on the UI-thread PGlite) must not starve input/paint.
      await yieldToUi();
      // Resolve {{ref}} / @ref placeholders against outputs captured so far
      // (seeded from persisted result_data at run start, so resumes work).
      const sub = substituteRefs(item.args, outputs);
      if (!sub.ok) {
        const failed = await aiApi.batchItemFail(
          companyId, userId, batchId, item.id,
          sub.error ?? 'مرجع غير متوفر',
          'UNRESOLVED_REF',
          false,
        );
        if (failed.success && failed.data?.finalStatus) {
          detail = (await refresh(companyId, userId, batchId)) ?? detail;
          callbacks.onProgress?.(detail);
          return detail;
        }
        if (failed.success) {
          detail.failedCount += 1;
          detail.skippedCount += failed.data?.skipped ?? 0;
          callbacks.onProgress?.(detail);
        }
      } else {
        const outcome = await executeToolCall(item.toolName, sub.args, { companyId, userId });
        if (outcome.ok) {
          const scalars = extractOutputScalars(outcome.result);
          rememberOutput(item, scalars);
          const done = await aiApi.batchItemDone(
            companyId, userId, batchId, item.id, extractResultRef(outcome.result), scalars,
          );
          if (done.success && done.data?.finalStatus) {
            detail = (await refresh(companyId, userId, batchId)) ?? detail;
            callbacks.onProgress?.(detail);
            return detail;
          }
          if (done.success) {
            detail.doneCount += 1;
            callbacks.onProgress?.(detail);
          }
        } else {
          const retryable = outcome.errorClass ? outcome.errorClass.retryable : true;
          const failed = await aiApi.batchItemFail(
            companyId, userId, batchId, item.id,
            outcome.error ?? 'خطأ غير معروف',
            outcome.errorClass?.code ?? null,
            retryable,
          );
          if (failed.success && failed.data?.retried) {
            // Back off per the shared schedule before the next claim round.
            const delay = nextRetryDelayMs(item.attempts + 1) ?? 0;
            if (delay > 0) await sleep(Math.min(delay, 10_000));
          }
          if (failed.success && failed.data?.finalStatus) {
            detail = (await refresh(companyId, userId, batchId)) ?? detail;
            callbacks.onProgress?.(detail);
            return detail;
          }
          if (failed.success && !failed.data?.retried) {
            detail.failedCount += 1;
            detail.skippedCount += failed.data?.skipped ?? 0;
            callbacks.onProgress?.(detail);
          }
        }
      }
      // Stop is honored BETWEEN items (after the current one finishes),
      // never by abandoning an item mid-execution.
      if (callbacks.shouldStop?.()) {
        detail = (await refresh(companyId, userId, batchId)) ?? detail;
        return detail;
      }
    }

    // End of claim round: header-only sync (pause/cancel detection + exact
    // counts) instead of a full items re-read. The full detail is fetched
    // once at start (ref seeding) and once at terminal close.
    detail = await syncHeader(companyId, userId, batchId, detail);
    if (isTerminalBatchStatus(detail.status)) {
      detail = (await refresh(companyId, userId, batchId)) ?? detail;
      callbacks.onProgress?.(detail);
      return detail;
    }
    callbacks.onProgress?.(detail);
  }

  return detail;
}

/** Progress line for cards and chat messages — single source of truth. */
export function batchProgressLine(detail: JobBatchDetail): string {
  return summarizeBatchProgress(detail.doneCount, detail.failedCount, detail.skippedCount, detail.totalCount);
}
