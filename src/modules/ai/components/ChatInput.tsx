import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Send, Loader2, Plus, Mic, Square } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { useToastStore } from '@/core/store/toastStore';
import { cn } from '@/core/utils';
import { searchEntities } from '../entityResolver';
import { AutoCompleteDropdown } from './AutoCompleteDropdown';
import { useSpeechRecognition } from './useSpeechRecognition';
import type { EntityMatch } from '../entityResolver';

// TEMPORARY: autocomplete disabled (2026-07-31). Set back to true to re-enable.
const AUTOCOMPLETE_ENABLED = false;

/** Quick-action prompts shown as chips above the input (complement autocomplete). */
const QUICK_ACTIONS = [
  { key: 'invoice', labelKey: 'ai.suggestions.invoice' },
  { key: 'sales', labelKey: 'ai.suggestions.sales' },
  { key: 'stock', labelKey: 'ai.suggestions.stock' },
  { key: 'report', labelKey: 'ai.suggestions.report' },
  { key: 'navigate', labelKey: 'ai.suggestions.navigate' },
] as const;

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

export const ChatInput = memo(function ChatInput({ onSend, disabled, isProcessing }: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyId = useAppStore((s) => s.activeCompany?.id ?? '');
  const language = useAppStore((s) => s.language);

  // ── Voice input (Web Speech API) ────────────────────────────────────────────
  const speech = useSpeechRecognition(language === 'en' ? 'en-US' : 'ar-SA');
  // Text present before recording started + finalized transcript segments.
  const speechBaseRef = useRef('');
  const speechFinalRef = useRef('');

  const composeFromSpeech = useCallback((finalText: string, interim: string) => {
    const joiner = speechBaseRef.current && !speechBaseRef.current.endsWith(' ') ? ' ' : '';
    const finalJoiner = finalText ? ' ' : '';
    setValue(`${speechBaseRef.current}${joiner}${finalText}${finalText && interim ? finalJoiner : ''}${interim}`);
  }, []);

  const handleMicClick = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
      return;
    }
    const current = value.trim();
    speechBaseRef.current = current;
    speechFinalRef.current = '';
    const started = speech.start((text, isFinal) => {
      if (isFinal) {
        speechFinalRef.current = speechFinalRef.current ? `${speechFinalRef.current} ${text}` : text;
        composeFromSpeech(speechFinalRef.current, '');
      } else {
        composeFromSpeech(speechFinalRef.current, text);
      }
    });
    if (!started) {
      useToastStore.getState().addToast('error', t('ai.voice.error'));
    }
  }, [speech, value, composeFromSpeech, t]);

  // Surface recognition errors (mic permission denied, network, …) as toasts.
  useEffect(() => {
    if (!speech.error) return;
    const message = speech.error === 'not-allowed' || speech.error === 'service-not-allowed'
      ? t('ai.voice.notAllowed')
      : t('ai.voice.error');
    useToastStore.getState().addToast('error', message);
  }, [speech.error, t]);

  // Keep the textarea auto-sized when the transcript updates it programmatically.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  // ── Autocomplete state ─────────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<EntityMatch[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);

  // Close dropdown on blur
  const handleBlur = useCallback(() => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      setIsOpen(false);
      setSuggestions([]);
      setSelectedIdx(-1);
    }, 200);
  }, []);

  // Close dropdown on escape
  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);
  }, []);

  // Debounced search
  const triggerSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!AUTOCOMPLETE_ENABLED) {
      setIsOpen(false);
      setSuggestions([]);
      setSelectedIdx(-1);
      return;
    }

    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2 || !companyId) {
      setIsOpen(false);
      setSuggestions([]);
      setSelectedIdx(-1);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchEntities(trimmed, companyId);
        if (results.length > 0) {
          setSuggestions(results);
          setSelectedIdx(0);
          setIsOpen(true);
        } else {
          setIsOpen(false);
          setSuggestions([]);
          setSelectedIdx(-1);
        }
      } catch {
        setIsOpen(false);
        setSuggestions([]);
        setSelectedIdx(-1);
      }
    }, 250);
  }, [companyId]);

  // Handle text change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    triggerSearch(newVal);
    // Auto-resize
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [triggerSearch]);

  // ── Entity selection ───────────────────────────────────────────────────────

  /** Replace the last word in the textarea with the selected entity's name. */
  const selectEntity = useCallback((match: EntityMatch) => {
    const el = textareaRef.current;
    if (!el) return;

    const cursorPos = el.selectionStart ?? value.length;
    // Find word boundaries around cursor
    const before = value.slice(0, cursorPos);
    const after = value.slice(cursorPos);
    const lastSpace = before.lastIndexOf(' ');

    // Replace current word with entity name
    const newBefore = lastSpace >= 0 ? before.slice(0, lastSpace + 1) : '';
    const newValue = newBefore + match.name + after;

    setValue(newValue);
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);

    // Set cursor after inserted name
    requestAnimationFrame(() => {
      const newPos = newBefore.length + match.name.length;
      el.setSelectionRange(newPos, newPos);
      el.focus();
    });
  }, [value]);

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    if (speech.isListening) speech.stop();
    const trimmed = value.trim();
    if (!trimmed || disabled || isProcessing) return;
    onSend(trimmed);
    setValue('');
    speechBaseRef.current = '';
    speechFinalRef.current = '';
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    // Close autocomplete
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);
  }, [value, disabled, isProcessing, onSend, speech]);

  // ── Keyboard handling ──────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isOpen && suggestions.length > 0) {
        // Arrow up — previous suggestion
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
          return;
        }
        // Arrow down — next suggestion
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIdx((prev) => (prev >= suggestions.length - 1 ? 0 : prev + 1));
          return;
        }
        // Enter/Tab — select highlighted
        if (e.key === 'Enter' && !e.shiftKey && selectedIdx >= 0 && selectedIdx < suggestions.length) {
          e.preventDefault();
          selectEntity(suggestions[selectedIdx]);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
            selectEntity(suggestions[selectedIdx]);
          }
          return;
        }
        // Escape — close dropdown
        if (e.key === 'Escape') {
          handleClose();
          return;
        }
      }

      // Normal Enter to send
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }

      // Escape — clear input
      if (e.key === 'Escape' && !isOpen) {
        setValue('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    },
    [isOpen, suggestions, selectedIdx, selectEntity, handleSend, handleClose]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Quick-action chips — visible when idle, complement autocomplete */}
      {!isProcessing && (
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5 overflow-x-auto">
          <Plus size={12} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.key}
              onClick={() => onSend(t(qa.labelKey))}
              disabled={disabled || isProcessing}
              className="flex-shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-700 dark:hover:text-primary-300 transition-colors disabled:opacity-50"
              title={t(qa.labelKey)}
            >
              {t(qa.labelKey)}
            </button>
          ))}
        </div>
      )}

      <div className="relative flex items-end gap-2 p-3">
      {/* Autocomplete dropdown — positioned above the input */}
      {AUTOCOMPLETE_ENABLED && (
        <AutoCompleteDropdown
          matches={suggestions}
          isOpen={isOpen && suggestions.length > 0}
          selectedIndex={selectedIdx}
          onSelect={selectEntity}
        />
      )}

      <textarea
        ref={textareaRef}
        data-chat-input="true"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        rows={1}
        disabled={disabled || isProcessing}
        placeholder={speech.isListening ? t('ai.voice.listening') : t('ai.inputPlaceholder')}
        className={cn(
          'flex-1 resize-none rounded-lg border px-3 py-2 text-sm transition-colors',
          'bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100',
          speech.isListening
            ? 'border-red-300 dark:border-red-700 focus:ring-2 focus:ring-red-500/20'
            : 'border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'focus:outline-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'placeholder:text-slate-400 dark:placeholder:text-slate-500'
        )}
      />
      {/* Alternating action button: mic (empty input) ⇄ send (has text). */}
      {isProcessing ? (
        <div
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 animate-scale-in"
          title={t('ai.send')}
        >
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : value.trim() ? (
        <button
          onClick={handleSend}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg transition-all animate-scale-in',
            'bg-primary-600 text-white hover:bg-primary-700 active:scale-95',
            'shadow-sm shadow-primary-600/30',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={t('ai.send')}
          aria-label={t('ai.send')}
        >
          <Send size={18} className="rtl:-scale-x-100" />
        </button>
      ) : speech.isSupported ? (
        <button
          onClick={handleMicClick}
          disabled={disabled}
          className={cn(
            'relative flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg transition-all animate-scale-in active:scale-95',
            speech.isListening
              ? 'bg-red-500 text-white hover:bg-red-600 shadow-sm shadow-red-500/40'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 dark:hover:text-primary-400',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={speech.isListening ? t('ai.voice.stop') : t('ai.voice.start')}
          aria-label={speech.isListening ? t('ai.voice.stop') : t('ai.voice.start')}
        >
          {speech.isListening && (
            <span className="absolute inset-0 rounded-lg bg-red-400 opacity-30 animate-ping" aria-hidden="true" />
          )}
          {speech.isListening ? <Square size={14} className="relative fill-current" /> : <Mic size={18} className="relative" />}
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled || isProcessing}
          className={cn(
            'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg transition-colors',
            'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          )}
          title={t('ai.send')}
        >
          <Send size={18} />
        </button>
      )}
      </div>
    </div>
  );
});
