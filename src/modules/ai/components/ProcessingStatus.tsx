import { memo, useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAiStore } from '../store';

/** How long the "reply complete" pill stays visible after a cycle ends. */
const DONE_PILL_MS = 6000;

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

interface ProcessingStatusProps {
  /** Set when the current cycle started (null when idle). */
  startedAt: number | null;
  /** Set when the last cycle finished (null if none yet). */
  completedAt: number | null;
}

/**
 * Live engine-state signal above the input:
 * - while processing: elapsed timer (a silent spinner with no time feedback
 *   reads as "hung" — a ticking clock proves work is happening);
 * - briefly after completion: an explicit "reply complete" pill so the user
 *   knows the next request can be typed now.
 */
export const ProcessingStatus = memo(function ProcessingStatus({ startedAt, completedAt }: ProcessingStatusProps) {
  const { t } = useTranslation();
  const isProcessing = useAiStore((s) => s.isProcessing);
  const lastKind = useAiStore((s) => {
    const m = s.messages[s.messages.length - 1];
    return m ? m.kind : null;
  });
  const [, setTick] = useState(0);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isProcessing]);

  useEffect(() => {
    if (isProcessing || !completedAt || lastKind === 'error') {
      setShowDone(false);
      return;
    }
    if (Date.now() - completedAt > DONE_PILL_MS) return;
    setShowDone(true);
    const id = setTimeout(() => setShowDone(false), DONE_PILL_MS - (Date.now() - completedAt));
    return () => clearTimeout(id);
  }, [isProcessing, completedAt, lastKind]);

  if (isProcessing && startedAt) {
    return (
      <div className="flex justify-center pt-2" role="status" aria-live="polite">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800">
          <Loader2 size={12} className="animate-spin" />
          {t('ai.executing')}
          <span className="tabular-nums text-primary-500 dark:text-primary-400">
            {formatElapsed(Date.now() - startedAt)}
          </span>
        </span>
      </div>
    );
  }

  if (showDone) {
    return (
      <div className="flex justify-center pt-2" role="status" aria-live="polite">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 size={12} />
          {t('ai.replyDone')}
        </span>
      </div>
    );
  }

  return null;
});
