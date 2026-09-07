import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Send, Mic, Square, Paperclip, X, Image as ImageIcon, FileText, Table, Mic as MicIcon, Loader2, Camera } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { useToastStore } from '@/core/store/toastStore';
import { cn } from '@/core/utils';
import { useSpeechRecognition } from './useSpeechRecognition';
import { CameraCapture } from './CameraCapture';
import { useAiStore } from '../store';
import {
  buildAttachmentDraftBlock,
  dropAttachmentBlob,
  formatAttachmentSize,
  processAttachmentFile,
  type AttachmentKind,
  type PreparedAttachment,
} from '../attachments';
// NOTE (Phase 77ب): the letter-level autocomplete (AutoCompleteDropdown +
// per-keystroke searchEntities) was dead code — disabled by
// AUTOCOMPLETE_ENABLED=false since 2026-07-31 and superseded by the chat
// engine's own entity resolution (resolveEntitiesInText runs on every send,
// corrects names in-place and shows the user what changed). The component,
// its wiring and the flag were removed; re-introducing per-keystroke
// suggestions should reuse searchEntities' RBAC-filtered API instead.

interface ChatInputProps {
  onSend: (text: string, attachments: PreparedAttachment[]) => void;
  /** Request the in-flight generation to stop at the next safe point. */
  onStop?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

function kindIcon(kind: AttachmentKind) {
  switch (kind) {
    case 'image': return <ImageIcon size={14} className="flex-shrink-0" />;
    case 'pdf': return <FileText size={14} className="flex-shrink-0" />;
    case 'spreadsheet': return <Table size={14} className="flex-shrink-0" />;
    case 'audio': return <MicIcon size={14} className="flex-shrink-0" />;
    case 'other': return <Paperclip size={14} className="flex-shrink-0" />;
  }
}

export const ChatInput = memo(function ChatInput({ onSend, onStop, disabled, isProcessing }: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const language = useAppStore((s) => s.language);

  // ── Attachments (Package B: multimodal intake) ──────────────────────────
  // Files are processed locally (classify → cap → sha256 → extract/downscale)
  // and their printable draft block is appended to the textarea (editable).
  // The chip is the source of truth at send time — textarea edits advisory.
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [attachMenu, setAttachMenu] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const attachmentsRef = useRef<PreparedAttachment[]>([]);
  attachmentsRef.current = attachments;

  const appendDraft = useCallback((block: string) => {
    setValue((v) => (v ? `${v.replace(/\s+$/, '')}\n\n${block}` : block));
  }, []);

  const sessionHashes = useCallback(() => {
    const hashes = new Set<string>();
    for (const m of useAiStore.getState().messages) {
      for (const a of m.attachments ?? []) hashes.add(a.sha256);
    }
    return hashes;
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setExtracting(true);
    try {
      for (const file of list) {
        const pending = new Set(attachmentsRef.current.map((a) => a.meta.sha256));
        try {
          const { attachment, duplicateOfPending } = await processAttachmentFile(file, pending);
          if (duplicateOfPending) {
            useToastStore.getState().addToast('error', t('ai.attach.duplicateInInput'));
            continue;
          }
          if (sessionHashes().has(attachment.meta.sha256)) {
            useToastStore.getState().addToast('error', t('ai.attach.alreadyInSession'));
          }
          setAttachments((prev) => [...prev, attachment]);
          appendDraft(buildAttachmentDraftBlock(attachment.meta));
        } catch (e) {
          useToastStore.getState().addToast('error', e instanceof Error ? e.message : t('ai.attach.extractFailed'));
        }
      }
    } finally {
      setExtracting(false);
    }
  }, [appendDraft, sessionHashes, t]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.meta.id === id);
      if (found) dropAttachmentBlob(id);
      return prev.filter((a) => a.meta.id !== id);
    });
  }, []);

  const openFilePicker = useCallback(() => {
    setAttachMenu(false);
    fileInputRef.current?.click();
  }, []);

  const openCamera = useCallback(() => {
    setAttachMenu(false);
    setCameraOpen(true);
  }, []);

  const handleCameraCapture = useCallback((file: File) => {
    void handleFiles([file]);
  }, [handleFiles]);

  // ── Voice input (Web Speech API) ────────────────────────────────────────────
  // ar-YE matches the app's DEFAULT_LOCALE (locale.ts) — Gulf/Saudi voices
  // mispronounce Yemeni brand terms and number formats.
  const speech = useSpeechRecognition(language === 'en' ? 'en-US' : 'ar-YE');
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

  // Handle text change (auto-resize only — no per-keystroke search).
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
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
  }, []);

  // ── Send ───────────────────────────────────────────────────────────────────

  const canSend = value.trim() !== '' || attachments.length > 0;

  const handleSend = useCallback(() => {
    if (speech.isListening) speech.stop();
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled || isProcessing) return;
    const outgoing = attachmentsRef.current;
    onSend(trimmed, outgoing);
    // Binaries are single-use: the send consumed them (engine holds dataUrls
    // in the outgoing objects). Drop the registry copies to free memory —
    // regenerate resends text only by design.
    for (const a of outgoing) dropAttachmentBlob(a.meta.id);
    setValue('');
    setAttachments([]);
    speechBaseRef.current = '';
    speechFinalRef.current = '';
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, attachments.length, disabled, isProcessing, onSend, speech]);

  // ── Keyboard handling ──────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter to send
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }

      // Escape — clear input
      if (e.key === 'Escape') {
        setValue('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    },
    [handleSend]
  );

  return (
    <div className="flex flex-col border-t border-zinc-200/70 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
      <div className="flex flex-col gap-2 p-3 max-w-3xl w-full mx-auto px-3 sm:px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)]">

      {/* Attachment chips — the pending files behind this message */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t('ai.attach.attachmentsCount')}>
          {attachments.map((a) => (
            <span
              key={a.meta.id}
              className={cn(
                'inline-flex items-center gap-1.5 max-w-full ps-2 pe-1 py-1 rounded-xl text-xs',
                'bg-primary-50 dark:bg-primary-950/40 text-primary-800 dark:text-primary-200',
                'border border-primary-200 dark:border-primary-800'
              )}
            >
              {kindIcon(a.meta.kind)}
              <span className="truncate max-w-[140px]" title={a.meta.name}>{a.meta.name}</span>
              <span className="text-primary-500 dark:text-primary-400 flex-shrink-0">{formatAttachmentSize(a.meta.size)}</span>
              <button
                onClick={() => removeAttachment(a.meta.id)}
                className="p-1 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/60"
                title={t('ai.attach.remove')}
                aria-label={`${t('ai.attach.remove')}: ${a.meta.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {extracting && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xl text-xs text-zinc-500 dark:text-zinc-400">
              <Loader2 size={12} className="animate-spin" />
              {t('ai.attach.extracting')}
            </span>
          )}
        </div>
      )}

      <div className="relative flex items-end gap-2">
      {/* Attach button + menu */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setAttachMenu((v) => !v)}
          disabled={disabled || isProcessing}
          className={cn(
            'w-12 h-12 flex items-center justify-center rounded-2xl transition-all active:scale-90',
            'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
            'hover:bg-primary-50 dark:hover:bg-primary-950/40 hover:text-primary-600 dark:hover:text-primary-400',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={t('ai.attach.attachFile')}
          aria-label={t('ai.attach.attachFile')}
          aria-expanded={attachMenu}
        >
          <Paperclip size={19} />
        </button>
        {attachMenu && (
          <div className="absolute bottom-14 start-0 z-50 min-w-[160px] rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lift p-1.5">
            <button
              onClick={openFilePicker}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Paperclip size={15} />
              {t('ai.attach.fromDevice')}
            </button>
            <button
              onClick={openCamera}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Camera size={15} />
              {t('ai.attach.takePhoto')}
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.pdf,.xlsx,.xls,.csv,audio/*"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <textarea
        ref={textareaRef}
        data-chat-input="true"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
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
      {/* Alternating action button: mic (empty input) ⇄ send (has text) ⇄ stop (processing). */}
      {isProcessing ? (
        <button
          onClick={() => onStop?.()}
          disabled={disabled || !onStop}
          className={cn(
            'flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-all active:scale-90 animate-scale-in',
            'bg-danger-500 text-white hover:bg-danger-600 hover:shadow-lift',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={t('ai.stopGeneration')}
          aria-label={t('ai.stopGeneration')}
        >
          <Square size={16} className="fill-current" />
        </button>
      ) : canSend ? (
        <button
          onClick={handleSend}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-all animate-scale-in active:scale-90',
            'bg-gradient-to-br from-primary-500 to-primary-700 text-white hover:shadow-lift',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title={attachments.length > 0 ? t('ai.attach.sendWithAttachments') : t('ai.send')}
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
          disabled={!canSend || disabled || isProcessing}
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

      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={handleCameraCapture} />
    </div>
  );
});
