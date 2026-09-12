import { aiApi } from '../api/index';
import { executeToolCall } from './toolExecutor';
import { getTool } from '../tools/registry';
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

/** Unique id per worker run — stamps claim leases (migration 0028) so a
 *  second window's recover can tell OUR in-flight items from a dead
 *  worker's orphans. */
function newWorkerId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `w-${c.randomUUID()}`;
  } catch { /* fall through */ }
  return `w-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
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
  // AND by seq string ({{0.id}} also works). refTools carries ref → tool
  // name so resolveOutputId honors the explicit PRIMARY_ID_FIELD annotation
  // (P0-7) instead of the "first Id-suffixed key" convention alone.
  const outputs: RefOutputs = new Map();
  const refTools = new Map<string, string>();
  const seedOutputs = (d: JobBatchDetail | null) => {
    if (!d) return;
    for (const it of d.items ?? []) {
      if (it.status === 'done' && it.resultData && Object.keys(it.resultData).length > 0) {
        if (it.ref) {
          outputs.set(it.ref, it.resultData);
          refTools.set(it.ref, it.toolName);
        }
        outputs.set(String(it.seq), it.resultData);
        refTools.set(String(it.seq), it.toolName);
      }
    }
  };
  const rememberOutput = (
    item: { seq: number; ref?: string | null; toolName?: string },
    scalars: Record<string, string | number | boolean>,
  ) => {
    if (Object.keys(scalars).length === 0) return;
    if (item.ref) {
      outputs.set(item.ref, scalars);
      if (item.toolName) refTools.set(item.ref, item.toolName);
    }
    outputs.set(String(item.seq), scalars);
    if (item.toolName) refTools.set(String(item.seq), item.toolName);
  };
  seedOutputs(detail);
  // P1 fix: consecutive empty claim rounds with no DB error used to spin at
  // 1.5s forever (e.g. a wedged 'running' item). Cap the streak; a handful
  // of consecutive empty rounds means nothing is progressing — exit with
  // the honest current detail instead of burning the thread.
  let emptyClaimStreak = 0;
  const EMPTY_CLAIM_STREAK_LIMIT = 20;
  // Claim-lease owner for this run (migration 0028). Every batchClaim call
  // below carries it: new claims are stamped, and our own running leases
  // are refreshed each round — so a concurrent recover in another window
  // only fails EXPIRED (dead-worker) rows, never our in-flight items.
  const workerId = newWorkerId();

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

    const claim = await aiApi.batchClaim(companyId, userId, batchId, BATCH_CLAIM_LIMIT, workerId);
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
      // header exits at the loop top. A persistent streak (wedged running
      // item no worker owns) exits instead of spinning forever.
      emptyClaimStreak += 1;
      if (emptyClaimStreak >= EMPTY_CLAIM_STREAK_LIMIT) {
        return detail;
      }
      await sleep(1500);
      detail = await syncHeader(companyId, userId, batchId, detail);
      if (isTerminalBatchStatus(detail.status)) {
        detail = (await refresh(companyId, userId, batchId)) ?? detail;
        callbacks.onProgress?.(detail);
        return detail;
      }
      continue;
    }
    emptyClaimStreak = 0;

    for (const item of claim.data) {
      // Cooperative gap: back-to-back heavy writes (invoice + journal +
      // stock on the UI-thread PGlite) must not starve input/paint.
      await yieldToUi();
      // Resolve {{ref}} / @ref placeholders against outputs captured so far
      // (seeded from persisted result_data at run start, so resumes work).
      // NOTE: pause/cancel is honored at chunk boundaries (loop top +
      // end-of-round sync) — chunks are intentionally small
      // (BATCH_CLAIM_LIMIT=10) so a user cancel waits at most ~9 more
      // items, never ~99. A per-item header check was tried and rejected:
      // it added N extra round-trips per chunk for no real gain.
      const sub = substituteRefs(item.args, outputs, refTools);
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
          } else {
            // P1 fix: a failed itemDone used to be a SILENT no-op (the write
            // executed but the row was flipped by a concurrent cancel/pause
            // or a transient DB error) — the loop kept executing the rest of
            // the chunk and the counters lied. Treat it as a hard stop:
            // re-read the header and bail this round so the next round (or
            // the honest terminal state) reflects reality.
            console.warn(`[ai-batch] batchItemDone failed for seq ${item.seq}: ${done.error ?? 'unknown'}`);
            detail = await syncHeader(companyId, userId, batchId, detail);
            break;
          }
        } else {
          // P1 fix: for WRITE tools a timeout abandons (not aborts) the
          // promise — the underlying write may still commit at any moment,
          // so re-running the item would create a duplicate financial
          // document. Mark it permanently failed instead of retrying; the
          // honest result_data record + audit trail keep the truth.
          const isTimeout = outcome.errorClass?.code === 'TIMEOUT';
          const toolDef = getTool(item.toolName);
          const isWrite = toolDef?.dangerLevel === 'write';
          const retryable = isTimeout && isWrite
            ? false
            : outcome.errorClass ? outcome.errorClass.retryable : true;
          const failed = await aiApi.batchItemFail(
            companyId, userId, batchId, item.id,
            outcome.error ?? 'خطأ غير معروف',
            outcome.errorClass?.code ?? (isTimeout && isWrite ? 'TIMEOUT_WRITE' : null),
            retryable,
          );
          if (failed.success && failed.data?.retried) {
            // Back off per the shared schedule before the next claim round.
            // P3 fix: item.attempts is post-claim-increment (includes the
            // just-failed attempt) — passing attempts+1 shifted the whole
            // schedule one slot and made the 5-min tier unreachable.
            const delay = nextRetryDelayMs(item.attempts) ?? 0;
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
