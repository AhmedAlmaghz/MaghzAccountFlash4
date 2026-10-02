import { aiApi } from '../api/index';
import { executeToolCall } from './toolExecutor';
import { getTool } from '../tools/registry';
import {
  extractOutputScalars,
  extractRefNames,
  isTerminalBatchStatus,
  nextRetryDelayMs,
  substituteRefs,
  summarizeBatchProgress,
  type RefOutputs,
} from './batchQueue';
import type { JobBatchDetail, JobBatchItem, JobBatchSummary } from '../api/batchTypes';
import { BATCH_CLAIM_LIMIT } from '../api/batchTypes';
import { checkJevPostingTool } from '../jev/jevPostingGuard';

/**
 * B1 wave width: independent items per parallel flight. 3 is deliberate —
 * wide enough to overlap the 10-30 sequential IPC queries inside one posting
 * flow (while item A waits on the network, B and C progress), narrow enough
 * to keep PGlite's single IDB lock and the renderer's UI thread responsive
 * (every flight still starts with yieldToUi). Ordering inside a wave is
 * irrelevant BY CONSTRUCTION (wavePartition guarantees no intra-wave deps).
 */
export const BATCH_WAVE_CONCURRENCY = 3;

/**
 * B1 wave scheduler: partition a claimed chunk into ordered waves where each
 * wave holds only items with NO dependencies on each other. Edges come from
 * numeric after_seq links AND {{ref}}/@ref placeholders that name another
 * chunk item's ref (or seq string). The claim gate already guarantees every
 * item's EXTERNAL parents are done — waves only encode INTRA-chunk order,
 * so producer→consumer ref chains (supplier → its invoices) keep working
 * while independent roots run side by side. Kahn's algorithm, chunk order
 * preserved inside each wave; a cycle (impossible — enqueue enforces
 * backward-only DAG) degrades to one sequential tail wave, never a hang.
 */
export function wavePartition(items: JobBatchItem[]): JobBatchItem[][] {
  if (items.length === 0) return [];
  const byRef = new Map<string, number>();
  const bySeq = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.ref) byRef.set(it.ref, i);
    bySeq.set(String(it.seq), i);
  });
  const deps: Array<Set<number>> = items.map(() => new Set<number>());
  items.forEach((it, i) => {
    if (typeof it.afterSeq === 'number') {
      const p = bySeq.get(String(it.afterSeq));
      if (p !== undefined && p !== i) deps[i].add(p);
    }
    for (const name of extractRefNames(it.args ?? {})) {
      const p = byRef.has(name) ? byRef.get(name) : bySeq.get(name);
      if (p !== undefined && p !== i) deps[i].add(p);
    }
  });
  const waves: JobBatchItem[][] = [];
  const done = new Set<number>();
  const remaining = new Set<number>(items.map((_, i) => i));
  while (remaining.size > 0) {
    const wave = [...remaining].filter((i) => {
      for (const d of deps[i]) {
        if (!done.has(d)) return false;
      }
      return true;
    });
    if (wave.length === 0) {
      // Cycle guard: run the rest sequentially in chunk order.
      waves.push([...remaining].map((i) => items[i]));
      break;
    }
    for (const i of wave) {
      remaining.delete(i);
      done.add(i);
    }
    waves.push(wave.map((i) => items[i]));
  }
  return waves;
}

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
  /**
   * Test-only override for the RATE_LIMIT cooldown window (production uses
   * the real 60s budget window). Lets unit tests exercise the wait-and-retry
   * path without sleeping a minute.
   */
  rateLimitWindowMs?: number;
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

/** True while ANY batch has a live worker loop in THIS renderer — the
 * max-iterations notice uses it to tell "batch still running" from a dead
 * end. */
export function isAnyBatchActive(): boolean {
  return activeBatches.size > 0;
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

/** Sliding window of the tool-executor write budget (mirrors toolExecutor). */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * P1 RATE_LIMIT fix: the tool-executor write budget is a 60s sliding window
 * shared by the whole worker. Sleep one full window in 1s slices so a
 * cooperative stop stays responsive (a single 60s sleep would ignore the
 * stop button for a full minute). Returns false when stopped mid-wait.
 * Exported for tests (they inject a short window instead of 60s).
 */
export async function sleepRateLimitWindow(shouldStop?: () => boolean, windowMs = RATE_LIMIT_WINDOW_MS): Promise<boolean> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    if (shouldStop?.()) return false;
    await sleep(1000);
  }
  return true;
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

/**
 * B1 stop helper: release NEVER-STARTED claimed items back to `queued`
 * without burning attempts. Takes explicit ids (not a chunk-order count)
 * because wave-parallel execution starts items out of claim order — only
 * ids absent from the started set are safe to release. Idempotent and
 * best-effort: a failed release only means the old 30-minute-lease
 * behaviour for those rows.
 */
