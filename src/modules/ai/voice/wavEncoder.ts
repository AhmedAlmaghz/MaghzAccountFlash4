/**
 * Client-side WAV transcoding (zero dependencies).
 *
 * WHY: the OpenAI-compatible `input_audio` part only accepts `wav`/`mp3`,
 * but MediaRecorder produces `webm/opus` (Chrome), `ogg` (Firefox) or `mp4`
 * (Safari). Sending those bytes labelled `mp3` mistranscribes silently.
 * Transcoding to 16 kHz mono 16-bit WAV is the universal STT ingest format
 * (Whisper/Gemini native) and keeps a 2-minute note under ~4 MB.
 *
 * The pure `encodeWavMono16k` is DOM-free and unit-tested; `blobToWavBase64`
 * handles the browser decode/resample steps around it.
 */

export const VOICE_TARGET_SAMPLE_RATE = 16000;
/** Hard stop for dictation notes (2 min @16kHz mono 16-bit ≈ 3.8 MB). */
export const MAX_VOICE_SECONDS = 120;

/** Pure PCM encoder: mono float samples → 16-bit WAV bytes. No DOM. */
export function encodeWavMono16k(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decode any recorded blob, downmix to mono, resample to 16 kHz, encode WAV.
 * Returns base64 WITHOUT the data: prefix (ready for `input_audio.data`).
 */
export async function blobToWavBase64(
  blob: Blob,
  targetRate: number = VOICE_TARGET_SAMPLE_RATE,
): Promise<{ base64: string; durationSec: number; bytes: number }> {
  if (!blob || blob.size === 0) throw new Error('empty');
  const AudioCtx = window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('no-audio-context');
  const raw = new Uint8Array(await blob.arrayBuffer());
  // Quick duration guard from the encoded size is unreliable — decode first.
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(raw.buffer as ArrayBuffer);
    if (!decoded || decoded.length === 0) throw new Error('empty');
    const durationSec = decoded.duration;
    if (durationSec > MAX_VOICE_SECONDS + 5) throw new Error('too_long');
    // Downmix all channels to mono at the native rate first.
    const nativeRate = decoded.sampleRate;
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < decoded.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    // Resample to the STT target rate with an OfflineAudioContext (best
    // practice: browser-quality resampling instead of naive decimation).
    let samples = mono;
    let rate = nativeRate;
    if (nativeRate !== targetRate) {
      const frames = Math.max(1, Math.ceil((decoded.length * targetRate) / nativeRate));
      const offline = new OfflineAudioContext(1, frames, targetRate);
      const source = offline.createBufferSource();
      const buffer = offline.createBuffer(1, decoded.length, nativeRate);
      buffer.getChannelData(0).set(mono);
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      samples = rendered.getChannelData(0).slice();
      rate = targetRate;
    }
    const wav = encodeWavMono16k(samples, rate);
    return { base64: uint8ToBase64(wav), durationSec, bytes: wav.length };
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}
