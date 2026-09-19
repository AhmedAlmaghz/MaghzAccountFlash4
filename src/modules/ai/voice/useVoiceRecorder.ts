import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isVoiceRecordingSupported,
  pickRecorderMime,
  VOICE_MIC_CONSTRAINTS,
} from './audioConstraints';
import { blobToWavBase64, MAX_VOICE_SECONDS } from './wavEncoder';
import { transcribeVoiceNote } from './voiceTranscribe';

export type RecorderPhase = 'idle' | 'recording' | 'processing';

/**
 * File-based voice recorder → AI transcription → text.
 *
 * Flow: getUserMedia (DSP constraints: AEC + noise suppression + AGC) →
 * MediaRecorder (opus/webm, probed mime) + live AnalyserNode level meter →
 * stop → WAV transcode (16 kHz mono) → `transcribeVoiceNote` (Gemini etc.).
 *
 * The transcript is delivered ONCE via `lastTranscript` state (consumed with
 * `consumeTranscript`) — manual stop and timer auto-stop share this path, so
 * the component appends in a single `useEffect` and can never double-insert.
 * Web Speech stays the offline/no-key fallback; this hook is the quality path
 * when an API key exists.
 */
export function useVoiceRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [level, setLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const companyRef = useRef<string>('');
  const langRef = useRef<'ar' | 'en'>('ar');
  const finishingRef = useRef(false);

  const isSupported = isVoiceRecordingSupported();

  const teardown = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      void ctx.close().catch(() => undefined);
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    finishingRef.current = false;
    setLevel(0);
  }, []);

  // Never leak mic/recorder across unmounts.
  useEffect(() => () => teardown(), [teardown]);

  /** Shared finish path: stop recorder → blob → WAV → transcribe → deliver once. */
  const finishRecording = useCallback(async (): Promise<void> => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    // Claim the recorder first so a racing stop()/timer can't double-finish.
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          recorder.onstop = null;
          resolve();
        };
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }
    const blob = new Blob(chunksRef.current, {
      type: (recorder && recorder.mimeType) || 'audio/webm',
    });
    const companyId = companyRef.current;
    const lang = langRef.current;
    teardown();
    setPhase('processing');
    try {
      if (!blob || blob.size === 0) {
        setError('empty');
        return;
      }
      const wav = await blobToWavBase64(blob);
      const res = await transcribeVoiceNote({
        companyId,
        wavBase64: wav.base64,
        wavBytes: wav.bytes,
        lang,
        durationSec: wav.durationSec,
      });
      if (res.success && res.text) {
        setLastTranscript(res.text);
      } else {
        setError(res.error || 'transcribe_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'transcribe_failed');
    } finally {
      setPhase('idle');
    }
  }, [teardown]);

  const finishRef = useRef(finishRecording);
  // Mirror the latest finish path for the auto-stop timer (effect, never render).
  useEffect(() => {
    finishRef.current = finishRecording;
  });

  const start = useCallback(
    async (args: { companyId: string; lang: 'ar' | 'en' }): Promise<boolean> => {
      if (!isVoiceRecordingSupported() || recorderRef.current) return false;
      setError(null);
      setLastTranscript(null);
      companyRef.current = args.companyId;
      langRef.current = args.lang;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: VOICE_MIC_CONSTRAINTS,
        });
        streamRef.current = stream;
        const mime = pickRecorderMime();
        const recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onerror = () => {
          setError('record_error');
        };
        // Live level meter (display only — same AnalyserNode pattern as the
        // waveform in useVoiceDictation).
        try {
          const AudioCtx = window.AudioContext
            || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            audioCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.7;
            source.connect(analyser);
            analyserRef.current = analyser;
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              if (!analyserRef.current) return;
              analyserRef.current.getByteFrequencyData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) sum += data[i];
              setLevel(Math.min(100, Math.round(((sum / data.length) / 128) * 100)));
              rafRef.current = requestAnimationFrame(tick);
            };
            tick();
          }
        } catch {
          /* meter is best-effort */
        }
        recorderRef.current = recorder;
        recorder.start(250);
        setElapsedSec(0);
        setPhase('recording');
        timerRef.current = window.setInterval(() => {
          setElapsedSec((s) => {
            // Auto-stop at the cap via the shared finish path.
            if (s + 1 >= MAX_VOICE_SECONDS) void finishRef.current();
            return s + 1 >= MAX_VOICE_SECONDS ? s : s + 1;
          });
        }, 1000);
        return true;
      } catch {
        teardown();
        setError('not_allowed');
        return false;
      }
    },
    [teardown],
  );

  /** Manual stop → shared finish path (transcript lands in lastTranscript). */
  const stop = useCallback(async (): Promise<void> => {
    if (!recorderRef.current || finishingRef.current) return;
    await finishRecording();
  }, [finishRecording]);

  const cancel = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    chunksRef.current = [];
    teardown();
    setPhase('idle');
  }, [teardown]);

  const consumeTranscript = useCallback(() => {
    setLastTranscript(null);
  }, []);

  return {
    phase,
    level,
    elapsedSec,
    error,
    lastTranscript,
    isSupported,
    start,
    stop,
    cancel,
    consumeTranscript,
  };
}