async function releaseIds(
  companyId: string,
  userId: string,
  batchId: string,
  workerId: string,
  ids: string[],
): Promise<void> {
  const pending = ids.filter(Boolean);
  if (pending.length === 0) return;
  try {
    await aiApi.batchRelease(companyId, userId, batchId, workerId, pending);
  } catch {
    // best-effort: the loop exit proceeds regardless
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

  const executeGuardedItem = async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{
    blocked: boolean;
    outcome: Awaited<ReturnType<typeof executeToolCall>>;
  }> => {
    const postingCheck = await checkJevPostingTool(companyId, toolName, getTool(toolName), args);
    if (postingCheck.result.verdict === 'block') {
      return {
        blocked: true,
        outcome: {
          ok: false,
          error: `تم منع التنفيذ بواسطة JEV: ${postingCheck.result.reason}`,
        },
      };
    }
    return {
      blocked: false,
      outcome: await executeToolCall(toolName, args, { companyId, userId }),
    };
  };

  while (!isTerminalBatchStatus(detail.status)) {
    if (callbacks.shouldStop?.()) {
      // Loop-top stop (no live chunk in hand — any previous chunk was fully
      // executed or released at its own stop check). Just refresh and exit.
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
    // Narrowed once: non-empty from the checks above. Closures below must
    // use this binding (not claim.data) or TS18048 trips on the closure.
    const chunk = claim.data;

    // B1 wave-parallel chunk execution. The old loop ran items strictly one
    // by one while each posting flow holds 10-30 sequential IPC queries, so
    // a 10-item chunk serialized hundreds of round-trips. Waves run
    // independent items side by side (width BATCH_WAVE_CONCURRENCY) while
    // producer→consumer ref/after edges inside the chunk keep their order
    // across waves. Stop is honored BETWEEN flights (in-flight items always
    // finish — never abandon a financial write); never-started ids release.
    const chunkState = { detail, chunkRetryDelay: 0 };
    const startedIds = new Set<string>();
    const unstartedIds = (): string[] =>
      chunk.map((it) => it.id).filter((id) => id && !startedIds.has(id));

    // P3-5 fix: collect max retry delay for retried items in this chunk;
    // sleeping inside the loop blocked siblings. Defer to after the loop.
    const runChunkItem = async (
      item: JobBatchItem,
    ): Promise<{ terminal: JobBatchDetail | null; breakRound: boolean }> => {
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
          chunkState.detail = (await refresh(companyId, userId, batchId)) ?? chunkState.detail;
          callbacks.onProgress?.(chunkState.detail);
          return { terminal: chunkState.detail, breakRound: false };
        }
        if (failed.success) {
          chunkState.detail.failedCount += 1;
          chunkState.detail.skippedCount += failed.data?.skipped ?? 0;
          callbacks.onProgress?.(chunkState.detail);
        }
      } else {
        // P1 RATE_LIMIT fix: the 60/min write budget is shared by the whole
        // worker — failing the item burns an attempt while its chunk-siblings
        // keep the window saturated, so the tail of a big batch dies
        // permanently within ~a minute (each burns 4 attempts in backoff
        // sleeps far shorter than the 60s window). Instead: wait out ONE full
        // window (interruptible by stop) and re-execute IN PLACE — the row
        // stays claimed (30-min lease), no fail call, no attempt burned
        // beyond the claim itself, no dependent cascade. Bounded: a second
        // consecutive RATE_LIMIT falls through to the normal fail path.
        let execution = await executeGuardedItem(item.toolName, sub.args);
        if (!execution.blocked && execution.outcome.errorClass?.code === 'RATE_LIMIT') {
          const waited = await sleepRateLimitWindow(callbacks.shouldStop, callbacks.rateLimitWindowMs);
          if (!waited) {
            // Stopped during the cooldown — release the never-started
            // remainder (this item included: it never executed — it IS in
            // startedIds, so re-add it explicitly) and exit honestly.
            await releaseIds(companyId, userId, batchId, workerId, [...unstartedIds(), item.id]);
            chunkState.detail = (await refresh(companyId, userId, batchId)) ?? chunkState.detail;
            return { terminal: chunkState.detail, breakRound: false };
          }
          execution = await executeGuardedItem(item.toolName, sub.args);
        }
        const outcome = execution.outcome;
        if (outcome.ok) {
          const scalars = extractOutputScalars(outcome.result);
          rememberOutput(item, scalars);
          const done = await aiApi.batchItemDone(
            companyId, userId, batchId, item.id, extractResultRef(outcome.result), scalars,
          );
          if (done.success && done.data?.finalStatus) {
            chunkState.detail = (await refresh(companyId, userId, batchId)) ?? chunkState.detail;
            callbacks.onProgress?.(chunkState.detail);
            return { terminal: chunkState.detail, breakRound: false };
          }
          if (done.success) {
            chunkState.detail.doneCount += 1;
            callbacks.onProgress?.(chunkState.detail);
          } else {
            // P1 fix: a failed itemDone used to be a SILENT no-op (the write
            // executed but the row was flipped by a concurrent cancel/pause
            // or a transient DB error) — the loop kept executing the rest of
            // the chunk and the counters lied. Treat it as a hard stop:
            // re-read the header and bail this round so the next round (or
            // the honest terminal state) reflects reality.
            console.warn(`[ai-batch] batchItemDone failed for seq ${item.seq}: ${done.error ?? 'unknown'}`);
            chunkState.detail = await syncHeader(companyId, userId, batchId, chunkState.detail);
            return { terminal: null, breakRound: true };
          }
        } else {
          // P1 fix: for WRITE tools a timeout abandons (not aborts) the
          // promise — the underlying write may still commit at any moment,
          // so re-running the item would create a duplicate financial
          // document. Mark it permanently failed instead of retrying; the
          // honest result_data record + audit trail keep the truth.
          const isTimeout = !execution.blocked && outcome.errorClass?.code === 'TIMEOUT';
          const toolDef = getTool(item.toolName);
          const isWrite = toolDef?.dangerLevel === 'write';
          const retryable = execution.blocked
            ? false
            : isTimeout && isWrite
              ? false
              : outcome.errorClass ? outcome.errorClass.retryable : true;
          const failed = await aiApi.batchItemFail(
            companyId, userId, batchId, item.id,
            outcome.error ?? 'خطأ غير معروف',
            execution.blocked
              ? 'JEV_POSTING_BLOCKED'
              : outcome.errorClass?.code ?? (isTimeout && isWrite ? 'TIMEOUT_WRITE' : null),
            retryable,
          );
          if (failed.success && failed.data?.retried) {
            // Back off per the shared schedule before the next claim round.
            // P3 fix: item.attempts is post-claim-increment (includes the
            // just-failed attempt) — passing attempts+1 shifted the whole
            // schedule one slot and made the 5-min tier unreachable.
            // Also: don't sleep inside the loop (blocked siblings); collect
            // max delay and sleep once after the chunk.
            const delay = nextRetryDelayMs(item.attempts) ?? 0;
            if (delay > 0) chunkState.chunkRetryDelay = Math.max(chunkState.chunkRetryDelay, delay);
          }
          if (failed.success && failed.data?.finalStatus) {
            chunkState.detail = (await refresh(companyId, userId, batchId)) ?? chunkState.detail;
            callbacks.onProgress?.(chunkState.detail);
            return { terminal: chunkState.detail, breakRound: false };
          }
          if (failed.success && !failed.data?.retried) {
            chunkState.detail.failedCount += 1;
            chunkState.detail.skippedCount += failed.data?.skipped ?? 0;
            callbacks.onProgress?.(chunkState.detail);
          }
        }
      }
      return { terminal: null, breakRound: false };
    };

    const waves = wavePartition(chunk);
    let waveExit: JobBatchDetail | null = null;
    waveLoop: for (const wave of waves) {
      for (let i = 0; i < wave.length; i += BATCH_WAVE_CONCURRENCY) {
        // No pre-flight stop check here: the loop-top check above covers
        // chunk entry, and the previous flight's post-check covers every
        // later wave. A pre-flight check would double-count stop-budget
        // stubs AND delay the first flight for no reason.
        const flight = wave.slice(i, i + BATCH_WAVE_CONCURRENCY);
        for (const f of flight) startedIds.add(f.id);
        // Cooperative gap: back-to-back heavy writes (invoice + journal +
        // stock on the UI-thread PGlite) must not starve input/paint.
        await yieldToUi();
        const results = await Promise.all(flight.map((it) => runChunkItem(it)));
        // Stop is honored BETWEEN flights (after in-flight items finish),
        // never by abandoning an item mid-execution. Unexecuted chunk items
        // are released back to queued (no attempt burned) so resume is instant.
        if (callbacks.shouldStop?.()) {
          await releaseIds(companyId, userId, batchId, workerId, unstartedIds());
          chunkState.detail = (await refresh(companyId, userId, batchId)) ?? chunkState.detail;
          waveExit = chunkState.detail;
          break waveLoop;
        }
        const term = results.find((r) => r.terminal);
        if (term?.terminal) {
          waveExit = term.terminal;
          break waveLoop;
        }
        if (results.some((r) => r.breakRound)) {
          // chunkState.detail already header-synced inside the break path;
          // fall through to the end-of-round handling below.
          break waveLoop;
        }
      }
    }
    detail = chunkState.detail;
    if (waveExit) return waveExit;

    // P3-5 fix: honor real backoff schedule (0 → 30s → 5min) without capping
    // to 10s, and without blocking siblings inside the loop. Sleep once
    // after the chunk if any item was retried.
    if (chunkState.chunkRetryDelay > 0) {
      const waited = await sleepRateLimitWindow(callbacks.shouldStop, chunkState.chunkRetryDelay);
      if (!waited) {
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
