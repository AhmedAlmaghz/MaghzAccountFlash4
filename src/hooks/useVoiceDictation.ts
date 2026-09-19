import { useState, useEffect, useRef, useCallback } from 'react';

export interface VoiceCommand {
  keywords: string[];
  action: () => void;
  feedbackTextAr: string;
  feedbackTextEn: string;
}

interface UseVoiceDictationOptions {
  lang?: 'ar-SA' | 'en-US';
  onFinalTranscript?: (text: string) => void;
  commands?: VoiceCommand[];
}

export function useVoiceDictation({
  lang = 'ar-SA',
  onFinalTranscript,
  commands = [],
}: UseVoiceDictationOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [speechLang, setSpeechLang] = useState<'ar-SA' | 'en-US'>(lang);
  const [interimText, setInterimText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const recognitionRef = useRef<any | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // 1. مولد المؤثرات الصوتية الصافي (Web Audio API)
  const playChime = useCallback((type: 'start' | 'stop' | 'command') => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'start') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'stop') {
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'command') {
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.06);
        osc.frequency.setValueAtTime(783.99, now + 0.12);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch {
      // تجاهل الأخطاء غير الحرجة في الصوت
    }
  }, []);

  // 2. فحص وتنفيذ الأوامر الصوتية
  const matchVoiceCommand = useCallback((spokenText: string): boolean => {
    const clean = spokenText.trim().toLowerCase();
    for (const cmd of commands) {
      if (cmd.keywords.some((kw) => clean.includes(kw.toLowerCase()))) {
        playChime('command');
        setToastMessage(speechLang === 'ar-SA' ? cmd.feedbackTextAr : cmd.feedbackTextEn);
        cmd.action();
        return true;
      }
    }
    return false;
  }, [commands, playChime, speechLang]);

  // 3. تهيئة Web Speech Recognition
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const w = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SpeechRecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechLang;

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript;
        } else {
          currentInterim += item[0].transcript;
        }
      }

      const textToCheck = (finalTranscript || currentInterim).trim();

      const isCmd = matchVoiceCommand(textToCheck);
      if (isCmd) {
        setInterimText('');
        return;
      }

      if (currentInterim) {
        setInterimText(currentInterim);
      }

      if (finalTranscript && onFinalTranscript) {
        onFinalTranscript(finalTranscript);
        setInterimText('');
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition as unknown as any;

    return () => {
      try {
        recognition.abort();
      } catch {}
    };
  }, [speechLang, matchVoiceCommand, onFinalTranscript]);

  // 4. تبديل حالة الاستماع
  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      playChime('stop');
      setInterimText('');
    } else {
      try {
        (recognitionRef.current as unknown as { lang: string }).lang = speechLang;
        recognitionRef.current.start();
        setIsListening(true);
        playChime('start');
        setToastMessage(null);
      } catch (err) {
        console.error('Speech recognition error:', err);
      }
    }
  }, [isListening, speechLang, playChime]);

  // 5. تبديل لغة الصوت (عربي / إنجليزي)
  const toggleSpeechLang = useCallback(() => {
    const nextLang = speechLang === 'ar-SA' ? 'en-US' : 'ar-SA';
    setSpeechLang(nextLang);
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setTimeout(() => {
        try {
          (recognitionRef.current as unknown as { lang: string }).lang = nextLang;
          recognitionRef.current!.start();
          setIsListening(true);
        } catch {}
      }, 150);
    }
  }, [speechLang, isListening]);

  return {
    isListening,
    isSupported,
    speechLang,
    interimText,
    toastMessage,
    setToastMessage,
    toggleListening,
    toggleSpeechLang,
  };
}
