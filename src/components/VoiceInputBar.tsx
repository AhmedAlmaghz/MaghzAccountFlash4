import React, { useState, useMemo, useCallback } from 'react';
import { Mic, MicOff, Send, Sparkles, X, Globe } from 'lucide-react';
import { useVoiceDictation, type VoiceCommand } from '@/hooks/useVoiceDictation';

interface VoiceInputBarProps {
  onSendMessage: (text: string) => void;
  placeholder?: string;
  isRtl?: boolean;
}

export const VoiceInputBar: React.FC<VoiceInputBarProps> = ({
  onSendMessage,
  placeholder = 'اكتب رسالتك أو تحدث صوتياً...',
  isRtl = true,
}) => {
  const [inputText, setInputText] = useState('');

  const commands: VoiceCommand[] = useMemo(() => [
    {
      keywords: ['ارسل', 'إرسال', 'send', 'submit'],
      action: () => {
        if (inputText.trim()) {
          onSendMessage(inputText);
          setInputText('');
        }
      },
      feedbackTextAr: '⚡ تم تنفيذ الأمر: إرسال الرسالة',
      feedbackTextEn: '⚡ Voice Command: Message Sent',
    },
    {
      keywords: ['امسح', 'مسح', 'تفريغ', 'clear'],
      action: () => setInputText(''),
      feedbackTextAr: '⚡ تم تفريغ النص',
      feedbackTextEn: '⚡ Voice Command: Text Cleared',
    },
    {
      keywords: ['محادثة جديدة', 'new chat'],
      action: () => setInputText(''),
      feedbackTextAr: '⚡ محادثة جديدة',
      feedbackTextEn: '⚡ New Chat',
    },
  ], [inputText, onSendMessage]);

  const handleFinalSpeech = useCallback((spokenChunk: string) => {
    setInputText((prev) => (prev ? `${prev} ${spokenChunk}` : spokenChunk));
  }, []);

  const {
    isListening,
    isSupported,
    speechLang,
    interimText,
    audioLevel,
    toastMessage,
    setToastMessage,
    toggleListening,
    stopListening,
    toggleSpeechLang,
  } = useVoiceDictation({
    lang: isRtl ? 'ar-SA' : 'en-US',
    onFinalTranscript: handleFinalSpeech,
    commands,
  });

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  if (!isSupported) {
    return (
      <div className="text-xs text-amber-600 dark:text-amber-400 p-2 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 rounded-xl">
        المتصفح لا يدعم Web Speech API. يُرجى استخدام Google Chrome أو Edge.
      </div>
    );
  }

  return (
    <div className="w-full space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
      {toastMessage && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-cyan-950/90 border border-cyan-500/40 text-cyan-200 text-xs font-semibold animate-in fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-cyan-400 hover:text-white p-1">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <form
        onSubmit={handleManualSubmit}
        className={`relative rounded-2xl bg-white dark:bg-zinc-900 border transition-all duration-200 p-3 shadow-sm ${
          isListening
            ? 'border-rose-500/80 ring-2 ring-rose-500/20'
            : 'border-zinc-200 dark:border-zinc-800 focus-within:border-cyan-500'
        }`}
      >
        {isListening && (
          <div className="mb-2 flex flex-col gap-1.5 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                </span>
                <span className="font-semibold text-[11px] text-rose-700 dark:text-rose-300">جاري الاستماع...</span>
                {interimText && (
                  <span className="text-zinc-600 dark:text-zinc-400 italic text-[11px] truncate max-w-[160px]">
                    &quot;{interimText}&quot;
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={toggleSpeechLang}
                  className="px-2 py-0.5 rounded bg-white dark:bg-zinc-800 hover:bg-zinc-50 border border-rose-200 dark:border-rose-800 text-[10px] font-mono text-rose-700 dark:text-rose-300 flex items-center gap-1"
                >
                  <Globe className="w-2.5 h-2.5" />
                  <span>{speechLang === 'ar-SA' ? 'عربي' : 'EN'}</span>
                </button>
                <button
                  type="button"
                  onClick={stopListening}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm"
                >
                  <X className="w-3 h-3" />
                  إيقاف
                </button>
              </div>
            </div>
            {/* مخطط الموجة الحي — 16 شريطاً بارتفاع مرتبط بـ audioLevel */}
            <div className="flex items-center justify-center gap-[2px] h-6 px-1" aria-hidden="true">
              {Array.from({ length: 16 }).map((_, i) => {
                const base = 4 + Math.abs(Math.sin((i * 0.9) + (audioLevel / 12))) * 14;
                const h = isListening ? Math.max(4, Math.min(20, base + (audioLevel / 100) * 12 + (Math.random() * 2 - 1))) : 4;
                return (
                  <span
                    key={i}
                    className="w-[3px] bg-rose-500 dark:bg-rose-400 rounded-full transition-[height] duration-75"
                    style={{ height: `${h}px`, opacity: 0.7 + (h / 20) * 0.3 }}
                  />
                );
              })}
            </div>
            <p className="text-[10px] text-center text-rose-600/70 dark:text-rose-400/70">تحدث الآن — سيُضاف كلامك إلى النص الحالي تلقائياً</p>
          </div>
        )}

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed"
        />

        <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800 mt-2">
          <button
            type="button"
            onClick={toggleListening}
            className={`p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-xs font-semibold ${
              isListening
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/20 animate-pulse'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
            }`}
            title="تفعيل الإملاء الصوتي والأوامر"
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            <span>{isListening ? 'إيقاف' : 'إملاء صوتي'}</span>
          </button>

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="flex items-center justify-center p-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold disabled:opacity-40 transition-all shadow-md shadow-cyan-500/20"
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default VoiceInputBar;
