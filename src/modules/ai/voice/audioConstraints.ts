/**
 * Microphone constraints for voice capture (best practice).
 *
 * The live Web Speech path owns its own capture stream, but explicitly
 * requesting the mic with DSP constraints first warms up permission AND
 * engages the browser's built-in echo cancellation / noise suppression /
 * automatic gain control — the zero-dependency "noise isolation" tier.
 * Browsers ignore unknown constraints gracefully, so this is safe everywhere.
 */
export const VOICE_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Preferred recorder MIME types, probed in order (Chrome → Firefox → Safari). */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  '',
];

/** Pick the first MIME type the browser's MediaRecorder supports ('' = default). */
export function pickRecorderMime(): string {
  try {
    const MR = typeof window !== 'undefined'
      ? (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder
      : undefined;
    if (!MR || typeof MR.isTypeSupported !== 'function') return '';
    for (const mime of RECORDER_MIME_CANDIDATES) {
      if (!mime) return '';
      if (MR.isTypeSupported(mime)) return mime;
    }
    return '';
  } catch {
    return '';
  }
}

export function isVoiceRecordingSupported(): boolean {
  try {
    const w = window as unknown as { MediaRecorder?: unknown };
    return (
      typeof window !== 'undefined' &&
      typeof w.MediaRecorder !== 'undefined' &&
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')
    );
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget mic warmup: triggers the permission prompt early and lets
 * the browser's DSP chain settle before either STT path starts. Never throws
 * and never blocks — SpeechRecognition manages its own stream anyway.
 */
export async function warmUpMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_MIC_CONSTRAINTS });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}
