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
 *
 * Continuous-listening hardening: Chrome ends the session on silence/timeout
 * even with `continuous = true`, dropping the trailing words. While the user
 * hasn't pressed stop, we transparently restart the engine; `onresult` uses
 * absolute `event.results` indexing so finalized segments are never re-fired,
 * which is what previously caused duplicated words.
 */
export function useSpeechRecognition(lang: string): UseSpeechRecognition {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionHandle | null>(null);
  const transcriptRef = useRef<(text: string, isFinal: boolean) => void>(() => {});
  /** True while the user wants to keep listening (until explicit stop). */
  const wantListeningRef = useRef(false);
  /**
   * Result indices already emitted as FINAL. Interim hypotheses are
   * re-emitted freely (they're display-only); a finalized segment is
   * emitted exactly once — across engine restarts too — which is what
   * previously caused duplicated words.
   */
  const finalizedIdxRef = useRef<Set<number>>(new Set());

  const isSupported = getSpeechRecognitionCtor() !== null;

  const start = useCallback(
    (onTranscript: (text: string, isFinal: boolean) => void): boolean => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor || recognitionRef.current) return false;
      transcriptRef.current = onTranscript;
      setError(null);
      wantListeningRef.current = true;
      finalizedIdxRef.current = new Set();

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? '';
          if (!text) continue;
          if (result.isFinal) {
            // Emit each finalized segment exactly once — a restart quirk
            // or an interim→final evolution must never double-fire.
            if (!finalizedIdxRef.current.has(i)) {
              finalizedIdxRef.current.add(i);
              finalText = finalText ? `${finalText} ${text}` : text;
            }
          } else {
            interim = interim ? `${interim} ${text}` : text;
          }
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
        if (wantListeningRef.current) {
          // Chrome stopped on silence — restart transparently. A fresh
          // instance keeps the mic open; the absolute index guard above
          // prevents duplicate emissions across the restart.
          const Next = getSpeechRecognitionCtor();
          if (!Next) {
            wantListeningRef.current = false;
            setIsListening(false);
            return;
          }
          try {
            const restart = new Next();
            restart.lang = lang;
            restart.continuous = true;
            restart.interimResults = true;
            restart.maxAlternatives = 1;
            restart.onresult = rec.onresult;
            restart.onerror = rec.onerror;
            restart.onend = rec.onend;
            recognitionRef.current = restart;
            restart.start();
            // Engine restart resets interim results — a new interim session
            // begins; nothing to flush since finals already went through.
          } catch {
            wantListeningRef.current = false;
            setIsListening(false);
          }
          return;
        }
        setIsListening(false);
      };

      recognitionRef.current = rec;
      try {
        rec.start();
        setIsListening(true);
        return true;
      } catch {
        recognitionRef.current = null;
        wantListeningRef.current = false;
        return false;
      }
    },
    [lang]
  );

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
  }, []);

  // Never leak a live microphone session across unmounts.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
