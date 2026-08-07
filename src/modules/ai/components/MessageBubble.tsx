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
    <div className={cn('group flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser
            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
        )}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      {/* Content */}
      <div className={cn('flex flex-col gap-1 max-w-[75%]', isUser ? 'items-end' : 'items-start')}>
        {/* Text content */}
        {message.content && (
          <div className="relative">
            <div
              className={cn(
                'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                isUser
                  ? 'bg-primary-600 text-white rounded-br-md'
                  : message.kind === 'error'
                    ? 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800 rounded-bl-md'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-md'
              )}
            >
              {message.kind === 'error' && <AlertCircle size={14} className="inline ml-1 -mt-0.5" />}
              {isAssistant && message.kind !== 'error' ? (
                <RichText text={message.content} />
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>

            {/* Copy button — visible on hover */}
            <button
              onClick={handleCopy}
              className={cn(
                'absolute -top-2 end-0 p-1 rounded-md transition-opacity opacity-0 group-hover:opacity-100',
                'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm',
                'text-slate-400 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400'
              )}
              title={t('ai.messageActions.copy')}
            >
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
            </button>
          </div>
        )}

        {/* Tool call card */}
        {message.toolCall && (
          <ToolCallCard toolCall={message.toolCall} onConfirm={onConfirm} />
        )}

        {/* Interactive suggestion chips — under assistant messages */}
        {isAssistant && suggestions && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSuggestion?.(s)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                  'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800',
                  'text-slate-600 dark:text-slate-300',
                  'hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-700 dark:hover:text-primary-300',
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
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 dark:text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
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
