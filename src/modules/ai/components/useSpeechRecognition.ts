import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

export interface SpeechRecognitionHandle {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionHandle;

/** Feature-detect the Web Speech API (Chrome/Edge: webkitSpeechRecognition). */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognition {
  isSupported: boolean;
  isListening: boolean;
  /** Last recognition error code ('not-allowed' | 'no-speech' | 'network' | …). */
  error: string | null;
  /**
   * Start listening. `onTranscript` is invoked with spoken text as it arrives:
   * `isFinal=false` for interim hypotheses, `true` for finalized segments.
   * Returns false when the API is unavailable or already listening.
   */
  start: (onTranscript: (text: string, isFinal: boolean) => void) => boolean;
  stop: () => void;
}

/**
 * Thin, framework-agnostic wrapper over the Web Speech API.
 * A fresh recognition instance is created per session (most reliable pattern);
 * the transcript callback is kept in a ref so re-renders never stale-capture it.
 */
export function useSpeechRecognition(lang: string): UseSpeechRecognition {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionHandle | null>(null);
  const transcriptRef = useRef<(text: string, isFinal: boolean) => void>(() => {});

  const isSupported = getSpeechRecognitionCtor() !== null;

  const start = useCallback(
    (onTranscript: (text: string, isFinal: boolean) => void): boolean => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor || recognitionRef.current) return false;
      transcriptRef.current = onTranscript;
      setError(null);

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? '';
          if (!text) continue;
          if (result.isFinal) finalText += text;
          else interim += text;
        }
        if (finalText) transcriptRef.current(finalText.trim(), true);
        if (interim) transcriptRef.current(interim.trim(), false);
      };
      rec.onerror = (event) => {
        // 'no-speech' / 'aborted' are benign — surface the rest to the UI.
        if (event.error && event.error !== 'no-speech' && event.error !== 'aborted') {
          setError(event.error);
        }
      };
      rec.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };

      recognitionRef.current = rec;
      try {
        rec.start();
        setIsListening(true);
        return true;
      } catch {
        recognitionRef.current = null;
        return false;
      }
    },
    [lang]
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Never leak a live microphone session across unmounts.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
