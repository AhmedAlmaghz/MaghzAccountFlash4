import { memo, useState, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import { Button } from '@/core/ui/components/Button';
import type { PendingToolCall } from '../types';

interface ToolCallCardProps {
  toolCall: PendingToolCall;
  onConfirm?: (callId: string, approved: boolean) => void;
}

const statusConfig = {
  'pending-confirmation': {
    icon: AlertTriangle,
    color: 'text-gold-700 dark:text-gold-300',
    bg: 'bg-gold-50 dark:bg-gold-900/20 border-gold-300 dark:border-gold-800',
    labelKey: 'ai.confirmTitle',
  },
  executing: {
    icon: Loader2,
    color: 'text-info-600 dark:text-info-400',
    bg: 'bg-info-50 dark:bg-info-900/20 border-info-200 dark:border-info-800',
    labelKey: 'ai.executingTool',
  },
  success: {
    icon: CheckCircle2,
    color: 'text-success-600 dark:text-success-400',
    bg: 'bg-success-50 dark:bg-success-900/20 border-success-200 dark:border-success-800',
    labelKey: 'ai.toolSuccess',
  },
  error: {
    icon: XCircle,
    color: 'text-danger-600 dark:text-danger-400',
    bg: 'bg-danger-50 dark:bg-danger-900/20 border-danger-200 dark:border-danger-800',
    labelKey: 'ai.toolError',
  },
  rejected: {
    icon: XCircle,
    color: 'text-zinc-500 dark:text-zinc-400',
    bg: 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700',
    labelKey: 'ai.rejected',
  },
};

export const ToolCallCard = memo(function ToolCallCard({ toolCall, onConfirm }: ToolCallCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const config = statusConfig[toolCall.status];
  const Icon = config.icon;
  const isPending = toolCall.status === 'pending-confirmation';
  const isExecuting = toolCall.status === 'executing';

  /** Parse formatted text — pipe tables → HTML, **bold** → <strong> */
  const formattedResult = useMemo(() => {
    if (!toolCall.resultSummary) return null;
    return parseFormattedText(toolCall.resultSummary);
  }, [toolCall.resultSummary]);

  const handleCopy = useCallback(() => {
    const text = `Tool: ${toolCall.toolName}\nArgs: ${JSON.stringify(toolCall.args, null, 2)}\n${toolCall.resultSummary ? `Result: ${toolCall.resultSummary}` : ''}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [toolCall]);

  const handleConfirm = useCallback(() => {
    onConfirm?.(toolCall.callId, true);
  }, [onConfirm, toolCall.callId]);

  const handleReject = useCallback(() => {
    onConfirm?.(toolCall.callId, false);
  }, [onConfirm, toolCall.callId]);

  return (
    <div className={cn('rounded-xl border text-xs overflow-hidden', config.bg)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon
          size={14}
          className={cn(config.color, isExecuting && 'animate-spin')}
        />
        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
          {toolCall.label}
        </span>

        <div className="ms-auto flex items-center gap-1">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              copied
                ? 'text-success-600 dark:text-success-400'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100',
              'hover:bg-white/60 dark:hover:bg-white/10'
            )}
            title="نسخ"
            aria-label="نسخ"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>

          {/* Expand/collapse */}
          <button
            onClick={() => setExpanded(!expanded)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100',
              'hover:bg-white/60 dark:hover:bg-white/10'
            )}
            aria-label={expanded ? 'إغلاق التفاصيل' : 'عرض التفاصيل'}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {/* Status badge */}
        <span className={cn('text-[10px] font-medium', config.color)}>
          {isPending ? t('ai.confirmTitle') : isExecuting ? t('ai.executingTool', { tool: '' }).replace(': ', '') : t(config.labelKey)}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2 border-t border-black/10 dark:border-white/10">
          <div className="mt-2 space-y-1">
            <div>
              <span className="font-medium text-zinc-600 dark:text-zinc-400">الأداة: </span>
              <span className="text-zinc-800 dark:text-zinc-200 font-mono">{toolCall.toolName}</span>
            </div>
            {Object.keys(toolCall.args).length > 0 && (
              <div>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">المعاملات: </span>
                <pre className="mt-1 p-2 rounded-lg bg-zinc-950/5 dark:bg-white/10 text-[11px] font-mono overflow-x-auto text-zinc-800 dark:text-zinc-200">
                  {JSON.stringify(toolCall.args, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.resultSummary && (
              <div>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">النتيجة: </span>
                <div className="mt-1 text-zinc-800 dark:text-zinc-200 text-[11px] leading-relaxed">
                  {formattedResult}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation buttons */}
      {isPending && onConfirm && (
        <div className="flex gap-2 px-3 pb-2">
          <Button size="sm" variant="primary" onClick={handleConfirm} leftIcon={<CheckCircle2 size={12} />}>
            {t('ai.approve')}
          </Button>
          <Button size="sm" variant="danger" onClick={handleReject} leftIcon={<XCircle size={12} />}>
            {t('ai.reject')}
          </Button>
        </div>
      )}
    </div>
  );
});

/**
 * Parse a formatted result string (pipe tables, bold, emoji lines) into
 * React elements suitable for rendering in the ToolCallCard.
 */
function parseFormattedText(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Table block (pipe-delimited) ──────────────────────────────
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(renderTableFromLines(tableLines));
      continue;
    }

    // ── Empty line → spacer ───────────────────────────────────────
    if (line.trim() === '') {
      elements.push(<div key={`spacer-${i}`} className="h-1" />);
      i++;
      continue;
    }

    // ── Regular text line ─────────────────────────────────────────
    elements.push(
      <div key={`line-${i}`} className="whitespace-pre-wrap">
        {renderInlineText(line)}
      </div>,
    );
    i++;
  }

  return elements;
}

/**
 * Parse a pipe-delimited markdown table block into an HTML table.
 * First line = header, second line = separator (|---|), rest = rows.
 */
function renderTableFromLines(lines: string[]): React.ReactNode {
  // Filter out separator lines (contain only |, -, :)
  const dataLines = lines.filter((l) => !/^\|[\s\-:]+\|$/.test(l.trim()));
  if (dataLines.length < 2) {
    // Fallback: just render as text
    return (
      <div className="font-mono text-[11px] whitespace-pre-wrap">
        {dataLines.join('\n')}
      </div>
    );
  }

  const headerLine = dataLines[0];
  const headers = headerLine
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);

  const rows = dataLines.slice(1).map((rowLine) =>
    rowLine
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean),
  );

  return (
    <div className="overflow-x-auto my-1">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {headers.map((h, idx) => (
              <th
                key={idx}
                className="border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-700 px-2 py-1 text-start font-semibold text-zinc-700 dark:text-zinc-200"
              >
                {renderInlineText(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white/60 dark:bg-zinc-800/40' : 'bg-transparent'}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="border border-zinc-300 dark:border-zinc-600 px-2 py-1 text-start text-zinc-700 dark:text-zinc-300"
                >
                  {renderInlineText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Render inline text — handle **bold** markers and emojis.
 */
function renderInlineText(text: string): React.ReactNode {
  // Split on **...** patterns
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) {
    return <span>{text}</span>;
  }
  return (
    <span>
      {parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={idx}>{part.slice(2, -2)}</strong>;
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}
