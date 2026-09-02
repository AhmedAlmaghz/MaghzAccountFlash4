import { memo, useState, useCallback } from 'react';
import { Bot, User, AlertCircle, Clipboard, Check, RefreshCw, Navigation, Wand2 } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import type { ChatMessage } from '../types';
import type { Suggestion } from '../suggestions/suggestionEngine';
import { ToolCallCard } from './ToolCallCard';
import { RichText } from './RichText';

interface MessageBubbleProps {
  message: ChatMessage;
  onConfirm?: (callId: string, approved: boolean) => void;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
  suggestions?: Suggestion[];
  onSuggestion?: (suggestion: Suggestion) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onConfirm,
  onRegenerate,
  isLastAssistant,
  suggestions,
  onSuggestion,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isAssistant = !isUser;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  return (
    <div className={cn('group flex gap-2.5 sm:gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar — gradient for assistant, soft for user */}
      <div
        className={cn(
          'flex-shrink-0 w-9 h-9 rounded-2xl flex items-center justify-center',
          isUser
            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
            : 'bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lift'
        )}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      {/* Content */}
      <div className={cn('flex flex-col gap-1.5 max-w-[85%] sm:max-w-[75%]', isUser ? 'items-end' : 'items-start')}>
        {/* Text content */}
        {message.content && (
          <div className="relative">
            <div
              className={cn(
                'px-4 py-3 rounded-2xl text-sm leading-relaxed',
                isUser
                  ? 'bg-gradient-to-br from-primary-600 to-primary-700 text-white rounded-br-md shadow-lift'
                  : message.kind === 'error'
                    ? 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800 rounded-bl-md'
                    : 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200/70 dark:border-zinc-700 shadow-card rounded-bl-md'
              )}
            >
              {message.kind === 'error' && <AlertCircle size={14} className="inline ms-1 -mt-0.5" />}
              {isAssistant && message.kind !== 'error' ? (
                <RichText text={message.content} />
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>

            {/* Copy button — visible on hover / always in reach on touch */}
            <button
              onClick={handleCopy}
              className={cn(
                'absolute -top-2 end-0 p-1.5 rounded-lg transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-card',
                'text-zinc-400 dark:text-zinc-300 hover:text-primary-600 dark:hover:text-primary-400'
              )}
              title={t('ai.messageActions.copy')}
              aria-label={t('ai.messageActions.copy')}
            >
              {copied ? <Check size={13} /> : <Clipboard size={13} />}
            </button>
          </div>
        )}

        {/* Tool call card */}
        {message.toolCall && (
          <ToolCallCard toolCall={message.toolCall} onConfirm={onConfirm} />
        )}

        {/* Interactive suggestion chips — under assistant messages
            (ChatPanel renders contextual ones after the last reply too; these
            keep per-message support for tests + widget usage) */}
        {isAssistant && suggestions && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSuggestion?.(s)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-full border transition-all active:scale-95',
                  'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/80',
                  'text-zinc-600 dark:text-zinc-300',
                  'hover:bg-primary-50 dark:hover:bg-primary-950/40 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-700 dark:hover:text-primary-300',
                  'cursor-pointer'
                )}
                title={
                  s.type === 'navigate'
                    ? t('ai.suggestions.navigateChip')
                    : t('ai.suggestions.promptChip')
                }
              >
                {s.type === 'navigate' ? (
                  <Navigation size={11} className="flex-shrink-0" />
                ) : (
                  <Wand2 size={11} className="flex-shrink-0" />
                )}
                <span>{t(s.labelKey)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Regenerate button — only on last assistant message */}
        {isLastAssistant && !isUser && message.kind !== 'error' && onRegenerate && (
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-400 dark:text-zinc-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title={t('ai.messageActions.regenerate')}
          >
            <RefreshCw size={12} />
            <span>{t('ai.messageActions.regenerate')}</span>
          </button>
        )}
      </div>
    </div>
  );
});
