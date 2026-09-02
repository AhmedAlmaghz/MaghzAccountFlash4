import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Send, Loader2, Mic, Square } from 'lucide-react';
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
  /** Last interim hypothesis — used to dedupe when it later finalizes. */
  const speechInterimRef = useRef('');

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
    speechInterimRef.current = '';
    const started = speech.start((text, isFinal) => {
      if (isFinal) {
        // A finalized segment usually arrives after its own interim was
        // already shown. Trim the overlap so words never duplicate: if the
        // final text starts with (or contains) the shown interim, drop the
        // interim part; otherwise treat the whole final as new.
        const shown = speechInterimRef.current.trim();
        let segment = text.trim();
        if (shown && segment.startsWith(shown)) {
          segment = segment.slice(shown.length).trim();
        } else if (shown && shown.startsWith(segment)) {
          segment = ''; // final is a subset of the interim — nothing new
        }
        speechInterimRef.current = '';
        if (segment) {
          speechFinalRef.current = speechFinalRef.current
            ? `${speechFinalRef.current} ${segment}`
            : segment;
        }
        composeFromSpeech(speechFinalRef.current, '');
      } else {
        // Live hypothesis — shown as the tail; finalization will dedupe.
        speechInterimRef.current = text;
        composeFromSpeech(speechFinalRef.current, text.trim());
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
  // Single-line look by default (one row height), grows only past one line,
  // capped at 5 lines (~120px).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const oneLine = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const paddingY = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom) || 24;
    const minHeight = Math.ceil(oneLine + paddingY);
    const needed = Math.min(el.scrollHeight, 120);
    el.style.height = `${Math.max(minHeight, needed)}px`;
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
    // Auto-resize — single-line default, grow past one line only
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      const oneLine = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const paddingY = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom) || 24;
      const minHeight = Math.ceil(oneLine + paddingY);
      const needed = Math.min(el.scrollHeight, 120);
      el.style.height = `${Math.max(minHeight, needed)}px`;
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
    <div className="flex flex-col border-t border-zinc-200/70 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
      <div className="relative flex items-end gap-2 p-3 max-w-3xl w-full mx-auto px-3 sm:px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
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
          'flex-1 resize-none rounded-2xl border px-4 py-2.5 text-base sm:text-sm transition-colors overflow-hidden leading-normal',
          'bg-zinc-100/80 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100',
          speech.isListening
            ? 'border-red-300 dark:border-red-700 focus:ring-2 focus:ring-red-500/20'
            : 'border-zinc-200 dark:border-zinc-700 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 dark:focus:border-primary-400',
          'focus:outline-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'placeholder:text-zinc-400 dark:placeholder:text-zinc-500'
        )}
      />
      {/* Alternating action button: mic (empty input) ⇄ send (has text). */}
      {isProcessing ? (
        <div
          className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 animate-scale-in"
          title={t('ai.send')}
        >
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : value.trim() ? (
        <button
          onClick={handleSend}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-all animate-scale-in active:scale-90',
            'bg-gradient-to-br from-primary-500 to-primary-700 text-white hover:shadow-lift',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={t('ai.send')}
          aria-label={t('ai.send')}
        >
          <Send size={19} className="rtl:-scale-x-100" />
        </button>
      ) : speech.isSupported ? (
        <button
          onClick={handleMicClick}
          disabled={disabled}
          className={cn(
            'relative flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-all animate-scale-in active:scale-90',
            speech.isListening
              ? 'bg-danger-500 text-white hover:bg-danger-600 shadow-lift'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-primary-50 dark:hover:bg-primary-950/40 hover:text-primary-600 dark:hover:text-primary-400',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={speech.isListening ? t('ai.voice.stop') : t('ai.voice.start')}
          aria-label={speech.isListening ? t('ai.voice.stop') : t('ai.voice.start')}
        >
          {speech.isListening && (
            <span className="absolute inset-0 rounded-2xl bg-red-400 opacity-30 animate-ping" aria-hidden="true" />
          )}
          {speech.isListening ? <Square size={15} className="relative fill-current" /> : <Mic size={19} className="relative" />}
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled || isProcessing}
          className={cn(
            'flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-colors',
            'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
          )}
          title={t('ai.send')}
        >
          <Send size={19} />
        </button>
      )}
      </div>
    </div>
  );
});
