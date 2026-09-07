import { aiApi } from '../api/index';
import { executeToolCall } from './toolExecutor';
import {
  isTerminalBatchStatus,
  nextRetryDelayMs,
  summarizeBatchProgress,
} from './batchQueue';
import type { JobBatchDetail } from '../api/batchTypes';
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

export async function runBatch(
  companyId: string,
  userId: string,
  batchId: string,
  callbacks: BatchRunCallbacks = {},
): Promise<JobBatchDetail | null> {
  let detail = await refresh(companyId, userId, batchId);
  if (!detail) return null;

  while (!isTerminalBatchStatus(detail.status)) {
    if (callbacks.shouldStop?.()) return detail;

    const claim = await aiApi.batchClaim(companyId, userId, batchId, BATCH_CLAIM_LIMIT);
    if (!claim.success || !claim.data) {
      // Claim failed (DB hiccup) — back off one round and re-read the header.
      await sleep(2000);
      detail = (await refresh(companyId, userId, batchId)) ?? detail;
      continue;
    }
    if (claim.data.length === 0) {
      // Nothing claimable: either finished (finalize flipped the header),
      // paused/cancelled externally, or waiting on deps — re-read and decide.
      detail = (await refresh(companyId, userId, batchId)) ?? detail;
      if (!isTerminalBatchStatus(detail.status) && detail.status !== 'paused') {
        await sleep(1500);
        detail = (await refresh(companyId, userId, batchId)) ?? detail;
      }
      continue;
    }

    for (const item of claim.data) {
      if (callbacks.shouldStop?.()) {
        detail = (await refresh(companyId, userId, batchId)) ?? detail;
        return detail;
      }
      const outcome = await executeToolCall(item.toolName, item.args, { companyId, userId });
      if (outcome.ok) {
        const done = await aiApi.batchItemDone(
          companyId, userId, batchId, item.id, extractResultRef(outcome.result),
        );
        if (done.success && done.data?.finalStatus) {
          detail = (await refresh(companyId, userId, batchId)) ?? detail;
          callbacks.onProgress?.(detail);
          return detail;
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
      }
    }

    detail = (await refresh(companyId, userId, batchId)) ?? detail;
    callbacks.onProgress?.(detail);
  }

  return detail;
}

/** Progress line for cards and chat messages — single source of truth. */
export function batchProgressLine(detail: JobBatchDetail): string {
  return summarizeBatchProgress(detail.doneCount, detail.failedCount, detail.skippedCount, detail.totalCount);
}
