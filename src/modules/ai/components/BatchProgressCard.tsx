import { memo, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import {
  cancelBatch,
  getBatch,
  pauseBatch,
  retryFailedBatch,
  unpauseBatch,
} from '../api/batch';
import type { JobBatchDetail, JobBatchStatus } from '../api/batchTypes';
import { isTerminalBatchStatus } from '../engine/batchQueue';

/**
 * Live batch progress card (Package D).
 *
 * Rendered under any tool card carrying a batchId (enqueue/resume approvals
 * and resumed runs). Polls the header every 3s while the batch is active —
 * terminal batches render once and stop. Actions hit the same ai:batch-*
 * channels the worker uses (pause/resume/cancel/retry-failed).
 */

const TERMINAL: ReadonlySet<JobBatchStatus> = new Set(['done', 'partial', 'cancelled']);

function statusStyle(status: JobBatchStatus): string {
  switch (status) {
    case 'done': return 'text-success-700 dark:text-success-300 bg-success-50 dark:bg-success-900/20';
    case 'partial': return 'text-gold-700 dark:text-gold-300 bg-gold-50 dark:bg-gold-900/20';
    case 'cancelled': return 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800';
    case 'paused': return 'text-gold-700 dark:text-gold-300 bg-gold-50 dark:bg-gold-900/20';
    case 'running': return 'text-info-700 dark:text-info-300 bg-info-50 dark:bg-info-900/20';
    case 'pending': return 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800';
  }
}

export const BatchProgressCard = memo(function BatchProgressCard({ batchId }: { batchId: string }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<JobBatchDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getBatch(batchId);
    if (res.success && res.data) {
      setDetail(res.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = detail !== null && !isTerminalBatchStatus(detail.status) && !TERMINAL.has(detail.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  const act = useCallback(async (name: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(name);
    try {
      await fn();
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (failed && !detail) {
    return (
      <div className="text-xs text-danger-600 dark:text-danger-400 flex items-center gap-1.5">
        <AlertTriangle size={13} />
        {t('ai.batch.loadError')}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="text-xs text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
        <Loader2 size={13} className="animate-spin" />
        {t('ai.batch.progress')}…
      </div>
    );
  }

  const total = Math.max(1, detail.totalCount);
  const donePct = Math.min(100, Math.round((detail.doneCount / total) * 100));
  const failedItems = (detail.items ?? []).filter((i) => i.status === 'failed').slice(0, 3);

  const btn =
    'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-xl border transition-all active:scale-95 disabled:opacity-50';

  return (
    <div className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">
          {detail.title || t('ai.batch.progress')}
        </span>
        <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0', statusStyle(detail.status))}>
          {t(`ai.batch.status_${detail.status}`)}
        </span>
      </div>

      <div
        className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-700 overflow-hidden"
        role="progressbar"
        aria-valuenow={donePct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            detail.status === 'done' ? 'bg-success-500' : detail.failedCount > 0 ? 'bg-gold-500' : 'bg-primary-500'
          )}
          style={{ width: `${donePct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 size={12} className="text-success-500" />
          {t('ai.batch.done')} {detail.doneCount}
        </span>
        {detail.failedCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <XCircle size={12} className="text-danger-500" />
            {t('ai.batch.failed')} {detail.failedCount}
          </span>
        )}
        {detail.skippedCount > 0 && (
          <span>{t('ai.batch.skipped')} {detail.skippedCount}</span>
        )}
        <span>{t('ai.batch.remaining')} {Math.max(0, detail.totalCount - detail.doneCount - detail.failedCount - detail.skippedCount)}</span>
      </div>

      {failedItems.length > 0 && (
        <ul className="space-y-1">
          {failedItems.map((i) => (
            <li key={i.id} className="text-[11px] text-danger-600 dark:text-danger-400 truncate" title={i.lastError ?? ''}>
              #{i.seq} {i.toolName}: {i.lastError || '؟'}
            </li>
          ))}
        </ul>
      )}

      {active && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {detail.status !== 'paused' ? (
            <button
              className={cn(btn, 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700')}
              disabled={busy !== null}
              onClick={() => void act('pause', () => pauseBatch(batchId))}
            >
              {busy === 'pause' ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
              {t('ai.batch.pause')}
            </button>
          ) : (
            <button
              className={cn(btn, 'border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40')}
              disabled={busy !== null}
              onClick={() => void act('resume', () => unpauseBatch(batchId))}
            >
              {busy === 'resume' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {t('ai.batch.resume')}
            </button>
          )}
          {detail.failedCount > 0 && (
            <button
              className={cn(btn, 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700')}
              disabled={busy !== null}
              onClick={() => void act('retry', () => retryFailedBatch(batchId))}
            >
              {busy === 'retry' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              {t('ai.batch.retryFailed')}
            </button>
          )}
          <button
            className={cn(btn, 'border-danger-200 dark:border-danger-800 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20')}
            disabled={busy !== null}
            onClick={() => void act('cancel', () => cancelBatch(batchId))}
          >
            {busy === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
            {busy === 'cancel' ? t('ai.batch.cancelling') : t('ai.batch.cancel')}
          </button>
        </div>
      )}
    </div>
  );
});
