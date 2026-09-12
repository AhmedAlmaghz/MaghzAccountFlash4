import { memo, useState, useCallback, useEffect } from 'react';
import {
  Bot,
  User,
  AlertCircle,
  Clipboard,
  Check,
  RefreshCw,
  Navigation,
  Wand2,
  Volume2,
  Square,
} from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import type { ChatMessage } from '../types';
import type { Suggestion } from '../suggestions/suggestionEngine';
import { ToolCallCard } from './ToolCallCard';
import { BatchProgressCard } from './BatchProgressCard';
import { RichText } from './RichText';
import { formatAttachmentSize, hasAttachmentBlob, type AttachmentKind } from '../attachments';

function chipIcon(kind: AttachmentKind) {
  // Text-only glyphs keep the bubble light — no extra icon imports needed
  // beyond the shared set; reuse a generic marker per kind.
  switch (kind) {
    case 'image': return '🖼️';
    case 'pdf': return '📄';
    case 'spreadsheet': return '📊';
    case 'audio': return '🎙️';
    case 'other': return '📎';
  }
}

/**
 * Detect the dominant script of a text chunk for speech synthesis.
 * Arabic (incl. digits/punct) → 'ar', Latin → 'en', fallback → null (no TTS).
 */
function detectSpeechLang(text: string): string | null {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return null;
  return arabic >= latin ? 'ar' : 'en';
}

/** Strip markdown artifacts so the synthesizer reads clean prose. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/^>\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const [speaking, setSpeaking] = useState(false);

  const speakableText = stripMarkdown(message.content || '');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const handleSpeak = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }
    // Toggle: speaking → stop
    if (speaking) {
      stopSpeaking();
      return;
    }
    if (!speakableText) return;

    // Cancel anything queued globally, pick a matching voice for the
    // auto-detected language, and speak at a clear, professional pace.
    window.speechSynthesis.cancel();

    const lang = detectSpeechLang(speakableText) ?? 'ar';
    const utter = new SpeechSynthesisUtterance(speakableText);
    utter.lang = lang === 'ar' ? 'ar-YE' : 'en-US';
    utter.rate = 1.0;
    utter.pitch = 1.0;

    // Prefer a native voice for the detected language when available.
    const voices = window.speechSynthesis.getVoices();
    const match =
      voices.find((v) => v.lang?.toLowerCase().startsWith(lang) && v.localService) ??
      voices.find((v) => v.lang?.toLowerCase().startsWith(lang));
    if (match) utter.voice = match;

    utter.onend = () => {
      setSpeaking(false);
    };
    utter.onerror = () => {
      setSpeaking(false);
    };

    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }, [speakableText, speaking, stopSpeaking]);

  // Stop audio when the bubble unmounts (session switch, clear, etc.).
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const canSpeak =
    !!speakableText && typeof window !== 'undefined' && !!window.speechSynthesis;

  const actionBtn =
    'p-2 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800';

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
                  // P2 fix: logical corners (rounded-ee) instead of physical
                  // (rounded-br) — the app defaults to dir="rtl", where the
                  // physical corner points AWAY from the avatar.
                  ? 'bg-gradient-to-br from-primary-600 to-primary-700 text-white rounded-ee-md shadow-lift'
                  : message.kind === 'error'
                    ? 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800 rounded-es-md'
                    : 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200/70 dark:border-zinc-700 shadow-card rounded-es-md'
              )}
            >
              {message.kind === 'error' && <AlertCircle size={14} className="inline ms-1 -mt-0.5" />}
              {isAssistant && message.kind !== 'error' ? (
                <RichText text={message.content} />
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>

            {/* Message actions — copy + speak, always visible (touch friendly) */}
            <div
              className={cn(
                'flex items-center gap-0.5 mt-1',
                isUser ? 'flex-row-reverse' : 'flex-row'
              )}
            >
              <button
                onClick={handleCopy}
                className={cn(actionBtn, copied && 'text-success-600 dark:text-success-400')}
                title={copied ? t('ai.messageActions.copied') : t('ai.messageActions.copy')}
                aria-label={t('ai.messageActions.copy')}
              >
                {copied ? <Check size={14} /> : <Clipboard size={14} />}
              </button>
              {canSpeak && (
                <button
                  onClick={handleSpeak}
                  className={cn(actionBtn, speaking && 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/40')}
                  title={speaking ? t('ai.messageActions.stopSpeaking') : t('ai.messageActions.speak')}
                  aria-label={speaking ? t('ai.messageActions.stopSpeaking') : t('ai.messageActions.speak')}
                >
                  {speaking ? <Square size={13} className="fill-current" /> : <Volume2 size={15} />}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Attachment chips — metadata persisted with the message; the binary
            itself may have expired with the renderer session (thumbnail then
            hides, extracted text stays in the conversation). */}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {message.attachments.map((a) => {
              const live = hasAttachmentBlob(a.id);
              return (
                <span
                  key={a.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 max-w-full px-2.5 py-1.5 rounded-xl text-xs',
                    'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
                    'border border-zinc-200 dark:border-zinc-700'
                  )}
                  title={live ? a.name : `${a.name} — ${t('ai.attach.expired')}`}
                >
                  <span aria-hidden="true">{chipIcon(a.kind)}</span>
                  <span className="truncate max-w-[140px]">{a.name}</span>
                  <span className="text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                    {formatAttachmentSize(a.size)}
                  </span>
                  {!live && (
                    <span className="text-amber-600 dark:text-amber-400 flex-shrink-0" aria-label={t('ai.attach.expired')}>
                      ⏳
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* Tool call card */}
        {message.toolCall && (
          <ToolCallCard toolCall={message.toolCall} onConfirm={onConfirm} />
        )}

        {/* Live batch progress — any card driving a batch (enqueue approval,
            resume approval, or a resumed run) shows substance, not text. */}
        {message.toolCall?.batchId && (
          <div className="w-full">
            <BatchProgressCard batchId={message.toolCall.batchId} />
          </div>
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
